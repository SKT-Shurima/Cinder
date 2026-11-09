import { isTrackEnabled } from "./libraryVisibility.js"
import { musicThemes } from "#shared/musicThemes"

/**
 * 按当前集合、来源开关和列表筛选派生歌曲，供全部音乐、歌单、收藏、历史和搜索统一使用。
 * 歌单与收藏保留用户原顺序；排序时复制结果，不修改曲库快照或正在播放的队列。
 * 在线歌手详情未就绪时返回空集合，不用其他歌手或上次请求的数据填充当前页面。
 */
export function selectLibraryTracks({
  library,
  page,
  selected,
  popularArtists,
  tracksById,
  musicSearch,
  trackSearch = "",
  onlyMissing = false,
  sort = "default",
}) {
  if (!library) {
    return []
  }
  let tracks
  switch (page) {
    case "artist":
      tracks =
        popularArtists.loading || popularArtists.error || popularArtists.detail.loading || popularArtists.detail.error
          ? []
          : popularArtists.detail.tracks
      break
    case "playlist":
      tracks = selected ? selected.trackIds.map(id => tracksById.get(id)).filter(Boolean) : library.tracks
      break
    case "favorites":
      tracks = library.favorites.map(id => tracksById.get(id)).filter(Boolean)
      break
    case "recent":
      tracks = library.history.map(item => tracksById.get(item.id)).filter(Boolean)
      break
    case "search":
      tracks = musicSearch.tracks
      break
    default:
      tracks = library.tracks
  }
  let result = tracks.filter(track => isTrackEnabled(track, library.settings))
  if (trackSearch) {
    result = result.filter(track =>
      `${track.title} ${track.artist} ${track.album} ${track.filename}`.toLocaleLowerCase().includes(trackSearch),
    )
  }
  if (onlyMissing) {
    result = result.filter(track => !track.cover)
  }
  if (sort === "duration") {
    result = [...result].sort((a, b) => a.duration - b.duration)
  } else if (sort !== "default") {
    result = [...result].sort((a, b) => a[sort].localeCompare(b[sort], "zh-CN", { numeric: true }))
  }
  return result
}

/**
 * 从导航上下文生成页面标题和简短摘要，页面布局不直接维护嵌套条件文案。
 * 歌单或歌手已失效时显示通用名称，不影响当前歌曲和队列。
 */
export function getLibraryPagePresentation({ page, selectedId, selected, selectedArtist, popularArtists, query }) {
  const titles = { themes: "主题歌单", artists: "热门歌手", favorites: "我喜欢的音乐", recent: "最近播放", songs: "全部音乐" }
  let pageTitle = titles[page] || "全部音乐"
  if (page === "theme") {
    pageTitle = musicThemes.find(item => item.id === selectedId)?.name || "主题歌单"
  }
  if (page === "artist") {
    pageTitle = selectedArtist?.name || "歌手"
  }
  if (page === "playlist") {
    pageTitle = selected?.name || "歌单"
  }
  if (page === "search") {
    pageTitle = `搜索“${query}”`
  }
  const summaries = { favorites: "把心动的旋律，收藏在这里", recent: "那些陪过你的旋律" }
  const pageSummary =
    page === "artist"
      ? `${popularArtists.source} · 热门作品`
      : page === "playlist"
        ? selected?.relative
        : summaries[page] || "你的音乐，随时都在"
  return { pageTitle, pageSummary }
}
