/**
 * 为没有本地歌词的单曲查询在线时间轴，只发送歌曲标签，不发送文件路径或音频。
 * 匹配版本和时长后才采用结果；缓存保存在应用数据目录，失败不阻止音频播放。
 */
import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { RecordingMatch } from "../../domain/artwork/recordingMatch.js"

/**
 * 歌词与封面共享录音标签比较规则，保持跨目录的一致匹配边界。
 */
const normalize = RecordingMatch.key

/**
 * 核对在线结果是否为同一录音，拒绝同名异人、DJ 与原版以及明显不同时长的版本。
 * 缺少歌手或时长时不猜测同步歌词，避免把不相关时间轴应用到用户歌曲。
 */
export function matchingLyrics(track, item) {
  const artist = normalize(track.artist || "")
  const other = normalize(item.artist || "")
  return (
    normalize(track.title || "") === normalize(item.title || "") &&
    artist &&
    artist !== normalize("未知歌手") &&
    (artist === other || (Math.min(artist.length, other.length) >= 2 && (artist.includes(other) || other.includes(artist)))) &&
    track.duration > 0 &&
    item.duration > 0 &&
    Math.abs(track.duration - item.duration) <= 8
  )
}

/**
 * 管理歌词请求合并、成功缓存和失败冷却，避免重复展开详情造成连续联网。
 * 请求器可由隔离测试替换；生产环境仅使用固定服务地址和有体积上限的 JSON。
 */
export class OnlineLyrics {
  /**
   * 指定缓存目录与请求实现，构造阶段不创建目录或启动网络请求。
   * 同一歌曲的标签或时长变化会生成新缓存键，旧版本不会覆盖新结果。
   */
  constructor(directory, fetcher = fetch) {
    this.directory = directory
    this.fetcher = fetcher
    this.pending = new Map()
    this.recent = new Map()
    this.cooldowns = new Map()
  }

  /**
   * 读取固定来源的 JSON，逐块限制响应大小并遵守服务器限流时间。
   * 不重试限流请求，异常交给上层转成非阻塞歌词提示；响应地址不能由渲染进程指定。
   */
  async json(url, options = {}) {
    const host = new URL(url).hostname
    if (!["music.163.com", "c.y.qq.com", "lrclib.net"].includes(host)) {
      throw new Error("不支持的歌词来源")
    }
    if ((this.cooldowns.get(host) || 0) > Date.now()) {
      throw new Error("歌词来源暂时限流，请稍后重试")
    }
    const { deadline = Infinity, ...request } = options
    const response = await this.fetcher(url, {
      ...request,
      signal: AbortSignal.timeout(Math.max(1, Math.min(6500, deadline - Date.now()))),
      headers: { "User-Agent": "cinder/0.1.0 (personal desktop music player)", ...options.headers },
    })
    if (response.status === 404) {
      return null
    }
    if (response.status === 429 || response.status === 503) {
      const retry = response.headers.get("retry-after")
      const seconds = Number(retry)
      const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - Date.now()
      this.cooldowns.set(host, Date.now() + Math.max(60000, Number.isFinite(delay) ? delay : 60000) * 1.1)
    }
    if (!response.ok) {
      throw new Error(`歌词来源暂不可用（${response.status}）`)
    }
    let size = 0
    const chunks = []
    for await (const chunk of response.body) {
      size += chunk.byteLength
      if (size > 1024 * 1024) {
        throw new Error("歌词响应超过大小限制")
      }
      chunks.push(Buffer.from(chunk))
    }
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    if (data?.code !== undefined && ![0, 200].includes(data.code)) {
      if ([405, 429].includes(data.code)) {
        this.cooldowns.set(host, Date.now() + 120000)
      }
      throw new Error("歌词来源暂未接受本次查询")
    }
    return data
  }

