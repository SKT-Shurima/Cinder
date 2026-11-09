/**
 * 按需读取所有来源的主题分类，离开页面后停止后台在线补充任务。
 */
import { useCallback, useEffect, useState } from "react"

/**
 * 保留已经核验的歌曲并增量刷新，账号、主题或来源变化时隔离迟到响应。
 * 仅远程或本地模式也会查询分类；只在补充在线候选时轮询，失败或完成后等待用户重试。
 */
export default function useThemeMusic({ api, id, sourceKey }) {
  const [detail, setDetail] = useState({ id: null, tracks: [], phase: "loading", checked: 0, message: "" })
  const [revision, setRevision] = useState(0)
  /**
   * 重新汇集当前分类，主进程丢弃旧任务并重新校验真实平台资源。
   * 不改变已开始播放的歌曲，也不自动替换播放队列。
   */
  const retry = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => api.onOnlineAccounts?.(retry), [api, retry])
  useEffect(() => {
    if (!id) {
      return
    }
    let alive = true
    let timer
    setDetail({ id, tracks: [], phase: "loading", checked: 0, message: "" })
    /**
     * 上一次查询结束后才安排下一次，避免慢网络叠加多个 IPC 请求。
     * 旧页的响应不写状态，后台任务只由仍在浏览的当前分类继续推进。
     */
    async function poll(refresh = false) {
      try {
        const value = await api.onlineTheme({ id, refresh })
        if (!alive) {
          return
        }
        setDetail(value)
        if (value.phase === "loading") {
          timer = setTimeout(poll, 1200)
        }
      } catch (failure) {
        if (alive) {
          setDetail(value => ({
            ...value,
            phase: "partial",
            message: String(failure.message || failure).replace(/^Error invoking remote method '[^']+': Error: /, ""),
          }))
        }
      }
    }
    poll(revision > 0)
    return () => {
      alive = false
      clearTimeout(timer)
      api.onlineThemeCancel(id).catch(() => {})
    }
  }, [api, id, sourceKey, revision])
  return { ...(detail.id === id ? detail : { tracks: [], phase: "loading", checked: 0, message: "" }), retry }
}
