/**
 * 打包 macOS Intel / Apple Silicon 应用与 Windows x64 便携版，并保留对应平台的许可证。
 * 构建、图标和 staging 全部位于项目外；Windows 不执行 macOS 工具，也不写入真实用户数据。
 */
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { execFileSync } from "node:child_process"
import { packager } from "@electron/packager"
import { PNG } from "pngjs"
import { projectRoot, rendererDirectory, releaseDirectory, installerDirectory } from "./buildPaths.js"
import { buildTarget } from "./buildTarget.js"

const target = buildTarget(process.argv.slice(2))
if (target.platform === "darwin" && process.platform !== "darwin") {
  throw new Error("macOS 安装包请在 Mac 或 macOS CI runner 上构建")
}
const manifest = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"))
const iconPng = path.join(projectRoot, "src", "assets", "brand-icon.png")
await fs.access(path.join(rendererDirectory, "index.html")).catch(() => {
  throw new Error("界面尚未构建，请先运行 npm run build")
})
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "cinder-package-"))

/**
 * 将任意边长的正方形品牌 PNG 转换为透明的 256 像素 Windows 图标，保留原有图案。
 * 按像素覆盖面积与预乘透明度加权，避免非整数缩放时出现黑边；不要求原图尺寸是 256 的倍数。
 * ICO 只写入打包临时目录，不改变源码图片，也不依赖 ImageMagick、Wine 或本机图像工具。
 */
async function windowsIcon() {
  const source = PNG.sync.read(await fs.readFile(iconPng))
  const size = 256
  if (source.width !== source.height) {
    throw new Error("品牌 PNG 必须是正方形")
  }
  const image = new PNG({ width: size, height: size })
  const step = source.width / size
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let alpha = 0
      const colors = [0, 0, 0]
      const left = x * step
      const right = (x + 1) * step
      const top = y * step
      const bottom = (y + 1) * step
      for (let row = Math.floor(top); row < Math.ceil(bottom); row++) {
        for (let column = Math.floor(left); column < Math.ceil(right); column++) {
          const weight = (Math.min(right, column + 1) - Math.max(left, column)) * (Math.min(bottom, row + 1) - Math.max(top, row))
          const offset = (row * source.width + column) * 4
          const a = source.data[offset + 3] * weight
          alpha += a
          for (let channel = 0; channel < 3; channel++) {
            colors[channel] += source.data[offset + channel] * a
          }
        }
      }
      const offset = (y * size + x) * 4
      for (let channel = 0; channel < 3; channel++) {
        image.data[offset + channel] = alpha ? Math.round(colors[channel] / alpha) : 0
      }
      image.data[offset + 3] = Math.round(alpha / (step * step))
    }
  }
  const bytes = PNG.sync.write(image)
  const header = Buffer.alloc(22)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  header.writeUInt16LE(1, 10)
  header.writeUInt16LE(32, 12)
  header.writeUInt32LE(bytes.length, 14)
  header.writeUInt32LE(22, 18)
  const icon = path.join(temporary, "cinder.ico")
  await fs.writeFile(icon, Buffer.concat([header, bytes]))
  return icon
}

/**
 * 在 macOS 主机生成 ICNS，各架构读取同一份品牌原图。
 * 只为 darwin 目标调用 sips 和 iconutil，Windows runner 不需要这些系统命令。
 */
