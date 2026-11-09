import { app, dialog, ipcMain, Menu, protocol, safeStorage } from "electron"
import path from "node:path"
import os from "node:os"
import { LibraryService } from "./catalog/libraryService.js"
import { OnlineAccounts } from "./accounts/onlineAccounts.js"
import { DesktopCommands } from "../ipc/desktopCommands.js"
import { RemoteSources } from "../infrastructure/remote/remoteSources.js"
import { OnlineMusic } from "../infrastructure/online/onlineMusic.js"
import { MediaGateway } from "../infrastructure/media/mediaGateway.js"
import { DockPlaybackMenu } from "../infrastructure/desktop/dockPlaybackMenu.js"
import { ApplicationWindow } from "../infrastructure/desktop/applicationWindow.js"
import { DesktopAppearance } from "../infrastructure/desktop/desktopAppearance.js"
import { installApplicationMenu } from "../infrastructure/desktop/applicationMenu.js"

/**
 * 作为桌面应用的组合入口，协调服务初始化、主窗口、IPC 和退出资源释放。
 * 业务用例留在各服务中，窗口安全策略与外观同步由桌面适配器负责，不向界面暴露内部实例。
 */
export class DesktopApplication {
  #window
  #appearance
  #library
  #remote
  #online
  #accounts
  #playerMenu
  /**
   * 只在内存中保存系统选择器明确授权的私钥内容与短期令牌。
   * 配置完成或退出后释放，界面不能通过此缓存提交任意本地路径读取文件。
   */
  #selectedKeys = new Map()
  #quitting = false
  /**
   * 记录系统菜单安装后返回的快捷键释放入口，退出时统一执行。
   * 服务初始化尚未完成就失败退出时保持空操作，避免清理过程再抛出异常。
   */
  #releaseShortcuts = () => {}

