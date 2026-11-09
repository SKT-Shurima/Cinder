/**
 * 用主题色烟雾火焰标记真实播放进度，拖动时只预览，松手后统一提交跳转。
 * 横向与纵向进度共用原生范围输入，保留键盘、读屏和指针捕获行为。
 */
import React, { useEffect, useRef, useState } from "react"
import SmokeFlame from "@/features/playback/components/SmokeFlame.jsx"

/**
 * 将秒数表达为可访问的分钟与秒，明确预览位置和总时长。
 * 未读到总时长时显示零，不把火焰动画位置用作音频时间。
 */
function progressTime(value) {
  const seconds = Math.max(0, Math.floor(value || 0))
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

/**
 * 管理一次指针或键盘拖动会话，期间只更新草稿与预览，结束时才提交最终时间。
 * 释放到控件之外仍可提交；Escape 或指针取消交回外层恢复原状态，卸载时也取消未完成会话。
 * 将拖动方式提供给样式层，鼠标拖动隐藏边框，键盘定位继续保留可见焦点。
 */
export default function FlameRange({
  value,
  max,
  onChange,
  onBegin,
  onPreview,
  onCancel,
  label = "播放进度",
  vertical = false,
  playing = false,
}) {
  const [foreground, setForeground] = useState(() => !document.hidden)
  const [draft, setDraft] = useState(null)
  const interaction = useRef(null)
  const latest = useRef({})
  latest.current = { onChange, onBegin, onPreview, onCancel }
  const duration = Math.max(1, Number.isFinite(max) ? max : 1)
  const position = Math.max(0, Math.min(duration, draft ?? (Number.isFinite(value) ? value : 0)))
  const progress = position / duration

  /**
   * 结束当前预览，提交或取消只执行一次，避免原生控件与窗口释放事件重复跳转。
   * 操作最终值保存在引用中，快速松手不会提交上一帧的 React 状态。
   */
  function finish(cancel = false) {
    const session = interaction.current
    if (!session) {
      return
    }
    interaction.current = null
    setDraft(null)
    if (cancel) {
      latest.current.onCancel?.()
    } else {
      latest.current.onChange(session.value)
    }
  }

  useEffect(() => {
    const changed = () => setForeground(!document.hidden)
    const up = () => {
      if (interaction.current?.mode === "pointer") {
        finish()
      }
    }
    const cancel = () => {
      if (interaction.current?.mode === "pointer") {
        finish(true)
      }
    }
    document.addEventListener("visibilitychange", changed)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", cancel)
    return () => {
      document.removeEventListener("visibilitychange", changed)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", cancel)
      if (interaction.current) {
        interaction.current = null
        latest.current.onCancel?.()
      }
    }
  }, [])

  /**
   * 开始拖动前通知播放器暂停输出，后续原生输入只更新待提交的位置。
   * 重复方向键不会重复启动会话，避免覆盖最初的播放状态。
   */
  function begin(mode) {
    if (interaction.current) {
      return
    }
    interaction.current = { mode, value: position }
    setDraft(position)
    latest.current.onBegin?.()
  }

  /**
   * 接收范围输入的新值，活动会话只预览；读屏软件的单次直接调整可立即提交。
   * 音频 seek 始终由外层处理，组件本身不读取或修改媒体元素。
   */
  function change(event) {
    const next = Number(event.target.value)
    if (interaction.current) {
      interaction.current.value = next
      setDraft(next)
      latest.current.onPreview?.(next)
    } else {
      latest.current.onChange(next)
    }
  }

  return (
    <div
      className={`flame-range ${vertical ? "is-vertical" : ""} ${(playing || draft !== null) && foreground ? "is-burning" : ""} ${draft !== null ? "is-scrubbing" : ""}`}
      data-scrub-mode={interaction.current?.mode}
      style={{ "--progress": `${progress * 100}%`, "--progress-scale": progress }}
    >
      <span className="flame-track" aria-hidden="true">
        <i />
      </span>
      <span className="flame-travel" aria-hidden="true">
        <span className="flame-handle">
          <SmokeFlame active={(playing || draft !== null) && foreground} />
        </span>
      </span>
      <input
        className="flame-input"
        aria-label={label}
        aria-valuetext={`${progressTime(position)}，共 ${progressTime(duration)}`}
        aria-orientation={vertical ? "vertical" : "horizontal"}
        type="range"
        min="0"
        max={duration}
        step="0.1"
        value={position}
        onPointerDown={event => {
          begin("pointer")
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onChange={change}
        onPointerUp={() => finish()}
        onPointerCancel={() => finish(true)}
        onKeyDown={event => {
          if (event.key === "Escape" && interaction.current) {
            event.preventDefault()
            event.stopPropagation()
            finish(true)
          } else if (
            ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)
          ) {
            begin("keyboard")
          }
        }}
        onKeyUp={() => {
          if (interaction.current?.mode === "keyboard") {
            finish()
          }
        }}
        onBlur={() => {
          if (interaction.current?.mode === "keyboard") {
            finish()
          }
        }}
      />
    </div>
  )
}
