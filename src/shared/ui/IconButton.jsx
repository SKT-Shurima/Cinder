/**
 * 为图标动作提供统一的按钮语义、提示和主题样式。
 * 额外属性用于焦点、禁用和展开状态，装饰图标不重复进入读屏名称。
 */
import React from "react"

/**
 * 生成具有统一读屏名称和悬停提示的图标动作按钮。
 * 可附加禁用、展开和焦点属性，装饰图形不会重复朗读。
 */
export default function IconButton({ icon: Glyph, label, className = "", size = 19, children, ...attributes }) {
  return (
    <button
      {...attributes}
      type="button"
      className={["icon-button", className].filter(Boolean).join(" ")}
      title={label}
      aria-label={label}
    >
      {Glyph && <Glyph aria-hidden="true" strokeWidth={1.7} size={size} />}
      {children}
    </button>
  )
}
