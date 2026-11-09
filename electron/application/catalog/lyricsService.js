/**
 * 按服务器、本地文件、内嵌文本与在线缓存的优先级取得歌词。
 * 在线访问需要显式授权参数；失败可回退到本地纯文本，不干扰音频播放。
 */
import fs from "node:fs/promises"
import path from "node:path"
import { lyricsTimeline } from "../../domain/catalog/trackRules.js"

/**
 * 协调本地、服务器及在线歌词，向播放器返回可展示的统一时间轴。
 * 有同步本地歌词时不联网，纯文本回退不能被不可靠的在线空结果覆盖。
 */
export class LyricsService {
  /**
   * 绑定曲库门面与在线歌词仓储，服务器接口由门面在完成连接后注入。
   */
  constructor(library, online) {
    this.library = library
    this.online = online
  }

  /**
   * 从歌曲关联的只读来源读取本地歌词，同步 LRC 优先于内嵌纯文本。
   * 在线歌曲不会把平台地址解释为本地文件路径；单份 LRC 最大 1 MB。
   */
  async local(track) {
    if (track.sourceId) {
      return this.library.remote.lyrics(track)
    }
    if (track.kind !== "online") {
      const stem = path.parse(track.path)
      const name = stem.name + ".lrc"
      for (const candidate of [path.join(stem.dir, name), path.join(stem.dir, "lyrics", name)]) {
        try {
          if ((await fs.stat(candidate)).size > 1048576) {
            continue
          }
          const parsed = lyricsTimeline(await fs.readFile(candidate, "utf8"))
          if (this.hasText(parsed)) {
            return parsed
          }
        } catch {}
      }
    }
    return lyricsTimeline(track.lyricText ?? "")
  }

  /**
   * 判断是否存在可展示内容，仅有时间标签或元信息的 LRC 视为缺失。
   */
  hasText(lyrics) {
    return lyrics.lines.some(line => line.text) || Boolean(lyrics.text.replace(/\[[^\]]*\]/gu, "").trim())
  }

  /**
   * 同步本地歌词直接返回；纯文本可回退到同步缓存，手动重试才强制更新。
   * 在线匹配仍无同步时间轴时保留可读的本地文本，避免用空结果覆盖已有歌词。
   */
  async read(id, { online = false, force = false } = {}) {
    const track = this.library.track(id)
    const local = await this.local(track)
    const available = this.hasText(local)
    const localResult = { ...local, source: track.sourceId ? "服务器歌词" : "本地歌词", status: "ready" }
    if (available && local.lines.length) {
      return localResult
    }
    if (available && !(online && force)) {
      const cached = await this.online.get(track, false, false)
      return cached?.text && lyricsTimeline(cached.text).lines.length
        ? { ...lyricsTimeline(cached.text), ...cached }
        : localResult
    }
    const result = await this.online.get(track, force, online)
    const parsed = lyricsTimeline(result?.text)
    if (available && !parsed.lines.length) {
      return localResult
    }
    return { ...parsed, ...result, source: result?.source ?? "", status: result?.status ?? "missing" }
  }
}
