/**
 * 在真实打包应用中验证跨平台启动、中文路径导入、音频协议、界面和持久化。
 * 只使用系统临时目录中的合成数据与静音 WAV；不读取个人曲库、账号或远程服务器。
 */
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { projectRoot, releaseDirectory } from "./buildPaths.js"
import { buildTarget } from "./buildTarget.js"

const target = buildTarget(process.argv.slice(2))
if (target.platform !== process.platform) {
  throw new Error("冒烟测试必须在目标操作系统上执行；Windows 包请交给 Windows CI runner")
}
const manifest = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"))
const build = path.join(releaseDirectory, `${manifest.productName}-${target.platform}-${target.arch}`)
const executable =
  target.platform === "darwin"
    ? path.join(build, `${manifest.productName}.app`, "Contents", "MacOS", manifest.productName)
    : path.join(build, `${manifest.productName}.exe`)
await fs.access(executable)
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "cinder-smoke-"))
const data = path.join(temporary, "独立数据")
const music = path.join(temporary, "音乐 # 与空格")
await fs.mkdir(data)
await fs.mkdir(music)

/**
 * 为真实控件测试保留足够的尾部时长，避免拖动和保存期间触发三秒交叉淡化切歌。
 */
const fixtureDurationSeconds = 30

/**
 * 生成可实际解码的三十秒 PCM WAV，供导入、媒体读取与拖动测试使用。
 * 音频内容为静音，测试不会播放商业音乐或要求机器具备真实输出设备。
 */
function silentWave() {
  const size = 44100 * 2 * fixtureDurationSeconds
  const wav = Buffer.alloc(44 + size)
  wav.write("RIFF")
  wav.writeUInt32LE(size + 36, 4)
  wav.write("WAVEfmt ", 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(44100, 24)
  wav.writeUInt32LE(88200, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write("data", 36)
  wav.writeUInt32LE(size, 40)
  return wav
}
for (const name of ["测试歌手 - 跨平台试听 #1.wav", "Test Artist - Playback & Range.wav"]) {
  await fs.writeFile(path.join(music, name), silentWave())
}
await fs.copyFile(path.join(projectRoot, "src", "assets", "brand-icon.png"), path.join(music, "cover.png"))
await fs.writeFile(
  path.join(data, "library.json"),
  JSON.stringify({
    roots: [music],
    tracks: [],
    scannedAt: 1,
    settings: { musicSources: { local: true, online: false, remote: false }, musicProviders: { qq: false, netease: false } },
  }),
)

/**
 * 在有界时间内等待异步界面或文件条件，超时给出具体检查环节。
 * 每次间隔二百毫秒，不进行无界忙轮询；条件抛出的异常由调用方决定是否重试。
 */
async function until(condition, label, timeout = 20000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await condition()) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error(`冒烟测试超时：${label}`)
}

/**
 * 启动独立应用并连接其仅监听回环地址的调试端口，供本次自动验证使用。
 * 静音合成音频在自动化实例中关闭后台媒体挂起，并激活测试页，以前台解码与播放作为验证基准。
 * 这些启动参数仅用于测试；结束后关闭自己创建的进程与连接，不连接用户已经运行的播放器。
 * @see https://chromium.googlesource.com/chromium/src/+/main/media/base/media_switches.cc
 */
async function launch() {
  const portFile = path.join(data, "DevToolsActivePort")
  await fs.rm(portFile, { force: true })
  const child = spawn(
    executable,
    [
      "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1",
      "--mute-audio",
      "--disable-background-media-suspend",
      "--autoplay-policy=no-user-gesture-required",
    ],
    {
      env: { ...process.env, CINDER_DATA_DIR: data },
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  let diagnostics = ""
  let launchError
  let socket
  let sequence = 0
  const pending = new Map()
  const errors = []
  const mediaResponses = []
  child.on("error", error => {
    launchError = error
  })
  child.stdout.on("data", chunk => {
    diagnostics = (diagnostics + chunk).slice(-4000)
  })
  child.stderr.on("data", chunk => {
    diagnostics = (diagnostics + chunk).slice(-4000)
  })
  try {
    let endpoint
    await until(
      async () => {
        if (launchError) {
          throw launchError
        }
        if (child.exitCode !== null || child.signalCode) {
          throw new Error(`应用提前退出：${diagnostics}`)
        }
        try {
          const port = Number((await fs.readFile(portFile, "utf8")).split("\n")[0])
          if (!Number.isInteger(port) || port < 1) {
            return false
          }
          const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) })).json()
          endpoint = pages.find(page => page.type === "page" && page.url.startsWith("file:"))?.webSocketDebuggerUrl
          return Boolean(endpoint)
        } catch {
          return false
        }
      },
      "应用建立调试连接",
      45000,
    )
    socket = new WebSocket(endpoint)
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true })
      socket.addEventListener("error", reject, { once: true })
    })
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data)
      if (message.id && pending.has(message.id)) {
        const request = pending.get(message.id)
        pending.delete(message.id)
        clearTimeout(request.timer)
        message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result)
      } else if (message.method === "Runtime.exceptionThrown") {
        errors.push(message.params.exceptionDetails.text)
      } else if (message.method === "Network.responseReceived" && message.params.response.url.startsWith("cinder://audio/")) {
        mediaResponses.push(message.params.response)
      }
    })
    /**
     * 按调试协议编号匹配命令响应，每次命令最长等待十秒。
     * 所有求值仅发生在合成曲库实例中，不在正式应用增加测试 IPC 或放宽内容安全策略。
     */
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++sequence
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`调试命令超时：${method}`))
        }, 10000)
        pending.set(id, { resolve, reject, timer })
        socket.send(JSON.stringify({ id, method, params }))
      })
    /**
     * 在隔离界面执行验证表达式，等待 Promise 并只返回可序列化结果。
     * 页面异常作为测试失败返回，不隐藏业务错误或改写真实应用源码。
     */
    const evaluate = async expression => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true })
      if (result.exceptionDetails) {
        throw new Error(JSON.stringify(result.exceptionDetails))
      }
      return result.result.value
    }
    /**
     * 结束本次测试拥有的进程，释放调试连接与命令计时器。
     * Windows 正常关闭已退出时不再发送信号，其他情况下用终止信号清理测试实例。
     */
    const stop = async () => {
      for (const request of pending.values()) {
        clearTimeout(request.timer)
        request.reject(new Error("测试实例已关闭"))
      }
      pending.clear()
      socket.close()
      if (child.exitCode === null && !child.signalCode) {
        child.kill()
      }
      await until(() => child.exitCode !== null || Boolean(child.signalCode), "测试实例退出", 10000)
    }
    await send("Runtime.enable")
    await send("Network.enable")
    await send("Page.enable")
    await send("Page.bringToFront")
    return { child, evaluate, send, stop, errors, mediaResponses }
  } catch (error) {
    socket?.close()
    if (child.exitCode === null) {
      child.kill()
    }
    throw error
  }
}

