/**
 * 统一手动切歌和自动接歌的混音时间，单位为秒。
 * 下一首提前准备，在上一首结束前留出完整重叠窗口；实际淡化不超过旧曲剩余时长。
 */
export const playbackTiming = Object.freeze({ crossfadeSeconds: 3, advanceBeforeEndSeconds: 3.4 })
