/**
 * 定义本地、在线与服务器来源的持久偏好，以及可接入资源的音乐平台。
 * 默认三类来源同时启用；模式只影响展示与播放选择，不删除曲库索引和服务器配置。
 */
export const sourceKinds = Object.freeze(["local", "online", "remote"])

/**
 * 平台名称与官方认证入口，前端仅提交固定标识，不能通过 IPC 指定任意资源网址。
 * 歌曲搜索和音频解析由主进程执行，所有资源交给 Cinder 播放；账号权限仍由平台判断。
 */
export const musicProviders = Object.freeze([
  { id: "qq", name: "QQ 音乐", url: "https://y.qq.com/", description: "搜索歌曲与专辑资源" },
  { id: "netease", name: "网易云音乐", url: "https://music.163.com/", description: "搜索歌曲与专辑资源" },
])

/**
 * 恢复来源偏好，旧版本未保存的类别默认启用，异常的全关闭配置回到本地模式。
 * 只接受固定字段的布尔值，避免额外配置或损坏数据改变来源边界。
 */
export function normalizeMusicSources(value) {
  const result = Object.fromEntries(sourceKinds.map(key => [key, typeof value?.[key] === "boolean" ? value[key] : true]))
  if (!Object.values(result).some(Boolean)) {
    result.local = true
  }
  return result
}

/**
 * 合并一次来源切换，至少保留一种启用状态，防止设置后整个应用没有可用入口。
 * 无效字段忽略；合法但会关闭最后一种来源的操作明确报错，不静默改成其他模式。
 */
export function updateMusicSources(current, input) {
  const next = normalizeMusicSources(current)
  for (const key of sourceKinds) {
    if (typeof input?.[key] === "boolean") {
      next[key] = input[key]
    }
  }
  if (!Object.values(next).some(Boolean)) {
    throw new Error("请至少保留一种音乐来源。")
  }
  return next
}

/**
 * 仅恢复当前支持的平台开关，首次使用默认提供各平台的原生资源入口。
 * 关闭平台不清除其官方登录会话，重新开启后仍由平台接口判断账号是否有效。
 * 旧版已移除的平台字段不会继续出现在设置、搜索或账号入口中。
 */
export function normalizeMusicProviders(value) {
  return Object.fromEntries(musicProviders.map(({ id }) => [id, typeof value?.[id] === "boolean" ? value[id] : true]))
}
