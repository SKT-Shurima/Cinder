/**
 * 维护可追溯到项目官网或运营机构的远程连接预设，不收录个人分享库。
 * 演示账号均由运营方公开发布；需要私人账号的服务只提供地址，不编造登录凭据。
 */
export const remoteLibraryPresets = Object.freeze([
  Object.freeze({
    id: "navidrome-demo",
    name: "Navidrome 官方演示",
    protocol: "subsonic",
    serverUrl: "https://demo.navidrome.org/",
    operator: "Navidrome",
    description: "欧美开放授权音乐 · 连接测试",
    access: "public",
    recommendationsEnabled: false,
    username: "demo",
    password: "demo",
    infoUrl: "https://www.navidrome.org/demo/",
  }),
  Object.freeze({
    id: "ampache-demo",
    name: "Ampache 官方演示",
    protocol: "subsonic",
    serverUrl: "https://demo.ampache.dev/",
    operator: "Ampache",
    description: "欧美 Creative Commons 音乐 · 连接测试",
    access: "public",
    recommendationsEnabled: false,
    username: "demo",
    password: "demodemo",
    infoUrl: "https://ampache.org/docs/clients/demo-server/",
  }),
  Object.freeze({
    id: "dogmazic",
    name: "Dogmazic 自由音乐库",
    protocol: "subsonic",
    serverUrl: "https://play.dogmazic.net/",
    operator: "Musique Libre!",
    description: "法国自由音乐库 · 需自己的账号",
    access: "account",
    recommendationsEnabled: false,
    infoUrl: "https://www.dogmazic.net/",
  }),
])

/**
 * 仅为地址和用户名完全匹配的官方演示来源恢复公开凭据。
 * 私人账号、被修改的地址及未登记预设一律不回退，避免把演示密码发送给其他服务器。
 */
export function publicPresetCredentials(source) {
  const preset = remoteLibraryPresets.find(item => item.id === source?.presetId && item.access === "public")
  return preset &&
    source.protocol === preset.protocol &&
    source.serverUrl === preset.serverUrl &&
    source.username === preset.username
    ? { password: preset.password }
    : null
}
