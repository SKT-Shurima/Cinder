/**
 * 封装 Navidrome / Subsonic 的只读请求、盐值认证和传输生命周期。
 * 认证地址只在主进程内构造，不保存到索引，也不把带令牌的异常传给界面。
 */
import { createHash, randomBytes } from "node:crypto"

/**
 * 限定客户端可调用的读取接口，远程同步不会更改服务器的歌单、收藏或播放记录。
 */
const readEndpoints = new Set([
  "ping",
  "search3",
  "getAlbumList2",
  "getAlbum",
  "getLyrics",
  "getLyricsBySongId",
  "getCoverArt",
  "stream",
])

/**
 * 规范服务器根地址，保留反向代理的路径前缀，允许粘贴 Navidrome 登录页地址。
 * 不接受嵌入账号的 URL 或其他协议；认证材料始终通过独立凭据容器传入。
 */
export function subsonicAddress(input) {
  let url
  try {
    url = new URL(String(input || "").trim())
  } catch {
    throw new Error("请填写完整曲库地址，例如 https://music.example.com")
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || !url.hostname) {
    throw new Error("曲库地址只支持 HTTP / HTTPS，请单独填写账号和密码")
  }
  url.hash = ""
  url.search = ""
  url.pathname = url.pathname.replace(/\/(?:app|rest)\/?$/u, "").replace(/\/+$/u, "") + "/"
  return url.href
}

/**
 * 有界读取接口正文，限制 JSON 和封面占用的内存，超限时立即取消远端流。
 * 调用方按资源类型传入上限，音频播放不会经过这个完整缓冲路径。
 */
export async function remoteBytes(response, limit) {
  if (!response.body) {
    return Buffer.alloc(0)
  }
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      size += value.byteLength
      if (size > limit) {
        throw new Error("曲库返回的数据过大，请缩小资源范围")
      }
      chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks)
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/**
 * 为每个来源持有认证材料和活动传输，移除来源时统一中断网络读取。
 * 每次请求生成独立随机盐；不发送明文密码，不跟随可能携带认证参数的重定向。
 */
export class SubsonicClient {
  /**
   * 注入已校验的服务器配置与本次凭据，测试可替换传输而不读取真实账号。
   * 创建客户端不会立即登录；close 后的实例不能重新发起请求。
   */
  constructor(source, credentials, fetcher = globalThis.fetch) {
    this.source = source
    this.password = credentials.password
    this.fetcher = fetcher
    this.controllers = new Set()
    this.closed = false
  }

  /**
   * 为固定只读接口创建临时认证地址，保留服务器路径前缀和歌曲字符串标识。
   * 返回值只能用于主进程传输，不得写入歌曲、日志或返回给 renderer。
   */
  address(endpoint, parameters) {
    if (!readEndpoints.has(endpoint)) {
      throw new Error("不支持的曲库读取接口")
    }
    const salt = randomBytes(16).toString("hex")
    const token = createHash("md5")
      .update(this.password + salt)
      .digest("hex")
    const url = new URL(`rest/${endpoint}.view`, this.source.serverUrl)
    for (const [key, value] of Object.entries({
      ...parameters,
      u: this.source.username,
      t: token,
      s: salt,
      v: "1.16.1",
      c: "cinder",
      f: "json",
    })) {
      url.searchParams.set(key, String(value))
    }
    return url
  }

  /**
   * 打开可取消的远端响应：连接头部限时二十秒，每次正文读取限时三十秒。
   * 音频持续传输时不会受整首歌曲时长限制；取消只关闭本次请求，退出关闭全部请求。
   * 使用播放器自身的 User-Agent 标识，避免服务器将默认脚本客户端误判为未知来源。
   */
  async open(endpoint, parameters = {}, { signal, headers } = {}) {
    if (this.closed) {
      throw new Error("曲库连接已关闭，请重新连接")
    }
    const controller = new AbortController()
    this.controllers.add(controller)
    const abort = () => controller.abort()
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) {
      controller.abort()
    }
    let timer = setTimeout(abort, 20000)
    const release = () => {
      clearTimeout(timer)
      this.controllers.delete(controller)
      signal?.removeEventListener("abort", abort)
    }
    try {
      const requestHeaders = new Headers(headers)
      requestHeaders.set("User-Agent", "cinder/0.1.0")
      const response = await this.fetcher(this.address(endpoint, parameters), {
        headers: requestHeaders,
        signal: controller.signal,
        redirect: "error",
      })
      clearTimeout(timer)
      if (!response.body) {
        release()
        return response
      }
      const reader = response.body.getReader()
      const body = new ReadableStream({
        pull: async target => {
          timer = setTimeout(abort, 30000)
          try {
            const { done, value } = await reader.read()
            clearTimeout(timer)
            if (done) {
              release()
              reader.releaseLock()
              target.close()
            } else {
              target.enqueue(value)
            }
          } catch {
            release()
            controller.abort()
            reader.releaseLock()
            target.error(new Error("远程音频读取中断，请检查网络后重试"))
          }
        },
        cancel: async () => {
          controller.abort()
          release()
          await reader.cancel().catch(() => {})
          reader.releaseLock()
        },
      })
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
    } catch {
      release()
      controller.abort()
      throw new Error(signal?.aborted || this.closed ? "曲库请求已取消" : "无法读取曲库，请核对地址、网络或服务器证书")
    }
  }

  /**
   * 解码有限大小的 Subsonic JSON，并把认证、权限和接口错误转换为可操作提示。
   * 不回显服务器任意错误正文；错误码保留给兼容性降级和测试判断。
   */
  async json(endpoint, parameters = {}) {
    const response = await this.open(endpoint, parameters)
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`曲库请求失败（HTTP ${response.status}），请核对服务器地址和账号`)
    }
    let data
    try {
      data = JSON.parse((await remoteBytes(response, 16 * 1024 * 1024)).toString("utf8"))?.["subsonic-response"]
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("此地址没有返回音乐曲库接口，请填写 Navidrome / Subsonic 的服务器根地址")
      }
      throw error
    }
    if (!data || typeof data.status !== "string") {
      throw new Error("服务器不是可识别的 Navidrome / Subsonic 曲库")
    }
    if (data.status !== "ok") {
      const code = Number(data.error?.code)
      const message =
        {
          40: "登录失败，请检查曲库用户名和密码",
          41: "此服务器仅支持令牌登录，请核对认证设置",
          50: "当前账号没有访问此曲库或歌曲的权限",
          70: "这首远程歌曲已不存在，请重新同步曲库",
        }[code] || `曲库接口暂不可用（${Number.isFinite(code) ? code : "未知错误"}）`
      const error = new Error(message)
      error.code = code
      throw error
    }
    return data
  }

  /**
   * 取消该来源所有活动请求并清除内存中的密码。
   * 移除来源、重新登录和应用退出都复用此释放入口。
   */
  close() {
    this.closed = true
    this.password = ""
    for (const controller of this.controllers) {
      controller.abort()
    }
    this.controllers.clear()
  }
}
