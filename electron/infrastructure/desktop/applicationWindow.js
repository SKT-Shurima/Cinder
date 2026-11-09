import { BrowserWindow, nativeTheme } from "electron"
import path from "node:path"

/**
 * 持有唯一主窗口并集中处理窗口安全边界、全屏控制和各平台的关闭行为。
 * 业务服务通过只读 current 获取受信窗口，不持有或自行替换窗口实例。
 */
export class ApplicationWindow {
  #current = null
  #paths
  #isQuitting
  #onRendererReset

  /**
   * 注入已经解析的资源路径与退出状态，不在构造阶段创建窗口或加载页面。
   * 渲染重置回调用于清除程序坞的过期播放能力，窗口重建时仍复用同一接口。
   */
  constructor(paths, { isQuitting, onRendererReset }) {
    this.#paths = paths
    this.#isQuitting = isQuitting
    this.#onRendererReset = onRendererReset
  }

  /**
   * 向桌面适配器提供当前唯一主窗口；关闭完成后返回 null，避免继续向销毁的内容发消息。
   */
  get current() {
    return this.#current
  }

  /**
   * 读取当前窗口的全屏和最大化状态，供系统按钮与受限 IPC 共用。
   * 窗口已经关闭时拒绝调用，不返回可被界面误用的旧状态。
   */
  getState = () => {
    if (!this.#current || this.#current.isDestroyed()) {
      throw new Error("窗口已关闭")
    }
    return { maximized: this.#current.isMaximized(), fullscreen: this.#current.isFullScreen() }
  }

  /**
   * 执行三种允许的窗口操作，全屏时先等待系统退出动画再关闭或最小化。
   * 不直接结束应用；macOS 关闭窗口后的驻留行为仍由统一 close 监听处理。
   */
  control = action => {
    if (!["minimize", "toggle-maximize", "close"].includes(action)) {
      throw new Error("不支持的窗口操作")
    }
    this.getState()
    const target = this.#current
    if (action === "close" || action === "minimize") {
      /**
       * 等待全屏退出后仍只操作最初的目标窗口，已经销毁时忽略迟到事件。
       * 不读取后来创建的窗口，避免旧关闭或最小化请求影响新的主窗口。
       */
      const finish = () => {
        if (target.isDestroyed()) {
          return
        }
        if (action === "close") {
          target.close()
        } else {
          target.minimize()
        }
      }
      if (target.isFullScreen()) {
        target.once("leave-full-screen", finish)
        target.setFullScreen(false)
      } else {
        finish()
      }
    } else if (target.isFullScreen()) {
      target.setFullScreen(false)
    } else if (target.isMaximized()) {
      target.unmaximize()
    } else {
      target.maximize()
    }
    return true
  }

  /**
   * 创建受限主窗口并绑定窗口事件，拒绝新窗口、任意导航和页面权限申请。
   * macOS 使用原生磨砂与交通灯，Windows 保留系统边框；渲染层不获得 Node.js 能力。
   * 窗口关闭或渲染重载会清理播放菜单状态，只有应用退出时才允许 macOS 真正关闭窗口。
   */
  create() {
    const mac = process.platform === "darwin"
    const target = new BrowserWindow({
      width: 1380,
      height: 900,
      minWidth: 1000,
      minHeight: 680,
      title: "Cinder",
      ...(mac
        ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 20, y: 22 } }
        : { titleBarStyle: "default", frame: true, icon: this.#paths.icon }),
      backgroundColor: mac ? "#00000000" : nativeTheme.shouldUseDarkColors ? "#191a22" : "#f4f4f8",
      ...(mac ? { vibrancy: "under-window", visualEffectState: "active" } : {}),
      webPreferences: { preload: this.#paths.preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    this.#current = target
    target.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    target.webContents.on("will-navigate", event => event.preventDefault())
    target.webContents.session.setPermissionRequestHandler((_content, _permission, callback) => callback(false))
    target.webContents.on("did-start-loading", this.#onRendererReset)
    target.webContents.on("render-process-gone", this.#onRendererReset)
    for (const event of ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) {
      target.on(event, () => {
        if (!target.isDestroyed() && !target.webContents.isDestroyed()) {
          target.webContents.send("window:state", this.getState())
        }
      })
    }
    target.loadFile(path.join(this.#paths.renderer, "index.html"))
    target.on("close", event => {
      if (!this.#isQuitting() && mac) {
        event.preventDefault()
        target.hide()
        target.webContents.send("player:media", "pause")
      }
    })
    target.on("closed", () => {
      this.#current = null
      this.#onRendererReset()
    })
    return target
  }

  /**
   * 响应第二次启动或程序坞激活，显示已有窗口并恢复焦点，不重建播放器与播放队列。
   */
  show() {
    if (!this.#current || this.#current.isDestroyed()) {
      return
    }
    this.#current.show()
    this.#current.focus()
  }
}
