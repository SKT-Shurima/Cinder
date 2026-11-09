import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { resolveUserDataDirectory } from "./desktopPaths.js"

test("显式隔离目录优先，测试实例不探测或选择个人曲库", () => {
  const actual = resolveUserDataDirectory("应用数据", "独立测试目录", () => {
    throw new Error("不应探测默认目录")
  })
  assert.equal(actual, "独立测试目录")
})

test("新旧数据目录并存时继续选择已经使用的新目录", () => {
  assert.equal(
    resolveUserDataDirectory("应用数据", undefined, () => true),
    path.join("应用数据", "cinder"),
  )
})

test("只有历史数据时沿用原目录，避免改名后曲库看起来丢失", () => {
  const legacy = path.join("应用数据", "听屿")
  assert.equal(
    resolveUserDataDirectory("应用数据", undefined, name => name === legacy),
    legacy,
  )
})

test("首次运行选择 Cinder 目录，路径解析本身不创建或搬移文件", () => {
  assert.equal(
    resolveUserDataDirectory("应用数据", undefined, () => false),
    path.join("应用数据", "cinder"),
  )
})
