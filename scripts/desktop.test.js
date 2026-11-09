/**
 * 验证跨平台导入边界和发布目标，避免把 Windows 盘符、不同盘符或未支持架构误处理。
 * 这些用例不读取真实曲库，也不在项目内生成文件。
 */
import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { containsLocalPath } from "../electron/domain/catalog/localPaths.js"
import { buildTarget } from "./buildTarget.js"

test("Windows 盘符根目录覆盖其音乐子目录", () => {
  assert.equal(containsLocalPath("C:\\", "C:\\音乐\\测试.wav", path.win32), true)
})
test("Windows 大小写不同的同一目录不会重复导入", () => {
  assert.equal(containsLocalPath("C:\\Music", "c:\\MUSIC\\专辑", path.win32), true)
})
test("兄弟目录和不同盘符不能被当成当前根目录的子目录", () => {
  assert.equal(containsLocalPath("C:\\Music", "C:\\Music-old", path.win32), false)
  assert.equal(containsLocalPath("C:\\Music", "D:\\Music", path.win32), false)
  assert.equal(containsLocalPath("/music", "/music-old", path.posix), false)
})
test("Windows 网络共享目录保持服务器与共享范围边界", () => {
  assert.equal(containsLocalPath("\\\\nas\\music", "\\\\NAS\\music\\专辑", path.win32), true)
  assert.equal(containsLocalPath("\\\\nas\\music", "\\\\nas\\private", path.win32), false)
})
test("Intel 和 Windows 交付目标必须明确，拒绝未接入的架构", () => {
  assert.deepEqual(buildTarget(["--platform=darwin", "--arch=x64"]), { platform: "darwin", arch: "x64" })
  assert.deepEqual(buildTarget(["--platform=win32", "--arch=x64"]), { platform: "win32", arch: "x64" })
  assert.throws(() => buildTarget(["--platform=win32", "--arch=arm64"]))
  assert.throws(() => buildTarget(["--platform=darwin", "--arch=universal"]))
})
