/**
 * 向桌面适配层同步即时播放能力，供程序坞等窗口外入口显示正确状态。
 * 与五秒一次的播放进度存储分离，暂停、恢复及队列变化不等待持久化周期。
 */
import { useEffect } from "react"

/**
 * 播放或可用操作发生变化时提交三个布尔值，不发送曲目信息和高频进度。
 * 状态由真实音频事件决定，菜单点击继续复用现有媒体命令；同步失败沿用界面错误提示。
 */
export default function useDesktopPlaybackState(api, { playing, canToggle, canSkip }, onError) {
  useEffect(() => {
    api.playerState({ playing, canToggle, canSkip }).catch(onError)
  }, [api, playing, canToggle, canSkip, onError])
}
