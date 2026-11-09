/**
 * 展示当前封面及多来源候选，候选检索和持久化由应用用例驱动。
 * 本组件不接受网络下载地址作为确认参数，用户只能选择后台返回的候选标识。
 */
import React, { useRef } from "react"
import { ArrowRight, ImagePlus, LoaderCircle, Search, X } from "lucide-react"
import CoverArt from "@/shared/ui/CoverArt.jsx"
import IconButton from "@/shared/ui/IconButton.jsx"
import useDialogFocus from "@/shared/hooks/useDialogFocus.js"
import { artworkAddress } from "@/shared/media/trackPresentation.js"

/**
 * 为已选歌曲提供封面来源核对、候选确认与本地图片选择入口。
 * 焦点被限制在弹层中，关闭后恢复触发控件；下载与持久化由应用层负责。
 */
export default function ArtworkDialog({ track, result, loading, onClose, onSearch, onChooseFile, onConfirm, onSource }) {
  const dialog = useRef(null)
  useDialogFocus(dialog, onClose)
  return (
    <div
      className="modal-backdrop"
      onMouseDown={event => {
        if (event.currentTarget === event.target) {
          onClose()
        }
      }}
    >
      <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="artwork-dialog-title" className="cover-modal">
        <header className="modal-heading">
          <div>
            <span className="eyebrow">ALBUM ARTWORK</span>
            <h2 id="artwork-dialog-title">为这首歌找到封面</h2>
          </div>
          <IconButton label="关闭封面匹配" icon={X} onClick={onClose} />
        </header>
        <div className="cover-current">
          <CoverArt track={track} />
          <div>
            <h3>{track.title}</h3>
            <p>
              {track.artist} · {track.album || "未知专辑"}
            </p>
            <span>
              {track.coverSource
                ? `当前来源：${track.coverSource.source}${track.coverSource.manual ? " · 手动确认" : ""}`
                : "尚未找到可靠封面"}
            </span>
            {track.coverSource?.sourceUrl && (
              <button className="text-button" onClick={onSource}>
                查看来源
                <ArrowRight size={13} />
              </button>
            )}
            {!track.cover && track.coverAttempt?.reason && <small>{track.coverAttempt.reason}</small>}
          </div>
        </div>
        <div className="cover-modal-actions">
          <button disabled={loading} className="primary-button" onClick={onSearch}>
            {loading ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />}
            {loading ? "正在检索多个音乐目录…" : "联网查找封面"}
          </button>
          <button className="outline-button" onClick={onChooseFile}>
            <ImagePlus size={16} />
            选择本地图片
          </button>
        </div>
        <p className="candidate-hint">请核对歌手、专辑和版本，再选择正确封面。</p>
        {result &&
          (result.candidates.length ? (
            <div className="candidate-grid">
              {result.candidates.map(candidate => (
                <button key={candidate.id} onClick={() => onConfirm(candidate.id)}>
                  <img alt={`${candidate.album}封面`} src={artworkAddress(candidate.cover)} />
                  <strong>{candidate.title}</strong>
                  <span>{candidate.artist}</span>
                  <small>{candidate.album}</small>
                  <em>
                    {candidate.source} · {candidate.automatic ? "录音匹配" : "请核对版本"}
                  </em>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-candidates">
              <ImagePlus size={30} />
              <p>本次查询未找到可用封面</p>
              <small>可以稍后重试，或选择本地图片。</small>
            </div>
          ))}
        {Boolean(result?.errors.length) && (
          <details className="source-errors">
            <summary>部分来源暂不可用</summary>
            {[...new Set(result.errors)].map((error, index) => (
              <p key={index}>{error}</p>
            ))}
          </details>
        )}
      </section>
    </div>
  )
}