  /**
   * 根据固定资源路径组合窗口与外观适配器，真正的服务初始化等待 Electron 就绪。
   * 主窗口访问器始终返回当前实例，窗口重建不会留下过期引用。
   */
  constructor(paths) {
    this.#window = new ApplicationWindow(paths, {
      isQuitting: () => this.#quitting,
      onRendererReset: () => this.#playerMenu?.update(),
    })
    this.#appearance = new DesktopAppearance(paths.icon, () => this.#window.current)
  }

  /**
   * 注册单实例与应用生命周期，只允许第一个实例初始化曲库和窗口。
   * 退出先标记状态并停止服务，再释放全局快捷键；macOS 关闭窗口后仍可从程序坞恢复。
   */
  run() {
    if (!app.requestSingleInstanceLock()) {
      app.quit()
      return
    }
    app.on("second-instance", () => this.#window.show())
    app
      .whenReady()
      .then(this.#start)
      .catch(error => {
        dialog.showErrorBox("Cinder 启动失败", error.message)
        app.quit()
      })
    app.on("activate", () => {
      if (this.#window.current) {
        this.#window.show()
      } else if (this.#library) {
        this.#window.create()
      }
    })
    app.on("before-quit", () => {
      this.#quitting = true
      if (this.#library) {
        this.#library.cancelScrape = true
      }
      this.#remote?.close()
      this.#online?.close()
      this.#accounts?.close()
      this.#selectedKeys.clear()
    })
    app.on("will-quit", () => this.#releaseShortcuts())
    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") {
        app.quit()
      }
    })
  }

  /**
   * 初始化曲库、服务器与账号服务，再接入媒体协议、受限 IPC 和窗口菜单。
   * 已保存在线资源在窗口建立后核验，不阻塞本地曲库展示；首次扫描只针对已有配置目录。
   */
  #start = async () => {
    if (process.platform === "win32") {
      app.setAppUserModelId("local.cinder.player")
    }
    const musicDirectory =
      process.platform === "darwin" ? path.join(os.homedir(), "personal", "media", "music") : app.getPath("music")
    this.#library = new LibraryService(app.getPath("userData"), musicDirectory)
    await this.#library.initialize()
    this.#remote = new RemoteSources(this.#library, {
      trustHost: async ({ host, port, fingerprint }) =>
        (
          await dialog.showMessageBox(this.#window.current, {
            type: "question",
            title: "确认音乐服务器",
            message: `首次连接 ${host}:${port}`,
            detail: `请核对服务器 SSH 指纹：\n${fingerprint}\n\n确认后此音乐库将记住该指纹。`,
            buttons: ["取消", "信任并连接"],
            defaultId: 0,
            cancelId: 0,
          })
        ).response === 1,
      encrypt: text => {
        if (!safeStorage.isEncryptionAvailable()) {
          throw new Error("系统安全存储暂不可用，请取消“记住凭据”后连接")
        }
        return safeStorage.encryptString(text).toString("base64")
      },
      decrypt: text => safeStorage.decryptString(Buffer.from(text, "base64")),
    })
    await this.#remote.initialize()
    this.#library.remote = this.#remote
    this.#accounts = new OnlineAccounts(
      () => this.#window.current,
      state => {
        this.#online?.searchCache.clear()
        this.#online?.artists.details.clear()
        this.#online?.refreshAvailability().catch(() => {})
        this.#window.current?.webContents.send("online:accounts-changed", state)
      },
    )
    this.#online = new OnlineMusic(this.#library, { authFor: id => this.#accounts.credentials(id) })
    this.#appearance.apply(this.#library.state.settings)
    const media = new MediaGateway({
      library: this.#library,
      online: this.#online,
      remote: this.#remote,
      onPlaybackError: failure => this.#window.current?.webContents.send("online:playback-error", failure),
    })
    protocol.handle("cinder", request => media.handle(request))
    this.#library.on("progress", value => this.#window.current?.webContents.send("library:progress", value))
    this.#library.on("changed", () => this.#window.current?.webContents.send("library:changed", true))
    this.#playerMenu = new DockPlaybackMenu({
      dock: app.dock,
      buildMenu: template => Menu.buildFromTemplate(template),
      sendAction: this.#sendPlayerAction,
    })
    this.#playerMenu.update()
    this.#registerIpc()
    this.#window.create()
    this.#releaseShortcuts = installApplicationMenu({
      getWindow: () => this.#window.current,
      sendPlayerAction: this.#sendPlayerAction,
    })
    this.#online.refreshAvailability().catch(() => {})
    if (!this.#library.state.scannedAt && this.#library.state.roots.length) {
      this.#runTask(() => this.#library.scan())
    }
  }

  /**
   * 将系统菜单与后台快捷键统一转给受信窗口，退出或渲染销毁后不再发布消息。
   * 不自动显示或聚焦窗口，后台切歌保持原有桌面状态。
   */
  #sendPlayerAction = action => {
    const target = this.#window.current
    if (this.#quitting || !target || target.isDestroyed() || target.webContents.isDestroyed()) {
      return
    }
    target.webContents.send("player:media", action)
  }

  /**
   * 启动互斥的后台索引任务并立即回应 IPC，后续进度通过曲库事件传给界面。
   * 已有任务时拒绝重复启动，异步失败转成可见状态，不丢弃原始业务错误。
   */
  #runTask = task => {
    if (this.#library.status.phase !== "idle") {
      throw new Error("当前已有任务运行，请先等待或停止")
    }
    task().catch(error => this.#library.progress({ phase: "idle", error: error.message, message: error.message }))
    return { started: true }
  }

  /**
   * 向固定命令表注入业务服务与窗口能力，发送方验证仍由 IPC 适配器逐次执行。
   * 私钥选择缓存只在本应用生命周期内存在，窗口、外观和播放菜单保持各自职责。
   */
  #registerIpc() {
    const commands = new DesktopCommands({
      library: this.#library,
      online: this.#online,
      remote: this.#remote,
      accounts: this.#accounts,
      selectedKeys: this.#selectedKeys,
      mainWindow: () => this.#window.current,
      windowState: this.#window.getState,
      controlWindow: (_event, action) => this.#window.control(action),
      background: this.#runTask,
      appearance: () => this.#appearance.apply(this.#library.state.settings),
      playerState: state => this.#playerMenu.update(state),
    })
    commands.install(ipcMain)
  }
}
