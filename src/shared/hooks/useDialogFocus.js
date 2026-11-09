/**
 * 为应用内弹层提供初始焦点、键盘循环与关闭后的焦点恢复。
 * 只在弹层挂载时接管键盘；关闭回调通过引用更新，避免内容刷新重置用户焦点。
 */
import { useEffect, useRef } from "react"

/**
 * 接管当前弹层的键盘焦点与 Escape 关闭动作，供多个业务弹层共用。
 * 内容异步变化时重新读取可用控件，卸载后恢复之前的焦点并取消键盘监听。
 */
export default function useDialogFocus(container, onDismiss) {
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss
  useEffect(() => {
    const previous = document.activeElement
    /**
     * 每次按键读取当前可用控件，异步加载后的按钮也遵循同一焦点边界。
     */
    const keyboard = event => {
      if (event.key === "Escape") {
        event.preventDefault()
        dismiss.current()
        return
      }
      if (event.key !== "Tab") {
        return
      }
      const controls = [
        ...container.current.querySelectorAll('button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]'),
      ]
      const first = controls[0]
      const last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    container.current.querySelector("button, input")?.focus()
    document.addEventListener("keydown", keyboard)
    return () => {
      document.removeEventListener("keydown", keyboard)
      previous?.focus()
    }
  }, [container])
}
