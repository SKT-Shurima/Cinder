/**
 * 约束当前交付的平台和架构，避免生成未接入验证流程的安装包。
 * macOS 分别交付 Intel x64 与 Apple Silicon arm64，Windows 首先交付 x64 便携包。
 */
import { parseArgs } from "node:util"

/**
 * 解析打包和冒烟测试共用的目标参数，省略时使用当前主机平台与架构。
 * 只接受明确支持的组合；Linux、Windows ARM 和通用包不会被误标为已经适配。
 */
export function buildTarget(args, hostPlatform = process.platform, hostArchitecture = process.arch) {
  const { values } = parseArgs({
    args,
    options: {
      platform: { type: "string", default: hostPlatform },
      arch: { type: "string", default: hostArchitecture },
    },
  })
  if (
    !(values.platform === "darwin" && ["x64", "arm64"].includes(values.arch)) &&
    !(values.platform === "win32" && values.arch === "x64")
  ) {
    throw new Error("当前支持 darwin/x64、darwin/arm64 和 win32/x64，请使用 --platform 与 --arch 指定目标")
  }
  return { platform: values.platform, arch: values.arch }
}
