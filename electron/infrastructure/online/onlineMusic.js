/**
 * 将支持平台的歌曲元数据与短期音频地址接入统一播放器，不创建远程网页视图。
 * 搜索结果只在内存中短期保留，用户播放或加入队列后才保存歌曲标识；不缓存整首音乐。
 */
import { createHash, randomInt } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { musicProviders, normalizeMusicProviders, normalizeMusicSources } from "#shared/musicSources"
import { imageMime } from "../artwork/artworkStore.js"
import { PopularArtistCatalog } from "./popularArtistCatalog.js"
import { PlaybackAvailability } from "./playbackAvailability.js"
import { qqPlaybackBatch, neteasePlaybackBatch } from "./platformPlaybackAccess.js"
import { PlaybackUnavailable } from "./playbackUnavailable.js"
import { ThemeMusicCatalog } from "./themeMusicCatalog.js"
import { homeRecommendationQuery } from "#shared/musicThemes"
import { recommendationKey, recommendationWindow, selectRecommendations } from "#shared/recommendationRules"
import { PlatformRequestGate } from "./platformRequestGate.js"
import { OnlineRequestError } from "./onlineRequestError.js"

/**
 * 将平台返回的展示文字去除搜索高亮标记，避免将 HTML 带入歌名、歌手与收藏元数据。
 */
function label(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .trim()
    .slice(0, 500)
}

/**
 * 为平台歌曲生成稳定的本地索引标识，账号、临时签名和播放地址不参与标识或保存。
 */
export function onlineTrackId(provider, remoteId) {
  return createHash("sha256").update(`online:${provider}:${remoteId}`).digest("hex").slice(0, 24)
}

/**
 * 仅允许官方接口及对应音频和图片域名，拒绝本机、带凭据地址和任意第三方代理。
 * 平台历史 HTTP 图片或 CDN 地址会先升级为 HTTPS，不降低证书校验要求。
 */
export function onlineAddress(provider, address) {
  const domains = { netease: ["music.163.com", "music.126.net"], qq: ["qq.com", "gtimg.cn"] }
  const url = new URL(String(address).replace(/^http:/, "https:"))
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !(domains[provider] || []).some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))
  ) {
    throw new Error("平台返回了不支持的资源地址")
  }
  return url.href
}

/**
 * 维护平台搜索、地址解析、受限流式播放和封面缓存，复用已有曲库与音频协议。
 * 游客只能获得平台允许的资源；会员、登录、地区或验证限制明确返回，不使用解锁服务。
 */
export class OnlineMusic {
  /**
   * 接收统一音乐库及账号读取器，测试可以注入请求器而不触碰真实账号与网络。
   * 账号信息仅在请求相同平台接口时使用，不进入快照、歌曲记录或音频 CDN 请求。
   * 各平台搜索和曲库展示共用播放可用性检查，每分钟复核已保存在线记录，不改写原索引。
   */
  constructor(library, { fetcher = fetch, authFor = async () => ({}) } = {}) {
    this.guid = String(randomInt(1000000000, 9999999999))
    this.library = library
    this.fetcher = fetcher
    this.authFor = authFor
    this.results = new Map()
    this.coverPending = new Map()
    this.searchCache = new Map()
    this.searchPending = new Map()
    this.artists = new PopularArtistCatalog(this, onlineAddress)
    this.themes = new ThemeMusicCatalog(this)
    this.requestGate = new PlatformRequestGate()
    const resolvers = { qq: qqPlaybackBatch, netease: neteasePlaybackBatch }
    this.availability = new Map(
      musicProviders.map(platform => [
        platform.id,
        new PlaybackAvailability({
          platform,
          authFor: () => this.authFor(platform.id),
          resolveBatch: (tracks, auth, signal) =>
            resolvers[platform.id](tracks, auth, {
              json: (provider, address, options) => this.json(provider, address, options),
              guid: this.guid,
              signal,
            }),
          probe: async (track, url, signal) => {
            const response = await this.mediaAt(
              track,
              onlineAddress(platform.id, url),
              new Request(`cinder://audio/${track.id}`, { signal, headers: { Range: "bytes=0-1023" } }),
            )
            await response.body?.cancel()
          },
          changed: () => this.library.emit?.("changed"),
        }),
      ]),
    )
    this.library.onlineVisibility = track => this.availability.get(track.provider)?.visible(track.id) === true
    this.library.onlineAvailability = () => Object.assign({}, ...[...this.availability.values()].map(service => service.hidden()))
    this.availabilityTimer = setInterval(() => this.refreshAvailability().catch(() => {}), 60000)
    this.availabilityTimer.unref?.()
  }

