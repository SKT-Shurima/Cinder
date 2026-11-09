/**
 * 以紧凑的声音工作台呈现预设、空间和均衡，浮层与设置页共用真实音效参数。
 * 图形只表达当前均衡设置，不冒充实时频谱；预览与自动保存继续使用同一条音频链。
 */
import React, { useEffect, useRef } from "react"
import { AudioLines, Headphones, RotateCcw, Speaker, Waves, X, Zap } from "lucide-react"
import { soundPresets } from "#shared/audioSettings"

/**
 * 固定四种已有预设的图标和短名称，完整名称用于辅助技术识别。
 * 自定义状态由参数调整产生，不增加没有实际处理能力的预设入口。
 */
const presetViews = [
  ["original", "原声", Headphones],
  ["reverb", "混响", Waves],
  ["electronic", "电音", Zap],
  ["warm", "温暖", Speaker],
]

/**
 * 从真实三段均衡增益绘制平滑的响应示意，零分贝与正负调节范围保持固定。
 * 这不是测量用滤波器频响，也不执行持续动画，只有参数改变才更新路径。
 */
function EqualizerCurve({ value }) {
  const y = key => 38 - value[key] * 1.8
  const path = `M 0 ${y("bass")} C 48 ${y("bass")}, 64 ${y("mid")}, 130 ${y("mid")} S 224 ${y("treble")}, 280 ${y("treble")}`
  return (
    <div className="eq-curve" aria-hidden="true">
      <svg viewBox="0 0 280 76" preserveAspectRatio="none">
        <path className="eq-grid" d="M0 16H280 M0 38H280 M0 60H280 M55 0V76 M140 0V76 M225 0V76" />
        <path className="eq-area" d={`${path} L280 76 L0 76Z`} />
        <path className="eq-line" d={path} />
      </svg>
      <div>
        <span>160 Hz</span>
        <span>1.2 kHz</span>
        <span>4.2 kHz</span>
      </div>
    </div>
  )
}

/**
 * 提供可复用的声音参数输入，空间参数横向调节，三段均衡采用竖向推子。
 * 拖动只触发实时预览，松手、键盘结束或失焦后提交最终值；原生输入保留范围与键盘行为。
 */
function SoundParameter({ parameter, value, onPreview, onCommit, vertical = false }) {
  const [key, label, min, max, unit, description] = parameter
  const dirty = useRef(false)
  const display = `${value[key] > 0 && unit === "dB" ? "+" : ""}${value[key]}`
  /**
   * 合并单个受限参数并进入自定义听感，保持其他推子和音效开关的最新状态。
   */
  function change(event, commit = false) {
    const next = { ...value, enabled: true, preset: "custom", [key]: Number(event.currentTarget.value) }
    dirty.current = !commit
    if (commit) {
      onCommit(next)
    } else {
      onPreview(next)
    }
  }
  return (
    <label className={`sound-parameter ${vertical ? "is-vertical" : ""}`}>
      <span className="parameter-heading">
        <span>
          {label}
          {!vertical && <small>{description}</small>}
        </span>
        <output>
          {display}
          <small>{unit}</small>
        </output>
      </span>
      <span className="parameter-track">
        <input
          type="range"
          min={min}
          max={max}
          step="1"
          aria-label={label}
          aria-valuetext={`${display} ${unit}`}
          aria-orientation={vertical ? "vertical" : "horizontal"}
          value={value[key]}
          onChange={event => change(event)}
          onPointerUp={event => change(event, true)}
          onBlur={event => {
            if (dirty.current) {
              change(event, true)
            }
          }}
          onKeyUp={event => {
            if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
              change(event, true)
            }
          }}
          style={{ "--range-progress": `${((value[key] - min) / (max - min)) * 100}%` }}
        />
        {vertical && <i aria-hidden="true" />}
      </span>
      {vertical && <small className="parameter-frequency">{description}</small>}
    </label>
  )
}

/**
 * 以预设切换、空间双推子及均衡器三个层次组织调整，浮层控制在可见窗口内。
 * 总开关保留用户参数；原声与重置才清零，任何布局切换均不重建音频元素。
 */
