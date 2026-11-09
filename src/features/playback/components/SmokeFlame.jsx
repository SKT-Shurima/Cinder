/**
 * 在透明小画布中绘制随主题变色的烟雾火焰，替代硬边的圆点或水滴形滑块。
 * 只绘制细小流光和半透明烟丝，暂停、后台和减少动态效果时保留静态形态。
 */
import React, { memo, useEffect, useRef, useState } from "react"

/**
 * 用连续曲线组成上升的火焰烟丝，主题色决定外焰，浅色核心保持透明的发光层次。
 * 固定采样规模与小画布限制绘制成本，不使用视频、远程贴图或大范围模糊滤镜。
 */
function paintFlame(context, phase, color) {
  context.clearRect(0, 0, 32, 48)
  const rgb = color
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number) || [173, 75, 44]
  const core = `rgb(${rgb.map(value => Math.round(value * 0.3 + 255 * 0.7)).join(",")})`
  const gradient = context.createLinearGradient(0, 46, 0, 2)
  gradient.addColorStop(0, color)
  gradient.addColorStop(0.42, color)
  gradient.addColorStop(0.72, core)
  gradient.addColorStop(1, "transparent")
  context.lineCap = "round"
  for (let ribbon = 0; ribbon < 9; ribbon++) {
    const offset = (ribbon - 4) * 0.7
    context.beginPath()
    for (let point = 0; point < 17; point++) {
      const rise = point / 16
      const taper = Math.sin(Math.PI * rise) * (0.8 + Math.sin(phase * 0.7 + ribbon) * 0.15)
      const x =
        16 +
        offset * (1 - rise) +
        Math.sin(rise * 7.5 - phase * 1.9 + ribbon * 0.45) * taper * 7 +
        Math.sin(phase * 0.9 + rise * 5) * rise * 5
      const y = 46 - rise * (35 + Math.sin(phase * 0.8 + ribbon * 0.6) * 5)
      if (point === 0) {
        context.moveTo(x, y)
      } else {
        context.lineTo(x, y)
      }
    }
    context.strokeStyle = gradient
    context.globalAlpha = 0.045
    context.lineWidth = 4.5
    context.stroke()
    context.globalAlpha = ribbon % 3 === 0 ? 0.52 : 0.26
    context.lineWidth = ribbon % 3 === 0 ? 1.25 : 0.65
    context.stroke()
  }
  const glow = context.createRadialGradient(16, 39, 1, 16, 39, 9)
  glow.addColorStop(0, core)
  glow.addColorStop(0.25, color)
  glow.addColorStop(1, "transparent")
  context.fillStyle = glow
  context.globalAlpha = 0.4
  context.fillRect(5, 29, 22, 18)
  context.globalAlpha = 1
}

/**
 * 以最多二十四帧更新小尺寸烟焰，主题改变时重新取色，拖动预览也可保持火焰活动。
 * 每帧只更新像素，停止时冻结当前形态；卸载后清理帧回调与主题观察器。
 */
function SmokeFlame({ active }) {
  const canvas = useRef(null)
  const phase = useRef(1.7)
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches)
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)")
    const changed = event => setReduced(event.matches)
    media.addEventListener("change", changed)
    return () => media.removeEventListener("change", changed)
  }, [])
  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext("2d")
    if (!context) {
      return
    }
    element.width = 48
    element.height = 72
    context.setTransform(1.5, 0, 0, 1.5, 0, 0)
    let frame = 0
    let last = 0
    let color = getComputedStyle(element).color
    const changed = () => {
      color = getComputedStyle(element).color
      paintFlame(context, phase.current, color)
    }
    const observer = new MutationObserver(changed)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-theme", "data-accent"] })

    /**
     * 按固定帧率推进烟丝流动，避免进度状态或高刷新率屏幕增加绘制次数。
     * 暂停和系统减少动态效果时仅保留一帧，不运行持续回调。
     */
    function draw(timestamp) {
      if (timestamp - last >= 1000 / 24) {
        last = timestamp
        phase.current = timestamp / 1000
        paintFlame(context, phase.current, color)
      }
      if (active && !reduced) {
        frame = requestAnimationFrame(draw)
      }
    }
    paintFlame(context, phase.current, color)
    if (active && !reduced) {
      frame = requestAnimationFrame(draw)
    }
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [active, reduced])
  return <canvas className="smoke-flame" ref={canvas} aria-hidden="true" />
}

export default memo(SmokeFlame)
