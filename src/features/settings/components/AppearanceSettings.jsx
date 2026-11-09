import React from "react"
import { Check, Monitor, Moon, Sun } from "lucide-react"
import { desktopShortcuts } from "@/shared/desktop/shortcuts.js"
/**
 * 复用同一选择器展示主题和配色，所有选项由面板提供，组件不读写偏好。
 */
function PreferenceChoices({ options, current, onSelect, accent = false }) {
  return (
    <div className={`theme-options ${accent ? "accent-options" : ""}`}>
      {options.map(({ id, title, icon: Glyph }) => (
        <button key={id} aria-pressed={id === current} className={id === current ? "active" : ""} onClick={() => onSelect(id)}>
          {accent ? <i className={"accent-swatch swatch-" + id} /> : <Glyph size={17} />}
          {title}
          {id === current && <Check size={16} />}
        </button>
      ))}
    </div>
  )
}

/**
 * 外观滑块即时预览，指针或键盘结束操作后才提交持久设置。
 * 参数范围与后端偏好规则一致，文字和图片不继承背景透明度。
 * 快捷键提示根据运行平台展示 Command 或 Ctrl，不改变实际注册的组合键。
 */
export default function AppearanceSettings({ settings, actions }) {
  const themes = [
    { id: "light", title: "浅色", icon: Sun },
    { id: "dark", title: "深色", icon: Moon },
    { id: "system", title: "跟随系统", icon: Monitor },
  ]
  const colors = Object.entries({ flame: "火焰", cyan: "青色", coral: "珊瑚红", violet: "紫色" }).map(([id, title]) => ({
    id,
    title,
  }))
  const sliders = [
    { field: "themeCoverage", title: "主题色占比", max: 90, hint: "调整两条主题色带的总宽度，每条各占一半。" },
    { field: "glassOpacity", title: "玻璃层不透明度", max: 100, hint: "数值越小越通透，文字与封面保持清晰。" },
  ]
  return (
    <section className="settings-section">
      <h2>
        <Sun size={20} />
        外观与快捷键
      </h2>
      <h3 className="setting-label">主题配色</h3>
      <PreferenceChoices
        options={colors}
        current={settings.accent || "flame"}
        onSelect={accent => actions.update({ accent })}
        accent
      />
      <h3 className="setting-label">界面外观</h3>
      <PreferenceChoices options={themes} current={settings.theme} onSelect={theme => actions.update({ theme })} />
      <div className="appearance-sliders">
        {sliders.map(({ field, title, max, hint }) => (
          <label key={field}>
            <span>
              {title}
              <output>{settings[field] ?? 70}%</output>
            </span>
            <input
              type="range"
              aria-label={title}
              min={10}
              max={max}
              step={1}
              value={settings[field] ?? 70}
              style={{ "--range-progress": `${(((settings[field] ?? 70) - 10) * 100) / (max - 10)}%` }}
              onChange={event => actions.preview(field, Number(event.target.value))}
              onPointerUp={event => actions.update({ [field]: Number(event.currentTarget.value) })}
              onKeyUp={event => actions.update({ [field]: Number(event.currentTarget.value) })}
            />
            <small>{hint}</small>
          </label>
        ))}
      </div>
      <div className="shortcut-list">
        {[
          ["播放 / 暂停", "空格"],
          ["搜索", desktopShortcuts.search],
          ["全局上一首 / 下一首", desktopShortcuts.skip],
          ["设置", desktopShortcuts.settings],
        ].map(([label, key]) => (
          <span key={label}>
            {label}
            <kbd>{key}</kbd>
          </span>
        ))}
      </div>
    </section>
  )
}
