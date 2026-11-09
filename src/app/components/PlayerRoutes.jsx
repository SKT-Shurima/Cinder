import React from "react"
import MusicHome from "@/features/library/components/MusicHome.jsx"
import ThemeMusicPage from "@/features/library/components/ThemeMusicPage.jsx"
import ArtistLibrary from "@/features/library/components/ArtistLibrary.jsx"
import LibraryCollection from "@/features/library/components/LibraryCollection.jsx"
import ArtistTracksStatus from "@/features/library/components/ArtistTracksStatus.jsx"
import OnlineLibrary from "@/features/accounts/components/OnlineLibrary.jsx"
import RemoteLibrary from "@/features/remote/components/RemoteLibrary.jsx"
import SettingsPage from "@/features/settings/components/SettingsPage.jsx"
import Cover from "@/shared/ui/CoverArt.jsx"

/**
 * 按导航状态装配音乐、主题、账号和设置页面，不管理音频或保存业务状态。
 * 详情展开时保留原页面并暂停交互，用户返回后继续沿用筛选和滚动位置。
 */
export default function PlayerRoutes({
  api,
  library,
  navigation,
  catalog,
  player,
  artwork,
  userPlaylists,
  settings,
  actions,
  detailOpen,
  busy,
  refresh,
  report,
}) {
  const {
    page,
    selectedId,
    query,
    songQuery,
    sort,
    onlyMissing,
    mainContent,
    remoteAddRequested,
    onlineProvider,
    settingsTab,
    artistLayoutSeed,
    navigate,
    openOnlineLibrary,
    openRemoteLibrary,
    configureOnlineLibrary,
    shuffleArtists,
    selectSettingsTab,
    setSongQuery,
    setOnlyMissing,
    setSort,
    setLoginProvider,
  } = navigation
  const {
    visibleLibrary,
    sourceModes,
    popularArtists,
    selectedArtist,
    selected,
    pageTitle,
    pageSummary,
    viewTracks,
    favorites,
    musicSearch,
    trackSearch,
    isSongPage,
  } = catalog
  const {
    currentId,
    playing,
    sound,
    playDiscovered,
    startOnlinePlayback,
    appendOnlineQueue,
    toggle,
    setMode,
    previewSound,
    commitSound,
  } = player
  const { openCover } = artwork
  const { updateSettings, previewAppearance } = settings
  const { action, favorite, addLocalMusic, scanLocalMusic, openArtist } = actions
  return (
    <main
      ref={mainContent}
      className={`main-content ${isSongPage ? "song-page" : ""} ${page === "online" ? "online-page" : ""} ${["themes", "theme"].includes(page) ? "theme-page" : ""}`}
      inert={detailOpen}
      aria-hidden={detailOpen}
    >
      {page === "home" && (
        <MusicHome
          api={api}
          library={visibleLibrary}
          sourceModes={sourceModes}
          onOnline={openOnlineLibrary}
          currentId={currentId}
          playing={playing}
          busy={busy}
          onPlay={playDiscovered}
          onToggle={toggle}
          onNavigate={navigate}
          onAddLocal={addLocalMusic}
          onAddRemote={openRemoteLibrary}
          onScan={scanLocalMusic}
          onCreatePlaylist={userPlaylists.open}
          Cover={Cover}
        />
      )}
      {["themes", "theme"].includes(page) && (
        <ThemeMusicPage
          key={`${page}:${selectedId}`}
          api={api}
          id={page === "theme" ? selectedId : null}
          library={library}
          onOpen={id => navigate("theme", id)}
          onBack={() => navigate("themes")}
          onConfigure={configureOnlineLibrary}
          onPlay={playDiscovered}
          onShuffle={ids => {
            setMode("shuffle")
            playDiscovered(ids[Math.floor(Math.random() * ids.length)], ids)
          }}
          table={{
            currentId,
            playing,
            favorites,
            onFavorite: favorite,
            onPlaylist: userPlaylists.open,
            onCover: openCover,
            onReveal: id => action(() => api.reveal(id)),
          }}
        />
      )}

      {page === "artists" && (
        <ArtistLibrary
          catalog={popularArtists}
          seed={artistLayoutSeed}
          onShuffle={shuffleArtists}
          onOpen={openArtist}
          onConfigure={configureOnlineLibrary}
        />
      )}
      {isSongPage && (
        <LibraryCollection
          page={page}
          title={pageTitle}
          summary={pageSummary}
          collection={page === "artist" ? selectedArtist : selected}
          tracks={viewTracks}
          filters={{ missing: onlyMissing, sort, query: songQuery }}
          onFilter={(field, value) => ({ missing: setOnlyMissing, sort: setSort, query: setSongQuery })[field](value)}
          onArtists={() => navigate("artists")}
          onPlay={playDiscovered}
          onShuffle={ids => {
            setMode("shuffle")
            playDiscovered(ids[Math.floor(Math.random() * ids.length)], ids)
          }}
          onCoverChange={() => action(() => api.chooseCover("playlist", selected.id))}
          onManagePlaylist={userPlaylists.edit}
          table={{
            currentId,
            playing,
            favorites,
            onFavorite: favorite,
            onPlaylist: userPlaylists.open,
            onCover: openCover,
            onReveal: id => action(() => api.reveal(id)),
            onRemoveFromPlaylist:
              page === "playlist" && selected?.kind === "user" ? id => userPlaylists.removeTrack(selected.id, id) : undefined,
            resetKey: `${page}:${selectedId}:${query}:${trackSearch}:${onlyMissing}:${sort}`,
          }}
          contentState={
            page === "artist" &&
            (popularArtists.loading ||
              popularArtists.error ||
              popularArtists.detail.loading ||
              popularArtists.detail.error ||
              !popularArtists.detail.tracks.length) ? (
              <ArtistTracksStatus
                loading={popularArtists.loading || popularArtists.detail.loading}
                error={popularArtists.error || popularArtists.detail.error}
                onRetry={popularArtists.retry}
                onConfigure={configureOnlineLibrary}
              />
            ) : null
          }
          searchStatus={
            page === "search" && (
              <div className="unified-search-status" role="status">
                <span>全部来源 · {musicSearch.tracks.length} 首匹配</span>
                <span>
                  {musicSearch.loading
                    ? "正在补充在线结果"
                    : musicSearch.errors.length
                      ? "部分在线平台暂不可用"
                      : "本地与远程匹配已索引的音乐"}
                </span>
              </div>
            )
          }
        />
      )}

      {page === "online" && sourceModes.online && (
        <OnlineLibrary
          onLogin={setLoginProvider}
          api={api}
          settings={library.settings}
          availability={library.onlineAvailability}
          initialProvider={onlineProvider}
          onConfigure={configureOnlineLibrary}
          onPlay={startOnlinePlayback}
          onQueue={appendOnlineQueue}
          onPlaylist={userPlaylists.open}
          currentId={currentId}
          playing={playing}
          onToggle={toggle}
          Cover={Cover}
        />
      )}

      {page === "remote" && (
        <div className="settings-content remote-page">
          <span className="eyebrow">YOUR MUSIC, ANYWHERE</span>
          <h1>远程音乐库</h1>
          <p className="remote-page-intro">连接后，远程歌曲会出现在“全部音乐”中。</p>
          <RemoteLibrary
            api={api}
            sources={library.remoteSources}
            busy={busy}
            onChanged={refresh}
            onError={report}
            initiallyOpen={remoteAddRequested || !library.remoteSources?.length}
          />
        </div>
      )}

      {page === "settings" && (
        <SettingsPage
          api={api}
          library={library}
          tab={settingsTab}
          onTab={selectSettingsTab}
          busy={busy}
          sound={sound}
          actions={{
            update: updateSettings,
            preview: previewAppearance,
            online: openOnlineLibrary,
            login: setLoginProvider,
            task: action,
            refresh,
            report,
            missing: () => {
              navigate("songs")
              setOnlyMissing(true)
            },
            soundPreview: previewSound,
            soundCommit: commitSound,
          }}
        />
      )}
    </main>
  )
}
