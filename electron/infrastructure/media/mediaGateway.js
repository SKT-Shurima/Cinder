/**
 * 按媒体来源路由只读协议请求，平台流、服务器流与本地文件共享响应边界。
 * 界面只能提交已索引标识；图片缓存路径、音频路径和网络地址均由主进程决定。
 */
import fs from "node:fs/promises"
import path from "node:path"
import { createReadStream } from "node:fs"
import { Readable } from "node:stream"
import { ByteRange } from "../../domain/media/byteRange.js"

const audioMime = Object.fromEntries(
  [
    ["mpeg", ["mp3"]],
    ["flac", ["flac"]],
    ["ogg", ["ogg", "opus"]],
    ["mp4", ["m4a", "mp4"]],
    ["aac", ["aac"]],
    ["wav", ["wav"]],
    ["aiff", ["aif", "aiff"]],
  ].flatMap(([mime, extensions]) => extensions.map(extension => ["." + extension, "audio/" + mime])),
)

/**
 * 将媒体协议按平台、服务器与本地文件路由到各自只读来源。
 * 所有入口只接收索引标识，取消请求会释放本次流及其事件监听。
 */
export class MediaGateway {
  /**
   * 注入三类资源服务和错误通知，不在构造阶段打开文件或建立网络连接。
   */
  constructor({ library, remote, online, onPlaybackError }) {
    Object.assign(this, { library, remote, online, onPlaybackError })
  }

  /**
   * 按歌曲来源代理平台音频、音乐服务器音频，或解析本地与 SFTP 文件描述。
   * 服务器拒绝音频时发布可操作错误，切歌或拖动导致的主动取消不会误报播放失败。
   * 原始接口响应与账号信息不进入界面。
   */
  async audio(id, request) {
    const track = this.library.track(id)
    if (track.kind === "online") {
      try {
        return await this.online.media(track, request)
      } catch (failure) {
        if (request.signal.aborted) {
          return new Response(null, { status: 499 })
        }
        this.onPlaybackError({ id, message: failure.message })
        return new Response(null, { status: 403 })
      }
    }
    if (track.sourceId) {
      try {
        const response = await this.remote.media(track, request)
        if (response) {
          return response
        }
      } catch (failure) {
        if (request.signal.aborted) {
          return new Response(null, { status: 499 })
        }
        this.onPlaybackError({ id, message: failure.message })
        return new Response(null, { status: 403 })
      }
    }
    const location = track.sourceId ? await this.remote.locate(track.sourceId, track.path) : null
    return this.file(request, { filename: track.path, mime: audioMime[track.extension], location, cache: false })
  }

  /**
   * 为可信文件描述生成支持拖动的只读响应，HEAD 与空文件不创建读取流。
   * 请求取消时销毁底层流并释放 abort 监听，避免远程连接在快速切歌后泄漏。
   */
  async file(request, descriptor) {
    const { filename, mime, location, cache } = descriptor
    const stat = location?.stat ?? (await fs.stat(filename))
    if (!stat.isFile()) {
      return new Response(null, { status: 404 })
    }
    const range = ByteRange.parse(request.headers.get("range"), stat.size)
    if (!range) {
      return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + stat.size } })
    }
    const headers = new Headers({
      "Content-Type": mime,
      "Content-Length": String(range.length),
      "Access-Control-Allow-Origin": "*",
      "Accept-Ranges": "bytes",
      "Cache-Control": cache ? "public, max-age=31536000, immutable" : "no-cache",
    })
    if (range.partial) {
      headers.set("Content-Range", `bytes ${range.start}-${range.end}/${stat.size}`)
    }
    const response = { status: range.partial ? 206 : 200, headers }
    if (request.method === "HEAD" || stat.size === 0) {
      return new Response(null, response)
    }
    const offsets = { start: range.start, end: range.end }
    const stream = location
      ? this.remote.stream(location.session, location.filename, offsets)
      : createReadStream(filename, offsets)
    /**
     * 中止本次媒体流，只影响该请求，不关闭共享的服务器来源或播放器实例。
     */
    const stop = () => stream.destroy()
    if (request.signal.aborted) {
      stop()
      return new Response(null, { status: 499 })
    }
    request.signal.addEventListener("abort", stop, { once: true })
    stream.once("close", () => request.signal.removeEventListener("abort", stop))
    return new Response(Readable.toWeb(stream), response)
  }

  /**
   * 分派固定协议主机，拒绝写入方法及不符合缓存命名规则的资源标识。
   * 文件丢失按 404 降级，播放器不会收到包含本机路径的错误正文。
   */
  async handle(request) {
    if (request.method !== "HEAD" && request.method !== "GET") {
      return new Response(null, { status: 405 })
    }
    const address = new URL(request.url)
    const id = address.pathname.substring(1)
    try {
      if (address.hostname === "audio") {
        return await this.audio(id, request)
      }
      if (address.hostname === "remote-cover" && /^[a-f0-9]{24}$/u.test(id)) {
        const image = await this.remote.cover(id)
        return new Response(request.method === "HEAD" ? null : image.bytes, {
          headers: { "Content-Type": image.mime, "Cache-Control": "private, max-age=86400", "Access-Control-Allow-Origin": "*" },
        })
      }
      if (["online-cover", "artist-cover"].includes(address.hostname) && /^[a-f0-9]{24}$/u.test(id)) {
        const image = address.hostname === "artist-cover" ? await this.online.artists.cover(id) : await this.online.cover(id)
        return new Response(request.method === "HEAD" ? null : image.bytes, {
          headers: { "Content-Type": image.mime, "Cache-Control": "public, max-age=86400", "Access-Control-Allow-Origin": "*" },
        })
      }
      if (address.hostname === "cover" && /^[a-f0-9]{64}\.(?:jpg|png|webp)$/u.test(id)) {
        const mime = { ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" }[path.extname(id)]
        return await this.file(request, { filename: path.join(this.library.coverDir, id), mime, cache: true })
      }
    } catch {}
    return new Response(null, { status: 404 })
  }
}
