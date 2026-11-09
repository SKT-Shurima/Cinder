/**
 * 组合歌曲集合的摘要、排序筛选与虚拟列表，歌单、歌手、收藏和搜索共用展示结构。
 * 播放动作接收当前集合的标识副本，浏览和排序不会重排正在播放的队列。
 */
import React from "react"
import { Folder, Heart, ImagePlus, ListMusic, MicVocal, Play, Search, Shuffle } from "lucide-react"
import TrackTable from "@/features/library/components/TrackTable.jsx"
import CoverArt from "@/shared/ui/CoverArt.jsx"
import { durationLabel } from "@/shared/media/trackPresentation.js"

/**
 * 保留当前页筛选值，由应用层统一维护导航后的重置规则。
 * 歌手入口始终可见，方便在歌曲与歌手两种浏览方式之间切换。
 */
function CollectionToolbar({ page, count, filters, onFilter, onArtists }) {
  return (
    <div className="song-toolbar">
      <div className="collection-view-tabs">
        <span className="song-tab">
          歌曲列表 <span>{count}</span>
        </span>
        <button className="text-button" onClick={onArtists}>
          <MicVocal size={15} />
          按歌手浏览
        </button>
      </div>
      <div className="song-toolbar-actions">
        <button
          aria-pressed={filters.missing}
          className={`missing-toggle ${filters.missing ? "active" : ""}`}
          onClick={() => onFilter("missing", !filters.missing)}
        >
          <ImagePlus size={14} />
          缺失封面
        </button>
        <select aria-label="歌曲排序" value={filters.sort} onChange={event => onFilter("sort", event.target.value)}>
          {[
            ["default", page === "artist" ? "热门顺序" : "文件夹顺序"],
            ["title", "按歌名排序"],
            ["artist", "按歌手排序"],
            ["album", "按专辑排序"],
            ["duration", "按时长排序"],
          ].map(([value, text]) => (
            <option value={value} key={value}>
              {text}
            </option>
          ))}
        </select>
        <label className="inline-search">
          <Search size={14} />
          <input
            aria-label="在当前列表中搜索"
            placeholder="搜索此列表"
            value={filters.query}
            onChange={event => onFilter("query", event.target.value)}
          />
        </label>
      </div>
    </div>
  )
}

/**
 * 将歌单、歌手或搜索集合转换为统一歌曲页面，复用筛选与虚拟列表。
 * 筛选状态由应用层控制，浏览列表的变化不会自动重排当前播放队列。
 * 在线集合可提供等待或失败反馈，此时不显示本地曲库的空列表引导。
 */
export default function LibraryCollection({
  page,
  title,
  summary,
  collection,
  tracks,
  filters,
  onFilter,
  onArtists,
  onPlay,
  onShuffle,
  onCoverChange,
  onManagePlaylist,
  table,
  searchStatus,
  contentState,
}) {
  const illustrated = ["playlist", "favorites", "artist"].includes(page)
  const ids = tracks.map(track => track.id)
  return (
    <>
      <section className={`playlist-header ${illustrated ? "" : "compact-header"}`}>
        {illustrated && (
          <div className={`detail-cover ${page === "favorites" ? "favorite-cover" : ""}`}>
            {page === "favorites" ? <Heart fill="currentColor" size={65} strokeWidth={1} /> : <CoverArt playlist={collection} />}
            {page === "playlist" && (
              <button className="edit-playlist-cover" onClick={onCoverChange}>
                <ImagePlus size={16} />
                更换封面
              </button>
            )}
          </div>
        )}
        <div className="playlist-info">
          <span className="playlist-type">
            {page === "artist" ? "ARTIST COLLECTION" : page === "playlist" ? "你的歌单" : "YOUR MUSIC COLLECTION"}
          </span>
          <h1>{title}</h1>
          <p className="playlist-owner">
            {page === "artist" ? <MicVocal size={16} /> : <Folder size={15} />}
            {summary}
          </p>
          <p className="playlist-meta">
            {tracks.length.toLocaleString()} 首歌曲<span>·</span>
            {durationLabel(tracks.reduce((total, track) => total + (track.duration || 0), 0))}
          </p>
          <div className="playlist-buttons">
            <button className="primary-button" disabled={!ids.length} onClick={() => onPlay(ids[0], ids)}>
              <Play fill="currentColor" size={17} />
              播放全部<span>{ids.length}</span>
            </button>
            <button className="outline-button" disabled={!ids.length} onClick={() => onShuffle(ids)}>
              <Shuffle size={17} />
              随机播放
            </button>
            {page === "playlist" && collection?.kind === "user" && (
              <button className="text-button" onClick={() => onManagePlaylist(collection)}>
                <ListMusic size={16} />
                管理歌单
              </button>
            )}
          </div>
        </div>
      </section>
      {searchStatus}
      {contentState || (
        <>
          <CollectionToolbar page={page} count={tracks.length} filters={filters} onFilter={onFilter} onArtists={onArtists} />
          <TrackTable
            {...table}
            tracks={tracks}
            emptyMessage={
              page === "playlist"
                ? "从全部音乐、主题或歌手作品中选择“加入歌单”。"
                : page === "artist"
                  ? "当前筛选没有匹配的作品，试试其他关键词或取消筛选。"
                  : undefined
            }
            onPlay={id => onPlay(id, ids)}
          />
        </>
      )}
    </>
  )
}
