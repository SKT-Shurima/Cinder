/**
 * 把聆听主题转换为官方平台歌单与搜索候选，资源核验和个人曲库写入由上层服务负责。
 */

/**
 * 隔离两家平台的检索协议，网易云优先从相关歌单汇集，QQ 使用平台歌曲搜索补充。
 * 只访问在线适配器允许的官方域名，缓存只保留公开元数据，不包含账号或音频地址。
 */
export class ThemePlaylistSources {
  /**
   * 复用已配置的请求器和歌曲映射，实例化时不发起网络请求。
   */
  constructor(online) {
    this.online = online
    this.playlists = new Map()
    this.details = new Map()
  }

  /**
   * 读取一个主题的一轮平台候选，同轮不同平台并行，单源失败不吞掉另一来源的资源。
   * 轮次扩展检索词和页码，最多返回一百八十条，调用者可逐批核验并提前停止。
   */
  async candidates(theme, providers, round, signal) {
    const keyword = theme.keywords[Math.floor(round / 4) % theme.keywords.length]
    const settled = await Promise.allSettled(
      providers.map(provider =>
        provider === "netease"
          ? this.fromPlaylist(keyword, round, signal)
          : this.searchSongs(provider, keyword, 1 + (round % 4) + Math.floor(round / 12) * 4, signal),
      ),
    )
    return {
      tracks: settled.flatMap(result => (result.status === "fulfilled" ? result.value : [])),
      errors: settled.flatMap((result, index) => (result.status === "rejected" ? [providers[index]] : [])),
    }
  }

  /**
   * 按主题检索真实歌曲，每次最多六十首，页码独立推进以扩展候选池。
   * 仅映射平台返回的记录，不把关键词伪造成歌曲，也不调用其他音乐代理。
   */
  async searchSongs(provider, keyword, page, signal) {
    let songs
    if (provider === "qq") {
      const data = await this.online.json(
        provider,
        `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?${new URLSearchParams({ w: keyword, format: "json", p: String(page), n: "60" })}`,
        { signal },
      )
      if (data.code !== 0 || !Array.isArray(data.data?.song?.list)) {
        throw new Error("QQ 音乐暂时无法搜索主题歌曲。")
      }
      songs = data.data.song.list
    } else {
      const data = await this.online.json(provider, "https://music.163.com/api/search/get/web", {
        signal,
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ s: keyword, type: "1", offset: String((page - 1) * 60), limit: "60" }),
      })
      if (data.code !== 200) {
        throw new Error("网易云音乐暂时无法搜索主题歌曲。")
      }
      return this.songDetails(
        (data.result?.songs || []).map(song => song.id),
        signal,
      )
    }
    return songs.map(song => this.online.normalize(provider, song)).filter(Boolean)
  }

  /**
   * 从相关网易云歌单获取真实歌曲标识，再读取完整元数据，避开游客详情只给十首的限制。
   * 每个检索词覆盖四个歌单，后续轮次读取各歌单的下一段，不反复检查相同的开头歌曲。
   * 只有平台明确返回的标识可进入详情请求，找不到歌单时退回同主题歌曲搜索。
   */
  async fromPlaylist(keyword, round, signal) {
    let playlists = this.playlists.get(keyword)
    if (!playlists || playlists.until < Date.now()) {
      const response = await this.online.json("netease", "https://music.163.com/api/search/get/web", {
        signal,
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ s: keyword, type: "1000", limit: "8", offset: "0" }),
      })
      if (response.code !== 200) {
        throw new Error("网易云音乐暂时无法读取主题歌单。")
      }
      playlists = {
        ids: (response.result?.playlists || [])
          .map(item => String(item.id))
          .filter(id => /^\d{1,20}$/u.test(id))
          .slice(0, 8),
        until: Date.now() + 3600000,
      }
      this.playlists.set(keyword, playlists)
      while (this.playlists.size > 160) {
        this.playlists.delete(this.playlists.keys().next().value)
      }
    }
    if (!playlists.ids.length) {
      return this.searchSongs("netease", keyword, 1 + (round % 4), signal)
    }
    const slot = (round % 4) + (Math.floor(round / 12) % 2) * 4
    const id = playlists.ids[slot % playlists.ids.length]
    let detail = this.details.get(id)
    if (!detail || detail.until < Date.now()) {
      const response = await this.online.json("netease", `https://music.163.com/api/v6/playlist/detail?id=${id}&n=1000&s=0`, {
        signal,
      })
      if (response.code !== 200 || !Array.isArray(response.playlist?.trackIds)) {
        throw new Error("主题来源歌单暂时无法读取。")
      }
      detail = {
        ids: response.playlist.trackIds
          .map(item => item.id)
          .filter(value => /^\d{1,20}$/u.test(String(value)))
          .slice(0, 1000),
        until: Date.now() + 3600000,
      }
      this.details.set(id, detail)
      while (this.details.size > 80) {
        this.details.delete(this.details.keys().next().value)
      }
    }
    const offset = Math.floor(round / 24) * 120
    const ids = detail.ids.slice(offset, offset + 120)
    return ids.length ? this.songDetails(ids, signal) : this.searchSongs("netease", keyword, 1 + Math.floor(round / 4), signal)
  }

  /**
   * 分段读取官方歌曲详情并沿用统一映射，补齐歌手、封面和时长等搜索缺失字段。
   * 每段六十首顺序读取，取消后不继续发请求；不会请求或保存音频文件。
   */
  async songDetails(ids, signal) {
    const tracks = []
    for (let start = 0; start < ids.length; start += 60) {
      signal?.throwIfAborted()
      const data = await this.online.json(
        "netease",
        "https://music.163.com/api/song/detail/?ids=" + encodeURIComponent(JSON.stringify(ids.slice(start, start + 60))),
        { signal },
      )
      if (data.code !== 200 || !Array.isArray(data.songs)) {
        throw new Error("网易云音乐暂时无法读取歌曲详情。")
      }
      tracks.push(...data.songs.map(song => this.online.normalize("netease", song)).filter(Boolean))
    }
    return tracks
  }
}
