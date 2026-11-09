/**
 * 通过浏览器原生音频节点处理音色与详情频谱，不下载、转码或复制整首音频。
 * 两个固定媒体源轮流读取歌曲，共享音效与频谱；切歌在音频线程中交叉淡化。
 */
import { normalizeSound } from "#shared/audioSettings"
import { playbackTiming } from "@/features/playback/audio/playbackTiming.js"

/**
 * 生成有限长度的立体声房间响应，只在首次使用混响时创建一次。
 * 使用可复现的噪声衰减，不发起外部资源请求，避免每次拖动滑块重建卷积缓存。
 */
function roomImpulse(context) {
  const length = Math.floor(context.sampleRate * 1.8)
  const buffer = context.createBuffer(2, length, context.sampleRate)
  let seed = 719
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    for (let index = 0; index < length; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      data[index] = (seed / 2147483648 - 1) * Math.pow(1 - index / length, 3.4)
    }
  }
  return buffer
}

/**
 * 创建小信号增益接近一的柔和饱和曲线，降低电子预设的刺耳感与音量突变。
 * 不使用高增益削波；曲线只创建一次，强度由干湿混合调节，不在进度回调中生成数组。
 */
function electronicCurve() {
  return Float32Array.from({ length: 2048 }, (_, index) => Math.tanh((index / 1023.5 - 1) * 1.35) / 1.35)
}

/**
 * 为固定的音频元素维护唯一的共享效果链，首次使用音效、频谱或交叉淡化时创建音频上下文。
 * 原声状态保留浏览器默认播放通道；接入后关闭效果则重新连接直通，避免重复媒体源或声音叠加。
 */
export class AudioEffectsEngine {
  /**
   * 绑定两个复用的播放声部与错误提示，单元素调用仍可用于独立音效试听。
   * 任一声部播放时恢复上下文；只有全部暂停才挂起，避免淡出声部暂停时截断新歌曲。
   */
  constructor(element, onError) {
    this.elements = Array.isArray(element) ? element : [element]
    this.element = this.elements[0]
    this.weights = new Map(this.elements.map((item, index) => [item, index ? 0 : 1]))
    this.decks = new Map()
    this.onError = onError
    this.settings = normalizeSound()
    this.context = null
    this.nodes = null
    this.mode = null
    this.handlePlay = () => this.resume().catch(onError)
    this.handlePause = () => {
      if (this.elements.every(item => item.paused)) {
        this.context?.suspend().catch(onError)
      }
    }
    for (const item of this.elements) {
      item.addEventListener("play", this.handlePlay)
      item.addEventListener("pause", this.handlePause)
    }
  }

  /**
   * 在明确播放前准备并恢复共享音频线程，原声模式也预先建立两路混音通道。
   * 首次切歌不再临时更换音频输出路径，防止交叉淡化开始前出现短暂静音。
   * 已暂停的音频不会因此开始播放；恢复失败交给界面提示。
   */
  async resume() {
    if (!this.context) {
      this.initialize()
    }
    if (this.context?.state === "suspended") {
      await this.context.resume()
    }
  }

  /**
   * 为可见的播放详情提供实际输出频谱，原声模式也复用同一个媒体源。
   * 分析节点不接入扬声器，不叠加音量；只读取本地音频线程数据，不录音或向外发送音频。
   */
  getAnalyser() {
    if (!this.context) {
      this.initialize()
    }
    if (!this.analyser) {
      this.analyser = this.context.createAnalyser()
      this.analyser.fftSize = 1024
      this.analyser.smoothingTimeConstant = 0.68
      this.analyser.minDecibels = -85
      this.analyser.maxDecibels = -18
    }
    this.visualizing = true
    this.attachAnalysis()
    if (this.elements.some(item => !item.paused)) {
      this.resume().catch(this.onError)
    }
    return this.analyser
  }

  /**
   * 跟随原声或效果旁路选择实际输出节点，切换预设后分析器仍反映当前听到的声音。
   * 接线前移除旧分支，兼容旁路切换已经断开媒体源全部连接的情况。
   */
  attachAnalysis() {
    if (!this.visualizing || !this.analyser) {
      return
    }
    if (this.analysisTap) {
      try {
        this.analysisTap.disconnect(this.analyser)
      } catch {}
    }
    this.analysisTap = this.mode === "effects" ? this.nodes.output : this.source
    this.analysisTap.connect(this.analyser)
  }

  /**
   * 详情收起、暂停或进入后台时断开频谱分支，停止额外分析计算。
   * 保留媒体源与音效链，不能销毁已关联媒体元素的上下文，否则继续播放会失声。
   */
  releaseAnalyser() {
    this.visualizing = false
    if (this.analysisTap && this.analyser) {
      try {
        this.analysisTap.disconnect(this.analyser)
      } catch {}
    }
    this.analysisTap = null
  }

