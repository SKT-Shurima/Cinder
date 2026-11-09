/**
 * 统一支持的音乐平台在登录弹层中的方式顺序和扫码提示，保持入口名称与实际协议一致。
 */

/**
 * 为当前平台组合微信、平台 App 扫码及账号表单，默认使用微信扫码。
 * QQ 音乐的平台扫码使用手机 QQ，网易云账号表单使用短信验证码。
 */
export function accountLoginMethods(provider) {
  const scanner = provider === "qq" ? "手机 QQ" : "网易云音乐 App"
  return [
    { id: "wechat", label: "微信扫码", kind: "qr", scanner: "微信" },
    { id: "qr", label: provider === "qq" ? "QQ 扫码" : "App 扫码", kind: "qr", scanner },
    { id: "account", label: provider === "netease" ? "验证码登录" : "账号登录", kind: "account" },
  ]
}
