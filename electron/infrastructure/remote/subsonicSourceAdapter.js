/**
 * 将音乐服务器的曲目、专辑、封面与音频转换为现有远程曲库模型。
 * 只同步账号可见的索引；不上传文件、不修改服务器歌单，也不提交播放统计。
 */
import fs from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { catalogKey, audioFormats, lyricsTimeline } from "../../domain/catalog/trackRules.js"
import { ByteRange } from "../../domain/media/byteRange.js"
import { imageMime } from "../artwork/artworkStore.js"
import { SubsonicClient, subsonicAddress, remoteBytes } from "./subsonicClient.js"
import { RemoteAudioLayout } from "./remoteAudioLayout.js"
import { publicPresetCredentials, remoteLibraryPresets } from "#shared/remotePresets"

/**
 * 校验音乐服务器配置，与 SFTP 的主机、端口、目录字段保持明确区分。
 * 重新登录不允许隐式更换账号或地址，避免原来源中的收藏指向另一个账号。
 */
function sourceConfig(input) {
  const serverUrl = subsonicAddress(input.serverUrl)
  const username = String(input.username || "").trim()
  if (!username || username.length > 128 || /[\x00-\x1f]/u.test(username)) {
    throw new Error("请填写有效的曲库用户名")
  }
  return {
    id: input.id,
    protocol: "subsonic",
    serverUrl,
    username,
    name: String(input.name || new URL(serverUrl).hostname)
      .trim()
      .slice(0, 80),
    auth: "password",
    remember: input.remember === true,
  }
}

/**
 * 将服务端歌曲标识映射到稳定索引，专辑身份用于分组而非拼接本机路径。
 * 不保存认证 URL；封面携带非敏感的连接版本，重新登录后允许失败的图片重新加载。
 * 只接受播放器支持的音频，视频及不完整条目不会进入曲库。
 */
function catalogTrack(song, source, previous) {
  const extension = `.${String(song.suffix || "").toLowerCase()}`
  if (!song.id || song.isVideo || song.isDir || !audioFormats.has(extension)) {
    return null
  }
  const id = catalogKey(`subsonic:${source.id}:${song.id}`)
  return {
    id,
    sourceId: source.id,
    remoteId: String(song.id),
    remoteAlbumId: String(song.albumId || song.parent || "singles"),
    remoteCoverId: song.coverArt ? String(song.coverArt) : null,
    path: `/subsonic/${encodeURIComponent(String(song.albumId || song.parent || "singles"))}/${encodeURIComponent(String(song.id))}${extension}`,
    filename: path.posix.basename(String(song.path || `${song.title || song.id}${extension}`)),
    extension,
    title: String(song.title || "未知歌曲"),
    artist: String(song.artist || "未知歌手"),
    album: String(song.album || "单曲"),
    duration: Math.max(0, Number(song.duration) || 0),
    size: Math.max(0, Number(song.size) || 0),
    codec: extension.substring(1).toUpperCase(),
    sampleRate: Number(song.samplingRate) || 0,
    bitsPerSample: Number(song.bitDepth) || 0,
    metadataRead: true,
    cover: song.coverArt ? `remote:${id}?v=${source.connectionRevision || 0}` : null,
    ...(previous?.coverSource?.manual ? { cover: previous.cover, coverSource: previous.coverSource } : {}),
  }
}

/**
 * 为音乐服务器实现远程来源策略，凭据保存与来源移除仍交由统一门面管理。
 * 协议客户端按来源复用；扫描失败保留原索引，封面按需读取并使用现有安全缓存。
 */
export class SubsonicSourceAdapter {
  /**
   * 绑定曲库门面与可替换网络传输，不在初始化时主动连接任何服务器。
   */
  constructor(owner, fetcher) {
    this.owner = owner
    this.library = owner.library
    this.fetcher = fetcher
    this.clients = new Map()
    this.covers = new Map()
    this.coverTasks = new Map()
    this.layouts = new RemoteAudioLayout()
  }

