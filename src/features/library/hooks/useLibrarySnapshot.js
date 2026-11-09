/**
 * 协调曲库快照读取、后台事件合并与首次会话恢复，界面组件不直接维护订阅细节。
 * 首次恢复仅发生一次；较早发出的查询不能覆盖已完成的较新快照。
 */
import { useCallback, useEffect, useRef, useState } from "react"

/**
 * 向应用提供最新曲库、任务状态与受控刷新接口，集中维护后台订阅。
 * 首次恢复与后续刷新分别处理，异步响应必须通过版本和挂载状态校验。
 */
export default function useLibrarySnapshot(api, onError) {
  const [library, setLibrary] = useState(null)
  const [status, setStatus] = useState({ phase: "idle" })
  const [initialSnapshot, setInitialSnapshot] = useState(null)
  const initialized = useRef(false)
  const request = useRef(0)
  const mounted = useRef(true)
  /**
   * 读取最新索引并按版本提交，恢复播放参数由应用层一次性完成。
   * 页面卸载后不提交结果，异步失败统一交给应用错误提示。
   */
  const refresh = useCallback(async () => {
    const version = ++request.current
    try {
      const snapshot = await api.snapshot()
      if (!mounted.current || request.current !== version) {
        return
      }
      if (!initialized.current) {
        initialized.current = true
        setInitialSnapshot(snapshot)
      }
      setLibrary(snapshot)
      setStatus(snapshot.status)
    } catch (failure) {
      if (mounted.current && request.current === version) {
        onError(failure)
      }
    }
  }, [api, onError])
  useEffect(() => {
    mounted.current = true
    let queued
    /**
     * 将连续封面或索引更新合并为一次读取，任务结束仍立即刷新完整快照。
     */
    const schedule = () => {
      clearTimeout(queued)
      queued = setTimeout(refresh, 180)
    }
    const unsubscribe = [
      api.onChanged(schedule),
      api.onProgress(progress => {
        setStatus(progress)
        if (progress.phase === "idle") {
          refresh()
        }
      }),
    ]
    refresh()
    return () => {
      mounted.current = false
      request.current += 1
      clearTimeout(queued)
      unsubscribe.forEach(release => release())
    }
  }, [api, refresh])
  return { library, setLibrary, status, initialized, initialSnapshot, refresh }
}