export function SoundControls({ value, onPreview, onCommit, expanded = false }) {
  const spatial = [
    ["reverb", "混响", 0, 100, "%", "让声音有呼吸的空间"],
    ["electronic", "电音强度", 0, 100, "%", "添加柔和的电子质感"],
  ]
  const equalizer = [
    ["bass", "低音", -12, 12, "dB", "160 Hz"],
    ["mid", "中音", -12, 12, "dB", "1.2 kHz"],
    ["treble", "高音", -12, 12, "dB", "4.2 kHz"],
  ]
  const presetName = value.preset === "custom" ? "自定义听感" : soundPresets[value.preset]?.name || "自选听感"
  return (
    <div className={`sound-controls ${expanded ? "is-expanded" : ""}`}>
      <div className="sound-status">
        <span>
          <i className={value.enabled ? "is-on" : ""} />
          <b>{value.enabled ? presetName : "原声直通"}</b>
          <small>{value.enabled ? "音效已开启" : "音效已关闭"}</small>
        </span>
        <label className="sound-toggle">
          <input
            aria-label="启用音效"
            type="checkbox"
            checked={value.enabled}
            onChange={event => onCommit({ ...value, enabled: event.target.checked })}
          />
          <span aria-hidden="true" />
        </label>
      </div>
      <div className="sound-presets" role="group" aria-label="音效预设">
        {presetViews.map(([key, label, Icon]) => (
          <button
            key={key}
            aria-label={soundPresets[key].name}
            aria-pressed={value.preset === key}
            className={value.preset === key ? "active" : ""}
            onClick={() => onCommit({ ...soundPresets[key], preset: key })}
          >
            <Icon size={15} strokeWidth={1.6} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="sound-groups">
        <section className="sound-space">
          <div className="sound-section-title">
            <span>空间与质感</span>
            <small>SPACE</small>
          </div>
          <div className="space-parameters">
            {spatial.map(parameter => (
              <SoundParameter key={parameter[0]} parameter={parameter} value={value} onPreview={onPreview} onCommit={onCommit} />
            ))}
          </div>
        </section>
        <section className="sound-equalizer">
          <div className="sound-section-title">
            <span>三段均衡</span>
            <small>EQUALIZER</small>
          </div>
          <EqualizerCurve value={value} />
          <div className="equalizer-faders">
            {equalizer.map(parameter => (
              <SoundParameter
                key={parameter[0]}
                parameter={parameter}
                value={value}
                onPreview={onPreview}
                onCommit={onCommit}
                vertical
              />
            ))}
          </div>
        </section>
      </div>
      <div className="sound-footnote">
        <span>
          <i />
          实时试听 · 自动保存
        </span>
        <button className="text-button" onClick={() => onCommit({ ...soundPresets.original, preset: "original" })}>
          <RotateCcw size={12} />
          还原原声
        </button>
      </div>
    </div>
  )
}

/**
 * 在播放栏上方展示轻量声音工作台，标题与控件共用主题色和玻璃材质。
 * 打开时移入焦点，关闭后恢复入口；组件卸载不改变已应用的音色与播放位置。
 */
export default function SoundEffects({ value, onPreview, onCommit, onClose }) {
  const panel = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    panel.current?.querySelector("button")?.focus({ preventScroll: true })
    const element = panel.current
    return () => {
      if (previous?.isConnected && (element?.contains(document.activeElement) || document.activeElement === document.body)) {
        previous.focus({ preventScroll: true })
      }
    }
  }, [])
  return (
    <aside className="sound-panel" aria-label="音效调节" ref={panel}>
      <div className="sound-heading">
        <div>
          <span className="studio-eyebrow">CINDER STUDIO</span>
          <h2>
            音色与空间
            <AudioLines size={18} strokeWidth={1.4} />
          </h2>
        </div>
        <button className="icon-button" aria-label="关闭音效面板" onClick={onClose}>
          <X size={17} />
        </button>
      </div>
      <SoundControls value={value} onPreview={onPreview} onCommit={onCommit} />
    </aside>
  )
}
