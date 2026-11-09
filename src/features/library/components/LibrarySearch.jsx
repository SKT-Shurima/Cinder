/**
 * 提供音乐库即时检索与键盘选择，合并本地、远程索引与在线资源，并在结果末尾显示来源。
 * 延迟检索不阻塞输入；候选数量有上限，不随音乐库大小增加下拉框中的 DOM。
 */
import React, { memo, useEffect, useMemo, useRef, useState } from "react"
import { ArrowUpRight, Folder, LoaderCircle, Music2, Search, X } from "lucide-react"
import MusicSourceIcon from "@/shared/ui/MusicSourceIcon.jsx"
import { artworkAddress } from "@/shared/media/trackPresentation.js"
import { searchSuggestions } from "@/features/library/model/recommendations.js"
import { desktopShortcuts } from "@/shared/desktop/shortcuts.js"

/**
 * 展示可清除、可用方向键选择的搜索框，回车可播放候选或查看全部搜索结果。
 * 点击外部或按 Escape 收起候选；使用稳定的列表标识让读屏软件跟随当前选择。
 * 本地、平台与音乐服务器封面共用安全协议入口，不在页面中拼接带账号的网络地址。
 * 搜索快捷键提示与运行平台一致，macOS 使用 Command，Windows 使用 Ctrl。
 */
function LibrarySearch({
  query,
  onChange,
  tracks,
  playlists,
  loading,
  errors,
  composing,
  onComposition,
  onSearch,
  onTrack,
  onPlaylist,
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const root = useRef(null)
  const input = useRef(null)
  const results = useMemo(() => {
    const text = query.trim().toLocaleLowerCase()
    if (!text || composing) {
      return []
    }
    const songs = searchSuggestions(tracks).map(track => ({
      kind: "track",
      id: track.id,
      name: track.title,
      detail: track.artist,
      cover: track.cover,
      track,
    }))
    const folders = playlists
      .filter(item => `${item.name} ${item.relative}`.toLocaleLowerCase().includes(text))
      .slice(0, 2)
      .map(item => ({
        kind: "playlist",
        id: item.id,
        name: item.name,
        detail: `${item.trackIds.length} 首 · ${item.relative}`,
        track: item,
      }))
    return [...songs, ...folders]
  }, [tracks, playlists, query, composing])
  const visibleResults = results
  const expanded = open && Boolean(query.trim())
  useEffect(() => {
    const outside = event => {
      if (!root.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener("pointerdown", outside)
    return () => document.removeEventListener("pointerdown", outside)
  }, [])
  useEffect(() => setActive(-1), [query, tracks])

  /**
   * 提交明确选择的歌曲或歌单，再关闭下拉结果，避免播放后残留遮挡。
   * 尚未用方向键选择候选时，回车沿用查看全部结果的行为。
   */
  function select(entry) {
    setOpen(false)
    setActive(-1)
    if (!entry) {
      onSearch(query)
    } else if (entry.kind === "track") {
      onTrack(entry.id)
    } else {
      onPlaylist(entry.id)
    }
  }

  /**
   * 在候选内循环移动键盘选择，Escape 只收起当前搜索浮层。
   * 阻止默认方向键滚动，候选尚未出现时仍允许回车进行完整搜索。
   */
  function keyboard(event) {
    if (event.nativeEvent.isComposing || composing) {
      return
    }
    if (event.key === "Escape") {
      setOpen(false)
      setActive(-1)
      event.stopPropagation()
      return
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      setOpen(true)
      if (visibleResults.length) {
        setActive(index =>
          index < 0
            ? event.key === "ArrowDown"
              ? 0
              : visibleResults.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + visibleResults.length) % visibleResults.length,
        )
      }
    }
    if (event.key === "Enter") {
      event.preventDefault()
      select(expanded && active >= 0 ? visibleResults[active] : null)
    }
  }

  return (
    <div className={`library-search ${expanded ? "is-expanded" : ""}`} ref={root}>
      <div className="search-box">
        <Search size={17} />
        <input
          ref={input}
          id="global-search"
          aria-label="搜索音乐或歌单"
          placeholder="搜索本地、远程与在线音乐"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls="library-search-results"
          aria-activedescendant={expanded && active >= 0 && visibleResults[active] ? `search-result-${active}` : undefined}
          autoComplete="off"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={event => {
            onChange(event.target.value)
            setActive(-1)
            setOpen(true)
          }}
          onKeyDown={keyboard}
          onCompositionStart={() => onComposition(true)}
          onCompositionEnd={() => onComposition(false)}
        />
        {query ? (
          <button
            type="button"
            className="search-clear"
            aria-label="清除搜索"
            onClick={() => {
              onChange("")
              setActive(-1)
              input.current?.focus()
            }}
          >
            <X size={14} />
          </button>
        ) : (
          <kbd>{desktopShortcuts.search}</kbd>
        )}
      </div>
      {expanded && (
        <div className="search-panel">
          <div className="search-panel-heading">
            所有来源 · 一起寻找<span>↑ ↓ 选择 · Enter 确认</span>
          </div>
          <div id="library-search-results" role="listbox" aria-label="搜索建议" aria-busy={loading}>
            {visibleResults.map((entry, index) => (
              <button
                key={`${entry.kind}-${entry.id}`}
                id={`search-result-${index}`}
                role="option"
                aria-selected={active === index}
                className={`search-result ${active === index ? "is-active" : ""}`}
                onMouseDown={event => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => select(entry)}
              >
                <span className="search-result-art">
                  {entry.cover ? (
                    <img src={artworkAddress(entry.cover)} alt="" loading="lazy" />
                  ) : entry.kind === "playlist" ? (
                    <Folder size={18} />
                  ) : (
                    <Music2 size={18} />
                  )}
                </span>
                <span>
                  <b>{entry.name}</b>
                  <small>{entry.detail}</small>
                </span>
                <span className="search-result-kind">
                  {entry.kind === "playlist" ? "歌单" : <MusicSourceIcon track={entry.track} />}
                </span>
              </button>
            ))}
            {!visibleResults.length && (
              <p className="search-empty">
                {loading || composing ? "正在寻找匹配的音乐…" : "没有找到匹配内容，试试歌手名或其他关键词。"}
              </p>
            )}
          </div>
          {loading && (
            <p className="search-network-state" role="status">
              <LoaderCircle size={12} className="spin" />
              正在补充在线结果
            </p>
          )}
          {errors?.length > 0 && <p className="search-network-state">部分在线平台暂不可用，可继续使用已有结果。</p>}
          <button className="search-all" onMouseDown={event => event.preventDefault()} onClick={() => select(null)}>
            查看全部搜索结果
            <ArrowUpRight size={15} />
          </button>
        </div>
      )}
    </div>
  )
}

export default memo(LibrarySearch)
