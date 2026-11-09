/**
 * 以固定间隔提交最新播放模型，播放器状态更新不重新创建定时器。
 * 卸载与关闭时补交最后状态，未恢复会话前不覆盖之前保存的队列。
 */
import { useEffect, useRef } from "react"

/**
 * 在应用运行和关闭时保存最新播放位置与队列，供下次启动恢复。
 * 初始恢复完成前不写入；引用保存最新模型，状态变化不会反复重建定时器。
 */
export default function usePlaybackPersistence(api, model, ready, onError) {
  const latest = useRef(model)
  latest.current = model
  useEffect(() => {
    /**
     * 保存当前有效歌曲的小型播放快照，失败只提示业务错误，不暂停音乐。
     */
    const persist = () => {
      if (ready.current && latest.current.trackId) {
        return api.savePlayer(latest.current).catch(onError)
      }
    }
    const timer = setInterval(persist, 5000)
    window.addEventListener("beforeunload", persist)
    return () => {
      clearInterval(timer)
      window.removeEventListener("beforeunload", persist)
      persist()
    }
  }, [api, ready, onError])
}
