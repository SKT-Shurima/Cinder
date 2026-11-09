/**
 * 复用两个音频元素实现预加载与交叉淡化，界面仍只有一套播放状态。
 * 切歌准备期间保留原曲；仅在目标歌曲成功解码播放后切换活动声部。
 */
import { playbackTiming } from "@/features/playback/audio/playbackTiming.js"

/**
 * 协调固定的两个声部与共享混音器，预加载、新曲就绪和交叉淡化使用同一任务版本。
 * 新曲准备失败时保留旧曲，暂停和拖动时统一收束两路输出。
 */
export class PlaybackController {
  /**
   * 接管固定声部和共享混音器，外部 ref 始终指向已经就绪的活动音频。
   * 回调仅发布当前目标歌曲的状态，旧声部的暂停、结束事件不会干扰新歌曲。
   */
  constructor(elements, engine, { audioRef, playRequested, onState, onAdvance, onError }) {
    this.elements = elements
    this.engine = engine
    this.audioRef = audioRef
    this.playRequested = playRequested
    this.onState = onState
    this.onAdvance = onAdvance
    this.onError = onError
    this.active = elements[0]
    this.activeId = null
    this.desiredId = null
    this.nextId = null
    this.revision = 0
    this.loads = new Map()
    this.ids = new Map()
    this.listeners = []
    this.pending = null
    this.fade = null
    this.destroyed = false
    audioRef.current = this.active
    for (const element of elements) {
      for (const event of ["timeupdate", "play", "pause", "ended", "error"]) {
        const listener = () => this.handleEvent(element, event)
        element.addEventListener(event, listener)
        this.listeners.push([element, event, listener])
      }
    }
  }

  /**
   * 发布活动曲目的真实位置、时长和播放状态，不将待加载曲目的旧元数据带到界面。
   * 一次状态通知不会改变队列或重新加载文件。
   */
  publish() {
    if (this.activeId !== this.desiredId || !this.activeId) {
      return
    }
    this.onState({
      position: this.active.currentTime || 0,
      duration: Number.isFinite(this.active.duration) ? this.active.duration : 0,
      playing: !this.active.paused,
    })
  }

  /**
   * 统一处理两路媒体事件，在旧曲结束前提前进入下一首，为三秒交叉淡化留出准备余量。
   * 单曲循环或单首队列不会提前跳转；暂停、结束及出错的旧声部只负责资源回收。
   */
  handleEvent(element, event) {
    if (element !== this.active || this.activeId !== this.desiredId || !this.activeId) {
      return
    }
    if (event === "error") {
      if (!this.pending) {
        this.playRequested.current = false
        this.pause()
        this.onError("这首歌暂时无法播放，请检查文件或服务器连接。")
      }
      return
    }
    if (event === "ended") {
      if (!this.pending && !this.advancing) {
        this.advancing = true
        this.onAdvance()
      }
      return
    }
    this.publish()
    if (
      event === "timeupdate" &&
      !element.paused &&
      this.nextId &&
      this.nextId !== this.activeId &&
      !this.pending &&
      !this.advancing &&
      element.duration - element.currentTime <= playbackTiming.advanceBeforeEndSeconds
    ) {
      this.advancing = true
      this.onAdvance()
    }
  }

  /**
   * 准备指定声部的元数据，同一歌曲的预加载与正式切换共享一个请求。
   * 换源时取消旧监听；超时或解码失败只拒绝该请求，不中断另一声部正在播放的歌曲。
   * 已报媒体错误的声部不得作为就绪缓存复用，用户重试时重新请求音频。
   */
  load(element, id) {
    if (this.ids.get(element) === id && element.readyState >= 1 && !element.error) {
      return Promise.resolve()
    }
    const previous = this.loads.get(element)
    if (previous?.id === id) {
      return previous.promise
    }
    previous?.abort()
    const record = { id }
    this.ids.set(element, id)
    record.promise = new Promise((resolve, reject) => {
      /**
       * 元数据请求结束后移除临时监听与超时，防止后续换源重复触发旧回调。
       */
      const cleanup = () => {
        clearTimeout(timer)
        element.removeEventListener("loadedmetadata", ready)
        element.removeEventListener("error", failed)
        if (this.loads.get(element) === record) {
          this.loads.delete(element)
        }
      }
      /**
       * 元数据可用后允许控制器开始播放，真正可听的就绪状态继续由 play Promise 保证。
       */
      const ready = () => {
        cleanup()
        resolve()
      }
      /**
       * 区分解码失败与网络读取失败，预加载失败不会单独向用户重复报错。
       */
      const failed = () => {
        cleanup()
        reject(
          new Error(
            [3, 4].includes(element.error?.code)
              ? "这首歌的音频格式无法解码，请检查源文件。"
              : "歌曲读取失败，请检查文件或服务器连接。",
          ),
        )
      }
      record.abort = () => {
        cleanup()
        reject(new DOMException("已取消旧歌曲加载", "AbortError"))
      }
      element.addEventListener("loadedmetadata", ready)
      element.addEventListener("error", failed)
      const timer = setTimeout(failed, 18000)
      element.preload = "auto"
      element.src = `cinder://audio/${id}`
      element.load()
    })
    this.loads.set(element, record)
    return record.promise
  }

  /**
   * 提前准备下一首歌曲，最多占用另一个声部，不扫描或下载整个播放列表。
   * 淡化尚未完成或正在切歌时等待，避免预加载覆盖仍然可听的淡出歌曲。
   */
  warmNext() {
    if (!this.nextId || this.nextId === this.activeId || this.pending || this.fade || !this.activeId || this.destroyed) {
      return
    }
    const spare = this.elements.find(element => element !== this.active)
    this.load(spare, this.nextId).catch(() => {})
  }

