/**
 * 使用固定行高虚拟列表呈现歌曲，行组件只依赖歌曲与播放状态。
 * 列表滚动不会触发音频操作，当前歌曲的音柱随播放状态统一启停。
 */
import React, { memo, useEffect, useMemo, useRef, useState } from "react"
import { CircleAlert, Clock3, Folder, Heart, ImagePlus, ListPlus, Minus, Play, Search } from "lucide-react"
import CoverArt from "@/shared/ui/CoverArt.jsx"
import IconButton from "@/shared/ui/IconButton.jsx"
import PlaybackIndicator from "@/shared/ui/PlaybackIndicator.jsx"
import { clockLabel } from "@/shared/media/trackPresentation.js"
import MusicSourceIcon from "@/shared/ui/MusicSourceIcon.jsx"

/**
 * 单行绑定用户动作，不在渲染时请求封面或服务器元数据。
 * 警告只标记历史文件状态，远程和在线记录不会提供本地文件管理器入口。
 * 加入或移出歌单由用户逐首触发，双击、播放及加载元信息都不会创建歌单。
 */
function TrackRow({
  track,
  index,
  active,
  playing,
  liked,
  onPlay,
  onFavorite,
  onCover,
  onReveal,
  onPlaylist,
  onRemoveFromPlaylist,
}) {
  const local = !track.sourceId && track.kind !== "online"
  return (
    <div
      data-track-id={track.id}
      className={`song-row song-grid ${active ? "current" : ""}`}
      style={{ top: index * 58, height: 58 }}
      onDoubleClick={() => onPlay(track.id)}
    >
      <button
        type="button"
        className="row-play"
        aria-label={`${active && playing ? "正在播放" : "播放"} ${track.title}`}
        onClick={() => onPlay(track.id)}
      >
        {active ? (
          <PlaybackIndicator playing={playing} />
        ) : (
          <>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <Play fill="currentColor" size={14} />
          </>
        )}
      </button>
      <IconButton
        icon={Heart}
        onClick={() => onFavorite(track.id)}
        label={liked ? "取消喜欢" : "喜欢这首歌"}
        className={liked ? "is-favorite" : ""}
      />
      <button className="song-title" type="button" onClick={() => onPlay(track.id)}>
        <CoverArt className="row-cover" track={track} />
        <span>
          <span className="song-name">{track.title}</span>
          <span className="song-format">{track.extension === ".flac" ? "SQ" : track.extension.substring(1).toUpperCase()}</span>
          {Boolean(track.warnings?.length) && (
            <span className="file-warning" title="历史文件存在不完整片段，可能只能播放部分音频">
              <CircleAlert size={12} />
            </span>
          )}
        </span>
      </button>
      {[track.artist, track.album || "未知专辑"].map((text, column) => (
        <span key={column} className="truncate secondary" title={text}>
          {text}
        </span>
      ))}
      <time className="song-duration">{track.sourceId && !track.duration ? "—:—" : clockLabel(track.duration)}</time>
      <div className="row-actions">
        <MusicSourceIcon track={track} />
        {onPlaylist && <IconButton icon={ListPlus} onClick={() => onPlaylist(track)} label="加入歌单" />}
        {onRemoveFromPlaylist && <IconButton icon={Minus} onClick={() => onRemoveFromPlaylist(track.id)} label="从歌单移除" />}
        <IconButton icon={ImagePlus} onClick={() => onCover(track)} label="匹配或更换封面" />
        {local && <IconButton icon={Folder} onClick={() => onReveal(track.id)} label="在文件管理器中显示" />}
      </div>
    </div>
  )
}

/**
 * 为大曲库计算可见行与缓冲范围，只挂载窗口附近的歌曲。
 * 集合切换时复位滚动位置，尺寸观察器随组件卸载释放。
 * 调用方可指定空结果说明，让在线作品筛选不出现本地文件导入提示。
 */
function TrackTable({
  tracks,
  currentId,
  playing,
  favorites,
  resetKey,
  emptyMessage = "试试其他关键词，或导入一个音乐文件夹。",
  ...actions
}) {
  const viewport = useRef(null)
  const [range, setRange] = useState({ offset: 0, height: 500 })
  useEffect(() => {
    const element = viewport.current
    const observer = new ResizeObserver(([entry]) => setRange(value => ({ ...value, height: entry.contentRect.height })))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    viewport.current.scrollTop = 0
    setRange(value => ({ ...value, offset: 0 }))
  }, [resetKey])
  const liked = useMemo(() => new Set(favorites), [favorites])
  const start = Math.max(0, Math.floor(range.offset / 58) - 6)
  const end = start + Math.ceil(range.height / 58) + 14
  return (
    <div className="song-table">
      <div className="song-heading song-grid">
        <span>#</span>
        <span />
        <span>音乐标题</span>
        <span>歌手</span>
        <span>专辑</span>
        <span>
          <Clock3 size={14} />
        </span>
        <span>来源</span>
      </div>
      <div
        className="song-scroll"
        ref={viewport}
        onScroll={event => {
          const offset = event.currentTarget.scrollTop
          setRange(value => ({ ...value, offset }))
        }}
      >
        {tracks.length ? (
          <div className="virtual-body" style={{ height: 58 * tracks.length }}>
            {tracks.slice(start, end).map((track, index) => (
              <TrackRow
                key={track.id}
                {...actions}
                track={track}
                index={start + index}
                liked={liked.has(track.id)}
                active={currentId === track.id}
                playing={playing}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <Search size={35} />
            <h3>这里还没有歌曲</h3>
            <p>{emptyMessage}</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(TrackTable)
