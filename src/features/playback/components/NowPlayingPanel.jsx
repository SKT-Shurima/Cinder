import React, { useEffect, useRef } from "react"
import { ChevronDown, Folder, Heart, ImagePlus } from "lucide-react"
import IconButton from "@/shared/ui/IconButton.jsx"
import Cover from "@/shared/ui/CoverArt.jsx"
import MusicSourceIcon from "@/shared/ui/MusicSourceIcon.jsx"
import PlaybackWave from "./PlaybackWave.jsx"
import Turntable from "./Turntable.jsx"
import LyricsView from "./LyricsView.jsx"

/**
 * 展示当前歌曲的唱机、同步歌词和音浪，打开时将焦点移到收起入口。
 * 面板收起时恢复原焦点，切换视图不创建媒体元素；所有播放与封面动作仍交由各自业务 Hook 执行。
 */
export default function NowPlayingPanel({ model, actions }) {
  const { track: current, open: detailOpen, playing, volume, position: displayedPosition, duration, lyrics, liked } = model
  const currentId = current.id
  const nowPanel = useRef(null)
  const closeNowButton = useRef(null)
  useEffect(() => {
    if (!detailOpen) {
      return
    }
    const previousFocus = document.activeElement
    closeNowButton.current?.focus({ preventScroll: true })
    return () => {
      if (
        previousFocus?.isConnected &&
        (document.activeElement === document.body || nowPanel.current?.contains(document.activeElement))
      ) {
        previousFocus.focus({ preventScroll: true })
      }
    }
  }, [detailOpen])
  return (
    <section
      id="now-playing-panel"
      ref={nowPanel}
      className={`now-panel ${detailOpen ? "is-open" : ""}`}
      aria-label="正在播放"
      aria-hidden={!detailOpen}
      inert={!detailOpen}
    >
      <PlaybackWave
        playing={playing}
        visible={detailOpen}
        silent={volume === 0}
        getAnalyser={actions.getAnalyser}
        releaseAnalyser={actions.releaseAnalyser}
      />
      <div className="now-content">
        <button ref={closeNowButton} className="close-now" aria-label="收起播放详情" onClick={actions.close}>
          <ChevronDown size={24} />
          收起
        </button>
        <div className="now-disc-area">
          <Turntable track={current} playing={playing && detailOpen} Cover={Cover} onToggle={actions.toggle} />
          <div className="now-title">
            <MusicSourceIcon track={current} showLabel className="now-source" />
            <h1>{current.title}</h1>
            <p>
              {current.artist}
              <span>·</span>
              {current.album || "单曲"}
            </p>
            <div>
              <IconButton icon={Heart} label="喜欢这首歌" className={liked ? "is-favorite" : ""} onClick={actions.favorite} />
              <IconButton icon={ImagePlus} label="查看或匹配封面" onClick={actions.artwork} />
              {!current.sourceId && current.kind !== "online" && (
                <IconButton icon={Folder} label="在文件管理器中显示" onClick={actions.reveal} />
              )}
            </div>
          </div>
        </div>
        <LyricsView
          key={currentId}
          lyrics={lyrics}
          position={displayedPosition}
          onProgressBegin={actions.scrubBegin}
          onProgressPreview={actions.scrubPreview}
          onProgressCommit={actions.scrubCommit}
          onProgressCancel={actions.scrubCancel}
          duration={duration || current?.duration || 0}
          playing={playing}
          onSeek={actions.seek}
          visible={detailOpen}
          onRetry={actions.retryLyrics}
        />
      </div>
    </section>
  )
}
