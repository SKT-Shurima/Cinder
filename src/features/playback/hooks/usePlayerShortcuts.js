import { useEffect } from "react"
import { handlePlaybackSpace } from "../model/playbackShortcuts.js"

/**
 * 绑定窗口快捷键和受信系统媒体消息，所有播放操作复用同一个音频控制器。
 * 输入和编辑弹窗保留原生按键；关闭浮层有明确优先级，卸载或动作变化时移除旧监听。
 */
export default function usePlayerShortcuts({ api, player, navigation, artworkOpen, playlistOpen, closeDetails }) {
  const { toggle, step, pause } = player
  const { loginProvider, soundOpen, setQueueOpen, setSoundOpen, openSettingsFromMenu } = navigation
  useEffect(() => {
    /**
     * 优先处理可编辑区域之外的播放器快捷键，避免空格同时触发播放和焦点按钮点击。
     */
    const handleKeyDown = event => {
      if (loginProvider || playlistOpen) {
        return
      }
      if (event.key === "Escape" && !artworkOpen) {
        setQueueOpen(false)
        if (soundOpen) {
          setSoundOpen(false)
          return
        }
        closeDetails()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "f") {
        event.preventDefault()
        document.querySelector("#global-search")?.focus()
        return
      }
      handlePlaybackSpace(event, { blocked: artworkOpen, toggle })
    }
    window.addEventListener("keydown", handleKeyDown)
    const off = api.onMedia(action => {
      if (action === "toggle") {
        toggle()
      }
      if (action === "pause") {
        pause()
      }
      if (action === "next") {
        step(1)
      }
      if (action === "previous") {
        step(-1)
      }
      if (action === "settings") {
        openSettingsFromMenu()
      }
    })
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      off()
    }
  }, [
    api,
    toggle,
    step,
    pause,
    loginProvider,
    soundOpen,
    artworkOpen,
    playlistOpen,
    closeDetails,
    setQueueOpen,
    setSoundOpen,
    openSettingsFromMenu,
  ])
}
