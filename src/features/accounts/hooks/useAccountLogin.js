/**
 * 管理应用内认证弹层的扫码状态机，界面与平台策略通过受限桌面接口通信。
 * 轮询等待上次请求结束再调度；切换平台、模式或关闭后丢弃迟到结果并停止轮询。
 */
import { useCallback, useEffect, useRef, useState } from "react"

/**
 * 去掉桌面 IPC 的内部包装，只向用户展示认证服务给出的业务原因。
 * 网络异常未提供说明时使用对应阶段的重试提示，不展示平台响应正文。
 */
function loginFailure(error, fallback) {
  return error?.message?.replace(/^Error invoking remote method '[^']+': Error: /u, "") || fallback
}

/**
 * 为当前平台提供二维码状态与刷新动作，供统一登录弹层订阅。
 * 模式或平台改变时释放旧轮询，只有当前请求版本允许提交结果。
 * 微信与 QQ 扫码按独立请求标识呈现，切换瞬间隐藏旧图片；成功状态只采信对应扫码任务。
 */
export default function useAccountLogin(api, provider, mode) {
  const [state, setState] = useState({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const revision = useRef(0)
  const requestKey = `${provider}:${mode}:${attempt}`
  useEffect(() => {
    if (!["qr", "wechat"].includes(mode)) {
      return
    }
    const version = ++revision.current
    let timer
    let active = true
    setState({ status: "loading", requestKey })
    /**
     * 一次只检查当前二维码，成功、过期或错误后不继续访问平台。
     */
    async function poll(id) {
      try {
        const result = await api.onlineLoginCheck(id)
        if (!active || revision.current !== version) {
          return
        }
        setState(current => ({ ...current, ...result }))
        if (["waiting", "confirming", "authorizing"].includes(result.status)) {
          timer = setTimeout(() => poll(id), 2000)
        }
      } catch (error) {
        if (active && revision.current === version) {
          setState(current => ({ ...current, status: "error", message: loginFailure(error, "平台连接中断，请刷新二维码重试") }))
        }
      }
    }
    api
      .onlineLogin(provider, mode)
      .then(result => {
        if (!active || revision.current !== version) {
          return
        }
        setState({ ...result, requestKey })
        timer = setTimeout(() => poll(result.id), 1600)
      })
      .catch(error => {
        if (active && revision.current === version) {
          setState({ status: "error", requestKey, message: loginFailure(error, "二维码生成失败，请刷新重试") })
        }
      })
    return () => {
      active = false
      revision.current += 1
      clearTimeout(timer)
      api.onlineLoginClose().catch(() => {})
    }
  }, [api, provider, mode, attempt, requestKey])
  const refresh = useCallback(() => setAttempt(value => value + 1), [])
  return { state: state.requestKey === requestKey ? state : { status: "loading" }, refresh }
}