  /**
   * 验证登录和曲目读取后才保存来源，连接测试不会写入配置或歌曲。
   * 重新登录关闭旧传输并更新封面连接版本；私人密码只进入凭据容器，不进入曲库快照。
   * 只有完全匹配运营方公开账号的连接才保留预设身份，供重启后恢复公开演示连接。
   * 测试预设默认不参与推荐，重新登录保留用户已经保存的推荐开关。
   */
  async configure(input, credentials, save) {
    const library = this.library
    if (library.status.phase !== "idle") {
      throw new Error("请先等待当前音乐库任务完成")
    }
    const source = sourceConfig(input)
    if (!credentials?.password) {
      throw new Error("请输入曲库登录密码")
    }
    const old = library.state.remoteSources.find(
      item =>
        item.id === source.id ||
        (item.protocol === "subsonic" && item.serverUrl === source.serverUrl && item.username === source.username),
    )
    if (
      source.id &&
      (!old || old.protocol !== "subsonic" || old.serverUrl !== source.serverUrl || old.username !== source.username)
    ) {
      throw new Error("重新登录时不能修改曲库地址或账号，请另行添加来源")
    }
    const config = { ...source, id: old?.id || randomUUID(), connectionRevision: (Number(old?.connectionRevision) || 0) + 1 }
    const published = publicPresetCredentials({ ...config, presetId: input.presetId })
    config.presetId = published?.password === credentials.password ? input.presetId : undefined
    const preset = remoteLibraryPresets.find(item => item.id === input.presetId && item.serverUrl === config.serverUrl)
    config.recommendationsEnabled =
      typeof old?.recommendationsEnabled === "boolean" ? old.recommendationsEnabled : preset?.recommendationsEnabled !== false
    const client = new SubsonicClient(config, credentials, this.fetcher)
    library.progress({ phase: "connect", error: null, message: `正在连接 ${config.name}…` })
    try {
      const info = await client.json("ping")
      Object.assign(config, { serverType: info.type || "subsonic", openSubsonic: info.openSubsonic === true })
      if (config.openSubsonic || config.serverType === "navidrome") {
        await client.json("search3", { query: "", artistCount: 0, albumCount: 0, songCount: 1 })
      } else {
        await client.json("getAlbumList2", { type: "alphabeticalByName", size: 1 })
      }
      if (!save) {
        return { message: "连接成功，账号可读取曲库" }
      }
      await this.owner.saveCredentials(config.id, { password: credentials.password }, config.remember)
      this.disconnect(config.id)
      library.state.remoteSources = [...library.state.remoteSources.filter(item => item.id !== config.id), { ...old, ...config }]
      await library.save()
      library.emit("changed")
      return { sourceId: config.id }
    } finally {
      client.close()
      library.progress({ phase: "idle", message: "" })
    }
  }

  /**
   * 获取仍存在的音乐服务器及其客户端，凭据失效时要求用户重新登录。
   * 只接受已保存来源，媒体请求不能临时指定服务器或认证材料。
   */
  connection(id) {
    const source = this.library.state.remoteSources.find(item => item.id === id && item.protocol === "subsonic")
    if (!source) {
      throw new Error("音乐服务器已移除，请重新添加")
    }
    if (!this.clients.has(id)) {
      this.clients.set(id, new SubsonicClient(source, this.owner.credentialsFor(id), this.fetcher))
    }
    return { source, client: this.clients.get(id) }
  }

  /**
   * 按稳定偏移分页读取全部曲目，OpenSubsonic 使用空查询同步，传统服务器按专辑读取。
   * 不以服务端可能缩小的页大小判断结束，重复页面或超过十万首时停止并保留旧索引。
   */
  async *pages(source, client) {
    if (source.openSubsonic || source.serverType === "navidrome") {
      for (let offset = 0; offset <= 100000;) {
        const data = await client.json("search3", {
          query: "",
          artistCount: 0,
          albumCount: 0,
          songCount: 500,
          songOffset: offset,
        })
        const songs = data.searchResult3?.song || []
        if (!songs.length) {
          return
        }
        yield songs
        offset += songs.length
      }
    } else {
      const seen = new Set()
      for (let offset = 0; offset <= 100000;) {
        const data = await client.json("getAlbumList2", { type: "alphabeticalByName", size: 500, offset })
        const albums = data.albumList2?.album || []
        if (!albums.length) {
          return
        }
        for (const album of albums) {
          if (seen.has(album.id)) {
            throw new Error("服务器返回了重复专辑，已停止同步并保留原曲库")
          }
          seen.add(album.id)
          const data = await client.json("getAlbum", { id: album.id })
          yield data.album?.song || []
        }
        offset += albums.length
      }
    }
    throw new Error("曲库过大，请使用规模不超过十万首的音乐库")
  }

