import { useMemo } from "react"
import { normalizeMusicSources } from "#shared/musicSources"
import { filterMusicLibrary } from "../model/libraryVisibility.js"
import { selectLibraryTracks, getLibraryPagePresentation } from "../model/libraryView.js"
import useMusicSearch from "./useMusicSearch.js"
import usePopularArtists from "./usePopularArtists.js"

/**
 * 从曲库和只读导航条件派生当前页面需要的数据，统一索引、搜索、歌手详情和页面文案。
 * 不修改导航或播放器；筛选与排序只影响浏览结果，后台快照仍保留完整的来源、收藏与歌单。
 */
export default function useLibraryView({ api, library, navigation }) {
  const { page, selectedId, query, searchComposing, songQuery, onlyMissing, sort } = navigation
  const tracksById = useMemo(() => new Map((library?.tracks || []).map(track => [track.id, track])), [library?.tracks])
  const sourceModes = useMemo(() => normalizeMusicSources(library?.settings.musicSources), [library?.settings.musicSources])
  const visibleLibrary = useMemo(() => filterMusicLibrary(library), [library])
  const musicSearch = useMusicSearch({ api, query, library, composing: searchComposing })
  const selected = library?.playlists.find(item => item.id === selectedId)
  const popularArtists = usePopularArtists({
    api,
    active: ["artists", "artist"].includes(page),
    selectedId: page === "artist" ? selectedId : null,
    enabled: sourceModes.online && library?.settings.musicProviders?.netease !== false,
  })
  const artists = popularArtists.artists
  const selectedArtist = artists.find(artist => artist.id === selectedId)
  const favorites = library?.favorites || []
  const trackSearch = (page === "search" ? songQuery : `${query} ${songQuery}`).trim().toLocaleLowerCase()
  const viewTracks = useMemo(
    () =>
      selectLibraryTracks({ library, page, selected, popularArtists, tracksById, musicSearch, trackSearch, onlyMissing, sort }),
    [
      library,
      page,
      selected,
      popularArtists.loading,
      popularArtists.error,
      popularArtists.detail,
      tracksById,
      trackSearch,
      onlyMissing,
      sort,
      musicSearch.tracks,
    ],
  )
  const presentation = getLibraryPagePresentation({ page, selectedId, selected, selectedArtist, popularArtists, query })
  return {
    tracksById,
    sourceModes,
    visibleLibrary,
    musicSearch,
    selected,
    popularArtists,
    artists,
    selectedArtist,
    favorites,
    viewTracks,
    trackSearch,
    isSongPage: ["songs", "playlist", "artist", "favorites", "recent", "search"].includes(page),
    ...presentation,
  }
}
