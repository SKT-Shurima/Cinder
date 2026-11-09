/**
 * 为首页从真实曲库与平台候选中组建三十首精选，来源之间轮流取歌。
 * 不伪造曲目、不重复歌曲标识，某类资源不足时由其余来源补足。
 */

import { selectRecommendations } from "#shared/recommendationRules"

/**
 * 将真实曲库与新搜索候选交给统一去重策略，保持首页与主进程相同的批次约束。
 * 最近五批禁止重现，最近十批的旧歌最多占两成；不足三十首时不降低重复限制。
 */
export function buildRecommendations(libraryTracks, onlineTracks, options = {}) {
  return selectRecommendations([...libraryTracks, ...onlineTracks], options)
}

/**
 * 按来源交替排列即时建议，避免大批本地匹配把远程和在线结果挤出下拉框。
 * 完整结果页仍保留所有歌曲，同名的不同来源以独立记录展示。
 */
export function searchSuggestions(tracks, limit = 9) {
  const online = tracks.filter(track => track.kind === "online")
  const platforms = [...new Set(online.map(track => track.provider))].map(provider =>
    online.filter(track => track.provider === provider),
  )
  const orderedOnline = []
  while (platforms.some(pool => pool.length)) {
    for (const pool of platforms) {
      if (pool.length) {
        orderedOnline.push(pool.shift())
      }
    }
  }
  const pools = [
    tracks.filter(track => track.kind !== "online" && !track.sourceId),
    tracks.filter(track => track.kind !== "online" && track.sourceId),
    orderedOnline,
  ]
  const result = []
  while (result.length < limit && pools.some(pool => pool.length)) {
    for (const pool of pools) {
      if (pool.length && result.length < limit) {
        result.push(pool.shift())
      }
    }
  }
  return result
}
