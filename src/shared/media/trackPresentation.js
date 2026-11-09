/**
 * 统一封面协议地址和时长展示，避免列表、播放栏与详情各自维护格式规则。
 * 仅处理展示值，不读取磁盘或主动请求网络。
 */

/**
 * 根据受信索引标识构造歌曲、远程专辑或歌手头像协议地址，空引用返回空值供占位使用。
 * 网络资源只携带已登记标识，不允许界面直接访问任意图片或带认证的服务器 URL。
 */
export function artworkAddress(key) {
  if (!key) {
    return undefined
  }
  if (key.startsWith("remote:")) {
    return `cinder://remote-cover/${key.substring(7)}`
  }
  if (key.startsWith("artist:")) {
    return `cinder://artist-cover/${key.substring(7)}`
  }
  const online = key.startsWith("online:")
  return `cinder://${online ? "online-cover" : "cover"}/${online ? key.substring(7) : key}`
}

/**
 * 将非负秒数显示为累计分钟与秒，未知或无效时长统一显示零。
 */
export function clockLabel(seconds = 0) {
  const total = Math.floor(Number.isFinite(seconds) ? Math.max(0, seconds) : 0)
  return [Math.floor(total / 60), total % 60].map(value => String(value).padStart(2, "0")).join(":")
}

/**
 * 以中文展示歌曲集合的总时长，未满一小时不显示小时字段。
 */
export function durationLabel(seconds = 0) {
  const minutes = Math.floor(Math.max(0, seconds) / 60)
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
}
