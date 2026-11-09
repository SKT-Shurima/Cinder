/**
 * 展示当前混合播放队列，选择歌曲只提交标识，不重新加载曲库或重排队列。
 * 当前歌曲使用共用的播放标记，暂停和后台时动画按统一规则停止。
 */
import React from "react"
import { ListMusic, X } from "lucide-react"
import CoverArt from "@/shared/ui/CoverArt.jsx"
import IconButton from "@/shared/ui/IconButton.jsx"
import PlaybackIndicator from "@/shared/ui/PlaybackIndicator.jsx"
import { clockLabel } from "@/shared/media/trackPresentation.js"

/**
 * 显示当前混合队列与正在播放的歌曲，提供选曲和关闭入口。
 * 队列记录与顺序由调用方维护，本组件不会修改曲库或触发额外搜索。
 */
export default function QueueDrawer({ tracks, currentId, playing, onPlay, onClose }) {
  return (
    <aside className="queue-panel" aria-label="当前播放队列">
      <header className="queue-heading">
        <div>
          <h2>当前播放</h2>
          <p>{tracks.length} 首歌曲</p>
        </div>
        <IconButton label="关闭播放队列" icon={X} onClick={onClose} />
      </header>
      <div className="queue-items">
        {tracks.length === 0 ? (
          <div className="empty-state">
            <ListMusic size={32} />
            <p>播放歌曲后，队列会显示在这里。</p>
          </div>
        ) : (
          tracks.map((song, index) => (
            <button className={song.id === currentId ? "active" : ""} key={song.id + ":" + index} onClick={() => onPlay(song.id)}>
              <CoverArt track={song} />
              <span>
                <b>{song.title}</b>
                <small>{song.artist}</small>
              </span>
              {song.id === currentId ? <PlaybackIndicator playing={playing} /> : <time>{clockLabel(song.duration)}</time>}
            </button>
          ))
        )}
      </div>
    </aside>
  )
}
