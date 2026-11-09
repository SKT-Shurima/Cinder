/**
 * 播放栏只呈现播放模型并分发用户动作，媒体实例与队列策略由应用控制器维护。
 * 状态图标、进度和音量各自保留读屏名称，调节音效与应用设置使用不同图标。
 */
import React from "react"
import {
  AudioLines,
  Heart,
  ListMusic,
  Maximize2,
  Minimize2,
  Music2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Settings2,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react"
import CoverArt from "@/shared/ui/CoverArt.jsx"
import IconButton from "@/shared/ui/IconButton.jsx"
import PlaybackIndicator from "@/shared/ui/PlaybackIndicator.jsx"
import FlameRange from "@/features/playback/components/FlameRange.jsx"
import { clockLabel } from "@/shared/media/trackPresentation.js"

/**
 * 循环模式的展示与下一状态，按钮切换顺序与持久播放模式保持一致。
 */
const modes = {
  list: { icon: Repeat, label: "列表循环", next: "shuffle" },
  shuffle: { icon: Shuffle, label: "随机播放", next: "one" },
  one: { icon: Repeat1, label: "单曲循环", next: "list" },
}

/**
 * 把当前播放模型呈现为歌曲信息、播放动作、进度和音量控件。
 * 只提交用户动作，媒体实例与跨来源队列始终由外层播放控制器持有。
 */
export default function PlayerBar({ model, actions }) {
  const {
    track,
    playing,
    position,
    duration,
    volume,
    mode,
    detailOpen,
    liked,
    playable,
    soundEnabled,
    soundOpen,
    queueOpen,
    queueCount,
  } = model
  const cycle = modes[mode]
  const maximum = duration || track?.duration || 1
  const quality =
    track &&
    ([".flac", ".wav", ".aiff", ".aif"].includes(track.extension) ? "无损 SQ" : track.extension.substring(1).toUpperCase())
  return (
    <footer className="player-bar">
      <div className="playing-track">
        {track ? (
          <>
            <PlaybackIndicator playing={playing} className="player-state-indicator" />
            <CoverArt track={track} className="player-cover" onClick={actions.details} />
            <div className="playing-info">
              <button onClick={actions.details}>{track.title}</button>
              <span>{track.artist}</span>
            </div>
            <IconButton
              icon={Heart}
              label={liked ? "取消喜欢" : "喜欢这首歌"}
              className={liked ? "is-favorite" : ""}
              onClick={actions.favorite}
            />
          </>
        ) : (
          <>
            <div className="idle-cover">
              <Music2 size={25} />
            </div>
            <div className="playing-info">
              <b>听见你的热爱</b>
              <span>选一首喜欢的歌，开始播放</span>
            </div>
          </>
        )}
      </div>
      <div className="player-center">
        <div className="playback-buttons">
          <IconButton
            icon={cycle.icon}
            label={`${cycle.label} · 点击切换${modes[cycle.next].label}`}
            className={mode === "list" ? "" : "mode-active"}
            onClick={() => actions.mode(cycle.next)}
          />
          <IconButton icon={SkipBack} disabled={!playable} label="上一首" onClick={() => actions.step(-1)} />
          <button
            disabled={!playable}
            className={`main-play ${playing ? "playing" : ""}`}
            aria-label={playing ? "暂停" : "播放"}
            onClick={actions.toggle}
          >
            {React.createElement(playing ? Pause : Play, { size: 22, fill: "currentColor" })}
          </button>
          <IconButton icon={SkipForward} disabled={!playable} label="下一首" onClick={() => actions.step(1)} />
          <IconButton
            icon={detailOpen ? Minimize2 : track ? Maximize2 : AudioLines}
            label={detailOpen ? "收起播放详情与歌词" : "展开播放详情与歌词"}
            disabled={!track}
            aria-expanded={detailOpen}
            aria-controls="now-playing-panel"
            onClick={actions.details}
          />
        </div>
        <div className="progress-row">
          <time>{clockLabel(position)}</time>
          <FlameRange
            label="播放进度"
            max={maximum}
            value={position}
            playing={playing}
            onChange={actions.scrubCommit}
            onBegin={actions.scrubBegin}
            onPreview={actions.scrubPreview}
            onCancel={actions.scrubCancel}
          />
          <time>{clockLabel(maximum === 1 && !track ? 0 : maximum)}</time>
        </div>
      </div>
      <div className="player-extras">
        <IconButton
          icon={Settings2}
          label="音效调节"
          className={soundEnabled ? "mode-active" : ""}
          aria-expanded={soundOpen}
          onClick={actions.sound}
        />
        {track && (
          <span
            className="quality-badge"
            title={track.kind === "online" ? "在线平台音频" : `${track.codec} · ${Math.round(track.sampleRate / 1000)} kHz`}
          >
            {quality}
          </span>
        )}
        <IconButton
          icon={volume ? Volume2 : VolumeX}
          label={volume ? "静音" : "取消静音"}
          onClick={() => actions.volume(volume ? 0 : 0.7, true)}
        />
        <input
          className="volume-slider"
          aria-label="音量"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          style={{ "--range-progress": `${volume * 100}%` }}
          onChange={event => actions.volume(Number(event.target.value))}
          onPointerUp={event => actions.volume(Number(event.currentTarget.value), true)}
          onKeyUp={event => actions.volume(Number(event.currentTarget.value), true)}
        />
        <span className="extra-divider" />
        <IconButton
          icon={ListMusic}
          label={`播放队列 ${queueCount} 首`}
          className={queueOpen ? "mode-active" : ""}
          onClick={actions.queue}
        />
        <small>{queueCount || ""}</small>
      </div>
    </footer>
  )
}
