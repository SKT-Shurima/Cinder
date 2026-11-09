/**
 * 按外观、音乐来源、播放音效和封面管理拆分设置，避免长页面混排不同任务。
 * 切换后只挂载当前类型的内容，远程凭据表单离开类型时随组件卸载销毁。
 */
import React from "react"
import { AudioLines, ImagePlus, Palette, Server } from "lucide-react"

/**
 * 固定设置分类的标识、名称和图标，为页签及内容面板提供稳定关联。
 * 标识仅用于当前界面导航，不改变保存的偏好字段与音乐来源。
 */
const tabs = [
  ["appearance", "外观", Palette],
  ["sources", "音乐来源", Server],
  ["sound", "播放音效", AudioLines],
  ["covers", "封面管理", ImagePlus],
]

/**
 * 提供桌面设置页签，方向键和 Home / End 可移动并选中分类。
 * 页签保持在原位置，外层负责切换内容与滚动；不会暂停音乐或清空播放队列。
 */
export default function SettingsTabs({ value, onChange }) {
  /**
   * 在分类内循环移动焦点并同步选择，阻止方向键把设置页面滚动到意外位置。
   * 只有页签内的导航键会被接管，Tab 保留原生进入面板和表单的顺序。
   */
  function keyboard(event) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return
    }
    event.preventDefault()
    const index = tabs.findIndex(([id]) => id === value)
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length
    onChange(tabs[next][0])
    event.currentTarget.querySelectorAll('[role="tab"]')[next]?.focus({ preventScroll: true })
  }
  return (
    <div className="settings-tabs" role="tablist" aria-label="设置分类" onKeyDown={keyboard}>
      {tabs.map(([id, label, Icon]) => (
        <button
          key={id}
          id={`settings-tab-${id}`}
          role="tab"
          aria-selected={value === id}
          aria-controls={`settings-panel-${id}`}
          tabIndex={value === id ? 0 : -1}
          className={value === id ? "active" : ""}
          onClick={() => onChange(id)}
        >
          <Icon size={15} />
          {label}
        </button>
      ))}
    </div>
  )
}
