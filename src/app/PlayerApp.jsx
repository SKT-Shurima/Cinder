/**
 * 装配曲库、导航和播放器的独立模型，仅协调跨功能动作与顶层布局。
 * 播放器生命周期、数据订阅与弹窗状态由各自 Hook 管理，浏览页面不会重建音频。
 */
import React, { useCallback, useEffect, useState } from "react"
import { LoaderCircle } from "lucide-react"
import api from "@/shared/desktop/desktopApi.js"
import brandIcon from "@/assets/brand-icon.png"
import WindowControls from "@/shared/desktop/components/WindowControls.jsx"
import LibrarySidebar from "./components/LibrarySidebar.jsx"
import AppHeader from "./components/AppHeader.jsx"
import PlayerRoutes from "./components/PlayerRoutes.jsx"
import PlayerOverlays from "./components/PlayerOverlays.jsx"
import useAppNavigation from "./hooks/useAppNavigation.js"
import useLibrarySnapshot from "@/features/library/hooks/useLibrarySnapshot.js"
import useLibraryView from "@/features/library/hooks/useLibraryView.js"
import useLibraryActions from "@/features/library/hooks/useLibraryActions.js"
import useUserPlaylists from "@/features/library/hooks/useUserPlaylists.js"
import useAudioPlayer from "@/features/playback/hooks/useAudioPlayer.js"
import useLyrics from "@/features/playback/hooks/useLyrics.js"
import usePlayerShortcuts from "@/features/playback/hooks/usePlayerShortcuts.js"
import useArtwork from "@/features/artwork/hooks/useArtwork.js"
import useSettings from "@/features/settings/hooks/useSettings.js"
import useAppearance from "@/features/settings/hooks/useAppearance.js"
import NowPlayingPanel from "@/features/playback/components/NowPlayingPanel.jsx"
import PlayerBar from "@/features/playback/components/PlayerBar.jsx"
import "@/styles/index.css"
import "@/features/library/library.css"
import "@/features/accounts/accounts.css"

/**
 * 组合当前工作区的数据模型和功能视图，对公共错误使用统一的短时消息提示。
 * 所有 Hook 无条件装配；曲库读取完成后才挂载媒体元素，初始会话保持暂停。
 */
