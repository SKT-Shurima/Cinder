import React from "react"
import { X } from "lucide-react"
import IconButton from "@/shared/ui/IconButton.jsx"
import SoundEffects from "@/features/playback/components/SoundEffects.jsx"
import QueueDrawer from "@/features/playback/components/QueueDrawer.jsx"
import ArtworkDialog from "@/features/artwork/components/ArtworkDialog.jsx"
import AccountDialog from "@/features/accounts/components/AccountDialog.jsx"
import PlaylistDialog from "@/features/library/components/PlaylistDialog.jsx"

/**
 * 统一放置播放浮层、封面确认、歌单编辑和账号认证，弹窗业务状态由各功能 Hook 持有。
 * 只在明确打开时挂载认证与编辑内容，关闭后释放焦点和表单，不创建额外播放器。
 */
export default function PlayerOverlays({
  api,
  navigation,
  catalog,
  player,
  artwork,
  userPlaylists,
  action,
  toast,
  onDismissToast,
}) {
  const { soundOpen, queueOpen, loginProvider, setSoundOpen, setQueueOpen, closeAccountDialog } = navigation
  const { visibleLibrary, tracksById } = catalog
  const { currentId, playing, sound, queueTracks, playTrack, previewSound, commitSound } = player
  const { coverTrack, candidates, coverLoading, closeCover, searchCover, applyCover } = artwork
  const currentCoverTrack = coverTrack ? tracksById.get(coverTrack.id) || coverTrack : null
  return (
    <>
      {soundOpen && (
        <SoundEffects
          value={sound}
          onPreview={previewSound}
          onCommit={commitSound}
          onClose={() => {
            commitSound(sound)
            setSoundOpen(false)
          }}
        />
      )}

      {queueOpen && (
        <QueueDrawer
          tracks={queueTracks}
          currentId={currentId}
          playing={playing}
          onPlay={playTrack}
          onClose={() => setQueueOpen(false)}
        />
      )}
      {coverTrack && (
        <ArtworkDialog
          track={currentCoverTrack}
          result={candidates}
          loading={coverLoading}
          onClose={closeCover}
          onSearch={searchCover}
          onChooseFile={() => action(() => api.chooseCover("track", coverTrack.id))}
          onConfirm={applyCover}
          onSource={() => action(() => api.openSource(currentCoverTrack.id))}
        />
      )}

      {userPlaylists.editor && <PlaylistDialog model={userPlaylists} playlists={visibleLibrary.playlists} />}
      {loginProvider && <AccountDialog key={loginProvider} api={api} provider={loginProvider} onClose={closeAccountDialog} />}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <IconButton icon={X} label="关闭提示" onClick={onDismissToast} />
        </div>
      )}
    </>
  )
}
