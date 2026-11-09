/**
 * 将指针拖拽和浏览动作接到统一气泡运动场，所有位移经过同一个碰撞模型。
 * 使用单一动画循环更新视觉坐标，不逐帧重渲染 React；拖拽结束不会误打开歌手。
 */
import { useCallback, useEffect, useRef } from "react"
import { ArtistBubbleField } from "@/features/library/model/artistBubbleField.js"

/**
 * 为当前歌手云建立可拖动的运动场，容器变化时按新的无重叠排布重建。
 * 点击与拖拽以五像素阈值区分，减少动态效果时保留直接拖拽并关闭悬停及惯性。
 */
export default function useArtistBubbles({ layout, width, container, onOpen }) {
  const field = useRef(null)
  const elements = useRef(new Map())
  const pointer = useRef(null)
  const frame = useRef(null)
  const previousTime = useRef(0)
  const reduced = useRef(false)
  const suppressed = useRef(null)

  /**
   * 将约束求解后的圆心差写入视觉层，原始尺寸及 React 排布坐标保持不变。
   * 不可见的圆形同样保留位置，随后滚动到该区域时不会出现穿透或坐标跳回。
   */
  const paint = useCallback(() => {
    for (const body of field.current?.bodies || []) {
      const element = elements.current.get(body.id)
      if (element) {
        element.style.transform = `translate3d(${body.x - body.baseX}px, ${body.y - body.baseY}px, 0)`
      }
    }
  }, [])

  /**
   * 推进当前运动场，只有拖拽、补位、悬停或惯性尚未结束时才申请下一帧。
   * 后台立即停止，重新回到前台后不补算离开的时长。
   */
  const tick = useCallback(
    time => {
      frame.current = null
      if (!field.current || document.hidden) {
        field.current?.stop()
        return
      }
      const active = field.current.step((time - previousTime.current) / 1000, { motion: !reduced.current })
      previousTime.current = time
      paint()
      if (active) {
        frame.current = requestAnimationFrame(tick)
      }
    },
    [paint],
  )

  /**
   * 合并连续指针事件的动画请求，同一歌手页始终只有一个活动循环。
   */
  const wake = useCallback(() => {
    if (frame.current !== null || !field.current || document.hidden) {
      return
    }
    previousTime.current = performance.now()
    frame.current = requestAnimationFrame(tick)
  }, [tick])

  /**
   * 停止动画并释放指针捕获，卸载、重新排布和系统动效偏好改变时复用。
   * 已拖动过的指针会短期抑制后续合成点击，避免系统取消拖拽后误进详情。
   */
  const stop = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
    }
    frame.current = null
    field.current?.stop()
    const current = pointer.current
    pointer.current = null
    if (current?.dragged) {
      suppressed.current = { id: current.id, until: performance.now() + 350 }
    }
    if (current?.target.hasPointerCapture(current.pointerId)) {
      current.target.releasePointerCapture(current.pointerId)
    }
    for (const element of elements.current.values()) {
      element.classList.remove("is-dragging")
    }
  }, [])

  useEffect(() => {
    stop()
    field.current = width ? new ArtistBubbleField(layout, width) : null
    paint()
    return stop
  }, [layout, width, paint, stop])
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)")
    reduced.current = media.matches
    /**
     * 系统减少动效或页面隐藏后立即清理当前运动，保留已经完成的可行排布。
     */
    const changed = () => {
      reduced.current = media.matches
      stop()
    }
    media.addEventListener("change", changed)
    document.addEventListener("visibilitychange", changed)
    return () => {
      media.removeEventListener("change", changed)
      document.removeEventListener("visibilitychange", changed)
      stop()
    }
  }, [stop])

  /**
   * 登记卡片的视觉节点，圆形卸载时及时移除引用，避免保留整个旧歌手列表。
   */
  const register = useCallback((id, element) => {
    if (element) {
      elements.current.set(id, element)
    } else {
      elements.current.delete(id)
    }
  }, [])

  /**
   * 将视口指针坐标换算为可滚动画布坐标，拖拽时以当前容器位置为准。
   */
  function point(event) {
    const bounds = container.current.getBoundingClientRect()
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
  }

  /**
   * 按下时保存相对圆心的偏移并捕获指针，小范围点击仍沿用普通浏览动作。
   */
  function pointerDown(id, event) {
    if (event.button !== 0 || pointer.current || !field.current) {
      return
    }
    const body = field.current.index.get(id)
    if (!body) {
      return
    }
    const position = point(event)
    pointer.current = {
      id,
      pointerId: event.pointerId,
      target: event.currentTarget,
      startX: position.x,
      startY: position.y,
      offsetX: body.x - position.x,
      offsetY: body.y - position.y,
      dragged: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  /**
   * 超过阈值后开始真实圆心拖动，指针快速跨过多个气泡时仍由模型逐帧验证碰撞。
   */
  function pointerMove(event) {
    const current = pointer.current
    if (!current || current.pointerId !== event.pointerId || !field.current) {
      return
    }
    const position = point(event)
    if (!current.dragged && Math.hypot(position.x - current.startX, position.y - current.startY) < 5) {
      return
    }
    if (!current.dragged) {
      current.dragged = true
      field.current.beginDrag(current.id)
      elements.current.get(current.id)?.classList.add("is-dragging")
    }
    event.preventDefault()
    field.current.dragTo(position.x + current.offsetX, position.y + current.offsetY)
    wake()
  }

  /**
   * 松手后释放圆心约束并平滑填补较大空隙，拖拽产生的点击在短时间内被消费。
   * 减少动态效果时由模型直接提交可行补位坐标，不启动额外漂浮动画。
   * 指针取消和失去捕获共用此入口，重复到达的结束事件不会重复触发浏览。
   */
  function pointerUp(event) {
    const current = pointer.current
    if (!current || current.pointerId !== event.pointerId) {
      return
    }
    pointer.current = null
    if (current.dragged) {
      field.current?.endDrag()
      suppressed.current = { id: current.id, until: performance.now() + 350 }
      elements.current.get(current.id)?.classList.remove("is-dragging")
      wake()
    }
    if (current.target.hasPointerCapture(current.pointerId)) {
      current.target.releasePointerCapture(current.pointerId)
    }
  }

  /**
   * 鼠标或键盘聚焦时让整个气泡小幅往返漂浮，触屏及减少动态效果时不启动装饰运动。
   */
  function hover(id, event) {
    if (
      reduced.current ||
      event?.pointerType === "touch" ||
      (event?.type === "focus" && !event.currentTarget.matches(":focus-visible"))
    ) {
      return
    }
    field.current?.setHover(id)
    wake()
  }

  /**
   * 离开后停止往返驱动力，已经产生的速度交给运动场平滑收尾。
   */
  function leave() {
    field.current?.setHover(null)
    wake()
  }

  /**
   * 只把普通点击交给歌手导航，拖拽松手后的合成点击不会改变当前页面。
   */
  function open(id) {
    if (suppressed.current?.id === id && performance.now() < suppressed.current.until) {
      return
    }
    onOpen(id)
  }

  return { register, pointerDown, pointerMove, pointerUp, hover, leave, open }
}
