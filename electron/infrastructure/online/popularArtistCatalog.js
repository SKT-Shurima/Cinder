/**
 * 将平台热门歌手目录与本地曲库分离，提供固定数量的发现卡片及按需读取的热门作品。
 * 只接受平台返回的歌手标识，头像沿用受限图片协议，浏览结果不会自动加入个人曲库。
 */
import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { imageMime } from "../artwork/artworkStore.js"

/**
 * 管理热门目录、作品和头像的短期缓存，复用在线适配器的账号及来源权限。
 * 目录请求合并，作品仅在打开歌手时加载；缓存失效不会修改用户收藏或播放队列。
 */
export class PopularArtistCatalog {
  /**
   * 注入平台传输、地址白名单策略及曲库图片仓储，构造时不发起请求或读取本地歌曲。
   */
  constructor(online, validateAddress) {
    this.online = online
    this.validateAddress = validateAddress
    this.entries = new Map()
    this.details = new Map()
    this.pending = new Map()
    this.images = new Map()
    this.catalog = null
  }

  /**
   * 读取按平台热度排序的前二百位歌手，六小时内复用目录并合并并发请求。
   * 来源关闭时立即拒绝，即使已有缓存也不绕过开关；失败不替换仍可读取的旧目录。
   */
  async list() {
    this.online.provider("netease")
    if (this.catalog?.until > Date.now()) {
      return this.catalog.value
    }
    if (this.pending.has("list")) {
      return this.pending.get("list")
    }
    const task = this.loadList().finally(() => this.pending.delete("list"))
    this.pending.set("list", task)
    return task
  }

  /**
   * 使用支持分页的热门目录接口读取两页，去重后最多保留二百位。
   * 目录同时作为后续歌曲和头像请求的白名单，不允许界面拼接任意平台地址。
   */
  async loadList() {
    const pages = await Promise.all(
      [0, 100].map(offset =>
        this.online.json(
          "netease",
          `https://music.163.com/api/v1/artist/list?type=-1&area=-1&initial=-1&limit=100&offset=${offset}`,
        ),
      ),
    )
    const artists = new Map()
    for (const page of pages) {
      if (page.code !== 200 || !Array.isArray(page.artists)) {
        throw new Error("热门歌手暂时无法加载，请稍后重试。")
      }
      for (const item of page.artists) {
        if (!/^\d{1,20}$/.test(String(item.id)) || !item.name) {
          continue
        }
        const id = createHash("sha256").update(`artist:netease:${item.id}`).digest("hex").slice(0, 24)
        let artwork = ""
        try {
          artwork = this.validateAddress("netease", item.img1v1Url || item.picUrl)
        } catch {}
        artists.set(id, {
          id,
          remoteId: String(item.id),
          provider: "netease",
          name: String(item.name).slice(0, 120),
          aliases: (item.alias || []).filter(value => typeof value === "string").slice(0, 8),
          albumCount: Number(item.albumSize) || 0,
          songCount: Number(item.musicSize) || 0,
          covers: artwork ? [`artist:${id}`] : [],
          artwork,
        })
      }
    }
    if (!artists.size) {
      throw new Error("平台暂未返回热门歌手，请稍后重试。")
    }
    const entries = [...artists.values()].slice(0, 200)
    this.entries = new Map(entries.map(artist => [artist.id, artist]))
    const value = { artists: entries.map(({ artwork, ...artist }) => artist), source: "网易云音乐", updatedAt: Date.now() }
    this.catalog = { value, until: Date.now() + 6 * 60 * 60000 }
    return value
  }

  /**
   * 为已发现的歌手读取最多五十首平台热门作品，十分钟内复用并重新登记播放索引。
   * 快速切换歌手不会写入个人曲库；只有之后明确收藏、入队或播放才保存歌曲元数据。
   * 缓存中的作品同样重新核对当前账号的播放状态，不把旧账号的可播结果直接沿用到新账号。
   */
  async detail(id) {
    this.online.provider("netease")
    const artist = this.entries.get(id)
    if (!artist) {
      throw new Error("歌手目录已更新，请返回热门歌手重新选择。")
    }
    const cached = this.details.get(id)
    if (cached?.until > Date.now()) {
      const tracks = await this.online.playableTracks(cached.value.tracks)
      this.online.remember(tracks)
      return { ...cached.value, tracks }
    }
    if (this.pending.has(id)) {
      return this.pending.get(id)
    }
    const task = this.loadDetail(artist).finally(() => this.pending.delete(id))
    this.pending.set(id, task)
    return task
  }

  /**
   * 按平台歌手标识获取真实热门歌曲，交给统一歌曲映射和资源索引继续处理。
   * 目录只保留最近二十位的作品缓存，平台错误不伪造歌曲或替换为同名歌手。
   * 作品经过批量授权与音频头探测后才展示，未获当前会话授权的条目保留在平台侧。
   */
  async loadDetail(artist) {
    const data = await this.online.json("netease", `https://music.163.com/api/artist/${artist.remoteId}`)
    if (data.code !== 200 || !Array.isArray(data.hotSongs)) {
      throw new Error("这位歌手的热门歌曲暂时无法加载，请重试。")
    }
    const tracks = await this.online.playableTracks(
      data.hotSongs
        .slice(0, 50)
        .map(song => this.online.normalize("netease", song))
        .filter(Boolean),
    )
    this.online.remember(tracks)
    const value = { artist: this.catalog.value.artists.find(item => item.id === artist.id), tracks }
    this.details.delete(artist.id)
    this.details.set(artist.id, { value, until: Date.now() + 10 * 60000 })
    while (this.details.size > 20) {
      this.details.delete(this.details.keys().next().value)
    }
    return value
  }

  /**
   * 只读取目录登记的官方头像，合并同一头像请求并按内容哈希复用磁盘图片。
   * 不携带账号 Cookie，限制图片体积和格式；目录之外的标识不能请求网络资源。
   */
  async cover(id) {
    this.online.provider("netease")
    if (this.pending.has(`cover:${id}`)) {
      return this.pending.get(`cover:${id}`)
    }
    const task = this.loadCover(id).finally(() => this.pending.delete(`cover:${id}`))
    this.pending.set(`cover:${id}`, task)
    return task
  }

  /**
   * 优先读取已缓存头像，缺失时通过官方图片域名下载并验证图片字节。
   * 网络失败不缓存空图片，后续重新进入页面仍可重试；超限时取消响应流。
   */
  async loadCover(id) {
    const artist = this.entries.get(id)
    if (!artist?.artwork) {
      throw new Error("暂无歌手头像")
    }
    const filename = this.images.get(id)
    if (filename) {
      try {
        const bytes = await fs.readFile(path.join(this.online.library.coverDir, filename))
        return { bytes, mime: imageMime(bytes) }
      } catch {}
    }
    const response = await this.online.fetcher(`${artist.artwork}${artist.artwork.includes("?") ? "&" : "?"}param=320y320`, {
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    })
    if (!response.ok) {
      throw new Error("歌手头像暂不可用")
    }
    const chunks = []
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.byteLength
      if (size > 5 * 1024 * 1024) {
        await response.body.cancel().catch(() => {})
        throw new Error("歌手头像过大")
      }
      chunks.push(Buffer.from(chunk))
    }
    const bytes = Buffer.concat(chunks)
    const mime = imageMime(bytes)
    if (!mime) {
      throw new Error("歌手头像格式不受支持")
    }
    this.images.set(id, await this.online.library.cacheImage(bytes))
    return { bytes, mime }
  }
}