async function macIcon() {
  const iconset = path.join(temporary, "cinder.iconset")
  await fs.mkdir(iconset)
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      execFileSync(
        "sips",
        [
          "-z",
          String(size * scale),
          String(size * scale),
          iconPng,
          "--out",
          path.join(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`),
        ],
        { stdio: "ignore" },
      )
    }
  }
  const icon = path.join(temporary, "cinder.icns")
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", icon])
  return icon
}

/**
 * 从本次下载的目标平台 Electron 中保留许可，避免跨平台构建时误用主机平台的 Chromium 许可。
 * 在预构建包解压后复制到其资源目录；macOS 顶层许可随后丢弃时，应用内仍有完整副本。
 */
async function retainElectronLicenses({ buildPath, platform }) {
  const resources =
    platform === "darwin" ? path.join(buildPath, "Electron.app", "Contents", "Resources") : path.join(buildPath, "resources")
  await fs.mkdir(resources, { recursive: true })
  await fs.copyFile(path.join(buildPath, "LICENSE"), path.join(resources, "LICENSE.electron.txt"))
  await fs.copyFile(path.join(buildPath, "LICENSES.chromium.html"), path.join(resources, "LICENSES.chromium.html"))
}

/**
 * 在独立目录安装纯 JavaScript 运行依赖，不复用主机编译的可选原生插件；运行包跳过相邻单元测试。
 * 通过 npm 的 Node 入口执行安装，兼容 Windows 的 npm.cmd，不开启 shell 或执行依赖安装脚本。
 */
async function prepareRuntime() {
  const staging = path.join(temporary, "app")
  await fs.mkdir(staging)
  await fs.cp(path.join(projectRoot, "electron"), path.join(staging, "electron"), {
    recursive: true,
    filter: filename => !filename.endsWith(".test.js"),
  })
  await fs.cp(path.join(projectRoot, "shared"), path.join(staging, "shared"), {
    recursive: true,
    filter: filename => !filename.endsWith(".test.js"),
  })
  await fs.cp(rendererDirectory, path.join(staging, "renderer"), { recursive: true })
  await fs.writeFile(
    path.join(staging, "package.json"),
    JSON.stringify({ ...manifest, devDependencies: undefined, scripts: undefined }),
  )
  for (const name of ["package-lock.json", "LICENSE"]) {
    await fs.copyFile(path.join(projectRoot, name), path.join(staging, name))
  }
  if (!process.env.npm_execpath) {
    throw new Error("请通过 npm run package 执行打包，以便确定本机 npm 入口")
  }
  execFileSync(
    process.execPath,
    [process.env.npm_execpath, "install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: staging, stdio: "inherit" },
  )
  return staging
}

/**
 * 为 Mac 生成拖放式 DMG，或为 Windows 生成解压即可运行的 ZIP。
 * 安装包只收录平台应用及 Mac 的 Applications 链接；不附加测试记录、演示曲库或账户信息。
 */
async function createInstaller(build) {
  await fs.mkdir(installerDirectory, { recursive: true })
  const name = `Cinder-${manifest.version}-${target.platform === "darwin" ? "macos" : "windows"}-${target.arch}`
  if (target.platform === "darwin") {
    const application = path.join(build, `${manifest.productName}.app`)
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", application], { stdio: "inherit" })
    execFileSync("codesign", ["--verify", "--deep", "--strict", application])
    const contents = path.join(temporary, "dmg")
    await fs.mkdir(contents)
    execFileSync("ditto", [application, path.join(contents, `${manifest.productName}.app`)])
    await fs.symlink("/Applications", path.join(contents, "Applications"))
    const filename = path.join(installerDirectory, name + ".dmg")
    execFileSync(
      "hdiutil",
      ["create", "-ov", "-volname", manifest.productName, "-srcfolder", contents, "-format", "UDZO", filename],
      { stdio: "inherit" },
    )
    return filename
  }
  const filename = path.join(installerDirectory, name + ".zip")
  if (process.platform === "win32") {
    execFileSync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Compress-Archive -LiteralPath $env:CINDER_ZIP_SOURCE -DestinationPath $env:CINDER_ZIP_TARGET -CompressionLevel Optimal -Force",
      ],
      {
        env: { ...process.env, CINDER_ZIP_SOURCE: build, CINDER_ZIP_TARGET: filename },
        stdio: "inherit",
      },
    )
  } else {
    execFileSync("ditto", ["-c", "-k", "--keepParent", "--norsrc", "--noextattr", "--noqtn", build, filename])
  }
  return filename
}

try {
  const icon = target.platform === "darwin" ? await macIcon() : await windowsIcon()
  const staging = await prepareRuntime()
  const builds = await packager({
    dir: staging,
    name: manifest.productName,
    executableName: manifest.productName,
    appBundleId: "local.cinder.player",
    appVersion: manifest.version,
    ...target,
    electronVersion: manifest.devDependencies.electron,
    appCategoryType: "public.app-category.music",
    out: releaseDirectory,
    overwrite: true,
    prune: true,
    icon,
    extraResource: [iconPng],
    afterExtract: [retainElectronLicenses],
    appCopyright: `${manifest.productName} · 本地音乐`,
  })
  for (const build of builds) {
    console.log(JSON.stringify({ ...target, application: build, installer: await createInstaller(build) }))
  }
} finally {
  await fs.rm(temporary, { recursive: true, force: true })
}
