/**
 * 统一订阅平台账号关联状态，设置页、在线音乐和登录弹层使用相同的状态来源。
 * 查询中和查询失败分别保留，不把尚未拿到结果的账号误显示为未关联。
 */
import { useCallback, useEffect, useRef, useState } from "react"

/**
 * 初次进入和应用重新聚焦时查询平台会话，账号变化通知立即刷新可见状态。
 * 查询响应晚于新通知时丢弃旧快照，卸载后释放监听且不再更新界面。
 */
export default function useOnlineAccounts(api) {
  const [accounts, setAccounts] = useState({})
  const [pending, setPending] = useState(true)
  const [error, setError] = useState("")
  const active = useRef(false)
  const revision = useRef(0)
  /**
   * 发起一次受版本保护的状态查询，失败时提供重试入口并保留最后一次已知账号数据。
   * 结果只包含关联标记，界面不读取 Cookie 或其他认证凭据。
   */
  const refresh = useCallback(async () => {
    if (!active.current) {
      return
    }
    const version = ++revision.current
    setPending(true)
    try {
      const value = await api.onlineAccounts()
      if (active.current && version === revision.current) {
        setAccounts(value)
        setError("")
      }
    } catch {
      if (active.current && version === revision.current) {
        setError("账号状态暂时无法确认")
      }
    } finally {
      if (active.current && version === revision.current) {
        setPending(false)
      }
    }
  }, [api])
  useEffect(() => {
    active.current = true
    refresh()
    const unsubscribe = api.onOnlineAccounts(value => {
      if (active.current) {
        revision.current++
        setAccounts(value)
        setPending(false)
        setError("")
      }
    })
    window.addEventListener("focus", refresh)
    return () => {
      active.current = false
      revision.current++
      unsubscribe()
      window.removeEventListener("focus", refresh)
    }
  }, [api, refresh])
  return { accounts, pending, error, refresh }
}
