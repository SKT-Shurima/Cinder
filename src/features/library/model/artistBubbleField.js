/**
 * 歌手气泡的二维运动模型，统一处理拖拽、惯性和刚性圆形碰撞。
 * 模型不访问 DOM；直径始终不变，任何无法满足间距的步进都会退回可行位置。
 */
import { compactArtistBubbles } from "@/features/library/model/compactArtistBubbles.js"

/**
 * 将气泡运动限制在给定边界，碰到边缘后保留少量反向速度。
 * 视觉层不缩放圆形，也不会通过压扁气泡腾出空间。
 */
function confine(body, width, height) {
  const x = Math.max(body.radius + 8, Math.min(width - body.radius - 8, body.x))
  const y = Math.max(body.radius + 8, Math.min(height - body.radius - 8, body.y))
  if (x !== body.x) {
    body.vx *= -0.2
  }
  if (y !== body.y) {
    body.vy *= -0.2
  }
  body.x = x
  body.y = y
}

/**
 * 以圆心空间网格枚举可能接触的气泡，避免每个动画帧扫描全部两两组合。
 * 网格尺寸覆盖最大接触距离，跨格移动后由下一次约束迭代重新建立邻接关系。
 */
function contacts(bodies, size) {
  const grid = new Map()
  const pairs = []
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i]
    const x = Math.floor(body.x / size)
    const y = Math.floor(body.y / size)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(`${x + dx}:${y + dy}`) || []) {
          pairs.push([bodies[j], body])
        }
      }
    }
    const key = `${x}:${y}`
    if (!grid.has(key)) {
      grid.set(key, [])
    }
    grid.get(key).push(i)
  }
  return pairs
}

/**
 * 管理一次歌手排布的运动与约束，拖动会轻推邻近气泡，释放后自然减速。
 * 每次步进先保存有效状态，求解失败时缩短本次位移，保证提交给界面的圆形不重叠。
 */
export class ArtistBubbleField {
  /**
   * 从已经无重叠的排布建立独立运动状态，随机尺寸不参与后续交互修改。
   */
  constructor(layout, width) {
    this.width = width
    this.height = layout.height
    this.gap = 6 * Math.min(1, (width - Math.min(16, width / 4)) / 184)
    this.bodies = layout.cards.map(card => ({
      id: card.id,
      radius: card.radius,
      x: card.centerX,
      y: card.centerY,
      vx: 0,
      vy: 0,
      baseX: card.centerX,
      baseY: card.centerY,
    }))
    this.index = new Map(this.bodies.map(body => [body.id, body]))
    this.cellSize = Math.max(1, ...this.bodies.map(body => body.radius * 2 + this.gap))
    this.drag = null
    this.hover = null
    this.time = 0
    this.compaction = null
  }

  /**
   * 为当前悬停气泡保存轻微往返运动的中心，离开后保留速度并逐渐停下。
   * 重复进入同一气泡不重新分配运动中心，拖拽期间不叠加悬停驱动力。
   */
  setHover(id) {
    if (this.hover?.id === id) {
      return
    }
    const body = this.index.get(id)
    this.hover = body ? { id, x: body.x, y: body.y } : null
  }

  /**
   * 开始拖拽指定气泡，指针目标由界面换算为画布内圆心坐标。
   * 当前圆形优先跟随指针，仍允许碰撞约束微调位置，周围圆形继续参与位移。
   */
  beginDrag(id) {
    const body = this.index.get(id)
    if (body) {
      this.compaction = null
      this.drag = { id, x: body.x, y: body.y }
    }
  }

  /**
   * 更新拖拽目标，实际位移在下一帧有界步进后提交，避免快速拖动穿过其他气泡。
   */
  dragTo(x, y) {
    if (this.drag && Number.isFinite(x) && Number.isFinite(y)) {
      Object.assign(this.drag, { x, y })
    }
  }

  /**
   * 释放拖拽控制并计算就近补位目标，保留实际速度让气泡平滑转入收拢过程。
   * 新拖拽可以随时打断补位；目标只改变位置，不改变头像尺寸或随机种子。
   */
  endDrag() {
    const anchorId = this.drag?.id
    this.drag = null
    this.hover = null
    this.compaction = { targets: compactArtistBubbles(this.bodies, this.width, this.gap, anchorId), elapsed: 0, quiet: 0 }
  }

  /**
   * 暂停全部装饰运动，后台、减少动态效果和组件卸载共用该清理入口。
   * 已经完成的重新排布保留，不强制跳回最初位置。
   */
  stop() {
    this.drag = null
    this.hover = null
    this.compaction = null
    for (const body of this.bodies) {
      body.vx = 0
      body.vy = 0
    }
  }

  /**
   * 检查当前布局的真实圆心距离与边界，拖拽压力下仍保留至少两像素的安全间隔。
   * 求解以六像素为目标，允许间隔自然收紧而不改变圆形尺寸，避免密集排列阻塞全部运动。
   */
  valid() {
    for (const body of this.bodies) {
      if (
        body.x < body.radius + 8 - 0.001 ||
        body.x > this.width - body.radius - 8 + 0.001 ||
        body.y < body.radius + 8 - 0.001 ||
        body.y > this.height - body.radius - 8 + 0.001
      ) {
        return false
      }
    }
    return contacts(this.bodies, this.cellSize).every(
      ([a, b]) => Math.hypot(b.x - a.x, b.y - a.y) >= a.radius + b.radius + this.gap / 3 - 0.0001,
    )
  }

