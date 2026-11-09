/**
 * 从持久索引派生歌曲统计和用户歌单，专辑、目录及平台来源不再自动创建歌单。
 * 用户歌单独立保存成员关系，扫描和远程同步只能更新其中歌曲的可用信息。
 */

/**
 * 统计无损来源时采用稳定格式集合，避免遍历每首歌曲时重复创建集合。
 */
const losslessFormats = new Set([".flac", ".wav", ".aiff", ".aif"])

/**
 * 为界面生成只读歌曲与用户歌单视图，不改写原始索引、收藏或播放顺序。
 * 没有用户创建记录的旧曲库返回空歌单，不把旧版专辑分组迁移为用户资产。
 */
export class CatalogProjection {
  /**
   * 汇集歌曲统计，并按用户保存的成员顺序生成封面与可用曲目列表。
   * 空歌单继续显示；暂不可见或已移除歌曲只在展示投影中排除，不凭分组补入新歌。
   */
  build(state, status) {
    const tracks = state.tracks.concat(state.onlineTracks ?? [])
    const byId = new Map(tracks.map(track => [track.id, track]))
    const playlists = (state.userPlaylists || []).map(playlist => {
      const members = playlist.trackIds.map(id => byId.get(id)).filter(Boolean)
      return {
        ...playlist,
        kind: "user",
        relative: "我创建的歌单",
        trackIds: members.map(track => track.id),
        covers: [...new Set(members.map(track => track.cover).filter(Boolean))].slice(0, 4),
        customCover: state.playlistCovers[playlist.id] ?? null,
      }
    })
    const stats = { tracks: tracks.length, playlists: playlists.length, covered: 0, duration: 0, lossless: 0 }
    for (const track of tracks) {
      if (track.cover) {
        stats.covered++
      }
      stats.duration += track.duration || 0
      if (losslessFormats.has(track.extension)) {
        stats.lossless++
      }
    }
    return { ...state, tracks, playlists, stats, status }
  }
}
