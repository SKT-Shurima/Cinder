/**
 * 为在线歌手作品页呈现等待、失败与空结果，避免展示本地导入音乐的提示。
 * 状态变化不控制播放器，重试与来源设置交回页面协调层。
 */
import React from "react"
import { LoaderCircle, MicVocal } from "lucide-react"

/**
 * 根据请求结果显示对应反馈，平台关闭或网络失败时保留明确的恢复入口。
 */
export default function ArtistTracksStatus({ loading, error, onRetry, onConfigure }) {
  const pending = loading && !error
  return (
    <div className="empty-state" role={error ? "alert" : "status"}>
      {pending ? <LoaderCircle className="spin" size={30} /> : <MicVocal size={32} />}
      <h3>{error ? "暂时无法加载热门作品" : pending ? "正在加载热门作品" : "这位歌手暂时没有可展示的热门作品"}</h3>
      <p>{error || (pending ? "正在读取平台歌曲信息…" : "可以稍后重试，或到在线音乐搜索更多作品。")}</p>
      {!pending && (
        <button className="outline-button" onClick={onRetry}>
          重新加载
        </button>
      )}
      {error && (
        <button className="text-button" onClick={onConfigure}>
          音乐来源设置
        </button>
      )}
    </div>
  )
}
