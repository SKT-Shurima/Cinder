import React, { useEffect, useState } from "react"
import { Copy, Minimize2, Minus, Square, X } from "lucide-react"
import IconButton from "@/shared/ui/IconButton.jsx"
import api from "@/shared/desktop/desktopApi.js"
/**
 * 在未启用原生窗口按钮的平台提供左上角窗口操作，macOS 与 Windows 直接使用系统按钮。
 * 同步系统菜单带来的状态变化；初始查询不得覆盖更晚的事件，卸载后停止更新。
 */
export default function WindowControls({ onError }) {
  const [state, setState] = useState(null)
  useEffect(() => {
    let alive = true
    let receivedEvent = false
    const off = api.onWindowState(value => {
      receivedEvent = true
      if (alive) {
        setState(value)
      }
    })
    api
      .windowState()
      .then(value => {
        if (alive && !receivedEvent) {
          setState(value)
        }
      })
      .catch(onError)
    return () => {
      alive = false
      off()
    }
  }, [onError])

  /**
   * 通过受限 IPC 请求窗口操作，系统拒绝时将原因交给统一提示栏。
   * 关闭行为由主进程按平台决定，界面不直接终止进程或清空当前播放队列。
   */
  async function perform(action) {
    try {
      await api.windowControl(action)
    } catch (error) {
      onError(error)
    }
  }

  return (
    <div className="window-controls" role="group" aria-label="窗口控制">
      <IconButton icon={X} label="关闭窗口" className="window-close" onClick={() => perform("close")} />
      <IconButton icon={Minus} label="最小化窗口" onClick={() => perform("minimize")} />
      <IconButton
        icon={state?.fullscreen ? Minimize2 : state?.maximized ? Copy : Square}
        label={state?.fullscreen ? "退出全屏" : state?.maximized ? "还原窗口" : "最大化窗口"}
        disabled={!state}
        onClick={() => perform("toggle-maximize")}
      />
    </div>
  )
}
