/**
 * 统一应用内和 Dock 的品牌色旋转角度，透明 Logo 始终沿用同一份火焰原图。
 * 只改变色相，保留光丝的明暗、暖白高光和 Alpha，不生成新的背景底板。
 */
export const brandHueRotations = Object.freeze({ flame: 0, cyan: 160, coral: -18, violet: 230 })

/**
 * 为 Dock 位图应用与 CSS hue-rotate 相同的颜色矩阵。
 * 输入为解码后的 RGBA 像素；原位更新 RGB，所有透明度保持原值，包括光丝边缘的半透明像素。
 */
export function tintBrandPixels(pixels, degrees) {
  if (!degrees) {
    return pixels
  }
  const angle = (degrees * Math.PI) / 180
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const matrix = [
    0.213 + 0.787 * c - 0.213 * s,
    0.715 - 0.715 * c - 0.715 * s,
    0.072 - 0.072 * c + 0.928 * s,
    0.213 - 0.213 * c + 0.143 * s,
    0.715 + 0.285 * c + 0.14 * s,
    0.072 - 0.072 * c - 0.283 * s,
    0.213 - 0.213 * c - 0.787 * s,
    0.715 - 0.715 * c + 0.715 * s,
    0.072 + 0.928 * c + 0.072 * s,
  ]
  for (let index = 0; index < pixels.length; index += 4) {
    if (!pixels[index + 3]) {
      continue
    }
    const r = pixels[index]
    const g = pixels[index + 1]
    const b = pixels[index + 2]
    pixels[index] = Math.round(Math.max(0, Math.min(255, matrix[0] * r + matrix[1] * g + matrix[2] * b)))
    pixels[index + 1] = Math.round(Math.max(0, Math.min(255, matrix[3] * r + matrix[4] * g + matrix[5] * b)))
    pixels[index + 2] = Math.round(Math.max(0, Math.min(255, matrix[6] * r + matrix[7] * g + matrix[8] * b)))
  }
  return pixels
}
