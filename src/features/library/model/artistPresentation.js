/**
 * 热门歌手球体的有界随机布局，头像与文字共享同一个圆形碰撞边界。
 * 同一集合、宽度和种子得到相同结果，播放进度刷新不会引起卡片跳动。
 */

/**
 * 将布局种子转换为可重复的随机序列，仅用于展示，不用于标识或安全决策。
 */
function layoutRandom(seed) {
  let state = 2166136261
  for (const character of String(seed)) {
    state = Math.imul(state ^ character.codePointAt(0), 16777619) >>> 0
  }
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

/**
 * 在给定横坐标寻找球体能放入的最高空隙，按圆心距离计算禁止占用的纵向区间。
 * 相邻球体可以填入彼此的斜向空隙；区间按起点合并检查，避免漏掉上方已有球体。
 */
export function sphereTopAt(cards, x, radius, gap, initialTop) {
  const centerX = x + radius
  const intervals = []
  for (const previous of cards) {
    const distance = radius + previous.radius + gap
    const dx = Math.abs(centerX - previous.centerX)
    if (dx >= distance) {
      continue
    }
    const offset = Math.sqrt(distance * distance - dx * dx)
    intervals.push({ start: previous.centerY - offset - radius, end: previous.centerY + offset - radius })
  }
  intervals.sort((a, b) => a.start - b.start)
  let top = initialTop
  for (const interval of intervals) {
    if (top <= interval.start) {
      break
    }
    if (top < interval.end) {
      top = interval.end
    }
  }
  return top
}

/**
 * 以真实圆形边界紧密堆放歌手球体，随机落点结合相邻球体的切线方向填补空隙。
 * 直径为 112 至 184 像素，最大比最小大 64.3%；窄容器等比缩小，始终不超过 65%。
 * 姓名与数量收纳在球内，不再占用额外矩形空间；球面之间保留六像素基础间隙。
 * 种子和宽度不变时位置稳定，结果不依赖 DOM；返回的高度覆盖全部球体与底部阴影。
 */
export function layoutArtistCards(artists, containerWidth, seed) {
  const width = Math.max(1, Math.floor(containerWidth))
  const random = layoutRandom(seed)
  const inset = Math.min(8, width / 8)
  const available = width - inset * 2
  const scale = Math.min(1, available / 184)
  const gap = 6 * scale
  const cards = []
  for (const artist of artists) {
    const diameter = (112 + Math.floor(random() * 73)) * scale
    const radius = diameter / 2
    let best = null
    const span = Math.max(0, available - diameter)
    const candidates = Array.from({ length: 48 }, () => inset + random() * span)
    for (const previous of cards.slice(-20)) {
      const distance = radius + previous.radius + gap
      candidates.push(
        previous.centerX - radius,
        previous.centerX - radius + distance / 2,
        previous.centerX - radius - distance / 2,
      )
    }
    for (const candidate of candidates) {
      const x = Math.max(inset, Math.min(inset + span, candidate))
      const y = sphereTopAt(cards, x, radius, gap, 8 + random() * 14)
      const score = y + random() * 8
      if (!best || score < best.score) {
        best = { id: artist.id, x, y, centerX: x + radius, centerY: y + radius, radius, diameter, height: diameter, score }
      }
    }
    cards.push(best)
  }
  return { cards, height: cards.reduce((bottom, card) => Math.max(bottom, card.y + card.height + 18), 0) }
}
