/**
 * 定义扇形舞台逐张换批的节奏，右侧卡片先动，退场间隔逐渐缩短，入场间隔逐渐拉长。
 * 数值单位为毫秒，最多七张可见卡片；运动只影响展示，不改变播放队列。
 */
const leavingDelays = [0, 150, 270, 365, 440, 495, 535]
const enteringDelays = [0, 40, 95, 170, 265, 385, 535]

/**
 * 为指定顺位的卡片提供延迟与持续时间，使退场加速、入场减速的节奏保持一致。
 * 顺位零代表屏幕最右侧，异常顺位限制在当前最多七张卡片的范围内。
 */
export function batchCardMotion(rank, phase) {
  const index = Math.max(0, Math.min(6, rank))
  return { delay: (phase === "leaving" ? leavingDelays : enteringDelays)[index], duration: phase === "leaving" ? 380 : 460 }
}

/**
 * 计算最后一张可见卡片结束时间，供动画事件丢失、后台页面或空舞台时的兜底使用。
 */
export function batchMotionDuration(count, phase) {
  const motion = batchCardMotion(Math.max(0, Math.min(7, count) - 1), phase)
  return motion.delay + motion.duration
}
