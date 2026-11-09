/**
 * 将原色头像铺满随机大小的圆形卡片，姓名和歌曲数量显示在圆内下方。
 * 拖拽与漂浮由统一运动场协调，圆形不会缩放或互相穿透。
 */
import React, { memo, useCallback } from "react"
import CoverArt from "@/shared/ui/CoverArt.jsx"

/**
 * 自然彩色头像铺满整个圆形卡片，姓名与歌曲数量直接叠放在原图上。
 * 文字不带背景底板或遮罩，保留照片原有肤色和层次。
 * 头像接近视口时预加载，解码前显示主题骨架，准备完成后平滑淡入。
 * 整个气泡同时支持普通点击与指针拖拽，运动场负责区分两种动作并抑制拖拽后的误点击。
 * 长姓名单行省略，完整姓名保留在提示与可访问名称中。
 * 热门歌曲进入详情后再加载，卡片渲染不会请求作品或改变播放队列。
 */
function ArtistCard({ artist, placement, interactions }) {
  /**
   * 将卡片节点交给当前气泡场更新位置，卸载时通过空引用释放旧节点。
   */
  const register = useCallback(element => interactions.register(artist.id, element), [artist.id, interactions.register])
  const summary = `${(artist.songCount || 0).toLocaleString("zh-CN")} 首歌曲`
  return (
    <article
      ref={register}
      className="artist-card"
      data-artist-id={artist.id}
      style={{ left: placement.x, top: placement.y, width: placement.diameter, "--artist-diameter": `${placement.diameter}px` }}
    >
      <button
        type="button"
        className="artist-art"
        title={`${artist.name} · 拖动气泡，点击查看作品`}
        aria-label={`查看歌手 ${artist.name}，${summary}`}
        onClick={() => interactions.open(artist.id)}
        onPointerDown={event => interactions.pointerDown(artist.id, event)}
        onPointerMove={interactions.pointerMove}
        onPointerUp={interactions.pointerUp}
        onPointerCancel={interactions.pointerUp}
        onLostPointerCapture={interactions.pointerUp}
        onPointerEnter={event => interactions.hover(artist.id, event)}
        onPointerLeave={interactions.leave}
        onFocus={event => interactions.hover(artist.id, event)}
        onBlur={interactions.leave}
      >
        <span className="artist-circle">
          <CoverArt playlist={artist} progressive />
          <span className="artist-bubble-caption">
            <strong>{artist.name}</strong>
            <span>{summary}</span>
          </span>
        </span>
      </button>
    </article>
  )
}

export default memo(ArtistCard)
