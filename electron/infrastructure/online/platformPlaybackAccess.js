/**
 * 将 QQ 与网易云的官方批量授权响应转换为统一结果，具体可用性缓存和音频探测交给公共服务。
 */
import { qqPlaybackAddress } from "./qqPlaybackResult.js"
import { PlaybackUnavailable } from "./playbackUnavailable.js"

/**
 * 让 QQ 在同一请求内为所有候选歌曲返回授权路径，每首结果继续核对歌曲标识。
 * 授权拒绝保留为单曲结果，不使同批已授权的会员歌曲一起消失，也不把其他歌曲的路径错配过来。
 */
export async function qqPlaybackBatch(tracks, auth, { json, guid, signal }) {
  const uin = auth.uin || "0"
  const payload = {
    comm: { uin: Number(uin) || 0, format: "json", ct: 24, cv: 0 },
    req_0: {
      module: "vkey.GetVkeyServer",
      method: "CgiGetVkey",
      param: {
        guid,
        songmid: tracks.map(track => track.remoteId),
        songtype: tracks.map(() => 0),
        uin,
        loginflag: auth.uin ? 1 : 0,
        platform: "20",
        filename: tracks.map(track => `C400${track.mediaId || track.remoteId}.m4a`),
      },
    },
  }
  const response = await json(
    "qq",
    `https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=${encodeURIComponent(JSON.stringify(payload))}`,
    { signal },
  )
  const items = response?.req_0?.data?.midurlinfo
  return new Map(
    tracks.map((track, index) => {
      const matched =
        Array.isArray(items) &&
        (items.find(item => item.songmid === track.remoteId) ||
          (items.length === tracks.length && !items[index]?.songmid ? items[index] : undefined))
      const single = {
        ...response,
        req_0: { ...response?.req_0, data: { ...response?.req_0?.data, midurlinfo: matched ? [matched] : [] } },
      }
      try {
        return [track.id, { url: qqPlaybackAddress(single, auth.signedIn) }]
      } catch (error) {
        return [track.id, { error }]
      }
    }),
  )
}

/**
 * 从网易云当前会话获取逐首播放地址，明确无地址的结果直接标记为不可播。
 * 不再为授权拒绝拼接通用外链；协议或网络异常继续作为可重试错误，不删除保存的歌曲。
 */
export async function neteasePlaybackBatch(tracks, _auth, { json, signal }) {
  const query = new URLSearchParams({ ids: JSON.stringify(tracks.map(track => Number(track.remoteId))), br: "128000" })
  const response = await json("netease", "https://music.163.com/api/song/enhance/player/url?" + query, { signal })
  if (response?.code !== 200 || !Array.isArray(response.data)) {
    throw new Error("网易云音乐暂时无法核对播放授权。")
  }
  const items = new Map(response.data.map(item => [String(item.id), item]))
  return new Map(
    tracks.map(track => {
      const item = items.get(track.remoteId)
      if (!item) {
        return [track.id, { error: new Error("网易云音乐未返回对应歌曲的播放结果。") }]
      }
      if (typeof item.url === "string" && item.url) {
        return [track.id, { url: item.url }]
      }
      return [track.id, { error: new PlaybackUnavailable("网易云音乐当前未提供这首歌的播放地址，已从可播放列表中隐藏。") }]
    }),
  )
}
