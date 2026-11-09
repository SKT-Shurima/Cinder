/**
 * 将窗口内的播放键行为与具体页面解耦，只有已聚焦应用接收到的键盘事件才进入这里。
 */

/**
 * 用空格切换暂停和播放，即使焦点停留在歌曲或其他按钮上也优先控制音乐。
 * 文字输入、组合输入、修饰键组合与编辑弹窗保留原行为；阻止按钮默认点击并忽略长按重复。
 * 返回是否已消费事件，调用者据此停止后续页面快捷键分派，不注册系统全局空格键。
 */
export function handlePlaybackSpace(event, { blocked = false, toggle }) {
  if (
    blocked ||
    event.isComposing ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey ||
    (event.code !== "Space" && event.key !== " ")
  ) {
    return false
  }
  const target = event.target
  if (
    /^(INPUT|TEXTAREA|SELECT)$/u.test(target?.tagName || "") ||
    target?.isContentEditable ||
    target?.closest?.('[role="textbox"]')
  ) {
    return false
  }
  event.preventDefault()
  if (!event.repeat) {
    toggle()
  }
  return true
}
