/**
 * 将播放器的即时状态投影为 macOS 程序坞菜单，系统默认窗口菜单仍由 macOS 提供。
 * 不读取曲库或持久化进度，操作统一回到现有播放器，避免程序坞维护第二套队列。
 */

/**
 * 封装程序坞播放入口，仅在播放状态或可用操作改变时更新原生菜单。
 * Dock 和菜单工厂由桌面入口注入；其他平台缺少 Dock 时保持无副作用。
 */
export class DockPlaybackMenu {
  /**
   * 接收系统菜单适配器和现有播放动作分派器，初始化时不调用未就绪的系统 API。
   * 桌面入口需在应用 ready 后首次提交状态，菜单才能出现在程序坞右键操作中。
   */
  constructor({ dock, buildMenu, sendAction }) {
    this.dock = dock
    this.buildMenu = buildMenu
    this.sendAction = sendAction
    this.signature = null
  }

  /**
   * 根据渲染进程报告的真实播放状态切换播放或暂停，并同步切歌入口是否可用。
   * 仅接受严格布尔值，忽略歌曲、路径等额外字段；重复进度事件不会重建菜单。
   * 初始化、界面重载或崩溃时传空状态，暂时禁用操作，等待新播放器报告状态。
   */
  update(input) {
    if (!this.dock) {
      return true
    }
    const canToggle = input?.canToggle === true
    const canSkip = input?.canSkip === true
    const playing = input?.playing === true && canToggle
    const signature = `${playing}:${canToggle}:${canSkip}`
    if (signature === this.signature) {
      return true
    }
    const menu = this.buildMenu([
      { id: "dock-player-toggle", label: playing ? "暂停" : "播放", enabled: canToggle, click: () => this.sendAction("toggle") },
      { id: "dock-player-previous", label: "上一首", enabled: canSkip, click: () => this.sendAction("previous") },
      { id: "dock-player-next", label: "下一首", enabled: canSkip, click: () => this.sendAction("next") },
    ])
    this.dock.setMenu(menu)
    this.signature = signature
    return true
  }
}
