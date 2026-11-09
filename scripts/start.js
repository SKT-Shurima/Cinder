/**
 * 使用 Node 启动本机 Electron，兼容 macOS 终端、Windows PowerShell 和 CMD。
 * 先确认界面已构建，再向子进程传递目录；不会覆盖用户已有的独立数据目录配置。
 */
import { access } from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"
import electron from "electron"
import { projectRoot, rendererDirectory } from "./buildPaths.js"

await access(path.join(rendererDirectory, "index.html")).catch(() => {
  throw new Error("界面尚未构建，请先运行 npm run build")
})
const child = spawn(electron, [projectRoot, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, CINDER_RENDERER_DIR: rendererDirectory },
})
child.on("error", error => {
  console.error(error.message)
  process.exitCode = 1
})
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
