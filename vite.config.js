/**
 * 构建本地文件协议使用的界面资源，并统一界面源码的导入入口。
 * 输出始终位于项目外；共享业务规则通过 package.json 的 #shared 导入映射复用。
 */
import { defineConfig } from "vite"
import { fileURLToPath } from "node:url"
import { rendererDirectory } from "./scripts/buildPaths.js"

export default defineConfig({
  base: "./",
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { outDir: rendererDirectory, emptyOutDir: true },
})
