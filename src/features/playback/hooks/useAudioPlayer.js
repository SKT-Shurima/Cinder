import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AudioEffectsEngine } from "@/features/playback/audio/audioEffectsEngine.js"
import { PlaybackController } from "@/features/playback/audio/playbackController.js"
import { isTrackEnabled } from "@/features/library/model/libraryVisibility.js"
import { artworkAddress as coverUrl } from "@/shared/media/trackPresentation.js"
import { normalizeMusicSources } from "#shared/musicSources"
import { normalizeSound } from "#shared/audioSettings"
import usePlaybackPersistence from "./usePlaybackPersistence.js"
import useDesktopPlaybackState from "./useDesktopPlaybackState.js"

/**
 * 管理同一播放器的队列、双声部控制器、进度拖动、音效与系统播放状态。
 * 初始快照只恢复一次且保持暂停；界面导航不重建音频节点，卸载时统一销毁控制器和声音资源。
 * 在线准备使用请求版本丢弃迟到结果，拖动会话绑定歌曲标识，避免旧位置或旧授权抢占新歌曲。
 */
export default function useAudioPlayer({
  api,
  library,
  setLibrary,
  tracksById,
  viewTracks,
  initialSnapshot,
  initialized,
  updateSettings,
  onError: report,
}) {
  const [currentId, setCurrentId] = useState(null)
  const [queue, setQueue] = useState([])
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [scrubPosition, setScrubPosition] = useState(null)
  const scrubSession = useRef(null)
  const currentTrackIdentity = useRef(currentId)
  currentTrackIdentity.current = currentId
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.7)
  const [mode, setMode] = useState("list")
  const [sound, setSound] = useState(() => normalizeSound())
  const effects = useRef(null)
  const persistedSound = useRef(JSON.stringify(normalizeSound()))
  const audio = useRef(null)
  const deckA = useRef(null)
  const deckB = useRef(null)
  const playback = useRef(null)
  const advanceTrack = useRef(null)
  const playRequested = useRef(false)
  const onlinePlaybackVersion = useRef(0)
  const onlineStreamErrors = useRef(new Map())
  const resumePosition = useRef(0)

  const current = tracksById.get(currentId)
  const sourceModes = useMemo(() => normalizeMusicSources(library?.settings.musicSources), [library?.settings.musicSources])
  /**
   * 首次快照恢复音量、音效与播放队列，后续刷新交由曲库订阅 Hook 合并。
   * 上次歌曲按暂停状态恢复，保存位置只在媒体控制器选中该曲后消费。
   */
  const restoreSession = useCallback(snapshot => {
    const { player, settings } = snapshot
    setVolume(settings.volume ?? 0.7)
    setMode(player.mode ?? "list")
    const restored = normalizeSound(settings.soundEffects)
    setSound(restored)
    persistedSound.current = JSON.stringify(restored)
    setQueue(player.queue ?? [])
    setCurrentId(player.trackId ?? null)
    resumePosition.current = player.position ?? 0
  }, [])

  useEffect(() => {
    if (initialSnapshot) {
      restoreSession(initialSnapshot)
    }
  }, [initialSnapshot, restoreSession])
  usePlaybackPersistence(api, { trackId: currentId, queue, position, mode }, initialized, report)
  useEffect(() => {
    for (const element of [deckA.current, deckB.current]) {
      if (element) {
        element.volume = volume
      }
    }
  }, [volume, Boolean(library)])
  useEffect(() => {
    if (currentId && (!current || !isTrackEnabled(current, library?.settings))) {
      playback.current?.pause()
    }
  }, [sourceModes.local, sourceModes.remote, sourceModes.online, library?.settings.musicProviders, currentId, Boolean(current)])
  useEffect(
    () =>
      api.onOnlinePlaybackError?.(failure => {
        onlineStreamErrors.current.set(failure.id, failure.message)
        if (onlineStreamErrors.current.size > 50) {
          onlineStreamErrors.current.delete(onlineStreamErrors.current.keys().next().value)
        }
        if (failure.id === currentTrackIdentity.current) {
          report(failure.message)
        }
      }),
    [report],
  )
  useEffect(() => {
    if (current?.sourceId) {
      api.remoteMetadata(currentId).catch(() => {})
    }
  }, [currentId, current?.sourceId])
  const plannedNext = useMemo(() => {
    const ids = (queue.length ? queue : viewTracks.map(track => track.id)).filter(id =>
      isTrackEnabled(tracksById.get(id), library?.settings),
    )
    if (!ids.length || mode === "one") {
      return null
    }
    const choices = ids.filter(id => id !== currentId)
    return mode === "shuffle" && choices.length
      ? choices[Math.floor(Math.random() * choices.length)]
      : ids[(ids.indexOf(currentId) + 1) % ids.length]
  }, [queue, viewTracks, tracksById, currentId, mode, library?.settings.musicSources])

  /**
   * 播放指定歌曲并可按当前列表替换队列。
   * 切歌时清零上次位置，新曲就绪后与旧曲交叉淡化；再次选择当前歌曲则结束重叠并从头播放。
   */
  const playTrack = useCallback(
    (id, ids) => {
      if (!isTrackEnabled(tracksById.get(id), library?.settings)) {
        return
      }
      onlinePlaybackVersion.current++
      onlineStreamErrors.current.delete(id)
      if (ids) {
        setQueue(ids)
      }
      playRequested.current = true
      resumePosition.current = 0
      if (id === currentId && audio.current) {
        playback.current?.seek(0)
        playback.current?.play()
      } else {
        setPosition(0)
        setDuration(0)
        setCurrentId(id)
      }
      api
        .played(id)
        .then(history => setLibrary(value => (value ? { ...value, history } : value)))
        .catch(report)
    },
    [tracksById, currentId, report, library?.settings.musicSources],
  )

  /**
   * 把搜索或推荐的混合资源接入统一队列，在线播放前先验证真实音频。
   * 准备失败保持原曲；连续选择或随后播放本地音乐时丢弃过期准备，避免迟到请求抢播。
   * 百首主题队列拆成每批不超过一百首的固定入库命令，超出旧入口限制时也不先开始播放。
   */
  const startOnlinePlayback = useCallback(
    async (id, ids) => {
      const revision = ++onlinePlaybackVersion.current
      const selected = tracksById.get(id)
      if (!selected || selected.kind === "online") {
        await api.onlinePrepare(id)
      }
      if (revision !== onlinePlaybackVersion.current) {
        return
      }
      const selectedIds = [...new Set([...(ids || [id]), id])]
      const onlineIds = selectedIds.filter(value => !tracksById.has(value) || tracksById.get(value).kind === "online")
      for (let start = 0; start < onlineIds.length; start += 100) {
        const result = await api.onlineAdd(onlineIds.slice(start, start + 100))
        if (revision !== onlinePlaybackVersion.current) {
          return
        }
        setLibrary(result.library)
      }
      setQueue(selectedIds)
      onlineStreamErrors.current.delete(id)
      playRequested.current = true
      resumePosition.current = 0
      if (id === currentTrackIdentity.current) {
        playback.current?.seek(0)
        playback.current?.play()
      } else {
        setPosition(0)
        setDuration(0)
        setCurrentId(id)
      }
      api
        .played(id)
        .then(history => setLibrary(value => (value ? { ...value, history } : value)))
        .catch(report)
    },
    [report, tracksById],
  )

  /**
   * 接收首页与全局搜索的混合歌曲列表，尚未入库的在线记录先经主进程校验。
   * 常规曲库播放保持同步路径；异步资源失败由统一提示反馈，原曲继续播放。
   */
  const playDiscovered = useCallback(
    (id, ids) => {
      if ((ids || [id]).some(value => !tracksById.has(value))) {
        startOnlinePlayback(id, ids).catch(report)
      } else {
        playTrack(id, ids)
      }
    },
    [tracksById, startOnlinePlayback, playTrack, report],
  )

  /**
   * 把单首在线资源追加到现有本地、远程或在线混合队列，不跳转当前播放位置。
   * 歌曲对象由主进程的已知搜索结果决定，界面只传入稳定标识。
   */
  const appendOnlineQueue = useCallback(async id => {
    const result = await api.onlineAdd([id])
    setLibrary(result.library)
    setQueue(value => (value.includes(id) ? value : [...value, id]))
  }, [])

  /**
   * 根据队列切换相邻歌曲，结束事件遵循单曲或列表循环设置。
   * 随机模式排除当前歌曲，只有一首时允许重复；缺失的索引条目自动过滤。
   */
  const step = useCallback(
    (direction = 1, ended = false) => {
      const ids = (queue.length ? queue : viewTracks.map(track => track.id)).filter(id =>
        isTrackEnabled(tracksById.get(id), library?.settings),
      )
      if (!ids.length) {
        return
      }
      if (ended && mode === "one" && currentId) {
        playback.current?.seek(0)
        playback.current?.play()
        return
      }
      const index = ids.indexOf(currentId)
      const choices = ids.filter(id => id !== currentId)
      const id =
        direction === 1 && plannedNext
          ? plannedNext
          : mode === "shuffle" && choices.length
            ? choices[Math.floor(Math.random() * choices.length)]
            : ids[(index + direction + ids.length) % ids.length]
      playTrack(id, ids)
    },
    [queue, viewTracks, tracksById, currentId, mode, playTrack, plannedNext, library?.settings.musicSources],
  )
  advanceTrack.current = () => step(1, true)

  /**
   * 响应播放按钮和空格快捷键，首次播放采用当前列表第一首。
   * 已暂停的歌曲从原位置继续；浏览歌单时不会隐式更换现有队列。
   */
  const toggle = useCallback(() => {
    onlinePlaybackVersion.current++
    if (!isTrackEnabled(current, library?.settings)) {
      if (viewTracks[0]) {
        playDiscovered(
          viewTracks[0].id,
          viewTracks.map(track => track.id),
        )
      }
      return
    }
    if (audio.current?.paused) {
      playback.current?.play()
    } else {
      playback.current?.pause()
    }
  }, [current, viewTracks, playDiscovered, report, library?.settings.musicSources])

  useDesktopPlaybackState(
    api,
    {
      playing,
      canToggle: playing || isTrackEnabled(current, library?.settings) || isTrackEnabled(viewTracks[0], library?.settings),
      canSkip: queue.length
        ? queue.some(id => isTrackEnabled(tracksById.get(id), library?.settings))
        : viewTracks.some(track => isTrackEnabled(track, library?.settings)),
    },
    report,
  )

  /**
   * 将播放器跳到有效音频范围内，用于拖动进度条和点击同步歌词。
   * 定位前收束交叉淡化；目标仍在加载时忽略 seek，避免旧歌曲跳到新歌曲的位置。
   */
  const seek = useCallback(value => {
    const actual = playback.current?.seek(value)
    if (Number.isFinite(actual)) {
      setPosition(actual)
    }
  }, [])

  /**
   * 开始拖动播放进度时暂停音频，记住当前歌曲和原来的播放状态。
   * 拖动期间不修改音频时间，防止频繁 seek 发声或反复请求远程音频片段。
   */
  const beginScrub = useCallback(() => {
    const element = audio.current
    if (!element || !currentTrackIdentity.current || scrubSession.current) {
      return
    }
    scrubSession.current = { id: currentTrackIdentity.current, playing: !element.paused }
    setScrubPosition(element.currentTime || 0)
    playback.current?.pause()
  }, [])

  /**
   * 只预览待跳转秒数，让两处进度和歌词定位保持一致，不调用媒体 seek 或 play。
   * 原生范围输入负责限制数值范围，非有限输入直接忽略。
   */
  const previewScrub = useCallback(value => {
    if (Number.isFinite(value)) {
      setScrubPosition(Math.max(0, value))
    }
  }, [])

  /**
   * 松手或松开方向键后提交一次最终位置，并恢复拖动前的播放或暂停状态。
   * 拖动中已经切歌时丢弃旧会话，避免旧位置与旧播放状态覆盖新歌曲。
   */
  const commitScrub = useCallback(
    value => {
      const session = scrubSession.current
      scrubSession.current = null
      setScrubPosition(null)
      if (session && session.id !== currentTrackIdentity.current) {
        return
      }
      seek(value)
      if (session?.playing && audio.current) {
        playback.current?.play()
      }
    },
    [seek],
  )

  /**
   * 取消拖动时退出预览，音频保持原位置，并只在同一首歌曲原本播放时继续。
   * 控件卸载或 Escape 同样使用此边界，不会恢复已被用户切走的歌曲。
   */
  const cancelScrub = useCallback(() => {
    const session = scrubSession.current
    scrubSession.current = null
    setScrubPosition(null)
    if (session?.playing && session.id === currentTrackIdentity.current && audio.current) {
      playback.current?.play()
    }
  }, [])
  useEffect(() => {
    if (scrubSession.current && scrubSession.current.id !== currentId) {
      scrubSession.current = null
      setScrubPosition(null)
    }
  }, [currentId])

  useEffect(() => {
    if (!library || !deckA.current || !deckB.current) {
      return
    }
    const engine = new AudioEffectsEngine([deckA.current, deckB.current], report)
    effects.current = engine
    const controller = new PlaybackController([deckA.current, deckB.current], engine, {
      audioRef: audio,
      playRequested,
      onState: value => {
        setPosition(value.position)
        setDuration(value.duration)
        setPlaying(value.playing)
        if ("mediaSession" in navigator) {
          navigator.mediaSession.playbackState = value.playing ? "playing" : "paused"
        }
      },
      onAdvance: () => advanceTrack.current?.(),
      onError: (error, retainedId, failedId) => {
        if (retainedId) {
          setCurrentId(retainedId)
        } else {
          setPlaying(false)
        }
        report(onlineStreamErrors.current.get(failedId || currentTrackIdentity.current) || error)
      },
    })
    playback.current = controller
    return () => {
      controller.destroy()
      engine.destroy()
      effects.current = null
      playback.current = null
    }
  }, [Boolean(library), report])
  /**
   * 仅在当前歌曲已进入可播放快照后恢复声部，在线授权仍在检查时保留进度并等待。
   * 被隐藏的旧曲不会在启动时自动触发失败请求；授权恢复后可按原位置以暂停状态恢复。
   */
  useEffect(() => {
    if (!currentId || !current || !playback.current) {
      return
    }
    const savedPosition = resumePosition.current
    resumePosition.current = 0
    playback.current.setTrack(currentId, savedPosition)
  }, [currentId, Boolean(library), Boolean(current)])
  useEffect(() => {
    playback.current?.setNext(plannedNext)
  }, [plannedNext, Boolean(library)])
  useEffect(() => {
    effects.current?.apply(sound)
  }, [sound, Boolean(library)])
  useEffect(() => {
    const serialized = JSON.stringify(sound)
    if (!initialized.current || serialized === persistedSound.current) {
      return
    }
    const timer = setTimeout(() => {
      persistedSound.current = serialized
      updateSettings({ soundEffects: sound })
    }, 450)
    return () => clearTimeout(timer)
  }, [sound])

  useEffect(() => {
    if (!("mediaSession" in navigator) || !current) {
      return
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist,
      album: current.album,
      artwork: current.cover ? [{ src: coverUrl(current.cover) }] : [],
    })
    for (const [action, callback] of [
      ["play", () => playback.current?.play()],
      ["pause", () => playback.current?.pause()],
      ["previoustrack", () => step(-1)],
      ["nexttrack", () => step(1)],
      ["seekto", details => seek(details.seekTime)],
    ]) {
      try {
        navigator.mediaSession.setActionHandler(action, callback)
      } catch {}
    }
  }, [current, step, seek, report])

  /**
   * 为可见音浪请求同一音频链的真实分析节点，初始化失败时通过统一提示反馈。
   * 不创建第二个播放器，不下载或记录音频，原声与音效输出都可读取频谱。
   */
  const getWaveAnalyser = useCallback(() => {
    try {
      return effects.current?.getAnalyser()
    } catch (error) {
      report(error)
      return null
    }
  }, [report])

  /**
   * 详情收起、暂停或进入后台时停止频谱分支，继续保留当前播放与音效状态。
   * 回到详情后复用原节点，避免同一媒体元素重复关联音频源。
   */
  const releaseWaveAnalyser = useCallback(() => effects.current?.releaseAnalyser(), [])

  /**
   * 实时试听有限范围内的音色参数，拖动过程中不反复写入整份音乐库。
   * 预览状态跨面板保留，停止调整 450 毫秒后合并保存，松手或明确提交时立即保存。
   */
  function previewSound(value) {
    setSound(normalizeSound(value))
  }

  /**
   * 应用预设或用户提交的自定义音效，同时持久化所有相关字段。
   * 配置保存失败沿用统一错误提示，已开始的音频播放不重新加载。
   */
  function commitSound(value) {
    const next = normalizeSound(value)
    persistedSound.current = JSON.stringify(next)
    setSound(next)
    updateSettings({ soundEffects: next })
  }

  /**
   * 接收主进程或系统媒体会话的暂停指令，只影响当前控制器，不清空队列与保存位置。
   */
  const pause = useCallback(() => playback.current?.pause(), [])

  const queueTracks = useMemo(
    () => queue.map(id => tracksById.get(id)).filter(track => isTrackEnabled(track, library?.settings)),
    [queue, tracksById, library?.settings],
  )

  return {
    currentId,
    current,
    queue,
    queueTracks,
    playing,
    position,
    displayedPosition: scrubPosition ?? position,
    duration,
    volume,
    mode,
    sound,
    deckA,
    deckB,
    playTrack,
    startOnlinePlayback,
    playDiscovered,
    appendOnlineQueue,
    step,
    toggle,
    pause,
    seek,
    beginScrub,
    previewScrub,
    commitScrub,
    cancelScrub,
    setMode,
    setVolume,
    getWaveAnalyser,
    releaseWaveAnalyser,
    previewSound,
    commitSound,
  }
}
