/**
 * 向界面暴露固定的音乐、窗口控制和系统播放状态同步能力，隔离 Node.js 与网页执行环境。
 * 界面只能提交歌曲标识、受限配置和白名单窗口操作，不能访问任意文件或任意 IPC 通道。
 */
const { contextBridge, ipcRenderer } = require("electron")

/**
 * 订阅主进程的播放器状态通知。
 * 返回解绑函数，组件销毁时移除监听，避免重复处理后台任务进度。
 */
function subscribe(channel, listener) {
  const handler = (_event, value) => listener(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

/**
 * 将主进程业务失败转换为可直接展示的原因，统一去掉 Electron IPC 包装和内部异常类名称。
 * 只使用受信命令的 message，不传递调用栈或修改平台授权结果；界面仍可正常捕获失败。
 */
async function invoke(channel, ...parameters) {
  try {
    return await ipcRenderer.invoke(channel, ...parameters)
  } catch (failure) {
    const message = String(failure?.message || "操作暂时无法完成，请稍后重试。").replace(
      /^Error invoking remote method '[^']+': (?:[A-Za-z][A-Za-z0-9]*: )?/u,
      "",
    )
    throw new Error(message)
  }
}

/**
 * 发布固定桌面能力及只读的平台、CPU 架构，供窗口控件、快捷键文案和兼容性验证使用。
 * macOS 与 Windows 使用系统窗口按钮；平台信息不扩展文件或 IPC 访问权限。
 */
contextBridge.exposeInMainWorld("cinder", {
  platform: process.platform,
  architecture: process.arch,
  nativeWindowControls: ["darwin", "win32"].includes(process.platform),
  windowState: () => invoke("window:state"),
  windowControl: action => invoke("window:control", action),
  onWindowState: listener => subscribe("window:state", listener),
  playerState: value => invoke("player:state", value),
  snapshot: () => invoke("library:snapshot"),
  scan: () => invoke("library:scan"),
  addRoot: () => invoke("library:add-root"),
  removeRoot: root => invoke("library:remove-root", root),
  scrape: retry => invoke("library:scrape", retry),
  stopScrape: () => invoke("library:stop-scrape"),
  favorite: id => invoke("library:favorite", id),
  playlistSave: input => invoke("playlist:save", input),
  playlistRemove: id => invoke("playlist:remove", id),
  played: id => invoke("library:played", id),
  savePlayer: value => invoke("library:player", value),
  settings: value => invoke("library:settings", value),
  onlineSearch: input => invoke("online:search", input),
  onlineRecommendations: input => invoke("online:recommendations", input),
  onlineTheme: input => invoke("online:theme", input),
  onlineThemeCancel: id => invoke("online:theme-cancel", id),
  onlineArtists: () => invoke("online:artists"),
  onlineArtistTracks: id => invoke("online:artist-tracks", id),
  onlinePrepare: id => invoke("online:prepare", id),
  onlineAdd: ids => invoke("online:add", ids),
  onlineAccounts: () => invoke("online:accounts"),
  onlineLogin: (id, method) => invoke("online:login", id, method),
  onlineLoginCheck: id => invoke("online:login-check", id),
  onlineLoginClose: () => invoke("online:login-close"),
  onlineLoginView: (provider, bounds) => invoke("online:login-view", provider, bounds),
  onlineLoginDetach: () => invoke("online:login-detach"),
  onlineLoginPhone: (action, input) => invoke("online:login-phone", action, input),
  onOnlineLoginDismiss: listener => subscribe("online:login-dismiss", listener),
  onOnlineAccounts: listener => subscribe("online:accounts-changed", listener),
  onOnlinePlaybackError: listener => subscribe("online:playback-error", listener),
  remoteKey: () => invoke("remote:key"),
  remoteConfigure: (value, save) => invoke("remote:configure", value, save),
  remoteScan: id => invoke("remote:scan", id),
  remoteRemove: id => invoke("remote:remove", id),
  remoteMetadata: id => invoke("remote:metadata", id),
  remoteRecommendations: (id, enabled) => invoke("remote:recommendations", id, enabled),
  remotePresetInfo: id => invoke("remote:preset-info", id),
  lyrics: (id, options) => invoke("library:lyrics", id, options),
  candidates: id => invoke("library:candidates", id),
  applyCandidate: (id, candidateId) => invoke("library:apply-candidate", id, candidateId),
  chooseCover: (type, id) => invoke("library:choose-cover", type, id),
  reveal: id => invoke("library:reveal", id),
  openSource: id => invoke("library:open-source", id),
  onProgress: listener => subscribe("library:progress", listener),
  onChanged: listener => subscribe("library:changed", listener),
  onMedia: listener => subscribe("player:media", listener),
})
