/**
 * 为主题歌单与首页换批提供统一的歌曲身份和重复约束，不依赖平台临时播放地址。
 */

/**
 * 将歌名和演唱者组合为跨平台比较键，同一作品在不同来源中只占一个推荐位置。
 * 保留现场、翻唱等版本文字；缺少有效歌手时退回稳定标识，避免把不同作品误并。
 */
export function recommendationKey(track) {
  const title = String(track.title || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{Z}\s]/gu, "")
  const artists = String(track.artist || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .split(/\s*(?:\/|、|&|，|,)\s*/u)
    .map(value => value.replace(/[\p{P}\p{Z}\s]/gu, ""))
    .sort()
    .join("/")
  return title && artists && artists !== "未知歌手" ? `song:${title.slice(0, 250)}|${artists.slice(0, 250)}` : `id:${track.id}`
}

/**
 * 收敛来自界面存储或 IPC 的最近十批身份记录，最新批次排在前面。
 * 仅接受有限长度的字符串，每批最多三十首，不允许请求参数放大内存使用。
 */
export function recommendationHistory(value) {
  return Array.isArray(value)
    ? value
        .slice(0, 10)
        .filter(Array.isArray)
        .map(batch => [...new Set(batch.filter(key => typeof key === "string" && key.length <= 520))].slice(0, 30))
        .filter(batch => batch.length)
    : []
}

/**
 * 按最近五批禁用、最近十批限制复用的规则构建候选分类。
 * 旧五批最多占最终数量的两成；资源不足时缩短批次，不能通过缩小分母突破上限。
 */
export function recommendationWindow(history) {
  const batches = recommendationHistory(history)
  return { blocked: new Set(batches.slice(0, 5).flat()), recent: new Set(batches.flat()) }
}

/**
 * 判断曲目所属连接是否允许参与自动推荐，未设置的旧连接继续视为开启。
 * 关闭只影响推荐资格，不限制手动播放、搜索、历史记录或已建立的播放队列。
 */
export function isRecommendationAllowed(track, remoteSources = []) {
  return (
    Boolean(track) &&
    (!track.sourceId || !remoteSources.some(source => source.id === track.sourceId && source.recommendationsEnabled === false))
  )
}

/**
 * 在本地、服务器和不同在线平台之间交替取歌，先使用最近十批从未出现的新内容。
 * 最近五批完全排除；更早五批只在缺少新歌时补位，实际返回批次的重复比例仍不超过两成。
 * 同一录音跨来源只保留一条，洗牌操作不会修改输入数组和当前播放队列。
 * 关闭推荐的连接在跨来源去重之前排除，不能覆盖仍开启来源中的同一首歌。
 */
export function selectRecommendations(
  tracks,
  { history = [], excludeIds = [], limit = 30, random = Math.random, remoteSources = [] } = {},
) {
  const { blocked, recent } = recommendationWindow(history)
  const excluded = new Set(excludeIds)
  const unique = [
    ...new Map(
      tracks
        .filter(
          track =>
            isRecommendationAllowed(track, remoteSources) && !excluded.has(track.id) && !blocked.has(recommendationKey(track)),
        )
        .map(track => [recommendationKey(track), track]),
    ).values(),
  ]
  const fresh = unique.filter(track => !recent.has(recommendationKey(track)))
  const older = unique.filter(track => recent.has(recommendationKey(track)))
  const result = []
  for (const candidates of [fresh, older]) {
    const allowed = candidates === fresh ? limit : Math.min(limit - result.length, Math.floor(result.length / 4))
    const groups = new Map()
    for (const track of candidates) {
      const source = track.kind === "online" ? track.provider : track.sourceId ? "remote" : "local"
      if (!groups.has(source)) {
        groups.set(source, [])
      }
      groups.get(source).push(track)
    }
    const pools = [...groups.values()]
    for (const pool of pools) {
      for (let index = pool.length - 1; index > 0; index--) {
        const other = Math.floor(random() * (index + 1))
        ;[pool[index], pool[other]] = [pool[other], pool[index]]
      }
    }
    const end = result.length + allowed
    while (result.length < end && pools.some(pool => pool.length)) {
      for (const pool of pools) {
        if (pool.length && result.length < end) {
          result.push(pool.shift())
        }
      }
    }
  }
  return result
}
