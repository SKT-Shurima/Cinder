/**
 * 以真实专辑封面为视觉中心组织首页，保持音乐浏览和播放进度更新相互独立。
 * 首页整体记忆化，每批精选三十首歌曲，舞台只显示其中七张卡片，列表图片延迟加载，不为每张卡片创建模糊层。
 */
import React, { memo, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Disc3,
  FolderPlus,
  ListMusic,
  Pause,
  Play,
  RefreshCw,
  Server,
  Shuffle,
} from "lucide-react"
import PlaybackIndicator from "@/shared/ui/PlaybackIndicator.jsx"
import MusicSourceIcon from "@/shared/ui/MusicSourceIcon.jsx"
import { artworkAddress } from "@/shared/media/trackPresentation.js"
import { buildRecommendations } from "@/features/library/model/recommendations.js"
import { isRecommendationAllowed } from "#shared/recommendationRules"
import { isTrackEnabled } from "@/features/library/model/libraryVisibility.js"
import useRotatingBatch, { preloadStageArtwork } from "@/features/library/hooks/useRotatingBatch.js"
import { batchCardMotion } from "@/features/library/model/batchMotion.js"
import ThemeShelf from "@/features/library/components/ThemeShelf.jsx"
import { readRecommendationHistory, rememberRecommendationBatch } from "@/features/library/model/recommendationHistory.js"

/**
 * 展示带空间层次的封面切换，最多同时展示七张卡片，点击中央封面可播放或暂停，箭头用于浏览。
 * 切换封面仅改变有限卡片的 transform 和 opacity，不自动轮播、不重建音频元素。
 * 换批从右到左逐张退场，间隔先疏后密；新卡片逐张进入时先快后慢，过渡期间暂停交互。
 * 封面统一通过主进程媒体协议读取，音乐服务器的认证地址不会进入背景样式。
 */
