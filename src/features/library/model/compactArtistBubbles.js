/**
 * 在拖拽结束后计算就近补位目标，复用初始排布的圆形空隙查询。
 * 保留每位歌手的尺寸和大致横向位置，不重新随机分配头像或排布种子。
 */
import { sphereTopAt } from "@/features/library/model/artistPresentation.js"

/**
 * 检查补位直线路径是否被其他圆形阻挡，不把气泡拉向必须穿越头像才能抵达的空位。
 * 使用与运动场一致的最小间隔，拖拽挤紧后的可行起点不会被误判为穿透。
 */
function canSlide(body, target, others, gap) {
  const dx = target.x - body.x
  const dy = target.y - body.y
  const length = dx * dx + dy * dy
  return others.every(other => {
    const fraction = Math.max(
      0,
      Math.min(1, ((other.centerX - body.x) * dx + (other.centerY - body.y) * dy) / Math.max(1, length)),
    )
    return (
      Math.hypot(other.centerX - body.x - dx * fraction, other.centerY - body.y - dy * fraction) >=
      body.radius + other.radius + gap / 3 - 0.001
    )
  })
}

/**
 * 按当前纵向顺序向上收拢较大空隙，允许邻近气泡沿无阻挡方向斜向补位。
 * 小于二十四像素的收益不触发换位；每次选择都保留其他圆形作为障碍，不扩大已有画布。
 * 刚刚拖动的气泡作为补位锚点保留在松手处，由其他气泡填空，不撤销用户的拖动。
 * 返回独立坐标，不直接改变正在渲染的气泡，避免松手时瞬间跳到新位置。
 */
export function compactArtistBubbles(bodies, width, gap, anchorId) {
  const positions = bodies.map(body => ({ ...body, centerX: body.x, centerY: body.y }))
  const ordered = [...positions].sort((a, b) => a.y - a.radius - (b.y - b.radius))
  for (const body of ordered) {
    if (body.id === anchorId) {
      continue
    }
    const top = body.y - body.radius
    const left = body.x - body.radius
    const limit = Math.min(160, body.radius * 2.4)
    const others = positions.filter(other => other.id !== body.id)
    const candidates = [left]
    for (let i = 1; i <= 8; i++) {
      candidates.push(left - (limit * i) / 8, left + (limit * i) / 8)
    }
    let best = { x: left, y: top, score: top }
    for (const candidate of candidates) {
      const x = Math.max(8, Math.min(width - body.radius * 2 - 8, candidate))
      const y = sphereTopAt(others, x, body.radius, gap, 8)
      const score = y + Math.abs(x - left) * 0.7
      if (score < top - 24 && score < best.score && canSlide(body, { x: x + body.radius, y: y + body.radius }, others, gap)) {
        best = { x, y, score }
      }
    }
    body.centerX = body.x = best.x + body.radius
    body.centerY = body.y = best.y + body.radius
  }
  return new Map(positions.map(body => [body.id, { x: body.x, y: body.y }]))
}
