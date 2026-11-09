/**
 * 在歌曲行、队列与最近播放中展示统一的播放状态，不额外创建音频分析节点。
 * 暂停时保留静态音柱；后台与减少动态效果设置下停止循环，动画只改变合成层变换。
 */
import React, { memo } from "react"

/**
 * 根据实际播放状态呈现五根音柱，暂停时保留静态播放标记。
 * 不创建定时器或分析节点，后台与减少动态效果由统一样式规则暂停。
 */
function PlaybackIndicator({ playing = false, className = "" }) {
  return (
    <span
      className={`playback-indicator ${playing ? "is-playing" : "is-paused"} ${className}`}
      aria-hidden="true"
      data-playing={playing}
    >
      {[0, 1, 2, 3, 4].map(index => (
        <i key={index} style={{ "--bar-order": index }} />
      ))}
    </span>
  )
}

export default memo(PlaybackIndicator)
