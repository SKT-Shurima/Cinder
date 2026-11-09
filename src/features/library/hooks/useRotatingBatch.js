/**
 * 协调封面逐张旋转的退场与入场，替换内容只发生在旧批次最后一张卡片退场完成之后。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { artworkAddress } from "@/shared/media/trackPresentation.js"
import { batchMotionDuration } from "@/features/library/model/batchMotion.js"

/**
 * 为即将出现在扇形舞台上的七张封面预加载并解码，避免旋转进入时才出现图片。
 * 单张最多等待九百毫秒；失败保留正常占位，取消或卸载时释放图片事件和计时器。
 */
export async function preloadStageArtwork(tracks, signal) {
  const references = [
    ...new Set(
      tracks
        .slice(0, 4)
        .concat(tracks.slice(-3))
        .map(track => track.cover)
        .filter(Boolean),
    ),
  ]
  await Promise.all(
    references.map(
      reference =>
        new Promise(resolve => {
          const picture = new Image()
          let settled = false
          /**
           * 图片就绪、失败、超时或请求被替换后结束等待，迟到的解码不能重新提交这一批内容。
           */
          const finish = () => {
            if (settled) {
              return
            }
            settled = true
            clearTimeout(timer)
            signal?.removeEventListener("abort", finish)
            picture.onload = null
            picture.onerror = null
            resolve()
          }
          const timer = setTimeout(finish, 900)
          picture.onerror = finish
          picture.onload = async () => {
            try {
              await picture.decode()
            } catch {
              /* 有效协议图片可能不支持预解码，继续保留浏览器已加载内容。 */
            }
            finish()
          }
          if (signal?.aborted) {
            finish()
            return
          }
          signal?.addEventListener("abort", finish, { once: true })
          picture.src = artworkAddress(reference)
        }),
    ),
  )
}

/**
 * 以稳定标识比较批次内容，曲库状态刷新但歌曲未变时不重新触发旋转。
 */
function sameBatch(first, second) {
  return first.length === second.length && first.every((track, index) => track.id === second[index]?.id)
}

/**
 * 保留逐张退场期间的旧内容，再提交最新批次并逐张完成入场；同一时间只存在一组可交互封面。
 * 动画事件为主、超时为兜底，后台窗口没有动画事件时也不会卡住；减少动态效果时直接换批。
 */
export default function useRotatingBatch(tracks) {
  const [state, setState] = useState(() => ({ tracks, phase: "idle" }))
  const pending = useRef(tracks)
  pending.current = tracks
  const reduced = useRef(window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    /**
     * 系统在动画中途切换为减少动态效果时立即稳定到最新批次，避免继续旋转或等待旧计时器。
     */
    const update = () => {
      reduced.current = media.matches
      if (media.matches) {
        setState({ tracks: pending.current, phase: "idle" })
      }
    }
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])
  useEffect(() => {
    setState(current =>
      reduced.current
        ? { tracks, phase: "idle" }
        : sameBatch(current.tracks, tracks)
          ? { ...current, tracks }
          : current.phase === "idle"
            ? { ...current, phase: "leaving" }
            : current,
    )
  }, [tracks])

  /**
   * 旧批次完成退场后才替换歌曲，入场完成后再开放换批及卡片操作。
   * 若异步更新期间又收到新批次，会按相同顺序衔接最新结果，避免切到已经过期的中间批次。
   */
  const completePhase = useCallback(
    () =>
      setState(current =>
        current.phase === "leaving"
          ? { tracks: pending.current, phase: "entering" }
          : current.phase === "entering"
            ? { ...current, phase: sameBatch(current.tracks, pending.current) ? "idle" : "leaving" }
            : current,
      ),
    [],
  )
  useEffect(() => {
    if (state.phase === "idle") {
      return
    }
    const timer = setTimeout(completePhase, batchMotionDuration(state.tracks.length, state.phase) + 100)
    return () => clearTimeout(timer)
  }, [state.phase, state.tracks.length, completePhase])
  return { ...state, completePhase }
}