  /**
   * 完整读取成功后原子替换该来源的索引，保留其他来源、收藏和手动封面。
   * 网络失败、重复分页或来源更新时不提交半份曲库，重试可继续使用原有索引。
   */
  async scan(id) {
    const library = this.library
    if (library.status.phase !== "idle") {
      throw new Error("请等待当前任务完成")
    }
    const { source, client } = this.connection(id)
    library.progress({ phase: "remote", done: 0, total: 0, error: null, message: `正在同步 ${source.name}…` })
    try {
      const old = new Map(library.state.tracks.filter(track => track.sourceId === id).map(track => [track.remoteId, track]))
      const tracks = []
      const seen = new Set()
      for await (const songs of this.pages(source, client)) {
        for (const song of songs) {
          const remoteId = String(song.id)
          if (seen.has(remoteId)) {
            throw new Error("服务器返回了重复曲目，已停止同步并保留原曲库")
          }
          seen.add(remoteId)
          const track = catalogTrack(song, source, old.get(remoteId))
          if (track) {
            tracks.push(track)
          }
        }
        if (seen.size > 100000) {
          throw new Error("曲库过大，请使用规模不超过十万首的音乐库")
        }
        library.progress({ done: tracks.length, message: `${source.name} · 已读取 ${tracks.length} 首歌曲` })
      }
      if (!library.state.remoteSources.includes(source)) {
        throw new Error("曲库来源已更新，请重新同步")
      }
      library.state.tracks = [...library.state.tracks.filter(track => track.sourceId !== id), ...tracks].sort((a, b) =>
        a.path.localeCompare(b.path, "zh-CN", { numeric: true }),
      )
      source.scannedAt = Date.now()
      await library.save()
      library.emit("changed")
      library.progress({
        phase: "idle",
        done: tracks.length,
        total: tracks.length,
        message: `${source.name} · 已导入 ${tracks.length} 首歌曲`,
      })
      return library.snapshot()
    } catch (error) {
      library.progress({ phase: "idle", error: error.message, message: `曲库同步失败：${error.message}` })
      throw error
    }
  }

