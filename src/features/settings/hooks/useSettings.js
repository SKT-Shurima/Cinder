import { useCallback, useRef } from "react"

/**
 * 协调用户设置的保存与即时外观预览，界面只提交允许变更的字段。
 * 保存结果仅由最后一个请求提交，新的滑块预览会使旧响应失效；失败交给统一消息提示。
 */
export default function useSettings({ api, setLibrary, onError: report }) {
  const settingsRevision = useRef(0)
  /**
   * 持久化配色、浅深外观及音量等用户偏好。
   * 设置保存完成后同步界面，目录扫描开关在下次扫描时生效。
   * 仅应用最新请求的返回值，避免迟到的保存结果覆盖下一次拖动中的外观预览。
   */
  const updateSettings = useCallback(
    async value => {
      const revision = ++settingsRevision.current
      try {
        const settings = await api.settings(value)
        if (revision === settingsRevision.current) {
          setLibrary(currentLibrary => ({ ...currentLibrary, settings }))
        }
      } catch (error) {
        report(error)
      }
    },
    [api, setLibrary, report],
  )

  /**
   * 拖动外观滑块时即时预览背景，松开鼠标或结束键盘调整后才持久保存。
   * 只修改允许的渐变范围和玻璃浓度，不对整页内容设置 opacity，保证文字与封面清晰。
   */
  function previewAppearance(key, value) {
    if (!["themeCoverage", "glassOpacity"].includes(key) || !Number.isFinite(value)) {
      return
    }
    settingsRevision.current++
    setLibrary(currentLibrary => ({ ...currentLibrary, settings: { ...currentLibrary.settings, [key]: value } }))
  }

  return { updateSettings, previewAppearance }
}
