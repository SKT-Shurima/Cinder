/**
 * 将公开封面目录适配为统一候选结构，平台协议与录音匹配规则分离。
 * 只提交歌曲标签，不上传音频，也不把账号会话发送给公共封面目录。
 */
import { RecordingMatch } from "../../domain/artwork/recordingMatch.js"

/**
 * 请求目录 JSON，统一处理超时、平台业务错误和冷却标记。
 * 请求器可注入；错误仅暴露状态码，不把第三方响应正文作为产品提示。
 */
export async function catalogJson(address, init = {}, request = fetch) {
  const response = await request(address, {
    ...init,
    signal: AbortSignal.timeout(8000),
    headers: { "User-Agent": "cinder/0.1 (personal music library)", ...init.headers },
  })
  if (!response.ok) {
    throw Object.assign(new Error(`音乐目录连接失败（${response.status}）`), {
      cooldown: [429, 503].includes(response.status) ? 300000 : 0,
    })
  }
  const payload = await response.json()
  const code = payload.subcode || (![0, 200, undefined].includes(payload.code) ? payload.code : 0)
  if (code) {
    throw Object.assign(new Error(`音乐目录查询暂不可用（${code}）`), {
      queryFailure: Boolean(payload.subcode),
      cooldown: [405, 429].includes(code) ? 300000 : 0,
    })
  }
  return payload
}

/**
 * 从标签组合查询词，未知歌手不作为关键词发送。
 */
function searchText(track) {
  return [track.title, track.artist === "未知歌手" ? "" : track.artist].filter(Boolean).join(" ")
}

/**
 * 将 QQ 公开曲库查询转换为标准封面候选，保留专辑与录音来源。
 * 没有专辑标识的记录不生成图片地址，评分与确认规则由领域匹配器执行。
 */
export class QqArtworkProvider {
  /**
   * 声明目录身份，健康状态按该身份隔离，不与账号登录状态混用。
   */
  constructor() {
    this.name = "QQ 音乐"
  }

  /**
   * 按 QQ 专辑标识构建公开图片候选，缺少专辑的记录不进入封面选择。
   */
  async search(track) {
    const query = new URLSearchParams({ format: "json", w: searchText(track), n: "20", p: "1" })
    const payload = await catalogJson(`https://c.y.qq.com/soso/fcgi-bin/client_search_cp?${query}`, {
      headers: { Referer: "https://y.qq.com/" },
    })
    return (payload.data?.song?.list ?? []).flatMap(song =>
      song.albummid
        ? [
            {
              id: "qq:" + song.songmid,
              title: song.songname,
              album: song.albumname,
              artist: song.singer.map(singer => singer.name).join(" / "),
              duration: song.interval,
              source: this.name,
              sourceUrl: "https://y.qq.com/n/ryqq/songDetail/" + song.songmid,
              imageUrl: "https://y.gtimg.cn/music/photo_new/T002R500x500M000" + song.albummid + ".jpg",
            },
          ]
        : [],
    )
  }
}

/**
 * 为网易云录音搜索结果补充真实专辑图片，返回统一候选结构。
 * 详情请求限定到得分最高的候选，不使用猜测的图片编号。
 */
export class NeteaseArtworkProvider {
  /**
   * 网易云目录只使用公开元数据，不申请付费音频或用户权限。
   */
  constructor() {
    this.name = "网易云音乐"
  }

  /**
   * 先搜索录音再读取真实专辑图片，避免依据不可靠图片编号拼接地址。
   * 详情请求仅包含得分最高的八个候选，减少不必要的联网与响应体积。
   */
  async search(track) {
    const search = await catalogJson("https://music.163.com/api/search/get/web", {
      method: "POST",
      headers: { Referer: "https://music.163.com", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ type: "1", s: searchText(track), offset: "0", limit: "30" }),
    })
    const match = new RecordingMatch()
    const ranked = (search.result?.songs ?? [])
      .map(song =>
        match.evaluate(track, {
          id: "netease:" + song.id,
          remoteId: song.id,
          title: song.name,
          artist: song.artists.map(singer => singer.name).join(" / "),
          album: song.album.name,
          duration: song.duration / 1000,
          source: this.name,
          sourceUrl: "https://music.163.com/song?id=" + song.id,
        }),
      )
      .sort((left, right) => right.score - left.score)
      .slice(0, 8)
    if (ranked.length === 0) {
      return []
    }
    const query = new URLSearchParams({ ids: JSON.stringify(ranked.map(song => song.remoteId)) })
    const details = await catalogJson("https://music.163.com/api/song/detail/?" + query)
    const albums = new Map((details.songs ?? []).map(song => [song.id, song.album?.picUrl]))
    return ranked.flatMap(song =>
      albums.get(song.remoteId) ? [{ ...song, imageUrl: albums.get(song.remoteId).replace(/^http:/u, "https:") }] : [],
    )
  }
}

/**
 * 为国内目录无法确认的录音提供发行封面回退来源。
 * 请求时隙由实例串行管理，故障后仍释放后续查询机会。
 */
export class MusicBrainzArtworkProvider {
  /**
   * 各次查询共用串行时隙，遵守公共目录每秒至多一次的访问约束。
   */
  constructor() {
    this.name = "MusicBrainz"
    this.slot = Promise.resolve()
  }

  /**
   * 为国内目录未能确认的录音查询发行封面，保留来源链接供人工核对。
   * 网络失败仍释放时隙，不会使整个回退链永久阻塞。
   */
  async search(track) {
    const previous = this.slot
    let release
    this.slot = new Promise(resolve => {
      release = resolve
    })
    await previous
    setTimeout(release, 1100)
    const title = track.title.replace(/["\\]/gu, " ")
    const singer = track.artist.replace(/["\\]/gu, " ")
    const query = new URLSearchParams({ query: `recording:"${title}" AND artist:"${singer}"`, fmt: "json", limit: "5" })
    const response = await catalogJson("https://musicbrainz.org/ws/2/recording/?" + query)
    return (response.recordings ?? []).flatMap(recording => {
      const release = recording.releases?.find(album => album.title === track.album) ?? recording.releases?.[0]
      return release
        ? [
            {
              id: "musicbrainz:" + release.id,
              title: recording.title,
              artist: recording["artist-credit"]?.map(credit => credit.name).join(" / ") ?? "",
              album: release.title,
              duration: recording.length / 1000,
              source: "MusicBrainz / Cover Art Archive",
              sourceUrl: "https://musicbrainz.org/release/" + release.id,
              imageUrl: "https://coverartarchive.org/release/" + release.id + "/front-500",
            },
          ]
        : []
    })
  }
}
