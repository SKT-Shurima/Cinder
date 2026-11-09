/**
 * 将用户歌单弹层和桌面用例连接起来，主视图不直接维护创建及成员写入细节。
 * 浏览歌曲不会触发保存，只有明确确认创建、加入或编辑时才更新用户歌单。
 */
import { useCallback, useState } from "react"

/**
 * 协调用户歌单操作及失败反馈，保存完成后刷新快照但不改变播放队列。
 * 在线临时歌曲先登记元数据，已有歌曲直接引用；异步提交期间禁止重复操作和关闭弹层。
 */
export default function useUserPlaylists({ api, library, refresh, onNavigate, onError }) {
  const [editor, setEditor] = useState(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  /**
   * 打开创建或加入歌单入口，不预建空歌单，也不自动加入当前播放歌曲。
   */
  const open = useCallback((track = null) => {
    setError("")
    setEditor({ mode: track ? "add" : "create", track })
  }, [])
  /**
   * 编辑用户选中的歌单名称或删除状态，已有成员保持原样。
   */
  const edit = useCallback(playlist => {
    setError("")
    setEditor({ mode: "edit", playlist })
  }, [])
  /**
   * 取消未提交的编辑，不写入曲库；提交期间保留弹层直至结果返回。
   */
  const close = useCallback(() => {
    if (!pending) {
      setEditor(null)
    }
  }, [pending])
  /**
   * 保存明确选择的歌单及歌曲，成功后才关闭弹层并进入对应歌单。
   * 在线保存或名称校验失败时保留输入并显示原因，不以播放歌曲代替添加动作。
   */
  async function save(input) {
    if (pending) {
      return
    }
    setPending(true)
    setError("")
    try {
      const track = editor?.track
      if (track?.kind === "online" && !library.tracks.some(item => item.id === track.id)) {
        await api.onlineAdd([track.id])
      }
      const playlist = await api.playlistSave({ ...input, ...(track ? { addTrackIds: [track.id] } : {}) })
      await refresh()
      setEditor(null)
      onNavigate("playlist", playlist.id)
    } catch (failure) {
      setError(String(failure.message || failure).replace(/^Error invoking remote method '[^']+': Error: /, ""))
    } finally {
      setPending(false)
    }
  }
  /**
   * 删除已在弹层中二次确认的用户歌单，歌曲文件和正在播放的队列继续保留。
   * 失败时保留原编辑入口，成功后回到首页，避免停留在失效歌单页面。
   */
  async function remove() {
    if (pending) {
      return
    }
    setPending(true)
    setError("")
    try {
      await api.playlistRemove(editor.playlist.id)
      await refresh()
      setEditor(null)
      onNavigate("home")
    } catch (failure) {
      setError(String(failure.message || failure).replace(/^Error invoking remote method '[^']+': Error: /, ""))
    } finally {
      setPending(false)
    }
  }
  /**
   * 从用户正在浏览的歌单移除一首成员，不删除来源歌曲或取消收藏。
   * 空歌单继续保留，操作失败沿用全局错误提示。
   */
  async function removeTrack(playlistId, trackId) {
    try {
      await api.playlistSave({ id: playlistId, removeTrackIds: [trackId] })
      await refresh()
    } catch (failure) {
      onError(failure)
    }
  }
  return { editor, pending, error, open, edit, close, save, remove, removeTrack }
}
