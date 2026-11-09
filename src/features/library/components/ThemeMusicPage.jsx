/**
 * 将自动分类的私人曲库与在线主题连接到统一播放器，浏览不创建个人歌单。
 */
import React, { memo, useMemo, useState } from "react"
import { ArrowLeft, LoaderCircle, Play, RefreshCw, Search, Shuffle } from "lucide-react"
import { musicThemes } from "#shared/musicThemes"
import ThemeShelf, { ThemeArtwork } from "@/features/library/components/ThemeShelf.jsx"
import useThemeMusic from "@/features/library/hooks/useThemeMusic.js"
import TrackTable from "@/features/library/components/TrackTable.jsx"
import { themeLibraryKey } from "#shared/libraryThemeRules"
import { isTrackEnabled } from "@/features/library/model/libraryVisibility.js"
import { isRecommendationAllowed } from "#shared/recommendationRules"

/**
 * 展示已核验歌曲的真实数量，允许边加载边播放；加载只提供简短反馈，完成后保留歌曲与必要操作。
 * 扫描、标签或来源变化后重新请求分类，已移除或已关闭的曲目立即从展示列表排除。
 * 远程歌曲沿用曲库当前对象和标识，分类刷新不重建播放队列或中断已有音频。
 */
function ThemeMusicPage({ api, id, library, onOpen, onBack, onConfigure, onPlay, onShuffle, table }) {
  const theme = musicThemes.find(item => item.id === id)
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState("default")
  const { settings, onlineAvailability: availability } = library
  const sourceKey = useMemo(() => themeLibraryKey(library), [library.tracks, library.remoteSources, library.scannedAt, settings])
  const detail = useThemeMusic({ api, id: theme?.id, sourceKey })
  const available = useMemo(() => {
    const byId = new Map(library.tracks.map(track => [track.id, track]))
    return detail.tracks.flatMap(track => {
      const current = track.kind === "online" ? track : byId.get(track.id)
      return current &&
        isTrackEnabled(current, settings) &&
        isRecommendationAllowed(current, library.remoteSources) &&
        availability?.[current.id] !== false
        ? [current]
        : []
    })
  }, [detail.tracks, library.tracks, library.remoteSources, settings, availability])
  const tracks = useMemo(() => {
    const result = available.filter(track =>
      `${track.title} ${track.artist} ${track.album}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    )
    return sort === "default"
      ? result
      : result.slice().sort((first, second) => first[sort].localeCompare(second[sort], "zh-CN", { numeric: true }))
  }, [available, query, sort])
  if (!theme) {
    return <ThemeShelf onOpen={onOpen} />
  }
  const ids = tracks.map(track => track.id)
  return (
    <div className="theme-detail">
      <button className="text-button theme-back" onClick={onBack}>
        <ArrowLeft size={15} />
        全部主题
      </button>
      <section className="theme-detail-heading">
        <ThemeArtwork theme={theme} />
        <div>
          <h1>{theme.name}</h1>
          <p>{theme.description}</p>
          <span className="theme-detail-count">{available.length} 首歌曲</span>
          <div className="playlist-buttons">
            <button className="primary-button" disabled={!ids.length} onClick={() => onPlay(ids[0], ids)}>
              <Play size={16} fill="currentColor" />
              播放全部
            </button>
            <button className="outline-button" disabled={!ids.length} onClick={() => onShuffle(ids)}>
              <Shuffle size={16} />
              随机播放
            </button>
            <button className="outline-button" disabled={detail.phase === "loading"} onClick={detail.retry}>
              <RefreshCw size={14} />
              换一批
            </button>
            <button className="text-button" onClick={onConfigure}>
              音乐来源
            </button>
          </div>
        </div>
      </section>
      {detail.message && detail.phase !== "loading" && (
        <p className="recommendation-note" role="status">
          {detail.message}
        </p>
      )}
      {detail.phase === "loading" && (
        <div className="theme-loading" role="status">
          <LoaderCircle className="spin" size={16} />
          <span>加载中…</span>
        </div>
      )}
      {tracks.length > 0 || available.length > 0 ? (
        <>
          <div className="song-toolbar">
            <span className="song-tab">
              歌曲列表 <span>{tracks.length}</span>
            </span>
            <div className="song-toolbar-actions">
              <select aria-label="主题歌曲排序" value={sort} onChange={event => setSort(event.target.value)}>
                <option value="default">精选顺序</option>
                <option value="title">按歌名排序</option>
                <option value="artist">按歌手排序</option>
              </select>
              <label className="inline-search">
                <Search size={14} />
                <input
                  aria-label="搜索当前主题"
                  placeholder="搜索此主题"
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                />
              </label>
            </div>
          </div>
          <TrackTable
            {...table}
            tracks={tracks}
            resetKey={`theme:${id}:${query}:${sort}`}
            onPlay={trackId => onPlay(trackId, ids)}
            emptyMessage="没有匹配的歌曲"
          />
        </>
      ) : detail.phase === "loading" ? (
        <div className="theme-track-skeleton" aria-label="正在加载主题歌曲" aria-busy="true">
          {Array.from({ length: 6 }, (_value, index) => (
            <div key={index}>
              <i />
              <span />
              <small />
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <h3>暂无可播放歌曲</h3>
          <button className="outline-button" onClick={detail.retry}>
            重试
          </button>
        </div>
      )}
    </div>
  )
}

export default memo(ThemeMusicPage)
