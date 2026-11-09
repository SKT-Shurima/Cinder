import { existsSync, mkdirSync } from "node:fs"
import path from "node:path"

/**
 * 为新安装选择 Cinder 数据目录，并让已有安装继续使用历史曲库位置。
 * 显式隔离目录优先，其次使用已存在的新目录，最后回退历史目录；只选择路径，不搬移或合并数据。
 */
export function resolveUserDataDirectory(appData, override, exists = existsSync) {
  if (override) {
    return override
  }
  const current = path.join(appData, "cinder")
  const legacy = path.join(appData, "听屿")
  return exists(current) || !exists(legacy) ? current : legacy
}

/**
 * 在 Electron 就绪前配置应用身份与数据位置，返回窗口和品牌图片所需的固定路径。
 * 运行数据始终位于应用数据或显式测试目录；开发资源和安装包资源分别读取，不在源码中创建曲库。
 */
export function configureDesktopPaths(app, electronDirectory) {
  const dataDirectory = resolveUserDataDirectory(app.getPath("appData"), process.env.CINDER_DATA_DIR)
  mkdirSync(dataDirectory, { recursive: true })
  app.setName("Cinder")
  app.setPath("userData", dataDirectory)
  return {
    preload: path.join(electronDirectory, "preload.cjs"),
    renderer: process.env.CINDER_RENDERER_DIR || path.join(app.getAppPath(), "renderer"),
    icon: app.isPackaged
      ? path.join(process.resourcesPath, "brand-icon.png")
      : path.join(electronDirectory, "..", "src", "assets", "brand-icon.png"),
  }
}
