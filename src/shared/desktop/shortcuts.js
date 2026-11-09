/**
 * 根据受信 preload 提供的平台名称展示快捷键，保持 Windows 的 Ctrl 提示与 macOS 的 Command 提示一致。
 * 此处仅生成界面文字，不注册按键或读取系统信息；实际快捷键继续由原有处理器执行。
 */
const mac = window.cinder.platform === "darwin"

export const desktopShortcuts = Object.freeze({
  search: mac ? "⌘ F" : "Ctrl F",
  settings: mac ? "⌘ ," : "Ctrl ,",
  skip: mac ? "⌘ ⌥ ← / →" : "Ctrl Alt ← / →",
})