function CoverStage({ loading, tracks, phase, onPhaseComplete, currentId, playing, onPlay, onToggle, Cover }) {
  const [selectedId, setSelectedId] = useState(tracks[0]?.id)
  const selectedIndex = Math.max(
    0,
    tracks.findIndex(track => track.id === selectedId),
  )
  const selected = tracks[selectedIndex]
  const offsets = tracks.map((_track, index) => {
    let offset = (index - selectedIndex + tracks.length) % tracks.length
    if (offset > tracks.length / 2) {
      offset -= tracks.length
    }
    return offset
  })
  const ordered = offsets.filter(offset => Math.abs(offset) <= 3).sort((first, second) => second - first)
  useEffect(() => {
    if (!tracks.some(track => track.id === selectedId)) {
      setSelectedId(tracks[0]?.id)
    }
  }, [tracks, selectedId])

  /**
   * 在有限的展示歌曲中切换封面，列表首尾衔接以便连续浏览。
   * 不修改播放器队列，用户确认播放时才把这组歌曲交给播放器。
   */
  function move(direction) {
    if (tracks.length) {
      setSelectedId(tracks[(selectedIndex + direction + tracks.length) % tracks.length].id)
    }
  }

  /**
   * 播放当前展示的歌曲；它已经是正在播放的歌曲时切换暂停和继续。
   * 新歌曲沿用展示集合建立队列，音频读取失败仍由播放器统一反馈。
   */
  function playSelected() {
    if (!selected) {
      return
    }
    if (selected.id === currentId) {
      onToggle()
    } else {
      onPlay(
        selected.id,
        tracks.map(track => track.id),
      )
    }
  }

  return (
    <section
      className={`listening-stage batch-${phase}`}
      aria-label="封面音乐精选"
      aria-busy={phase !== "idle"}
      onKeyDown={event => {
        if (phase !== "idle") {
          return
        }
        if (event.altKey || event.metaKey || event.ctrlKey) {
          return
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault()
          move(event.key === "ArrowLeft" ? -1 : 1)
        }
      }}
    >
      <div
        className="stage-ambient"
        aria-hidden="true"
        style={selected?.cover ? { backgroundImage: `url("${artworkAddress(selected.cover)}")` } : undefined}
      />
      <div className="stage-heading">
        <span>
          <i />
          YOUR PRIVATE MIX
        </span>
        <b>{loading ? "加载中…" : `${tracks.length} 首精选`}</b>
      </div>
      {selected ? (
        <div
          className={`stage-batch is-${phase}`}
          data-batch-phase={phase}
          inert={phase !== "idle"}
          onAnimationEnd={event => {
            if (
              event.target.dataset?.batchRank === String(ordered.length - 1) &&
              event.animationName === (phase === "leaving" ? "stage-card-leave" : "stage-card-enter")
            ) {
              onPhaseComplete()
            }
          }}
        >
          <div className="cover-stage">
            {tracks.map((track, index) => {
              const offset = offsets[index]
              const visible = Math.abs(offset) <= 3
              const rank = ordered.indexOf(offset)
              const motion = batchCardMotion(rank, phase)
              return (
                <button
                  key={track.id}
                  className={`stage-card ${offset === 0 ? "is-center" : ""}`}
                  data-batch-visible={visible}
                  data-batch-rank={visible ? rank : undefined}
                  aria-label={offset === 0 ? `播放 ${track.title}` : `选择歌曲 ${track.title}`}
                  aria-hidden={!visible}
                  tabIndex={visible ? 0 : -1}
                  inert={!visible}
                  style={{
                    "--offset": offset,
                    "--distance": Math.abs(offset),
                    "--card-opacity": 1 - Math.abs(offset) * 0.12,
                    "--batch-delay": `${motion.delay}ms`,
                    "--batch-duration": `${motion.duration}ms`,
                    zIndex: 5 - Math.abs(offset),
                    opacity: visible ? 1 - Math.abs(offset) * 0.12 : 0,
                  }}
                  onClick={() => (offset === 0 ? playSelected() : setSelectedId(track.id))}
                >
                  <Cover track={track} className="stage-cover" />
                  <span className="stage-card-caption">
                    <b>{track.title}</b>
                    <small>
                      <MusicSourceIcon track={track} />
                      {track.artist}
                    </small>
                  </span>
                  {offset === 0 && (
                    <span className="stage-card-play">
                      {currentId === track.id && playing ? (
                        <Pause size={19} fill="currentColor" />
                      ) : (
                        <Play size={19} fill="currentColor" />
                      )}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <div className="stage-bottom">
            <button className="stage-arrow" aria-label="上一张封面" disabled={tracks.length < 2} onClick={() => move(-1)}>
              <ChevronLeft size={18} />
            </button>
            <div className="stage-selection">
              <span className="stage-position">
                {String(selectedIndex + 1).padStart(2, "0")} <i>/ {tracks.length}</i>
              </span>
              <MusicSourceIcon track={selected} showLabel />
            </div>
            <button className="stage-arrow" aria-label="下一张封面" disabled={tracks.length < 2} onClick={() => move(1)}>
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      ) : (
        <div className="stage-empty">
          <Disc3 size={46} className={loading ? "spin" : ""} />
          {!loading && (
            <>
              <h2>暂无推荐</h2>
              <p>试试主题歌单，或添加音乐。</p>
            </>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * 以主内容和最近播放两栏组织音乐库首页，导入入口保持可见。
 * 不接收播放秒数，避免音频进度触发整页封面重复渲染；歌曲播放仍交给现有的统一控制器。
 * 全局搜索确认前保留当前歌单展示，候选浮层不会让首页内容跳动或清空。
 * 最近播放中的活动曲目显示轻量动态标记，暂停时换回播放按钮。
 * 换批保留现有内容直至新资源准备完成，并通过独立状态机串联退场与入场。
 * 实际完成展示后保存最近十批身份，返回首页或重启也不能绕过最近五批的去重约束。
 * 关闭连接推荐后立即排除该来源并重新组批，手动歌单、播放队列和最近播放继续保留。
 * 主题分类常驻并支持私人曲库；个人歌单区只展示用户创建记录，不由分类自动写入。
 */
function MusicHome({
  api,
  library,
  currentId,
  playing,
  busy,
  onPlay,
  onToggle,
  onNavigate,
  onAddLocal,
  onAddRemote,
  onScan,
  onCreatePlaylist,
  Cover,
  sourceModes,
  onOnline,
}) {
  const history = useRef(readRecommendationHistory())
  const preparing = useRef(false)
  const [batchNumber, setBatchNumber] = useState(0)
  const [batch, setBatch] = useState(() =>
    buildRecommendations(library.tracks, [], { history: history.current, remoteSources: library.remoteSources }),
  )
  const [recommending, setRecommending] = useState(false)
  const [recommendationWarning, setRecommendationWarning] = useState("")
  const libraryRef = useRef(library)
  libraryRef.current = library
  const request = useRef(0)
  const sourceKey = JSON.stringify([
    library.settings.musicSources,
    library.settings.musicProviders,
    (library.remoteSources || [])
      .filter(source => source.recommendationsEnabled === false)
      .map(source => source.id)
      .sort(),
  ])
  const featured = useMemo(
    () =>
      batch.filter(
        track =>
          isRecommendationAllowed(track, library.remoteSources) &&
          isTrackEnabled(track, library.settings) &&
          library.onlineAvailability?.[track.id] !== false,
      ),
    [batch, library.settings, library.onlineAvailability, library.remoteSources],
  )
  const rotation = useRotatingBatch(featured)
  useEffect(() => {
    const version = ++request.current
    const controller = new AbortController()
    preparing.current = true
    setRecommendationWarning("")
    setRecommending(true)
    /**
     * 先取得本次真实候选并准备舞台封面，完成后只提交一次批次，避免本地占位批次和联网结果连续跳换。
     * 平台失败时仍可使用当前曲库；请求被替换或页面卸载后不再进入动画。
     * 只有没有任何可展示歌曲时才反馈平台失败，不展示推荐规则和候选数量等内部过程。
     */
    async function prepareBatch() {
      let online = []
      let failed = false
      if (
        sourceModes.online &&
        api?.onlineRecommendations &&
        Object.values(libraryRef.current.settings.musicProviders || { default: true }).some(value => value !== false)
      ) {
        try {
          const result = await api.onlineRecommendations({ batch: batchNumber, history: history.current })
          online = result.tracks
          failed = result.errors.length > 0
        } catch {
          failed = true
        }
      }
      if (version !== request.current) {
        return
      }
      const available = online.filter(
        track =>
          isTrackEnabled(track, libraryRef.current.settings) && libraryRef.current.onlineAvailability?.[track.id] !== false,
      )
      const next = buildRecommendations(libraryRef.current.tracks, available, {
        history: history.current,
        remoteSources: libraryRef.current.remoteSources,
      })
      if (failed && !next.length) {
        setRecommendationWarning("在线推荐暂不可用，请稍后重试。")
      }
      await preloadStageArtwork(next, controller.signal)
      if (version === request.current) {
        preparing.current = false
        setBatch(next)
        setRecommending(false)
      }
    }
    prepareBatch()
    return () => {
      request.current++
      controller.abort()
    }
  }, [api, sourceKey, batchNumber])
  useEffect(() => {
    if (
      preparing.current ||
      recommending ||
      rotation.phase !== "idle" ||
      rotation.tracks.length !== featured.length ||
      rotation.tracks.some((track, index) => track.id !== featured[index]?.id)
    ) {
      return
    }
    history.current = rememberRecommendationBatch(history.current, rotation.tracks)
  }, [rotation.phase, rotation.tracks, featured, recommending])
  const recent = useMemo(() => {
    const byId = new Map(library.tracks.map(track => [track.id, track]))
    return library.history
      .map(item => byId.get(item.id))
      .filter(Boolean)
      .slice(0, 5)
  }, [library.tracks, library.history])
  const playlists = library.playlists

  /**
   * 手动重新汇集三十首精选，严格排除最近五批并限制最近十批复用比例。
   * 只刷新推荐集合，不修改当前播放、收藏或队列；异步结果由请求版本隔离。
   * 加载和旋转期间忽略重复触发，当前批次会在新内容就绪后完整退场。
   */
  function changeBatch() {
    if (recommending || rotation.phase !== "idle") {
      return
    }
    history.current = rememberRecommendationBatch(history.current, rotation.tracks)
    setBatchNumber(value => value + 1)
  }

  /**
   * 从允许推荐的来源建立随机漫游队列，用户点击后才开始播放。
   * 洗牌只操作歌曲标识的副本，不改变文件夹分类、收藏或本地文件。
   */
  function wander() {
    const ids = library.tracks.filter(track => isRecommendationAllowed(track, library.remoteSources)).map(track => track.id)
    for (let index = ids.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1))
      ;[ids[index], ids[other]] = [ids[other], ids[index]]
    }
    if (ids.length) {
      onPlay(ids[0], ids)
    }
  }

  return (
    <div className="home-content">
      <div className="section-title">
        <div>
          <span className="eyebrow">A LITTLE MUSIC, A LITTLE YOU</span>
          <h1>今天，听点喜欢的。</h1>
        </div>
        <div className="section-title-actions">
          {sourceModes?.online && (
            <button className="outline-button" onClick={() => onOnline()}>
              <Cloud size={16} />
              在线音乐
            </button>
          )}
          {sourceModes?.local !== false && (
            <button className="outline-button" disabled={busy} onClick={onAddLocal}>
              <FolderPlus size={16} />
              导入本地音乐
            </button>
          )}
          {sourceModes?.remote !== false && (
            <button className="primary-button" disabled={busy} onClick={() => onAddRemote(true)}>
              <Server size={16} />
              添加远程音乐
            </button>
          )}
        </div>
      </div>
      <div className="home-layout">
        <div className="home-main">
          <div className="featured-wrap">
            <CoverStage
              loading={recommending}
              tracks={rotation.tracks}
              phase={rotation.phase}
              onPhaseComplete={rotation.completePhase}
              currentId={currentId}
              playing={playing}
              onPlay={onPlay}
              onToggle={onToggle}
              Cover={Cover}
            />
            <button
              className="change-batch"
              disabled={recommending || rotation.phase !== "idle" || (!sourceModes.online && library.tracks.length < 2)}
              onClick={changeBatch}
            >
              <RefreshCw size={13} className={recommending ? "spin" : ""} />
              换一批
            </button>
            <span className="visually-hidden" role="status">
              {batchNumber && rotation.phase === "idle" && !recommending ? `已更换第 ${batchNumber} 批精选封面` : ""}
            </span>
          </div>
          {recommendationWarning && (
            <p className="recommendation-note" role="status">
              {recommendationWarning}
            </p>
          )}
          <ThemeShelf compact onOpen={id => onNavigate("theme", id)} onAll={() => onNavigate("themes")} />
          <section className="playlist-section">
            <div className="playlist-section-title">
              <div>
                <h2>
                  你的歌单<span>{playlists.length}</span>
                </h2>
                <p>收藏你的选择，留住喜欢的旋律。</p>
              </div>
              <div>
                <button className="text-button" disabled={busy} onClick={() => onCreatePlaylist()}>
                  <ListMusic size={14} />
                  创建歌单
                </button>
                <button className="text-button" disabled={!library.tracks.length} onClick={wander}>
                  <Shuffle size={14} />
                  随心漫游
                </button>
                <button
                  className="icon-button"
                  aria-label="重新扫描音乐库"
                  title="重新扫描音乐库"
                  disabled={busy}
                  onClick={onScan}
                >
                  <RefreshCw size={16} />
                </button>
              </div>
            </div>
            {!playlists.length ? (
              <div className="empty-state">
                <ListMusic size={30} />
                <h3>还没有歌单</h3>
                <button className="outline-button" disabled={busy} onClick={() => onCreatePlaylist()}>
                  创建歌单
                </button>
              </div>
            ) : (
              <div className="playlist-grid">
                {playlists.map(playlist => (
                  <article key={playlist.id} className="playlist-card">
                    <div className="playlist-cover-wrap">
                      <button
                        className="playlist-cover-button"
                        onClick={() => onNavigate("playlist", playlist.id)}
                        aria-label={`打开歌单 ${playlist.name}`}
                      >
                        <Cover playlist={playlist} />
                        <span className="track-count">
                          <ListMusic size={12} />
                          {playlist.trackIds.length}
                        </span>
                      </button>
                      <button
                        className="card-play"
                        disabled={!playlist.trackIds.length}
                        aria-label={`播放歌单 ${playlist.name}`}
                        onClick={() => onPlay(playlist.trackIds[0], playlist.trackIds)}
                      >
                        <Play size={19} fill="currentColor" />
                      </button>
                    </div>
                    <button className="playlist-name" onClick={() => onNavigate("playlist", playlist.id)}>
                      {playlist.name}
                    </button>
                    <p title={playlist.relative}>
                      我创建的歌单<span>{playlist.trackIds.length} 首</span>
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>
          <footer className="home-footer">Cinder · 让音乐回到生活里</footer>
        </div>
        <aside className="home-rail">
          <section className="recent-section">
            <div className="rail-heading">
              <h2>接着听</h2>
              <button className="text-button" onClick={() => onNavigate("recent")} aria-label="查看全部最近播放">
                <ArrowRight size={17} />
              </button>
            </div>
            <p className="rail-description">那些刚刚陪过你的旋律</p>
            <div className="recent-tracks">
              {(recent.length ? recent : featured.slice(0, 4)).map(track => (
                <button
                  key={track.id}
                  className={`recent-track ${track.id === currentId ? "is-current" : ""}`}
                  onClick={() =>
                    onPlay(
                      track.id,
                      (recent.length ? recent : featured).map(item => item.id),
                    )
                  }
                >
                  <span className="recent-art">
                    <Cover track={track} />
                    <span>
                      {track.id === currentId && playing ? (
                        <PlaybackIndicator playing={playing} />
                      ) : (
                        <Play size={15} fill="currentColor" />
                      )}
                    </span>
                  </span>
                  <span>
                    <b>{track.title}</b>
                    <small>
                      <MusicSourceIcon track={track} />
                      {track.artist}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </section>
          <section className="library-summary">
            <span className="summary-icon">
              <Disc3 size={20} />
            </span>
            <h2>只属于你的音乐库</h2>
            <p>本地、远程与在线音乐，都在这里。</p>
            <div className="summary-stats">
              <span>
                <b>{library.stats.tracks.toLocaleString()}</b>首歌曲
              </span>
              <span>
                <b>{library.stats.playlists}</b>个歌单
              </span>
              <span>
                <b>{library.stats.lossless.toLocaleString()}</b>首无损
              </span>
            </div>
            <button className="summary-link" onClick={() => onAddRemote(false)}>
              <Server size={15} />
              管理远程音乐
              <ChevronRight size={15} />
            </button>
          </section>
          <div className="listening-note">
            <span>FIND YOUR OWN RHYTHM</span>
            <p>
              把时间留给自己，
              <br />
              把心情交给音乐。
            </p>
            <i />
          </div>
        </aside>
      </div>
    </div>
  )
}

export default memo(MusicHome)
