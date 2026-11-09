/**
 * 用真实输出的频谱与响度绘制双向发光柱，跟随音乐强弱与频率变化。
 * 单一 Canvas 最多每秒绘制三十帧，不通过 React 更新每帧状态，不录音或发送音频。
 */
import React, { memo, useEffect, useRef, useState } from "react"

/**
 * 将真实频带强度绘制为双向发光柱，不再叠加点状波形或粒子。
 * 低频位于中心并向两侧展开高频；静音清空画布，不用固定正弦动画替代音频输入。
 * 采用分层细描边模拟光晕，避免逐帧模糊与大面积阴影的持续开销。
 */
function paintSpectrum(context, width, height, frequency, envelope, color, highlight) {
  context.clearRect(0, 0, width, height)
  if (envelope < 0.004) {
    return
  }
  const center = height * 0.56
  const bars = Math.min(150, Math.max(64, Math.floor(width / 8)))
  const spacing = width / (bars - 1)
  const gradient = context.createLinearGradient(0, center - height * 0.45, 0, center + height * 0.45)
  gradient.addColorStop(0, color)
  gradient.addColorStop(0.5, highlight)
  gradient.addColorStop(1, color)
  context.lineCap = "round"
  for (let index = 0; index < bars; index++) {
    const x = index / (bars - 1)
    const distance = Math.abs(x - 0.5) * 2
    const band = Math.min(frequency.length - 2, Math.floor(2 + Math.pow(distance, 1.6) * 200))
    const strength = (frequency[band] + frequency[band - 1] + frequency[band + 1]) / 765
    const amplitude = Math.pow(strength, 1.4) * height * 0.43 * envelope * (0.45 + 0.55 * Math.sin(Math.PI * x))
    if (amplitude < 1.4) {
      continue
    }
    context.beginPath()
    context.moveTo(x * width, center - amplitude)
    context.lineTo(x * width, center + amplitude)
    context.strokeStyle = color
    context.lineWidth = Math.min(6, spacing * 0.75)
    context.globalAlpha = 0.035 * envelope
    context.stroke()
    context.strokeStyle = gradient
    context.lineWidth = Math.max(1.2, Math.min(3, spacing * 0.34))
    context.globalAlpha = (0.14 + strength * 0.4) * envelope
    context.stroke()
  }
  context.globalAlpha = 1
}

/**
 * 在详情可见且播放时连接现有音频分析器，暂停、静音、收起或进入后台后停止取样。
 * 画布限制像素密度和帧率，主题与尺寸变化由独立观察器响应，卸载时释放所有监听和帧回调。
 * 系统减少动态效果时只绘制一次当前频谱，不运行连续动画。
 */
function PlaybackWave({ playing, visible, silent, getAnalyser, releaseAnalyser }) {
  const canvas = useRef(null)
  const [foreground, setForeground] = useState(() => !document.hidden)
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches)
  useEffect(() => {
    const changed = () => setForeground(!document.hidden)
    const media = matchMedia("(prefers-reduced-motion: reduce)")
    const motion = event => setReduced(event.matches)
    document.addEventListener("visibilitychange", changed)
    media.addEventListener("change", motion)
    return () => {
      document.removeEventListener("visibilitychange", changed)
      media.removeEventListener("change", motion)
    }
  }, [])
  const active = playing && visible && foreground && !silent
  useEffect(() => {
    if (!active || !canvas.current) {
      return
    }
    const element = canvas.current
    const context = element.getContext("2d", { alpha: true })
    const analyser = getAnalyser()
    if (!context || !analyser) {
      return
    }
    const frequency = new Uint8Array(analyser.frequencyBinCount)
    const waveform = new Float32Array(analyser.fftSize)
    let frame = 0
    let last = 0
    let envelope = 0
    let width = 0
    let height = 0
    let color = ""
    let highlight = ""
    let alive = true

    /**
     * 跟随可用区域调整绘制分辨率，限制高分屏像素密度以控制持续渲染成本。
     * 只在布局变化时读取尺寸，不在每帧测量歌词或其他页面元素。
     */
    function resize() {
      width = Math.max(1, Math.min(1600, element.clientWidth))
      height = Math.max(1, element.clientHeight)
      const ratio = Math.min(1.25, devicePixelRatio || 1)
      element.width = Math.round(width * ratio)
      element.height = Math.round(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }

    /**
     * 从主题继承实际颜色，避免为每帧绘图触发样式计算。
     * 调整配色或浅深模式后更新画布用色，不影响正在播放的音频。
     */
    function recolor() {
      color = getComputedStyle(element.parentElement).color
      const rgb = color.match(/[\d.]+/g)?.slice(0, 3) || [170, 90, 60]
      highlight = `rgb(${rgb.map(channel => Math.round(Number(channel) * (document.documentElement.dataset.theme === "dark" ? 0.35 : 0.8) + 255 * (document.documentElement.dataset.theme === "dark" ? 0.65 : 0.2))).join(",")})`
    }

    /**
     * 读取真实频谱与波形，使用快速上升、平缓衰减的响度包络响应节奏。
     * 每次只更新画布像素，不改变 DOM 或 React 状态；暂停后由 effect 清理循环和分析分支。
     */
    function draw(timestamp) {
      if (!alive) {
        return
      }
      if (timestamp - last >= 1000 / 30 || reduced) {
        last = timestamp
        analyser.getByteFrequencyData(frequency)
        analyser.getFloatTimeDomainData(waveform)
        let power = 0
        for (let index = 0; index < waveform.length; index++) {
          power += waveform[index] * waveform[index]
        }
        const target = Math.min(1, Math.sqrt(Math.sqrt(power / waveform.length)) * 2.8)
        envelope = reduced ? target : envelope + (target - envelope) * (target > envelope ? 0.6 : 0.16)
        paintSpectrum(context, width, height, frequency, envelope, color, highlight)
      }
      if (!reduced) {
        frame = requestAnimationFrame(draw)
      }
    }
    resize()
    recolor()
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    const theme = new MutationObserver(recolor)
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-accent", "style"] })
    frame = requestAnimationFrame(draw)
    return () => {
      alive = false
      cancelAnimationFrame(frame)
      observer.disconnect()
      theme.disconnect()
      releaseAnalyser()
    }
  }, [active, reduced, getAnalyser, releaseAnalyser])
  return (
    <div className={`playback-wave ${active ? "is-active" : ""}`} aria-hidden="true">
      <canvas ref={canvas} className="spectrum-canvas" />
    </div>
  )
}

export default memo(PlaybackWave)