  /**
   * 首次启用时构建均衡、混响、柔和饱和与立体声微延迟节点。
   * 电子分支过滤极低频和尖锐高频，慢速延迟变化增加空间感，不对人声施加音频频率的振幅调制。
   * 音频必须通过允许匿名跨域读取的本地协议提供，否则浏览器会将媒体源静音。
   */
  initialize() {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext
    if (!Context) {
      throw new Error("当前环境不支持实时音效")
    }
    const context = new Context({ latencyHint: "playback" })
    const source = context.createGain()
    try {
      for (const element of this.elements) {
        const media = context.createMediaElementSource(element)
        const level = context.createGain()
        level.gain.value = this.weights.get(element) ?? 0
        media.connect(level)
        level.connect(source)
        this.decks.set(element, { media, level })
      }
    } catch (error) {
      context.close()
      throw error
    }
    this.context = context
    this.source = source
    const input = context.createGain()
    const bass = context.createBiquadFilter()
    const mid = context.createBiquadFilter()
    const treble = context.createBiquadFilter()
    bass.type = "lowshelf"
    bass.frequency.value = 160
    mid.type = "peaking"
    mid.frequency.value = 1200
    mid.Q.value = 0.7
    treble.type = "highshelf"
    treble.frequency.value = 4200
    const dry = context.createGain()
    const reverb = context.createConvolver()
    const wet = context.createGain()
    const shaper = context.createWaveShaper()
    shaper.curve = electronicCurve()
    shaper.oversample = "2x"
    const electronicInput = context.createBiquadFilter()
    electronicInput.type = "highpass"
    electronicInput.frequency.value = 110
    electronicInput.Q.value = 0.7
    const polish = context.createBiquadFilter()
    polish.type = "lowpass"
    polish.frequency.value = 8200
    polish.Q.value = 0.7
    const electronic = context.createGain()
    const width = context.createGain()
    const left = context.createDelay(0.1)
    const right = context.createDelay(0.1)
    left.delayTime.value = 0.014
    right.delayTime.value = 0.022
    const panLeft = context.createStereoPanner()
    const panRight = context.createStereoPanner()
    panLeft.pan.value = -0.85
    panRight.pan.value = 0.85
    const depthLeft = context.createGain()
    const depthRight = context.createGain()
    depthLeft.gain.value = 0.0025
    depthRight.gain.value = -0.002
    const output = context.createDynamicsCompressor()
    output.threshold.value = -9
    output.knee.value = 16
    output.ratio.value = 6
    output.attack.value = 0.004
    output.release.value = 0.16
    input.connect(bass)
    bass.connect(mid)
    mid.connect(treble)
    treble.connect(dry)
    dry.connect(output)
    reverb.connect(wet)
    wet.connect(output)
    electronicInput.connect(shaper)
    shaper.connect(polish)
    polish.connect(electronic)
    electronic.connect(output)
    polish.connect(left)
    polish.connect(right)
    left.connect(panLeft)
    right.connect(panRight)
    panLeft.connect(width)
    panRight.connect(width)
    width.connect(output)
    depthLeft.connect(left.delayTime)
    depthRight.connect(right.delayTime)
    output.connect(context.destination)
    this.nodes = {
      input,
      bass,
      mid,
      treble,
      dry,
      reverb,
      wet,
      shaper,
      electronicInput,
      electronic,
      width,
      depthLeft,
      depthRight,
      output,
    }
    this.configure()
  }

  /**
   * 接收经过限幅的最新参数，原声旁路与效果链只在开关变化时重新接线。
   * 调整失败时恢复已有媒体源的直通连接，避免创建效果后让音乐永久失声。
   */
  apply(value) {
    this.settings = normalizeSound(value)
    try {
      if (!this.context && !this.settings.enabled) {
        return
      }
      if (!this.context) {
        this.initialize()
      } else {
        this.configure()
      }
      if (this.elements.some(item => !item.paused)) {
        this.resume().catch(this.onError)
      } else {
        this.context.suspend().catch(this.onError)
      }
    } catch (error) {
      if (this.source && this.context) {
        this.source.disconnect()
        this.source.connect(this.context.destination)
        this.mode = "bypass"
      }
      this.onError(error)
    }
  }