  /**
   * 以质量加权的圆形约束消除穿透，拖动气泡提高权重后轻推其他圆形。
   * 邻接关系每轮重算，连锁接触不会漏检；多轮仍不可行时由调用方收缩本次位移。
   */
  separate() {
    for (let pass = 0; pass < 48; pass++) {
      let deepest = 0
      for (const [a, b] of contacts(this.bodies, this.cellSize)) {
        const dx = b.x - a.x
        const dy = b.y - a.y
        const distance = Math.hypot(dx, dy)
        const overlap = a.radius + b.radius + this.gap - distance
        if (overlap <= 0) {
          continue
        }
        deepest = Math.max(deepest, overlap)
        const nx = distance ? dx / distance : 1
        const ny = distance ? dy / distance : 0
        const first = (a.id === this.drag?.id ? 0.15 : 1) / (a.radius * a.radius)
        const second = (b.id === this.drag?.id ? 0.15 : 1) / (b.radius * b.radius)
        const sum = first + second
        a.x -= (nx * overlap * first) / sum
        a.y -= (ny * overlap * first) / sum
        b.x += (nx * overlap * second) / sum
        b.y += (ny * overlap * second) / sum
      }
      for (const body of this.bodies) {
        confine(body, this.width, this.height)
      }
      if (deepest < 0.005) {
        break
      }
    }
  }

  /**
   * 推进一帧轻微浮动与惯性，时间步长限制防止切回前台时产生大跨度跳跃。
   * 拖拽直接改变圆心，松手后以阻尼驱动力补位，悬停使用小幅往返运动；提交前再次验证全部约束。
   * 减少动态效果时一次提交可行补位目标，常规模式在静止或三秒后停止补位，避免持续占用动画帧。
   * 返回是否还需后续帧，静止时界面可以停止 requestAnimationFrame。
   */
  step(seconds, { motion = true } = {}) {
    const dt = Math.max(0.001, Math.min(0.032, seconds))
    this.time += dt
    if (!motion && this.compaction) {
      for (const body of this.bodies) {
        Object.assign(body, this.compaction.targets.get(body.id), { vx: 0, vy: 0 })
      }
      this.compaction = null
    }
    const previous = this.bodies.map(body => ({ x: body.x, y: body.y }))
    for (const body of this.bodies) {
      if (this.drag?.id === body.id) {
        const dx = this.drag.x - body.x
        const dy = this.drag.y - body.y
        const distance = Math.hypot(dx, dy)
        const fraction = Math.min(1, 20 / Math.max(1, distance))
        body.x += dx * fraction
        body.y += dy * fraction
      } else {
        const target = this.compaction?.targets.get(body.id)
        if (target) {
          body.vx += (target.x - body.x) * 42 * dt
          body.vy += (target.y - body.y) * 42 * dt
        }
        if (motion && this.hover?.id === body.id) {
          body.vx += (this.hover.x + Math.sin(this.time * 2) * 8 - body.x) * 38 * dt
          body.vy += (this.hover.y + Math.cos(this.time * 1.7) * 7 - body.y) * 38 * dt
        }
        const damping = this.compaction ? 11 : 5.5
        body.vx *= Math.exp(-damping * dt)
        body.vy *= Math.exp(-damping * dt)
        body.x += body.vx * dt
        body.y += body.vy * dt
      }
      confine(body, this.width, this.height)
    }
    this.separate()
    if (!this.valid()) {
      const proposed = this.bodies.map(body => ({ x: body.x, y: body.y }))
      let low = 0
      let high = 1
      for (let attempt = 0; attempt < 20; attempt++) {
        const fraction = (low + high) / 2
        this.bodies.forEach((body, i) => {
          body.x = previous[i].x + (proposed[i].x - previous[i].x) * fraction
          body.y = previous[i].y + (proposed[i].y - previous[i].y) * fraction
        })
        if (this.valid()) {
          low = fraction
        } else {
          high = fraction
        }
      }
      this.bodies.forEach((body, i) => {
        body.x = previous[i].x + (proposed[i].x - previous[i].x) * low
        body.y = previous[i].y + (proposed[i].y - previous[i].y) * low
      })
    }
    this.bodies.forEach((body, i) => {
      body.vx = motion ? Math.max(-500, Math.min(500, (body.x - previous[i].x) / dt)) : 0
      body.vy = motion ? Math.max(-500, Math.min(500, (body.y - previous[i].y) / dt)) : 0
      if (!this.drag && !this.hover && Math.hypot(body.vx, body.vy) < 0.4) {
        body.vx = 0
        body.vy = 0
      }
    })
    if (this.compaction) {
      this.compaction.elapsed += dt
      const moving = this.bodies.some(body => Math.hypot(body.vx, body.vy) >= 1)
      this.compaction.quiet = moving ? 0 : this.compaction.quiet + dt
      if (this.compaction.quiet > 0.15 || this.compaction.elapsed > 3) {
        this.compaction = null
      }
    }
    return Boolean(
      this.drag || this.compaction || (motion && (this.hover || this.bodies.some(body => Math.hypot(body.vx, body.vy) >= 0.4))),
    )
  }
}