let current
try {
  current = await launch()
  await until(() => current.evaluate('Boolean(document.querySelector(".home-content"))'), "首页渲染")
  assert.deepEqual(await current.evaluate("({ platform: window.cinder.platform, arch: window.cinder.architecture })"), target)
  assert.equal(await current.evaluate("window.cinder.nativeWindowControls"), true)
  await current.evaluate("window.cinder.scan()")
  await until(
    () =>
      current.evaluate('window.cinder.snapshot().then(library => library.status.phase === "idle" && library.stats.tracks === 2)'),
    "中文与特殊字符路径导入",
  )
  const library = await current.evaluate("window.cinder.snapshot()")
  assert.equal(library.failures.length, 0)
  assert.equal(library.stats.covered, 2)
  const id = library.tracks[0].id
  await current.evaluate(
    '[...document.querySelectorAll(".main-nav button")].find(button => button.textContent.includes("全部音乐")).click()',
  )
  await until(() => current.evaluate('document.querySelectorAll(".song-row").length === 2'), "真实歌曲列表")
  await current.send("Page.bringToFront")
  await current.evaluate('document.querySelector(".song-row .row-play").click()')
  await until(
    () => current.evaluate('[...document.querySelectorAll("audio")].some(audio => !audio.paused && audio.currentTime > 0.1)'),
    "真实播放按钮与音频控制器",
  )
  const actualDuration = await current.evaluate('[...document.querySelectorAll("audio")].find(audio => !audio.paused).duration')
  assert.ok(Math.abs(actualDuration - fixtureDurationSeconds) < 0.1)
  const progress = await current.evaluate(
    '(() => { const rect = document.querySelector("input[aria-label=播放进度]").getBoundingClientRect(); return { x: rect.x + rect.width * 0.25, y: rect.y + rect.height / 2 }; })()',
  )
  await current.send("Input.dispatchMouseEvent", { type: "mousePressed", ...progress, button: "left", clickCount: 1 })
  await current.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...progress, button: "left", clickCount: 1 })
  await until(
    () => current.evaluate('[...document.querySelectorAll("audio")].some(audio => !audio.paused && audio.currentTime > 2)'),
    "真实进度控件拖动与恢复播放",
  )
  await current.evaluate('document.querySelector(".main-play").click()')
  await until(() => current.evaluate('[...document.querySelectorAll("audio")].every(audio => audio.paused)'), "真实暂停按钮")
  const savedPosition = await current.evaluate(
    'Math.max(...[...document.querySelectorAll("audio")].map(audio => audio.currentTime || 0))',
  )
  await until(async () => {
    try {
      const state = JSON.parse(await fs.readFile(path.join(data, "playback.json"), "utf8"))
      return state.trackId === id && state.position > 2
    } catch {
      return false
    }
  }, "真实队列与进度自动保存")
  assert.ok(
    current.mediaResponses.some(response => response.status === 206),
    "媒体协议应支持 Range 分段读取",
  )
  await current.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "f",
    code: "KeyF",
    modifiers: target.platform === "darwin" ? 4 : 2,
  })
  await current.send("Input.dispatchKeyEvent", { type: "keyUp", key: "f", code: "KeyF" })
  assert.equal(await current.evaluate("document.activeElement.id"), "global-search")
  assert.equal(
    await current.evaluate('document.querySelector(".library-search kbd").textContent'),
    target.platform === "darwin" ? "⌘ F" : "Ctrl F",
  )
  await current.evaluate(
    '[...document.querySelectorAll(".main-nav button")].find(button => button.textContent.includes("主题歌单")).click()',
  )
  await until(() => current.evaluate('document.querySelectorAll(".theme-cover-image").length === 50'), "主题目录")
  await current.evaluate('document.querySelectorAll(".theme-cover-image").forEach(image => { image.loading = "eager"; })')
  await until(
    () =>
      current.evaluate(
        '[...document.querySelectorAll(".theme-cover-image")].every(image => image.complete && image.naturalWidth === 640)',
      ),
    "五十张离线封面",
  )
  await current.evaluate(`window.cinder.favorite('${id}')`)
  await current.evaluate('window.cinder.settings({ theme: "light", volume: 0.25 })')
  assert.deepEqual(current.errors, [])
  current.evaluate('window.cinder.windowControl("close")').catch(() => {})
  if (target.platform === "win32") {
    await until(() => current.child.exitCode !== null, "Windows 关闭窗口后退出")
    assert.equal(current.child.exitCode, 0)
  } else {
    await new Promise(resolve => setTimeout(resolve, 300))
    assert.equal(current.child.exitCode, null, "Mac 关闭窗口后应继续驻留")
  }
  await current.stop()
  current = await launch()
  await until(() => current.evaluate('Boolean(document.querySelector(".home-content"))'), "重新启动")
  const restored = await current.evaluate("window.cinder.snapshot()")
  assert.equal(restored.player.trackId, id)
  assert.deepEqual(
    restored.player.queue,
    library.tracks.map(track => track.id),
  )
  await until(
    () =>
      current.evaluate(
        `[...document.querySelectorAll("audio")].some(audio => audio.readyState >= 1 && audio.paused && Math.abs(audio.currentTime - ${savedPosition}) < 0.5)`,
      ),
    "重启后暂停恢复歌曲与播放进度",
  )
  assert.equal(restored.settings.theme, "light")
  assert.equal(restored.settings.volume, 0.25)
  assert.ok(restored.favorites.includes(id))
  assert.equal(restored.stats.tracks, 2)
  assert.deepEqual(current.errors, [])
  console.log(
    `PASS ${target.platform}/${target.arch}: 启动、原生窗口、路径导入、真实控件播放/解码/Range/拖动/进度恢复、快捷键、50 张封面、设置与收藏持久化、关闭行为`,
  )
} finally {
  await current?.stop()
  await fs.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
}
