/**
 * 统一歌曲、歌单和歌手的封面展示，最多拼贴四张真实图片。
 * 缺失或加载失败时显示本地唱片占位，不为装饰图片发起无关的联网搜索。
 */
import React, { useState } from "react"
import { Music2 } from "lucide-react"
import { artworkAddress } from "@/shared/media/trackPresentation.js"
import ProgressiveArtwork from "@/shared/ui/ProgressiveArtwork.jsx"

/**
 * 为单张图片保留加载失败的降级状态，避免损坏缓存反复触发错误。
 * 图片引用改变后使用新组件键重新尝试，播放进度不会影响图片加载。
 */
function ArtworkImage({ reference }) {
  const [failed, setFailed] = useState(false)
  return failed ? (
    <span className="artwork-unavailable">
      <Music2 size={23} />
    </span>
  ) : (
    <img alt="" draggable={false} loading="lazy" src={artworkAddress(reference)} onError={() => setFailed(true)} />
  )
}

/**
 * 根据索引中的封面集合呈现图片，点击能力只在调用者提供动作时启用。
 * 可访问名称由歌曲或歌单标题组成，装饰图片本身不重复朗读。
 * progressive 为联网头像启用邻近视口预加载与骨架渐显，普通本地封面保持原有展示。
 */
export default function CoverArt({ track, playlist, name, className = "", onClick, progressive = false }) {
  const title = name || track?.title || playlist?.name || "音乐"
  const images = (track ? [track.cover] : playlist?.customCover ? [playlist.customCover] : (playlist?.covers ?? [])).filter(
    Boolean,
  )
  const seed = Array.from(title).reduce((value, character) => value + character.codePointAt(0), 0)
  const Wrapper = onClick ? "button" : "div"
  const Image = progressive ? ProgressiveArtwork : ArtworkImage
  return (
    <Wrapper
      className={`cover ${className}`}
      aria-label={`${onClick ? "查看" : ""}${title}封面`}
      onClick={onClick}
      {...(onClick ? { type: "button" } : {})}
    >
      {images.length > 1 ? (
        <div className="cover-mosaic">
          {[0, 1, 2, 3].map(index => (
            <Image key={index + images[index % images.length]} reference={images[index % images.length]} />
          ))}
        </div>
      ) : images.length ? (
        <Image key={images[0]} reference={images[0]} />
      ) : (
        <div className="cover-placeholder" style={{ "--cover-hue": seed % 360 }}>
          <div className="vinyl">
            <span />
          </div>
          <Music2 strokeWidth={1.5} size={25} />
          <span className="cover-initial">{title.substring(0, 4)}</span>
        </div>
      )}
    </Wrapper>
  )
}
