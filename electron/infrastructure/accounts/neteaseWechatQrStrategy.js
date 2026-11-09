/**
 * 适配网易云官方微信授权入口，公共二维码协议委托给微信客户端。
 * 每次授权使用网易云实时生成的状态和回调参数，音乐会话保存在独立平台分区。
 */
import { WechatQrClient } from "./wechatQrClient.js"

/**
 * 将平台 OAuth 回调适配成扫码策略，音乐会话由平台自己的 HTTPS 服务端建立。
 * 不具备完整音乐会话时由账号门面拒绝显示关联成功，避免只确认微信身份就误报登录。
 */
export class NeteaseWechatQrStrategy {
  /**
   * 组合网易云固定授权流程与公共扫码客户端，调用者不能提供任意平台或回调地址。
   */
  constructor() {
    this.qr = new WechatQrClient()
  }

  /**
   * 请求网易云官方桌面微信入口，保留服务器生成的状态和回调参数。
   * 不使用其他客户端的应用标识，微信确认后的授权码只交还网易云自己的回调。
   */
  async create(context) {
    const address = "https://music.163.com/api/sns/authorize?snsType=10&clientType=web2&callbackType=Login&forcelogin=true"
    const result = await this.qr.create(context, address)
    this.callback(result.redirect)
    return result
  }

  /**
   * 确认回调仍是当前平台约定的 HTTPS 接收地址，不允许将授权码交给其他官方子系统。
   */
  callback(address) {
    const url = new URL(address)
    if (
      url.protocol !== "https:" ||
      url.hostname !== "music.163.com" ||
      url.pathname !== "/back/weichat" ||
      url.username ||
      url.password ||
      url.port
    ) {
      throw new Error("平台返回了无效的微信授权回调")
    }
    return url
  }

  /**
   * 手机允许后将一次性授权码提交回对应音乐平台，Chromium 接收平台返回的认证 Cookie。
   * 关闭任务后的响应不会继续提交；明确的回调失败或异常正文只返回可重试提示。
   */
  async check(context, operation) {
    const result = await this.qr.check(context, operation)
    if (result.status !== "confirmed") {
      return result.status
    }
    const address = this.callback(operation.redirect)
    address.searchParams.set("code", result.code)
    address.searchParams.set("state", operation.state)
    const response = await context.request(address.href)
    const text = await response.text()
    if (text.length > 1048576) {
      throw new Error("平台授权响应超过大小限制")
    }
    if (!context.active()) {
      throw new Error("登录操作已关闭")
    }
    let value
    try {
      value = JSON.parse(text)
    } catch {
      /* 正常网页回调通过认证 Cookie 判断结果，不执行页面脚本。 */
    }
    if (value?.status === 0 || (value?.code !== undefined && ![0, 200].includes(Number(value.code)))) {
      throw new Error("平台未完成微信授权，请刷新二维码或使用 App 扫码重试")
    }
    return "authorized"
  }
}
