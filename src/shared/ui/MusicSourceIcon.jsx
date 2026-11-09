/**
 * 统一搜索、推荐与单曲详情中的来源标记。
 * 平台使用通用声波图形并保留文字来源，本地与远程图形沿用统一线宽和主题色。
 */
import React from "react"
import { musicProviders } from "#shared/musicSources"

/**
 * 从歌曲或歌单元数据判断来源，不依赖扩展名或路径中的展示文字。
 * 远程记录以服务器标识为准，在线记录显示具体平台，缺少元数据时按本地处理。
 */
export function musicSource(track) {
  if (track?.kind === "online") {
    return { id: track.provider, name: musicProviders.find(item => item.id === track.provider)?.name || "在线音乐" }
  }
  return track?.sourceId || track?.kind === "remote" ? { id: "remote", name: "远程音乐" } : { id: "local", name: "本地音乐" }
}

/**
 * 用通用音频图形区分在线来源，替代第三方平台的商标图片。
 * 图形仅作装饰，由相邻的平台名或外层来源标签提供可访问名称，不暗示官方合作。
 */
export function ProviderIcon({ id }) {
  return (
    <span className={`provider-icon provider-${id}`}>
      <svg
        className="provider-glyph"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {id === "qq" ? (
          <>
            <path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" />
          </>
        ) : (
          <>
            <circle cx="12" cy="12" r="3" />
            <path d="M7 6a8 8 0 0 0 0 12M17 6a8 8 0 0 1 0 12M4 3a12 12 0 0 0 0 18M20 3a12 12 0 0 1 0 18" />
          </>
        )}
      </svg>
    </span>
  )
}

/**
 * 绘制可随主题切换的来源图标，紧凑模式保留悬停说明和读屏名称。
 * 详情与筛选提示可同时显示文字；所有实例均为静态矢量，不创建动画或网络连接。
 */
export default function MusicSourceIcon({ track, source, showLabel = false, className = "" }) {
  const item = source ? { id: source, name: source === "local" ? "本地音乐" : "远程音乐" } : musicSource(track)
  return (
    <span
      className={`music-source source-${item.id} ${showLabel ? "with-label" : ""} ${className}`}
      title={item.name}
      aria-label={`来源：${item.name}`}
      data-source={item.id}
    >
      {musicProviders.some(provider => provider.id === item.id) ? (
        <ProviderIcon id={item.id} />
      ) : (
        <svg
          className="source-glyph"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {item.id === "remote" ? (
            <>
              <rect x="5" y="3" width="14" height="12" rx="3" />
              <path d="M5 9h14M8.5 6h.01M8.5 12h.01M12 15v4M5 21v-2h14v2" />
              <circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none" />
            </>
          ) : (
            <>
              <path d="M4 10.5 6 5h12l2 5.5V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
              <path d="M4 13h4l1.4 2h5.2l1.4-2h4" />
              <circle cx="12" cy="8.5" r="2.5" />
              <circle cx="12" cy="8.5" r=".5" fill="currentColor" stroke="none" />
            </>
          )}
        </svg>
      )}
      {showLabel && <span>{item.name}</span>}
    </span>
  )
}
