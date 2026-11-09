/**
 * 按三种来源与平台开关生成统一曲库视图，在线资源与本地、服务器歌曲共用队列。
 * 只派生展示列表，不改变原始索引、收藏、历史记录和保存的连接。
 */
import { musicProviders, normalizeMusicSources } from "#shared/musicSources"

/**
 * 根据在线类型或服务器标识判断来源是否启用，在线歌曲同时核对其平台开关。
 * 缺失歌曲视为不可播放，防止旧队列中的无效标识继续交给音频协议。
 * 已移除的平台不因旧版保存了启用开关而继续允许播放。
 */
export function isTrackEnabled(track, settings) {
  if (!track) {
    return false
  }
  if (track.kind === "online") {
    return (
      musicProviders.some(provider => provider.id === track.provider) &&
      settings?.musicSources?.online !== false &&
      settings?.musicProviders?.[track.provider] !== false
    )
  }
  return (track.sourceId ? settings?.musicSources?.remote : settings?.musicSources?.local) !== false
}

/**
 * 过滤歌曲、歌单、最近播放和收藏，并重算当前视图的统计，原始快照保留在外层设置中。
 * 三类来源和所有平台都启用时复用原对象，播放进度变化不会重新遍历音乐库。
 * 用户歌单在空白或来源关闭时仍保留，只筛选当前可展示的成员，不能随曲目数量消失。
 */
export function filterMusicLibrary(library) {
  if (!library) {
    return null
  }
  const modes = normalizeMusicSources(library.settings.musicSources)
  if (
    modes.local &&
    modes.remote &&
    modes.online &&
    !Object.values(library.settings.musicProviders || {}).some(value => value === false)
  ) {
    return library
  }
  const tracks = library.tracks.filter(track => isTrackEnabled(track, library.settings))
  const ids = new Set(tracks.map(track => track.id))
  const byId = new Map(tracks.map(track => [track.id, track]))
  const playlists = library.playlists.map(playlist => ({
    ...playlist,
    trackIds: playlist.trackIds.filter(id => ids.has(id)),
    covers: [...new Set(playlist.trackIds.map(id => byId.get(id)?.cover).filter(Boolean))].slice(0, 4),
  }))
  return {
    ...library,
    tracks,
    playlists,
    favorites: library.favorites.filter(id => ids.has(id)),
    history: library.history.filter(item => ids.has(item.id)),
    stats: {
      tracks: tracks.length,
      playlists: playlists.length,
      covered: tracks.filter(track => track.cover).length,
      duration: tracks.reduce((sum, track) => sum + (track.duration || 0), 0),
      lossless: tracks.filter(track => [".flac", ".wav", ".aiff", ".aif"].includes(track.extension)).length,
    },
  }
}