  /**
   * 优先匹配中文曲库中的完整录音，再读取对应的逐行歌词。
   * 最多核对两个可靠候选，纯音乐和未命中的曲目返回空结果，不拼接假歌词。
   */
  async netease(track, deadline) {
    const data = await this.json("https://music.163.com/api/search/get/web", {
      method: "POST",
      deadline,
      headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: "https://music.163.com" },
      body: new URLSearchParams({ s: `${track.title} ${track.artist}`, type: "1", limit: "20", offset: "0" }),
    })
    const songs = (data?.result?.songs || [])
      .map(song => ({
        id: song.id,
        title: song.name,
        artist: song.artists?.map(item => item.name).join(" / "),
        duration: song.duration / 1000,
      }))
      .filter(song => matchingLyrics(track, song))
      .sort((a, b) => Math.abs(a.duration - track.duration) - Math.abs(b.duration - track.duration))
      .slice(0, 2)
    for (const song of songs) {
      const result = await this.json(`https://music.163.com/api/song/lyric?id=${encodeURIComponent(song.id)}&lv=-1&kv=-1&tv=-1`, {
        deadline,
        headers: { Referer: "https://music.163.com" },
      })
      if (result?.lrc?.lyric?.trim()) {
        return { text: result.lrc.lyric, source: "网易云音乐", sourceUrl: `https://music.163.com/song?id=${song.id}` }
      }
    }
    return null
  }

  /**
   * 从 QQ 音乐公开目录补充中文歌词，先核对歌名、歌手与录音时长再取词。
   * 接口不可用时直接交给下一来源；只解码文本，不执行来源返回的 HTML 或脚本。
   */
  async qq(track, deadline) {
    const params = new URLSearchParams({ w: `${track.title} ${track.artist}`, format: "json", p: "1", n: "20" })
    const data = await this.json(`https://c.y.qq.com/soso/fcgi-bin/client_search_cp?${params}`, {
      deadline,
      headers: { Referer: "https://y.qq.com/" },
    })
    const songs = (data?.data?.song?.list || [])
      .filter(
        song =>
          song.songmid &&
          matchingLyrics(track, {
            title: song.songname,
            artist: song.singer?.map(item => item.name).join(" / "),
            duration: song.interval,
          }),
      )
      .slice(0, 2)
    for (const song of songs) {
      const query = new URLSearchParams({ songmid: song.songmid, format: "json", nobase64: "1" })
      const result = await this.json(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${query}`, {
        deadline,
        headers: { Referer: "https://y.qq.com/" },
      })
      if (typeof result?.lyric !== "string" || !result.lyric.trim()) {
        continue
      }
      let text = result.lyric
        .replace(/&#(x[0-9a-f]+|\d+);/gi, (_match, code) => {
          const point = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code)
          return point <= 0x10ffff ? String.fromCodePoint(point) : ""
        })
        .replaceAll("&amp;", "&")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&apos;", "'")
      if (!text.includes("[") && /^[A-Za-z0-9+/=\s]+$/.test(text)) {
        const decoded = Buffer.from(text, "base64").toString("utf8")
        if (/\[\d+:/.test(decoded)) {
          text = decoded
        }
      }
      return { text, source: "QQ 音乐", sourceUrl: `https://y.qq.com/n/ryqq/songDetail/${encodeURIComponent(song.songmid)}` }
    }
    return null
  }

  /**
   * 在公开歌词库中按歌名、歌手与时长寻找同步版本，静态歌词作为降级结果保留。
   * 一次搜索后只在本地筛选，不为整份音乐库批量发起请求。
   */
  async lrclib(track, deadline) {
    const params = new URLSearchParams({ track_name: track.title, artist_name: track.artist })
    const items = await this.json(`https://lrclib.net/api/search?${params}`, { deadline })
    const matches = (Array.isArray(items) ? items : [])
      .filter(
        item =>
          matchingLyrics(track, { title: item.trackName, artist: item.artistName, duration: item.duration }) &&
          !item.instrumental,
      )
      .sort(
        (a, b) =>
          Number(Boolean(b.syncedLyrics)) - Number(Boolean(a.syncedLyrics)) ||
          Math.abs(a.duration - track.duration) - Math.abs(b.duration - track.duration),
      )
    const item = matches.find(result => result.syncedLyrics || result.plainLyrics)
    return item
      ? { text: item.syncedLyrics || item.plainLyrics, source: "LRCLIB", sourceUrl: `https://lrclib.net/api/get/${item.id}` }
      : null
  }

  /**
   * 为明确打开的歌曲详情获取歌词，优先使用离线缓存并合并同一首的并发请求。
   * 没有可靠结果时短暂记忆失败，手动重试可绕过歌曲冷却；来源限流始终生效。
   */
  async get(track, force = false, online = true) {
    const key = createHash("sha256")
      .update(JSON.stringify([track.id, track.title, track.artist, track.duration]))
      .digest("hex")
    const file = path.join(this.directory, `${key}.json`)
    let cached = null
    try {
      const value = JSON.parse(await fs.readFile(file, "utf8"))
      if (typeof value.text === "string" && value.text.trim() && value.text.length <= 1024 * 1024) {
        cached = { ...value, cached: true, status: "ready" }
      }
    } catch {}
    if (cached && (!force || !online)) {
      return cached
    }
    if (!online) {
      return null
    }
    const privateTags = /(?:^|\D)1[3-9](?:[\s-]?\d){9}(?:\D|$)|会议记录|通话记录|voice memo/i.test(
      `${track.title} ${track.artist}`,
    )
    if (privateTags || !track.duration || !track.artist || track.artist === "未知歌手") {
      return { status: "missing", message: "歌曲标签不足，无法可靠匹配在线歌词。可在歌曲旁放置同名 LRC。" }
    }
    if (this.pending.has(key)) {
      return this.pending.get(key)
    }
    const previous = this.recent.get(key)
    if (!force && previous?.until > Date.now()) {
      return previous.result
    }
    const task = this.lookup(track, file)
      .then(result => {
        if (result.status !== "ready" && cached) {
          return { ...cached, message: "在线来源暂不可用，继续使用已缓存歌词。" }
        }
        this.recent.set(key, { until: Date.now() + (result.status === "error" ? 60000 : 3600000), result })
        if (this.recent.size > 200) {
          this.recent.delete(this.recent.keys().next().value)
        }
        return result
      })
      .finally(() => this.pending.delete(key))
    this.pending.set(key, task)
    return task
  }

  /**
   * 依次使用网易云、QQ 音乐和 LRCLIB，纯文本仅作后备，继续查找有时间轴的版本。
   * 总查询预算十八秒，按来源遵守限流；缓存通过原子替换落盘，断网仍保留最后成功结果。
   * 失败、无匹配和静态歌词分开反馈，不为无时间戳文本伪造时间轴。
   */
  async lookup(track, file) {
    const failures = []
    let plain = null
    const deadline = Date.now() + 18000
    for (const provider of [this.netease, this.qq, this.lrclib]) {
      if (Date.now() >= deadline) {
        failures.push("查询超时")
        break
      }
      try {
        const result = await provider.call(this, track, deadline)
        if (!result) {
          continue
        }
        if (!/\[\d+:\d+(?:\.\d+)?\]/.test(result.text)) {
          plain ||= result
          continue
        }
        return this.cache(file, result)
      } catch (error) {
        failures.push(error.name === "TimeoutError" ? "歌词来源连接超时" : error.message)
      }
    }
    if (plain) {
      return this.cache(file, plain)
    }
    return {
      status: failures.length ? "error" : "missing",
      message: failures.length ? "在线歌词暂未获取成功，可以稍后重试。" : "没有找到歌手、版本和时长相符的歌词。",
    }
  }

  /**
   * 原子保存已匹配的歌词与来源，保存失败仍交付当前可用结果。
   * 临时文件只位于应用歌词缓存目录，音乐文件及其相邻目录保持只读。
   */
  async cache(file, result) {
    try {
      await fs.mkdir(this.directory, { recursive: true })
      await fs.writeFile(`${file}.tmp`, JSON.stringify(result))
      await fs.rename(`${file}.tmp`, file)
    } catch {}
    return { ...result, status: "ready" }
  }
}
