/**
 * 共享音效参数白名单，界面预览与主进程保存使用同一范围。
 * 默认原声关闭处理，所有效果仅改变播放输出，不改写音频文件。
 */
export const soundPresets = {
  original: { name: "原声", enabled: false, reverb: 0, electronic: 0, bass: 0, mid: 0, treble: 0 },
  reverb: { name: "空间混响", enabled: true, reverb: 38, electronic: 0, bass: 0, mid: -1, treble: 1 },
  electronic: { name: "电音", enabled: true, reverb: 10, electronic: 60, bass: 3, mid: -1, treble: 2 },
  warm: { name: "温暖低音", enabled: true, reverb: 8, electronic: 0, bass: 5, mid: 1, treble: -2 },
}

/**
 * 过滤 IPC 及历史偏好中的音效字段，拒绝非有限数字并对增益与混合比例限幅。
 * 未提供的字段沿用原值；未知预设按自定义处理，不允许保存任意节点或执行代码。
 * 混响和电音以 0–100% 表示，低、中、高音增益以 -12–12 dB 表示，首次使用默认原声。
 */
export function normalizeSound(value = {}, previous = soundPresets.original) {
  value = value && typeof value === "object" ? value : {}
  previous = previous && typeof previous === "object" ? previous : soundPresets.original
  const result = {
    enabled: typeof value.enabled === "boolean" ? value.enabled : Boolean(previous.enabled),
    preset:
      typeof value.preset === "string"
        ? Object.hasOwn(soundPresets, value.preset)
          ? value.preset
          : "custom"
        : previous.preset || "original",
  }
  for (const key of ["reverb", "electronic", "bass", "mid", "treble"]) {
    const number = Number.isFinite(value[key]) ? value[key] : previous[key] || 0
    result[key] = Math.max(
      ["reverb", "electronic"].includes(key) ? 0 : -12,
      Math.min(["reverb", "electronic"].includes(key) ? 100 : 12, number),
    )
  }
  return result
}
