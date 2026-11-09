/**
 * 为界面构建、桌面启动、打包和冒烟测试提供统一的跨平台目录。
 * 默认使用系统临时目录；CI 可通过 CINDER_BUILD_DIR 指定项目外的构建目录。
 */
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"

export const projectRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)))
export const buildDirectory = path.resolve(process.env.CINDER_BUILD_DIR || path.join(os.tmpdir(), "cinder-build"))
const relativeBuildDirectory = path.relative(projectRoot, buildDirectory)
if (
  relativeBuildDirectory === "" ||
  (!path.isAbsolute(relativeBuildDirectory) &&
    relativeBuildDirectory !== ".." &&
    !relativeBuildDirectory.startsWith(".." + path.sep))
) {
  throw new Error("构建目录必须位于源码目录之外，请调整 CINDER_BUILD_DIR")
}

/**
 * 分离界面、平台应用和最终安装包，避免测试数据或临时 staging 混入交付物。
 * 各路径由同一构建根目录派生，不依赖 shell 的临时目录写法。
 */
export const rendererDirectory = path.join(buildDirectory, "renderer")
export const releaseDirectory = path.join(buildDirectory, "release")
export const installerDirectory = path.join(buildDirectory, "installers")
