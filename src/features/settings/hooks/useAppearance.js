import { useEffect, useState } from "react"
import { brandHueRotations } from "#shared/brand"
/**
 * 将配色、透明 Logo 色相与外观偏好同步到页面，并在跟随系统时监听系统外观变化。
 * 未读取到偏好时先显示深色火焰背景，避免启动白屏；手动外观不受系统变化覆盖。
 * 系统外观与可见性监听器随组件释放，后台停止装饰动画；配色同步 Logo、渐变范围和玻璃层浓度；主题色默认合计占 70%，均分为两条色带。
 */
export default function useAppearance(settings) {
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches)
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)")
    const changed = event => setSystemDark(event.matches)
    media.addEventListener("change", changed)
    return () => media.removeEventListener("change", changed)
  }, [])
  useEffect(() => {
    /**
     * 后台窗口暂停播放状态标记的装饰循环，不影响真正的音频与全局快捷键。
     */
    const visibility = () => {
      document.documentElement.dataset.foreground = String(!document.hidden)
    }
    visibility()
    document.addEventListener("visibilitychange", visibility)
    return () => document.removeEventListener("visibilitychange", visibility)
  }, [])
  const resolved = settings?.theme === "system" ? (systemDark ? "dark" : "light") : settings?.theme || "dark"
  useEffect(() => {
    document.documentElement.dataset.theme = resolved
    const accent = settings?.accent || "flame"
    document.documentElement.dataset.accent = accent
    document.documentElement.style.setProperty("--brand-hue", `${brandHueRotations[accent] || 0}deg`)
    document.documentElement.style.setProperty("--theme-coverage", `${settings?.themeCoverage ?? 70}%`)
    document.documentElement.style.setProperty("--glass-opacity", String((settings?.glassOpacity ?? 70) / 100))
  }, [resolved, settings?.accent, settings?.themeCoverage, settings?.glassOpacity])
  return resolved
}
