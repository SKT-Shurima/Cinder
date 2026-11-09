/**
 * 为联网头像提供邻近视口预加载、主题骨架和解码后的渐显，避免未就绪图片直接闪出。
 * 所有实例共用可见性观察器，离屏骨架暂停动画，卸载时释放节点和异步状态更新。
 */
import React, { useCallback, useEffect, useRef, useState } from "react"
import { Music2 } from "lucide-react"
import { artworkAddress } from "@/shared/media/trackPresentation.js"
import "@/shared/ui/artwork.css"

const listeners = new Map()
let observer = null

/**
 * 在头像接近滚动视口时提前请求图片，同一个观察器服务全部歌手卡片。
 * 嵌套滚动区也预留四百像素；最后一个节点卸载后断开观察，旧页面不会继续持有 DOM。
 */
function observeArtwork(element, listener) {
  if (typeof IntersectionObserver === "undefined") {
    listener(true)
    return () => {}
  }
  if (!observer) {
    observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          listeners.get(entry.target)?.(entry.isIntersecting)
        }
      },
      { rootMargin: "400px 0px", scrollMargin: "400px 0px" },
    )
  }
  listeners.set(element, listener)
  observer.observe(element)
  return () => {
    observer?.unobserve(element)
    listeners.delete(element)
    if (!listeners.size) {
      observer?.disconnect()
      observer = null
    }
  }
}

/**
 * 从主题骨架过渡到完整头像，只在浏览器完成图片解码后开始三百毫秒淡入。
 * 已缓存图片同样经过就绪检查；请求失败显示音乐占位，过期解码不能覆盖失败或卸载状态。
 * 图片引用变化由调用方组件键重建状态，避免上一位歌手的头像短暂串入下一张卡片。
 */
export default function ProgressiveArtwork({ reference }) {
  const host = useRef(null)
  const image = useRef(null)
  const active = useRef(false)
  const decoding = useRef(false)
  const failed = useRef(false)
  const [requested, setRequested] = useState(false)
  const [nearby, setNearby] = useState(false)
  const [status, setStatus] = useState("loading")

  /**
   * 把网络完成与视觉就绪分开，解码期间保留骨架，防止大图首次绘制时出现空白帧。
   * 部分有效图片的 decode 会拒绝，仍以真实尺寸判断是否可显示；卸载后不再提交状态。
   */
  const reveal = useCallback(async () => {
    const current = image.current
    if (!current || decoding.current || failed.current || !active.current) {
      return
    }
    decoding.current = true
    try {
      await current.decode()
    } catch {
      /* 部分协议图片可绘制但不支持预解码，继续检查真实尺寸。 */
    }
    if (active.current && image.current === current && !failed.current) {
      setStatus(current.naturalWidth > 0 ? "ready" : "error")
    }
    decoding.current = false
  }, [])

  /**
   * 停止加载占位并显示明确的失败图标，失败请求不自动循环重试。
   */
  const reject = useCallback(() => {
    failed.current = true
    if (active.current) {
      setStatus("error")
    }
  }, [])

  useEffect(() => {
    active.current = true
    const release = observeArtwork(host.current, visible => {
      setNearby(visible)
      if (visible) {
        setRequested(true)
      }
    })
    return () => {
      active.current = false
      release()
    }
  }, [])
  useEffect(() => {
    if (requested && image.current?.complete && image.current.naturalWidth > 0) {
      reveal()
    }
  }, [requested, reveal])

  return (
    <span ref={host} className="progressive-artwork" data-state={status} data-nearby={nearby} aria-busy={status === "loading"}>
      <span className="artwork-skeleton" aria-hidden="true">
        <i className="artwork-skeleton-head" />
        <i className="artwork-skeleton-body" />
        <i className="artwork-skeleton-shine" />
      </span>
      {requested && status !== "error" && (
        <img
          ref={image}
          alt=""
          draggable={false}
          decoding="async"
          src={artworkAddress(reference)}
          onLoad={reveal}
          onError={reject}
        />
      )}
      {status === "error" && (
        <span className="artwork-unavailable">
          <Music2 size={23} />
        </span>
      )}
    </span>
  )
}