  /**
   * 代理原始音频并转发字节范围，避免将认证 URL 交给页面或整首下载到内存。
   * 缺失时长时先核对真实容器，错误附加标签的 MP4 使用虚拟范围，原文件不会被修改。
   * 请求取消时终止上游读取；HEAD 只返回头部，接口错误不会被当成音频返回。
   */
  async media(track, request) {
    const { client } = this.connection(track.sourceId)
    const layout = await this.layouts.read(track, client)
    const range = request.headers.get("range")
    const visible = layout.size > 0 ? ByteRange.parse(range, layout.size) : null
    if (range && layout.size > 0 && !visible) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${layout.size}` } })
    }
    const upstreamRange = layout.offset ? `bytes=${layout.offset + visible.start}-${layout.offset + visible.end}` : range
    const response = await client.open(
      "stream",
      { id: track.remoteId, format: "raw" },
      { signal: request.signal, headers: upstreamRange ? { Range: upstreamRange } : undefined },
    )
    const headers = new Headers({ "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" })
    for (const key of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      if (response.headers.has(key)) {
        headers.set(key, response.headers.get(key))
      }
    }
    if (response.status === 416) {
      await response.body?.cancel()
      return new Response(null, { status: 416, headers })
    }
    if (
      ![200, 206].includes(response.status) ||
      !/^(?:audio\/|application\/(?:octet-stream|ogg))/iu.test(headers.get("content-type") || "")
    ) {
      await response.body?.cancel()
      throw new Error("曲库未提供可播放音频，请核对账号权限或重新同步歌曲")
    }
    let status = response.status
    if (layout.offset) {
      const expected = `bytes ${layout.offset + visible.start}-${layout.offset + visible.end}/${layout.size + layout.offset}`
      if (response.status !== 206 || response.headers.get("content-range") !== expected) {
        await response.body?.cancel()
        throw new Error("远程文件已变化或不支持定位，请重新同步曲库")
      }
      headers.set("Content-Length", String(visible.length))
      headers.set("Accept-Ranges", "bytes")
      headers.delete("Content-Range")
      if (visible.partial) {
        headers.set("Content-Range", `bytes ${visible.start}-${visible.end}/${layout.size}`)
      }
      status = visible.partial ? 206 : 200
    }
    if (layout.mime) {
      headers.set("Content-Type", layout.mime)
      if (track.extension !== ".m4a" && this.library.state.tracks.includes(track)) {
        track.extension = ".m4a"
        track.codec = "M4A"
        await this.library.save()
        this.library.emit("changed")
      }
    }
    if (request.method === "HEAD") {
      await response.body?.cancel()
      return new Response(null, { status, headers })
    }
    return new Response(response.body, { status, headers })
  }

  /**
   * 按专辑封面标识合并并发请求，验证图片后写入已有的内容寻址缓存。
   * 页面只收到图片字节；来源和认证参数不会出现在封面 URL 中，失败允许下次重试。
   */
  async cover(id) {
    const track = this.library.track(id)
    const { client } = this.connection(track.sourceId)
    if (!track.remoteCoverId) {
      throw new Error("这首歌没有服务器封面")
    }
    const key = `${track.sourceId}:${track.remoteCoverId}`
    if (!this.coverTasks.has(key)) {
      const task = (async () => {
        const cached = this.covers.get(key)
        if (cached) {
          try {
            const bytes = await fs.readFile(path.join(this.library.coverDir, cached))
            return { bytes, mime: imageMime(bytes) }
          } catch {
            this.covers.delete(key)
          }
        }
        const response = await client.open("getCoverArt", { id: track.remoteCoverId, size: 600 })
        if (!response.ok) {
          await response.body?.cancel()
          throw new Error("暂时无法读取曲库封面")
        }
        const bytes = await remoteBytes(response, 10 * 1024 * 1024)
        const mime = imageMime(bytes)
        if (!mime) {
          throw new Error("曲库封面格式不受支持")
        }
        const filename = await this.library.cacheImage(bytes)
        this.covers.set(key, filename)
        return { bytes, mime }
      })().finally(() => this.coverTasks.delete(key))
      this.coverTasks.set(key, task)
    }
    return this.coverTasks.get(key)
  }

  /**
   * 优先读取按歌曲标识关联的同步歌词，旧服务器降级为歌手和歌名查询。
   * 缺失歌词或不支持接口时返回空结果，不阻塞远程音频播放。
   */
  async lyrics(track) {
    const { client } = this.connection(track.sourceId)
    try {
      const data = await client.json("getLyricsBySongId", { id: track.remoteId })
      const entry = data.lyricsList?.structuredLyrics?.[0]
      if (entry?.line?.length) {
        return {
          text: entry.line.map(line => line.value).join("\n"),
          lines: entry.synced
            ? entry.line
                .map(line => ({ time: Math.max(0, Number(line.start) || 0) / 1000, text: String(line.value || "") }))
                .sort((a, b) => a.time - b.time)
                .slice(0, 2000)
            : [],
        }
      }
    } catch {}
    try {
      const data = await client.json("getLyrics", { artist: track.artist, title: track.title })
      return lyricsTimeline(data.lyrics?.value || "")
    } catch {
      return lyricsTimeline("")
    }
  }

  /**
   * 中断来源传输并释放封面引用，重新登录不会复用旧账号的客户端。
   * 已缓存图片按内容哈希保留，不影响其他仍在使用同一图片的歌曲。
   */
  disconnect(id) {
    this.layouts.clear(id)
    this.clients.get(id)?.close()
    this.clients.delete(id)
    for (const key of this.covers.keys()) {
      if (key.startsWith(`${id}:`)) {
        this.covers.delete(key)
      }
    }
  }

  /**
   * 退出应用时中断所有音乐服务器请求，清空客户端及封面任务索引。
   */
  close() {
    for (const id of this.clients.keys()) {
      this.disconnect(id)
    }
    this.coverTasks.clear()
  }
}