  /**
   * 平滑修改实时参数，仅在分支启停时接线，拖动增益不重建音频图。
   * 电子音色保留主体干声，以少量柔和饱和和两侧微延迟增加质感，避免机械振幅调制和明显回声。
   * 均衡提升前预留增益余量，最终压缩器限制叠加峰值；暂停或切歌不更换媒体源。
   */
  configure() {
    const value = this.settings
    const n = this.nodes
    const context = this.context
    const mode = value.enabled ? "effects" : "bypass"
    if (mode !== this.mode) {
      this.source.disconnect()
      this.source.connect(value.enabled ? n.input : context.destination)
      this.mode = mode
      this.attachAnalysis()
    }
    const electronic = value.enabled ? value.electronic / 100 : 0
    const reverb = value.enabled ? value.reverb / 100 : 0
    if (Boolean(reverb) !== Boolean(this.reverbConnected)) {
      if (reverb > 0) {
        if (!n.reverb.buffer) {
          n.reverb.buffer = roomImpulse(context)
        }
        n.treble.connect(n.reverb)
      } else {
        n.treble.disconnect(n.reverb)
      }
      this.reverbConnected = reverb > 0
    }
    if (Boolean(electronic) !== Boolean(this.electronicConnected)) {
      if (electronic > 0) {
        n.treble.connect(n.electronicInput)
      } else {
        n.treble.disconnect(n.electronicInput)
      }
      this.electronicConnected = electronic > 0
    }
    if (electronic > 0) {
      if (!this.oscillator) {
        this.oscillator = context.createOscillator()
        this.oscillator.frequency.value = 0.32
        this.oscillator.connect(n.depthLeft)
        this.oscillator.connect(n.depthRight)
        this.oscillator.start()
      }
    } else if (this.oscillator) {
      this.oscillator.stop()
      this.oscillator.disconnect()
      this.oscillator = null
    }
    const params = [
      [n.input.gain, Math.pow(10, -Math.max(0, value.bass, value.mid, value.treble) / 20)],
      [n.bass.gain, value.bass],
      [n.mid.gain, value.mid],
      [n.treble.gain, value.treble],
      [n.dry.gain, 1 - electronic * 0.32],
      [n.electronic.gain, electronic * 0.22],
      [n.width.gain, electronic * 0.11],
      [n.wet.gain, reverb * 0.65],
    ]
    for (const [parameter, target] of params) {
      parameter.cancelScheduledValues(context.currentTime)
      parameter.setTargetAtTime(target, context.currentTime, 0.025)
    }
  }

  /**
   * 设置单个播放声部的混音增益，音量滑块继续控制两路相同的主音量。
   * 未建上下文时只保存权重；已经排定的淡化会先取消，快速连续切歌不会累积旧曲线。
   */
  setDeckGain(element, value, seconds = 0) {
    this.weights.set(element, value)
    const parameter = this.decks.get(element)?.level.gain
    if (!parameter) {
      return
    }
    const now = this.context.currentTime
    if (parameter.cancelAndHoldAtTime) {
      parameter.cancelAndHoldAtTime(now)
    } else {
      const current = parameter.value
      parameter.cancelScheduledValues(now)
      parameter.setValueAtTime(current, now)
    }
    if (seconds) {
      parameter.linearRampToValueAtTime(value, now + seconds)
    } else {
      parameter.setValueAtTime(value, now)
    }
  }

  /**
   * 在音频线程排定等功率交叉淡化，两首歌曲在限定秒数内重叠输出。
   * 新声部必须已经成功开始播放；固定数组仅在切歌时生成，不依赖界面帧率或后台计时精度。
   * 中点两首歌均保持约七成增益，避免先淡出到静音再启动下一首造成听感断层。
   */
  crossfade(outgoing, incoming, seconds = playbackTiming.crossfadeSeconds) {
    if (!this.context) {
      this.initialize()
    }
    const now = this.context.currentTime
    const count = 256
    for (const [element, entering] of [
      [outgoing, false],
      [incoming, true],
    ]) {
      this.setDeckGain(element, entering ? 0 : 1)
      const curve = Float32Array.from({ length: count }, (_, index) =>
        entering ? Math.sin(((index / (count - 1)) * Math.PI) / 2) : Math.cos(((index / (count - 1)) * Math.PI) / 2),
      )
      this.decks.get(element).level.gain.setValueCurveAtTime(curve, now, seconds)
      this.weights.set(element, entering ? 1 : 0)
    }
    this.resume().catch(this.onError)
  }

  /**
   * 卸载播放器时移除两个声部的监听并释放共享音频线程。
   * 普通切歌不销毁媒体源，避免同一媒体元素被重复关联而失声。
   */
  destroy() {
    for (const element of this.elements) {
      element.removeEventListener("play", this.handlePlay)
      element.removeEventListener("pause", this.handlePause)
    }
    this.releaseAnalyser()
    if (this.oscillator) {
      this.oscillator.stop()
      this.oscillator.disconnect()
    }
    for (const { media, level } of this.decks.values()) {
      media.disconnect()
      level.disconnect()
    }
    this.source?.disconnect()
    this.context?.close().catch(() => {})
  }
}
