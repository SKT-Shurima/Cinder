/**
 * 提供统一的用户歌单创建、加入与管理弹层，名称和成员均由用户主动确认。
 * 本组件不直接调用桌面接口，提交状态和业务错误由歌单用例 Hook 提供。
 */
import React, { useRef, useState } from "react"
import { ListMusic, LoaderCircle, X } from "lucide-react"
import IconButton from "@/shared/ui/IconButton.jsx"
import useDialogFocus from "@/shared/hooks/useDialogFocus.js"

/**
 * 展示可选择的个人歌单或名称输入，并为删除提供明确的二次确认。
 * 取消不创建记录；保存时禁止重复点击，名称输入保留空格等正常文字编辑行为。
 */
export default function PlaylistDialog({ model, playlists }) {
  const { editor, pending, error, close, save, remove } = model
  const container = useRef(null)
  useDialogFocus(container, close)
  const [name, setName] = useState(editor.playlist?.name || "")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const editing = editor.mode === "edit"
  const adding = editor.mode === "add"
  const title = confirmDelete ? "删除这个歌单？" : editing ? "管理歌单" : adding ? "加入歌单" : "创建歌单"
  return (
    <div
      className="modal-backdrop"
      onMouseDown={event => {
        if (event.currentTarget === event.target) {
          close()
        }
      }}
    >
      <section
        ref={container}
        className="cover-modal user-playlist-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-playlist-title"
      >
        <header className="modal-heading">
          <h2 id="user-playlist-title">{title}</h2>
          <IconButton icon={X} label="关闭歌单窗口" disabled={pending} onClick={close} />
        </header>
        {confirmDelete ? (
          <>
            <p>删除“{editor.playlist.name}”，歌曲仍保留在音乐库。</p>
            <div className="settings-buttons">
              <button className="primary-button" disabled={pending} onClick={remove}>
                确认删除
              </button>
              <button className="outline-button" disabled={pending} onClick={() => setConfirmDelete(false)}>
                返回
              </button>
            </div>
          </>
        ) : (
          <>
            {adding && (
              <p className="playlist-selected-track">
                {editor.track.title} · {editor.track.artist}
              </p>
            )}
            {adding && playlists.length > 0 && (
              <div className="user-playlist-choices">
                {playlists.map(playlist => (
                  <button key={playlist.id} disabled={pending} onClick={() => save({ id: playlist.id })}>
                    <ListMusic size={17} />
                    <span>{playlist.name}</span>
                    <small>{playlist.trackIds.length} 首</small>
                  </button>
                ))}
              </div>
            )}
            <form
              onSubmit={event => {
                event.preventDefault()
                save({ ...(editing ? { id: editor.playlist.id } : {}), name })
              }}
            >
              <label>
                {adding ? "或创建新歌单" : "歌单名称"}
                <input
                  autoFocus
                  required
                  maxLength={64}
                  aria-label="歌单名称"
                  placeholder="给歌单起个名字"
                  value={name}
                  disabled={pending}
                  onChange={event => setName(event.target.value)}
                />
              </label>
              <div className="settings-buttons">
                <button type="submit" className="primary-button" disabled={pending || !name.trim()}>
                  {pending && <LoaderCircle size={15} className="spin" />}
                  {editing ? "保存" : adding ? "创建并加入" : "创建"}
                </button>
                <button type="button" className="outline-button" disabled={pending} onClick={close}>
                  取消
                </button>
                {editing && (
                  <button type="button" className="text-button" disabled={pending} onClick={() => setConfirmDelete(true)}>
                    删除歌单
                  </button>
                )}
              </div>
            </form>
          </>
        )}
        {error && (
          <p role="alert" className="connection-feedback has-error">
            {error}
          </p>
        )}
      </section>
    </div>
  )
}