  /**
   * 更新预加载目标，随机模式由外部固定本次候选，正式下一曲与预加载保持一致。
   * 单曲循环传入空目标，按原有结束事件从头重播。
   */
  setNext(id) {
    this.nextId = id
    this.warmNext()
  }

  /**
   * 清理上一轮交叉淡化，将活动声部恢复到完整音量并暂停另一路。
   * 连续快速切歌、拖动和暂停均先收束旧淡化，两个固定声部不会叠加成更多播放实例。
   */
  finishFade() {
    clearTimeout(this.fadeTimer)
    this.fadeTimer = null
    this.fade = null
    for (const element of this.elements) {
      this.engine.setDeckGain(element, element === this.active ? 1 : 0, 0.025)
      if (element !== this.active) {
        element.pause()
      }
    }
  }

  /**
   * 将目标歌曲加载到空闲声部，等新曲真正开始播放再同时排定旧曲淡出与新曲淡入。
   * 手动切歌保留三秒重叠；自动接歌按旧曲真实剩余时长裁剪，避免旧曲结束后仍等待淡入完成。
   * 用递增版本忽略快速切歌的过期请求；失败时保留原曲，并传递失败曲目标识以匹配服务器原因。
   */
  async setTrack(id, resume = 0) {
    if (!id || this.destroyed) {
      return
    }
    this.desiredId = id
    if (id === this.activeId && !this.pending) {
      this.publish()
      return
    }
    const revision = ++this.revision
    this.finishFade()
    this.advancing = false
    const incoming = this.activeId ? this.elements.find(element => element !== this.active) : this.active
    const outgoing = this.active
    const outgoingId = this.activeId
    this.pending = { id, revision }
    try {
      await this.load(incoming, id)
      if (revision !== this.revision || this.destroyed) {
        return
      }
      incoming.currentTime = Math.min(Math.max(0, resume), Number.isFinite(incoming.duration) ? incoming.duration : 0)
      const overlap = Boolean(outgoingId && !outgoing.paused && this.playRequested.current)
      this.engine.setDeckGain(incoming, overlap ? 0 : 1)
      if (overlap && !this.engine.context) {
        this.engine.initialize()
      }
      if (this.playRequested.current) {
        await this.engine.resume()
        if (revision !== this.revision || this.destroyed) {
          return
        }
        await incoming.play()
      }
      if (revision !== this.revision || this.destroyed) {
        return
      }
      if (!this.playRequested.current) {
        incoming.pause()
      }
      this.active = incoming
      this.activeId = id
      this.audioRef.current = incoming
      this.pending = null
      if (overlap && !incoming.paused && !outgoing.paused) {
        const remaining = Number.isFinite(outgoing.duration)
          ? Math.max(0.08, outgoing.duration - outgoing.currentTime)
          : playbackTiming.crossfadeSeconds
        const seconds = Math.min(playbackTiming.crossfadeSeconds, remaining)
        this.engine.crossfade(outgoing, incoming, seconds)
        this.fade = { outgoing, incoming }
        this.fadeTimer = setTimeout(
          () => {
            this.finishFade()
            this.warmNext()
          },
          seconds * 1000 + 50,
        )
      } else {
        this.finishFade()
        this.warmNext()
      }
      this.publish()
    } catch (error) {
      if (revision !== this.revision || this.destroyed || error.name === "AbortError") {
        return
      }
      this.pending = null
      incoming.pause()
      this.desiredId = outgoingId || id
      this.advancing = false
      const detail =
        error.name === "NotSupportedError" ? "这首歌的音频格式无法解码，请检查源文件。" : error.message || "歌曲暂时无法读取。"
      this.finishFade()
      this.publish()
      this.onError(`${detail}${outgoingId ? " 已保留当前播放。" : ""}`, outgoingId, id)
    }
  }

  /**
   * 继续当前曲目，准备中的切歌沿用同一个请求而不重复加载。
   * 如果上次读取失败，用户再次点击播放会重新尝试目标歌曲。
   */
  async play() {
    this.playRequested.current = true
    if (this.pending) {
      return
    }
    if (this.desiredId !== this.activeId) {
      return this.setTrack(this.desiredId)
    }
    try {
      await this.engine.resume()
      await this.active.play()
      this.publish()
    } catch (error) {
      if (error.name !== "AbortError") {
        this.onError(error)
      }
    }
  }

  /**
   * 同时暂停两路音频并收束淡化，拖动预览期间不会留下可听的旧声部。
   * 正在准备的歌曲可以继续读取元数据，但完成后必须保持暂停。
   */
  pause() {
    this.playRequested.current = false
    for (const element of this.elements) {
      element.pause()
    }
    this.finishFade()
    this.publish()
  }

  /**
   * 在有效时长内提交一次定位，跳转前结束重叠播放，避免旧歌在新位置继续淡出。
   * 尚未完成目标加载时不修改原曲；返回实际定位值供界面同步。
   */
  seek(value) {
    if (this.pending || !Number.isFinite(this.active.duration)) {
      return null
    }
    this.finishFade()
    this.advancing = false
    this.active.currentTime = Math.max(0, Math.min(value, this.active.duration))
    this.publish()
    return this.active.currentTime
  }

  /**
   * 卸载时取消所有等待、计时器和事件监听，停止两个声部后再由外部销毁音频图。
   * 异步加载完成后通过版本与销毁标记丢弃，不再修改卸载后的 React 状态。
   */
  destroy() {
    this.destroyed = true
    this.revision++
    clearTimeout(this.fadeTimer)
    for (const record of [...this.loads.values()]) {
      record.abort()
    }
    for (const [element, event, listener] of this.listeners) {
      element.removeEventListener(event, listener)
    }
    for (const element of this.elements) {
      element.pause()
    }
  }
}
