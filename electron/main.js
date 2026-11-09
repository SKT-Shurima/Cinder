/**
 * 配置应用数据与受限媒体协议后，启动唯一桌面应用。
 * 窗口、菜单和业务服务由组合入口管理；协议权限必须在 Electron 就绪前注册。
 */
import { app, protocol } from "electron"
import { fileURLToPath } from "node:url"
import { DesktopApplication } from "./application/desktopApplication.js"
import { configureDesktopPaths } from "./infrastructure/desktop/desktopPaths.js"

const paths = configureDesktopPaths(app, fileURLToPath(new URL(".", import.meta.url)))
protocol.registerSchemesAsPrivileged([
  { scheme: "cinder", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
])
new DesktopApplication(paths).run()
