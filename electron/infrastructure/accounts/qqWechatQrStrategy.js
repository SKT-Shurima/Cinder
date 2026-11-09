/**
 * 适配 QQ 音乐官网的微信扫码流程，二维码和授权码始终留在受限平台会话内。
 * 只解析官方响应的固定字段，不执行响应脚本；音乐会话交换遵循官方回调页的请求格式。
 */
import { randomUUID } from "node:crypto"
import { WechatQrClient } from "./wechatQrClient.js"

/**
 * QQ 音乐网页微信登录使用的公开应用标识，与 QQ 扫码使用的 OAuth 应用区分。
 * 这些参数不包含应用密钥，授权回调只允许返回 QQ 音乐官网。
 */
const application = "wx48db31d50e334801"
const callback = "https://y.qq.com/portal/wx_redirect.html?login_type=2&surl=https://y.qq.com/"

/**
 * 申请独立微信二维码并在手机确认后交换 QQ 音乐会话，供账号门面按登录方式选择。
 * 长轮询沿用微信官网的三十秒等待窗口，关闭弹层或切换方式时由门面中止请求。
 */
export class QqWechatQrStrategy {
  /**
   * 组合公共微信扫码客户端，QQ 音乐专属的会话交换保留在当前平台策略中。
   */
  constructor() {
    this.qr = new WechatQrClient()
  }

  /**
   * 从微信官方授权页读取一次性二维码标识，再获取真实二维码图片。
   * 不自行改造 QQ 二维码；返回的随机状态和扫码标识仅供主进程后续核验使用。
   */
  async create(context) {
    const state = randomUUID()
    const query = new URLSearchParams({
      appid: application,
      redirect_uri: callback,
      response_type: "code",
      scope: "snsapi_login",
      state,
    })
    return this.qr.create(context, "https://open.weixin.qq.com/connect/qrconnect?" + query)
  }

  /**
   * 读取微信扫码与手机确认状态，只有官方返回授权码后才请求 QQ 音乐建立会话。
   * 三十秒长轮询超时属于继续等待；取消、过期或关闭不会触发音乐账号授权请求。
   */
  async check(context, operation) {
    const result = await this.qr.check(context, operation)
    if (result.status === "confirmed") {
      await this.authorize(context, result.code)
      return "authorized"
    }
    return result.status
  }

  /**
   * 按 QQ 音乐官方微信回调页的格式交换一次性授权码，认证 Cookie 由 Chromium 会话接收。
   * 只有双层业务状态均成功才设置微信登录标记；不会记录或向渲染层返回授权码、票据和用户资料。
   */
  async authorize(context, code) {
    const cookies = await context.session.cookies.get({ url: "https://y.qq.com/" })
    const key =
      ["qqmusic_key", "p_skey", "skey", "p_lskey", "lskey"]
        .map(name => cookies.find(cookie => cookie.name === name)?.value)
        .find(Boolean) || ""
    const token = [...key].reduce((hash, character) => (hash + (hash << 5) + character.charCodeAt(0)) & 0x7fffffff, 5381)
    const payload = await context.json("https://u.y.qq.com/cgi-bin/musicu.fcg", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://y.qq.com" },
      body: JSON.stringify({
        comm: { g_tk: token, platform: "yqq", ct: 24, cv: 0, tmeAppID: "qqmusic", tmeLoginType: "1" },
        req: { module: "music.login.LoginServer", method: "Login", param: { strAppid: application, code } },
      }),
    })
    if (payload.code !== 0 || payload.req?.code !== 0) {
      throw new Error("QQ 音乐未完成微信授权，请刷新二维码重试")
    }
    if (!context.active()) {
      throw new Error("登录操作已关闭")
    }
    await context.session.cookies.set({
      url: "https://y.qq.com/",
      domain: ".qq.com",
      name: "login_type",
      value: "2",
      secure: true,
    })
  }
}
