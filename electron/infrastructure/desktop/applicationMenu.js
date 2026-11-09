import { dialog, globalShortcut, Menu } from "electron"

/**
 * 安装系统菜单和后台切歌快捷键，所有播放动作交给唯一播放器的消息入口。
 * 平台专属菜单只在对应系统显示；快捷键占用会提示具体失败项，返回的释放函数仅在应用退出时调用。
 */
export function installApplicationMenu({ getWindow, sendPlayerAction }) {
  const shortcuts = [
    {
      action: "previous",
      label: "上一首",
      accelerator: "CommandOrControl+Alt+Left",
      keys: process.platform === "darwin" ? "⌘⌥←" : "Ctrl+Alt+←",
    },
    {
      action: "next",
      label: "下一首",
      accelerator: "CommandOrControl+Alt+Right",
      keys: process.platform === "darwin" ? "⌘⌥→" : "Ctrl+Alt+→",
    },
  ]
  const failed = shortcuts.filter(
    shortcut => !globalShortcut.register(shortcut.accelerator, () => sendPlayerAction(shortcut.action)),
  )
  if (failed.length) {
    dialog
      .showMessageBox(getWindow(), {
        type: "warning",
        title: "Cinder",
        message: "部分全局切歌快捷键未能启用",
        detail: `${failed.map(shortcut => `${shortcut.label}：${shortcut.keys}`).join("\n")}\n\n这些组合键可能已被其他应用占用。请释放占用后重新启动 Cinder；仍可通过播放菜单切歌。`,
        buttons: ["知道了"],
      })
      .catch(error => console.error("无法显示全局快捷键提示：", error))
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Cinder",
        submenu: [
          { role: "about" },
          { type: "separator" },
          { label: "设置…", accelerator: "CmdOrCtrl+,", click: () => sendPlayerAction("settings") },
          { type: "separator" },
          ...(process.platform === "darwin"
            ? [{ role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }]
            : []),
          { role: "quit" },
        ],
      },
      {
        label: "编辑",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "播放",
        submenu: [
          { label: "播放 / 暂停", accelerator: "CmdOrCtrl+P", click: () => sendPlayerAction("toggle") },
          { label: "下一首", accelerator: "CmdOrCtrl+Right", click: () => sendPlayerAction("next") },
          { label: "上一首", accelerator: "CmdOrCtrl+Left", click: () => sendPlayerAction("previous") },
          { type: "separator" },
          ...shortcuts.map(shortcut => ({ label: `全局${shortcut.label}：${shortcut.keys}`, enabled: false })),
        ],
      },
      {
        label: "窗口",
        submenu: [
          { role: "minimize" },
          ...(process.platform === "darwin" ? [{ role: "zoom" }] : []),
          { role: "togglefullscreen" },
          ...(process.platform === "darwin" ? [{ role: "front" }] : []),
        ],
      },
    ]),
  )

  return () => globalShortcut.unregisterAll()
}