export default function PlayerApp() {
  const [toast, setToast] = useState("")
  /**
   * 仅显示用户能处理的业务错误，去掉 IPC 的内部包装，不向界面泄露调用栈。
   */
  const report = useCallback(
    error => setToast(String(error?.message || error).replace(/^Error invoking remote method '[^']+': Error: /, "")),
    [],
  )
  useEffect(() => {
    if (!toast) {
      return
    }
    const timer = setTimeout(() => setToast(""), 7000)
    return () => clearTimeout(timer)
  }, [toast])

  const store = useLibrarySnapshot(api, report)
  const { library, setLibrary, status, initialized, initialSnapshot, refresh } = store
  const busy = status.phase !== "idle"
  const navigation = useAppNavigation({ api, busy, onlineEnabled: library?.settings.musicSources?.online !== false })
  const catalog = useLibraryView({ api, library, navigation })
  const settings = useSettings({ api, setLibrary, onError: report })
  const resolvedTheme = useAppearance(library?.settings)
  const player = useAudioPlayer({
    api,
    library,
    setLibrary,
    tracksById: catalog.tracksById,
    viewTracks: catalog.viewTracks,
    initialSnapshot,
    initialized,
    updateSettings: settings.updateSettings,
    onError: report,
  })
  const userPlaylists = useUserPlaylists({ api, library, refresh, onNavigate: navigation.navigate, onError: report })
  const artwork = useArtwork({ api, tracksById: catalog.tracksById, setLibrary, refresh, onError: report, onNotice: setToast })
  const libraryActions = useLibraryActions({ api, tracksById: catalog.tracksById, setLibrary, refresh, onError: report })
  const { action, favorite } = libraryActions
  const detailOpen = navigation.nowOpen && Boolean(player.current)
  const { lyrics, retryLyrics } = useLyrics(api, player.currentId, detailOpen)

  /**
   * 详情只在已有歌曲时展开，切换前先收起队列，不影响当前列表、进度和播放状态。
   */
  const showNowPlaying = useCallback(
    (expanded = true) => {
      if (expanded && !player.current) {
        return
      }
      navigation.setQueueOpen(false)
      navigation.setNowOpen(expanded)
    },
    [player.current, navigation.setQueueOpen, navigation.setNowOpen],
  )
  /**
   * 为键盘和面板共用稳定的收起入口，避免播放秒数变化时重复绑定监听。
   */
  const closeDetails = useCallback(() => showNowPlaying(false), [showNowPlaying])
  usePlayerShortcuts({
    api,
    player,
    navigation,
    artworkOpen: Boolean(artwork.coverTrack),
    playlistOpen: Boolean(userPlaylists.editor),
    closeDetails,
  })

  /**
   * 播放搜索中明确选择的一首歌，保留单首队列并结束当前输入筛选。
   */
  const searchTrack = useCallback(
    id => {
      navigation.setQuery("")
      player.playDiscovered(id, [id])
    },
    [navigation.setQuery, player.playDiscovered],
  )
  /**
   * 进入用户明确选择的歌单，只切换浏览集合，不重新开始播放。
   */
  const searchPlaylist = useCallback(id => navigation.navigate("playlist", id), [navigation.navigate])
  /**
   * 按歌手标识进入作品页，稳定入口避免播放更新扰动整批歌手卡片。
   */
  const openArtist = useCallback(id => navigation.navigate("artist", id), [navigation.navigate])

  if (!library) {
    return (
      <div className="boot">
        <div className="brand-icon">
          <img src={brandIcon} alt="" />
        </div>
        <h1>Cinder</h1>
        <LoaderCircle className="spin" size={22} />
        <p>正在打开你的音乐世界</p>
        {toast && <p>{toast}</p>}
      </div>
    )
  }
  const { page, selectedId, query, searchComposing, queueOpen, soundOpen, navigate } = navigation
  const { visibleLibrary, sourceModes, artists, musicSearch, pageTitle, favorites } = catalog
  const { currentId, current, playing, displayedPosition, duration, volume, mode, sound, queueTracks } = player

  return (
    <div className="app-shell">
      <audio ref={player.deckA} crossOrigin="anonymous" preload="metadata" />
      <audio ref={player.deckB} crossOrigin="anonymous" preload="metadata" />
      <LibrarySidebar
        page={page}
        selectedId={selectedId}
        library={visibleLibrary}
        sourceModes={sourceModes}
        status={status}
        busy={busy}
        artists={artists.length}
        onNavigate={navigate}
        onOnline={navigation.openOnlineLibrary}
        onRemote={navigation.openRemoteLibrary}
        onAdd={userPlaylists.open}
        onMissing={() => {
          navigate("songs")
          navigation.setOnlyMissing(true)
        }}
        windowControls={!api.nativeWindowControls && <WindowControls onError={report} />}
      />
      <div className="workspace">
        <AppHeader
          page={page}
          pageTitle={pageTitle}
          detailOpen={detailOpen}
          resolvedTheme={resolvedTheme}
          sourceModes={sourceModes}
          onBack={() => navigate(page === "artist" ? "artists" : page === "theme" ? "themes" : "home")}
          onThemeChange={() => settings.updateSettings({ theme: resolvedTheme === "dark" ? "light" : "dark" })}
          onSettings={() => navigate("settings")}
          search={{
            query,
            onChange: navigation.setQuery,
            tracks: musicSearch.tracks,
            playlists: visibleLibrary.playlists,
            loading: musicSearch.loading,
            errors: musicSearch.errors,
            composing: searchComposing,
            onComposition: navigation.setSearchComposing,
            onSearch: navigation.searchAll,
            onTrack: searchTrack,
            onPlaylist: searchPlaylist,
          }}
        />
        {busy && (
          <div className="task-banner" role="status">
            <LoaderCircle size={15} className="spin" />
            <span>
              {status.phase === "scrape" ? "正在刮削封面" : status.phase === "connect" ? "正在连接服务器" : "正在扫描音乐"}{" "}
              <b>
                {status.done} / {status.total || "…"}
              </b>
              <span className="task-song"> · {status.message}</span>
            </span>
            <div className="task-meter">
              <i style={{ width: `${status.total ? (status.done / status.total) * 100 : 0}%` }} />
            </div>
            {status.phase === "scrape" && <button onClick={() => action(api.stopScrape)}>停止</button>}
          </div>
        )}
        <PlayerRoutes
          api={api}
          library={library}
          navigation={navigation}
          catalog={catalog}
          player={player}
          artwork={artwork}
          userPlaylists={userPlaylists}
          settings={settings}
          actions={{ ...libraryActions, openArtist }}
          detailOpen={detailOpen}
          busy={busy}
          refresh={refresh}
          report={report}
        />
        {current && (
          <NowPlayingPanel
            model={{
              track: current,
              open: detailOpen,
              playing,
              volume,
              position: displayedPosition,
              duration,
              lyrics,
              liked: favorites.includes(currentId),
            }}
            actions={{
              close: closeDetails,
              toggle: player.toggle,
              favorite: () => favorite(currentId),
              artwork: () => artwork.openCover(current),
              reveal: () => action(() => api.reveal(currentId)),
              getAnalyser: player.getWaveAnalyser,
              releaseAnalyser: player.releaseWaveAnalyser,
              scrubBegin: player.beginScrub,
              scrubPreview: player.previewScrub,
              scrubCommit: player.commitScrub,
              scrubCancel: player.cancelScrub,
              seek: player.seek,
              retryLyrics,
            }}
          />
        )}
      </div>
      <PlayerBar
        model={{
          track: current,
          playing,
          position: displayedPosition,
          duration,
          volume,
          mode,
          detailOpen,
          liked: favorites.includes(currentId),
          playable: Boolean(visibleLibrary.tracks.length),
          soundEnabled: sound.enabled,
          soundOpen,
          queueOpen,
          queueCount: queueTracks.length,
        }}
        actions={{
          details: () => showNowPlaying(!detailOpen),
          favorite: () => favorite(currentId),
          mode: player.setMode,
          step: player.step,
          toggle: player.toggle,
          scrubCommit: player.commitScrub,
          scrubBegin: player.beginScrub,
          scrubPreview: player.previewScrub,
          scrubCancel: player.cancelScrub,
          sound: () => {
            navigation.setQueueOpen(false)
            navigation.setSoundOpen(value => !value)
          },
          queue: () => {
            navigation.setSoundOpen(false)
            navigation.setQueueOpen(value => !value)
          },
          volume: (value, persist = false) => {
            player.setVolume(value)
            if (persist) {
              settings.updateSettings({ volume: value })
            }
          },
        }}
      />
      <PlayerOverlays
        api={api}
        navigation={navigation}
        catalog={catalog}
        player={player}
        artwork={artwork}
        userPlaylists={userPlaylists}
        action={action}
        toast={toast}
        onDismissToast={() => setToast("")}
      />
    </div>
  )
}
