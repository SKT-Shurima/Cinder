/**
 * 将真实歌词时间轴与播放进度同步，手动拖动时暂停跟随，松手后跳转到中心歌词。
 * 自动滚动始终限制在歌词容器内；静态歌词和网络失败不伪造时间轴。
 */
import React, { useEffect, useRef, useState } from "react"
import { AudioLines, LoaderCircle, Play, RefreshCw } from "lucide-react"
import FlameRange from "@/features/playback/components/FlameRange.jsx"

/**
 * 将歌词候选时间显示为累计分钟和秒，供拖动预览和跳转按钮使用。
 * 时间只来自已解析的歌词标签，不用行号估算播放位置。
 */
function lyricTime(seconds) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`
}

/**
 * 提供自动跟随、鼠标拖动、触控板浏览和逐行点击跳转。
 * 拖动取消不跳歌；手动滚动后可预览中心行并确认播放，或返回当前播放位置。
 * 当前行使用主题高亮，相邻与已唱行提供柔和层次；侧边火焰滑块与底部共用真实播放进度。
 */
export default function LyricsView({
  lyrics,
  position,
  duration,
  playing,
  onSeek,
  visible,
  onRetry,
  onProgressBegin,
  onProgressPreview,
  onProgressCommit,
  onProgressCancel,
}) {
  const scroller = useRef(null)
  const drag = useRef(null)
  const suppressClick = useRef(false)
  const frame = useRef(0)
  const browseTimer = useRef(0)
  const previewElement = useRef(null)
  const previewTime = useRef(0)
  const [browsing, setBrowsing] = useState(false)
  const [preview, setPreview] = useState(-1)
  const [dragging, setDragging] = useState(false)
  let active = -1
  for (let index = 0; index < lyrics.lines.length; index++) {
    if (lyrics.lines[index].time <= position) {
      active = index
    } else {
      break
    }
  }
  if (preview >= 0) {
    previewTime.current = lyrics.lines[preview]?.time || 0
  }

  /**
   * 手动浏览停止五秒后关闭定位提示并恢复当前歌词，悬停、键盘聚焦与拖动期间保留提示。
   * 每次有效操作重新计时，关闭使用样式淡出，不在没有确认时改变音频位置。
   */
  function scheduleBrowseExit() {
    clearTimeout(browseTimer.current)
    if (!visible || drag.current?.moved) {
      return
    }
    browseTimer.current = setTimeout(() => {
      if (drag.current || previewElement.current?.matches(":hover") || previewElement.current?.contains(document.activeElement)) {
        return
      }
      setBrowsing(false)
      setPreview(-1)
    }, 5000)
  }

  /**
   * 首次滚轮操作即进入歌词浏览，并在本帧滚动完成后计算中心候选。
   * 不依赖下一次滚动事件才能出现定位提示，连续操作重新开始五秒闲置计时。
   */
  function browseLyrics() {
    if (!lyrics.lines.length) {
      return
    }
    setBrowsing(true)
    scheduleBrowseExit()
    if (!frame.current) {
      frame.current = requestAnimationFrame(() => {
        frame.current = 0
        setPreview(centerLine())
      })
    }
  }
  useEffect(() => {
    if (browsing && !dragging) {
      scheduleBrowseExit()
    }
    return () => clearTimeout(browseTimer.current)
  }, [browsing, dragging, visible])

  /**
   * 查找视口中心最近的歌词行，使用已有布局坐标且每帧最多计算一次。
   * 仅在用户操作歌词时调用，音频进度更新不遍历全部 DOM 来测量布局。
   */
  function centerLine() {
    const element = scroller.current
    if (!element) {
      return -1
    }
    const center = element.scrollTop + element.clientHeight / 2
    let closest = -1
    let distance = Infinity
    for (const line of element.querySelectorAll("[data-line]")) {
      const delta = Math.abs(line.offsetTop + line.offsetHeight / 2 - center)
      if (delta < distance) {
        distance = delta
        closest = Number(line.dataset.line)
      }
    }
    return closest
  }

  /**
   * 将当前歌词移到容器中心，尊重系统减少动态效果选项。
   * 拖动或触控板浏览期间停止跟随，避免滚动位置与用户手势竞争。
   */
  function follow() {
    const element = scroller.current
    const line = element?.querySelector(`[data-line="${active}"]`)
    if (!visible || !line || !element) {
      return
    }
    element.scrollTo({
      top: line.offsetTop - (element.clientHeight - line.offsetHeight) / 2,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    })
  }
  useEffect(() => {
    if (!browsing && !dragging) {
      follow()
    }
  }, [active, visible, browsing, dragging, lyrics.lines])
  useEffect(() => () => cancelAnimationFrame(frame.current), [])
  useEffect(() => {
    if (!visible) {
      drag.current = null
      setDragging(false)
      setBrowsing(false)
    }
  }, [visible])

  /**
   * 记录拖动起点，不立即阻止点击，让普通歌词按钮继续支持键盘和鼠标跳转。
   * 只有主指针进入实际拖动后才捕获指针；静态歌词仍沿用原生文本滚动。
   */
  function beginDrag(event) {
    if (event.button !== 0 || !lyrics.lines.length) {
      return
    }
    drag.current = { id: event.pointerId, y: event.clientY, top: event.currentTarget.scrollTop, moved: false }
    clearTimeout(browseTimer.current)
  }

  /**
   * 将垂直拖动映射为歌词视口滚动，并在移动达到阈值后抑制意外的行点击。
   * 指针捕获保证移出容器后仍可结束拖动，不修改音频进度直到松手。
   */
  function moveDrag(event) {
    const current = drag.current
    if (!current || current.id !== event.pointerId) {
      return
    }
    if (!current.moved && Math.abs(event.clientY - current.y) < 5) {
      return
    }
    if (!current.moved) {
      current.moved = true
      event.currentTarget.setPointerCapture(event.pointerId)
      setDragging(true)
      setBrowsing(true)
      suppressClick.current = true
    }
    event.preventDefault()
    event.currentTarget.scrollTop = current.top - (event.clientY - current.y)
    if (!frame.current) {
      frame.current = requestAnimationFrame(() => {
        frame.current = 0
        setPreview(centerLine())
      })
    }
  }

  /**
   * 松手后采用中心行的时间戳跳转，取消手势则恢复跟随并保留原播放位置。
   * 抑制本次拖动衍生的 click，避免跳转后又选中鼠标最初按下的旧歌词。
   */
  function finishDrag(event) {
    const current = drag.current
    if (!current || current.id !== event.pointerId) {
      return
    }
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (current.moved && event.type !== "pointercancel") {
      jump(centerLine())
    }
    setDragging(false)
    setBrowsing(false)
    requestAnimationFrame(() => {
      suppressClick.current = false
    })
  }

  /**
   * 提交有效时间戳并恢复自动跟随，保持播放器原来的播放或暂停状态。
   * 纯文本没有时间戳，不进入此跳转流程。
   */
  function jump(index) {
    if (lyrics.lines[index]) {
      onSeek(lyrics.lines[index].time)
    }
    setBrowsing(false)
    setPreview(-1)
  }

  /**
   * 从歌词侧边的真实进度滑块定位音频，并退出手动歌词浏览以重新跟随。
   * 进度值由播放器统一约束，不按歌词行号估算歌曲时间。
   */
  function seekProgress(value) {
    onProgressCommit(value)
    setBrowsing(false)
    setPreview(-1)
  }

  return (
    <div className={`lyrics-area ${dragging ? "is-dragging" : ""}`}>
      <div className="lyrics-meta" aria-live="polite" title="本地与缓存优先，在线支持网易云、QQ 音乐和 LRCLIB 自动回退">
        {lyrics.loading ? (
          <>
            <LoaderCircle size={13} className="spin" />
            正在匹配在线歌词…
          </>
        ) : lyrics.source ? (
          <>
            <AudioLines size={13} />
            {lyrics.source}
            {lyrics.cached ? " · 离线缓存" : ""}
            {!lyrics.lines.length && lyrics.text ? (
              <>
                {" "}
                · 纯文本
                <button className="text-button" aria-label="重新匹配同步歌词" onClick={onRetry}>
                  <RefreshCw size={11} />
                </button>
              </>
            ) : (
              ""
            )}
          </>
        ) : (
          "歌词"
        )}
      </div>
      <div
        className={`lyrics-scroll ${lyrics.lines.length ? "has-playback-rail" : ""}`}
        ref={scroller}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onWheel={browseLyrics}
        onScroll={() => {
          if (browsing) {
            scheduleBrowseExit()
            if (!frame.current) {
              frame.current = requestAnimationFrame(() => {
                frame.current = 0
                setPreview(centerLine())
              })
            }
          }
        }}
      >
        {lyrics.lines.length ? (
          <div className="lyric-lines">
            {lyrics.lines.map((line, index) => (
              <button
                key={`${line.time}-${index}`}
                data-line={index}
                aria-current={index === active ? "true" : undefined}
                aria-label={`${line.text || "间奏"}，跳转到 ${lyricTime(line.time)}`}
                className={`${index === active ? "active" : Math.abs(index - active) === 1 ? "is-near" : index < active ? "is-past" : ""} ${browsing && index === preview ? "is-preview" : ""}`}
                onClick={event => {
                  if (suppressClick.current) {
                    event.preventDefault()
                    return
                  }
                  jump(index)
                }}
              >
                {line.text || "♪"}
              </button>
            ))}
          </div>
        ) : lyrics.text ? (
          <pre className="plain-lyrics">{lyrics.text}</pre>
        ) : (
          <div className="no-lyrics">
            {lyrics.loading ? <LoaderCircle size={30} className="spin" /> : <AudioLines size={32} />}
            <h3>{lyrics.loading ? "正在为这首歌找歌词" : "让旋律说话"}</h3>
            <p>{lyrics.message || (lyrics.loading ? "按歌名、歌手与版本核对时间轴" : "暂无可用歌词")}</p>
            {!lyrics.loading && (
              <button className="outline-button" onClick={onRetry}>
                <RefreshCw size={14} />
                重新匹配歌词
              </button>
            )}
            <small>本地歌词优先，联网成功后自动缓存。</small>
          </div>
        )}
      </div>
      {lyrics.lines.length > 0 && (
        <FlameRange
          label="歌词播放进度"
          vertical
          value={position}
          max={duration}
          onChange={seekProgress}
          onBegin={onProgressBegin}
          onPreview={onProgressPreview}
          onCancel={onProgressCancel}
          playing={playing && visible}
        />
      )}
      {lyrics.lines.length > 0 && (
        <div
          ref={previewElement}
          className={`lyric-seek-preview ${browsing && preview >= 0 ? "is-open" : ""}`}
          aria-hidden={!browsing || preview < 0}
          inert={!browsing || preview < 0}
          onPointerEnter={() => clearTimeout(browseTimer.current)}
          onPointerLeave={scheduleBrowseExit}
          onFocusCapture={() => clearTimeout(browseTimer.current)}
          onBlurCapture={scheduleBrowseExit}
          onKeyDown={scheduleBrowseExit}
        >
          <span>{lyricTime(previewTime.current)}</span>
          <button className="text-button" onClick={() => jump(preview)}>
            <Play size={13} fill="currentColor" />
            {dragging ? "松手跳到这里" : "从这里播放"}
          </button>
          <button
            className="text-button"
            onClick={() => {
              setBrowsing(false)
              setPreview(-1)
            }}
          >
            返回当前
          </button>
        </div>
      )}
      {lyrics.lines.length > 0 && !browsing && <small className="lyrics-hint">点击歌词跳转 · 拖动后松手定位</small>}
    </div>
  )
}