  /**
   * 校验来源和平台是否启用，所有搜索、入队和资源解析共享同一权限边界。
   */
  provider(id) {
    const provider = musicProviders.find(item => item.id === id)
    if (
      !provider ||
      !normalizeMusicSources(this.library.state.settings.musicSources).online ||
      !normalizeMusicProviders(this.library.state.settings.musicProviders)[id]
    ) {
      throw new Error("请先在音乐来源中启用这个平台。")
    }
    return provider
  }

  /**
   * 请求固定平台 JSON，限制等待时间与响应体积，不将平台内部错误正文或账号值显示到界面。
   * 跳转必须仍在同一平台官方域名内；请求头只携带该平台的登录会话。
   * 已移除或关闭的平台在读取账号和发起请求前拒绝，不能借旧索引继续联网。
   * 统一限制同平台请求密度；临时拒绝触发一分钟退避，不继续用后续候选冲击接口。
   * 超时、网络和响应异常分别转换为安全错误，原始正文及请求地址不会进入播放检查提示。
   */
  async json(provider, address, options = {}) {
    const platform = this.provider(provider)
    const target = new URL(onlineAddress(provider, address))
    await this.requestGate.enter(
      provider,
      options.signal,
      target.pathname.includes("/song/enhance/player/url") ||
        Boolean(target.searchParams.get("data")?.includes("vkey.GetVkeyServer")),
    )
    this.provider(provider)
    const auth = await this.authFor(provider)
    const headers = {
      "User-Agent": "Mozilla/5.0",
      Referer: platform.url,
      ...(auth.cookie ? { Cookie: auth.cookie } : {}),
      ...options.headers,
    }
    let url = onlineAddress(provider, address)
    const timeout = AbortSignal.timeout(9000)
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout
    try {
      for (let hop = 0; hop < 5; hop++) {
        const response = await this.fetcher(url, { ...options, headers, redirect: "manual", signal })
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel()
          url = onlineAddress(provider, new URL(response.headers.get("location"), url))
          continue
        }
        if (!response.ok) {
          await response.body?.cancel()
          this.requestGate.inspect(provider, null, response.status)
          throw new OnlineRequestError("response", { status: response.status })
        }
        const chunks = []
        let size = 0
        for await (const chunk of response.body) {
          size += chunk.byteLength
          if (size > 3 * 1024 * 1024) {
            await response.body.cancel().catch(() => {})
            throw new OnlineRequestError("response")
          }
          chunks.push(Buffer.from(chunk))
        }
        const data = JSON.parse(
          Buffer.concat(chunks)
            .toString("utf8")
            .replace(/^\w+\(/, "")
            .replace(/\);?\s*$/, ""),
        )
        this.requestGate.inspect(provider, data)
        return data
      }
      throw new OnlineRequestError("response")
    } catch (failure) {
      if (options.signal?.aborted) {
        throw failure
      }
      if (timeout.aborted) {
        throw new OnlineRequestError("timeout")
      }
      throw OnlineRequestError.from(failure)
    }
  }

  /**
   * 将平台各自的字段映射到播放器歌曲结构，元数据保留来源并与文件索引分开保存。
   * 临时播放链接从不写入歌曲，封面通过受限协议读取，不放开渲染进程的网络权限。
   * 未知平台不生成歌曲记录，旧数据不能借用其他平台的字段映射进入索引。
   */
  normalize(provider, song) {
    const platform = musicProviders.find(item => item.id === provider)
    if (!platform) {
      return null
    }
    const remoteId = String(provider === "netease" ? song.id : song.songmid)
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(remoteId)) {
      return null
    }
    const id = onlineTrackId(provider, remoteId)
    const title = label(provider === "netease" ? song.name : song.songname)
    const artist = label(
      provider === "netease" ? song.artists?.map(item => item.name).join(" / ") : song.singer?.map(item => item.name).join(" / "),
    )
    let artwork =
      provider === "netease"
        ? song.album?.picUrl
        : song.albummid
          ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${song.albummid}.jpg`
          : ""
    try {
      artwork = artwork ? onlineAddress(provider, artwork.replace("{size}", "300")) : ""
    } catch {
      artwork = ""
    }
    return {
      id,
      kind: "online",
      provider,
      remoteId,
      title,
      artist: artist || "未知歌手",
      album: label(provider === "netease" ? song.album?.name : song.albumname),
      duration: Number(provider === "netease" ? song.duration / 1000 : song.interval) || 0,
      filename: `${title}.online`,
      path: `online://${provider}/${remoteId}`,
      extension: provider === "qq" ? ".m4a" : ".mp3",
      codec: "在线音频",
      sampleRate: 0,
      bitsPerSample: 0,
      cover: artwork ? `online:${id}` : null,
      artwork,
      mediaId: String(song.media_mid || song.strMediaMid || remoteId),
      restricted: provider === "netease" ? song.fee === 1 || song.fee === 4 : Boolean(song.pay?.payplay),
      coverSource: {
        source: platform.name,
        sourceUrl:
          provider === "netease" ? `https://music.163.com/song?id=${remoteId}` : `https://y.qq.com/n/ryqq/songDetail/${remoteId}`,
      },
    }
  }

  /**
   * 搜索单一平台或并行搜索已启用的平台，同词同页请求合并并短期复用。
   * 每家最多二十条；缓存隔离平台开关，账号会话变化时由主进程主动清除。
   */
  async search(input) {
    if (!normalizeMusicSources(this.library.state.settings.musicSources).online) {
      throw new Error("请先启用在线音乐。")
    }
    const keyword = label(input?.keyword).slice(0, 120)
    if (!keyword) {
      return { tracks: [], errors: [], page: 1 }
    }
    const page = Math.max(1, Math.min(50, Number(input?.page) || 1))
    const providers =
      input?.provider === "all"
        ? musicProviders.filter(item => normalizeMusicProviders(this.library.state.settings.musicProviders)[item.id])
        : [this.provider(input?.provider)]
    const accountKey = await Promise.all(
      providers.map(async provider => [provider.id, (await this.availability.get(provider.id).context()).key]),
    )
    const key = JSON.stringify([keyword.toLocaleLowerCase(), page, providers.map(item => item.id), accountKey])
    const cached = this.searchCache.get(key)
    if (cached?.until > Date.now()) {
      const tracks = await this.playableTracks(cached.value.tracks)
      this.remember(tracks)
      return { ...cached.value, tracks }
    }
    if (this.searchPending.has(key)) {
      return this.searchPending.get(key)
    }
    const task = this.searchFresh(keyword, page, providers)
      .then(value => {
        this.searchCache.set(key, { value, until: Date.now() + 60000 })
        while (this.searchCache.size > 30) {
          this.searchCache.delete(this.searchCache.keys().next().value)
        }
        return value
      })
      .finally(() => this.searchPending.delete(key))
    this.searchPending.set(key, task)
    return task
  }

  /**
   * 从已启用的平台并行读取真实搜索资源，单个平台失败只生成该来源的提示。
   * 缓存和请求合并由外层负责，结果写入受限索引后才能被封面和音频协议使用。
   * 结果经过当前账号授权和音频头检查，只返回本次已经验证可播放的歌曲。
   */
  async searchFresh(keyword, page, providers) {
    const settled = await Promise.allSettled(
      providers.map(async ({ id }) => {
        let songs
        if (id === "netease") {
          const data = await this.json(id, "https://music.163.com/api/search/get/web", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ s: keyword, type: "1", offset: String((page - 1) * 20), limit: "20" }),
          })
          if (data.code !== 200) {
            throw new Error("网易云暂未接受搜索")
          }
          songs = data.result?.songs || []
          if (songs.length) {
            try {
              const detail = await this.json(
                id,
                `https://music.163.com/api/song/detail/?ids=${encodeURIComponent(JSON.stringify(songs.map(song => song.id)))}`,
              )
              const pictures = new Map((detail.songs || []).map(song => [song.id, song.album?.picUrl]))
              songs = songs.map(song => ({ ...song, album: { ...song.album, picUrl: pictures.get(song.id) } }))
            } catch {}
          }
        } else if (id === "qq") {
          const data = await this.json(
            id,
            `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?${new URLSearchParams({ w: keyword, format: "json", p: String(page), n: "20" })}`,
          )
          if (data.code) {
            throw new Error("QQ 音乐暂未接受搜索")
          }
          songs = data.data?.song?.list || []
        } else {
          throw new Error("不支持的音乐平台")
        }
        return this.playableTracks(
          songs
            .slice(0, 20)
            .map(song => this.normalize(id, song))
            .filter(Boolean),
        )
      }),
    )
    const tracks = []
    const errors = []
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") {
        tracks.push(...result.value)
      } else {
        errors.push({ provider: providers[index].id, message: `${providers[index].name}暂时无法搜索，请稍后重试。` })
      }
    })
    if (!tracks.length && errors.length === providers.length && providers.length) {
      throw new Error(errors.map(item => item.message).join(" "))
    }
    this.remember(tracks)
    return { tracks, errors, page }
  }

  /**
   * 为新鲜结果和缓存命中重新登记受限资源索引，使返回的歌曲可继续读取封面与入队。
   * 按访问顺序保留最多一千五百首，短期重复搜索不会引用已淘汰的元数据。
   */
  remember(tracks) {
    const now = Date.now()
    for (const track of tracks) {
      this.results.delete(track.id)
      this.results.set(track.id, { track, at: now })
    }
    for (const [id, item] of this.results) {
      if (now - item.at > 30 * 60000 || this.results.size > 1500) {
        this.results.delete(id)
      }
    }
  }

  /**
   * 从华语方向的主题实时搜索首页候选，轮换关键词与页码，并扩展候选直至达到三十首。
   * 最近五批在探测前排除，最近十批的复用仍受两成上限约束；不足时返回实际数量。
   * 这是 Cinder 的主题精选，账号变更或平台关闭后不能把旧授权结果提交给界面。
   */
  async recommendations(input) {
    const batch = Math.max(0, Math.min(100000, Math.floor(Number(input?.batch) || 0)))
    const context = await this.themes.context()
    const { blocked } = recommendationWindow(input?.history)
    const candidates = new Map()
    const errors = new Set()
    for (let round = 0; round < 6; round++) {
      const { keyword, playlistPage, songPage } = homeRecommendationQuery(batch, round)
      const settled = await Promise.allSettled(
        context.providers.map(async provider => {
          const found =
            provider === "netease"
              ? await this.themes.sources.fromPlaylist(keyword, playlistPage)
              : await this.themes.sources.searchSongs(provider, keyword, songPage)
          const fresh = found.filter(track => !blocked.has(recommendationKey(track)) && !candidates.has(track.id))
          const tracks = []
          for (let start = 0; start < fresh.length; start += 20) {
            tracks.push(...(await this.playableTracks(fresh.slice(start, start + 20))))
            if (tracks.length >= 30) {
              break
            }
          }
          return tracks
        }),
      )
      settled.forEach((result, index) => {
        if (result.status === "fulfilled") {
          for (const track of result.value) {
            candidates.set(track.id, track)
          }
        } else {
          errors.add(context.providers[index])
        }
      })
      if (selectRecommendations([...candidates.values()], { history: input?.history }).length >= 30) {
        break
      }
      if (errors.size === context.providers.length && !candidates.size) {
        break
      }
    }
    if (context.key !== (await this.themes.context()).key) {
      throw new Error("音乐来源或账号状态已变化，请重新换一批。")
    }
    const tracks = selectRecommendations([...candidates.values()], { history: input?.history })
    this.remember(tracks)
    return {
      tracks,
      errors: [...errors].map(provider => ({ provider, message: "部分在线来源暂时无法补充歌曲。" })),
      page: batch + 1,
    }
  }

  /**
   * 启动、账号变化和定时触发时重新核验已保存的在线歌曲，仅更新临时展示结果。
   * 来源关闭时停止探测；收藏、历史记录和原始在线索引继续保留，授权恢复后可以重新显示。
   */
  async refreshAvailability() {
    if (!normalizeMusicSources(this.library.state.settings.musicSources).online) {
      return
    }
    const enabled = normalizeMusicProviders(this.library.state.settings.musicProviders)
    await Promise.all(
      [...this.availability]
        .filter(([id]) => enabled[id])
        .map(async ([id, service]) => {
          await service.context()
          const tracks = (this.library.state.onlineTracks || []).filter(track => track.provider === id)
          for (let start = 0; start < tracks.length; start += 20) {
            await service.filter(tracks.slice(start, start + 20))
          }
        }),
    )
  }

  /**
   * 组合各平台已经核验可播放的结果，保持输入顺序，并供搜索、推荐和歌手作品列表共用。
   * 未知来源不会混入结果；平台网络失败仍由调用层显示可重试反馈。
   */
  async playableTracks(tracks) {
    const groups = await Promise.all(
      [...this.availability.values()].map(service =>
        service.filter(tracks.filter(track => track.provider === service.platform.id)),
      ),
    )
    const ids = new Set(groups.flat().map(track => track.id))
    return tracks.filter(track => ids.has(track.id))
  }

  /**
   * 根据已搜索或已入库的稳定标识查找歌曲，界面不能提交任意地址伪造在线资源。
   */
  track(id) {
    const track = this.results.get(id)?.track || this.library.state.onlineTracks?.find(item => item.id === id)
    if (!track) {
      throw new Error("搜索结果已过期，请重新搜索。")
    }
    this.provider(track.provider)
    return track
  }

  /**
   * 验证最多一百首混合队列，只把其中的在线歌曲加入持久索引。
   * 本地与远程标识必须已入库且启用，在线标识必须已搜索；全量验证通过后再保存。
   */
  async add(ids) {
    if (!Array.isArray(ids) || ids.length > 100) {
      throw new Error("请选择不超过一百首歌曲。")
    }
    const modes = normalizeMusicSources(this.library.state.settings.musicSources)
    const tracks = [...new Set(ids)].map(id => {
      const stored = this.library.state.tracks.find(track => track.id === id)
      if (!stored || stored.kind === "online") {
        return this.track(id)
      }
      if (!(stored.sourceId ? modes.remote : modes.local)) {
        throw new Error("队列中的音乐来源已关闭，请重新选择。")
      }
      return stored
    })
    const saved = new Map((this.library.state.onlineTracks || []).map(track => [track.id, track]))
    for (const track of tracks) {
      if (track.kind === "online") {
        saved.set(track.id, { ...track, addedAt: Date.now() })
      }
    }
    this.library.state.onlineTracks = [...saved.values()]
    await this.library.save()
    return { library: this.library.snapshot(), ids: tracks.map(track => track.id) }
  }

  /**
   * 解析短期播放地址并合并同一首歌曲的并发准备，超时与权限错误保留为明确业务反馈。
   * 播放链接只在内存保留两分钟；请求失败不缓存，不替换为其他平台的不同录音。
   */
  async resolve(track) {
    this.provider(track.provider)
    return this.availability.get(track.provider).resolve(track)
  }

  /**
   * 代理音频响应头和流，保留 Range、取消及 CORS，使在线歌曲复用现有音效与频谱。
   * 只对等待响应头设置超时，音频流不会在十秒后被截断；最多跟随五次官方 CDN 跳转。
   */
  async media(track, request) {
    const service = this.availability.get(track.provider)
    const context = service ? await service.context() : null
    try {
      return await this.mediaAt(track, await this.resolve(track), request)
    } catch (failure) {
      if (context && !request.signal.aborted) {
        service.reject(track.id, failure, context.key)
      }
      throw failure
    }
  }

  /**
   * 从已经验证过归属的音频地址读取流，供实际播放和筛选阶段的少量字节探测复用。
   * CDN 不接收账号 Cookie；明确拒绝与暂时服务失败分别处理，便于短期隐藏后重新核验。
   */
  async mediaAt(track, address, request) {
    let url = address
    const range = request.headers.get("range")
    if (range && !/^bytes=\d*-\d*$/.test(range)) {
      return new Response(null, { status: 416 })
    }
    for (let hop = 0; hop < 5; hop++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10000)
      let response
      try {
        response = await this.fetcher(url, {
          method: request.method,
          redirect: "manual",
          signal: AbortSignal.any([request.signal, controller.signal]),
          headers: {
            "User-Agent": "Mozilla/5.0",
            Referer: musicProviders.find(item => item.id === track.provider).url,
            ...(range ? { Range: range } : {}),
          },
        })
      } finally {
        clearTimeout(timer)
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel()
        url = onlineAddress(track.provider, new URL(response.headers.get("location"), url))
        continue
      }
      if (!response.ok || !/^(audio\/|application\/(octet-stream|ogg))/.test(response.headers.get("content-type") || "")) {
        await response.body?.cancel()
        if ([401, 403, 404, 410].includes(response.status) || response.ok) {
          throw new PlaybackUnavailable("平台未提供这首歌的可播放音频。")
        }
        throw new Error("音频服务暂时无法连接，请稍后重试。")
      }
      const headers = new Headers({ "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" })
      for (const key of ["content-type", "content-length", "content-range", "accept-ranges"]) {
        if (response.headers.has(key)) {
          headers.set(key, response.headers.get(key))
        }
      }
      return new Response(request.method === "HEAD" ? null : response.body, { status: response.status, headers })
    }
    throw new Error("音频资源跳转次数过多，请重新搜索后重试。")
  }

  /**
   * 用户点击播放前验证可读音频头，权限失败时继续保留原来的歌曲，不先清空播放器。
   * 只读取头部片段，不下载整首歌曲，成功后立即取消探测流。
   */
  async prepare(id) {
    const track = this.track(id)
    const response = await this.media(track, new Request(`cinder://audio/${id}`, { headers: { Range: "bytes=0-1023" } }))
    await response.body?.cancel()
    return true
  }

  /**
   * 从受限平台地址下载封面并按内容哈希缓存，缓存存在时离线读取。
   * 校验图片格式和十兆字节上限，第三方网页或 SVG 不进入图片协议。
   */
  async cover(id) {
    if (this.coverPending.has(id)) {
      return this.coverPending.get(id)
    }
    const task = this.loadCover(id).finally(() => this.coverPending.delete(id))
    this.coverPending.set(id, task)
    return task
  }

  /**
   * 根据已知歌曲定位缓存图片，缺失时下载合法的音乐封面，失败返回协议错误而不上传音频。
   */
  async loadCover(id) {
    const track = this.track(id)
    if (!track.artwork) {
      throw new Error("没有可用封面")
    }
    if (track.cachedCover && /^[a-f0-9]{64}\.(jpg|png|webp)$/.test(track.cachedCover)) {
      try {
        const bytes = await fs.readFile(path.join(this.library.coverDir, track.cachedCover))
        return { bytes, mime: imageMime(bytes) }
      } catch {}
    }
    const url = onlineAddress(track.provider, track.artwork)
    const response = await this.fetcher(url, { signal: AbortSignal.timeout(10000), redirect: "error" })
    if (!response.ok) {
      throw new Error("封面暂不可用")
    }
    const chunks = []
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.byteLength
      if (size > 10 * 1024 * 1024) {
        throw new Error("封面图片过大")
      }
      chunks.push(Buffer.from(chunk))
    }
    const bytes = Buffer.concat(chunks)
    const mime = imageMime(bytes)
    if (!mime) {
      throw new Error("不是有效的音乐封面")
    }
    const filename = await this.library.cacheImage(bytes)
    track.cachedCover = filename
    const stored = this.library.state.onlineTracks?.find(item => item.id === id)
    if (stored) {
      stored.cachedCover = filename
      await this.library.save()
    }
    return { bytes, mime }
  }

  /**
   * 退出应用时丢弃短期搜索和播放地址，已选择的歌曲与平台会话由各自存储负责恢复。
   */
  close() {
    clearInterval(this.availabilityTimer)
    this.themes.close()
    this.requestGate.close()
    for (const service of this.availability.values()) {
      service.close()
    }
    this.results.clear()
    this.searchCache.clear()
  }
}
