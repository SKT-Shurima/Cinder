/**
 * 将各平台官方扫码协议适配成申请与检查两个动作，公共界面无需了解平台状态码。
 * 二维码凭证只在主进程内保留，返回界面的内容仅为二维码图片、状态和业务提示。
 */
import QRCode from "qrcode"

/**
 * 将非敏感扫码网址编码为本地 PNG，不把二维码内容发送给第三方图片生成服务。
 */
async function qrImage(address) {
  return QRCode.toDataURL(address, { width: 240, margin: 2, errorCorrectionLevel: "M" })
}

/**
 * 适配网易云官方二维码申请与扫码确认状态，供账号门面统一调度。
 * 仅返回状态与二维码图片，认证 Cookie 由调用方的持久会话管理。
 */
export class NeteaseQrStrategy {
  /**
   * 从官方接口申请一次性扫码键，二维码有效期由授权服务控制。
   */
  async create(context) {
    const payload = await context.json("https://music.163.com/api/login/qrcode/unikey", {
      method: "POST",
      body: new URLSearchParams({ type: "1" }),
    })
    if (!payload.unikey) {
      throw new Error("网易云暂时无法生成二维码，请重试")
    }
    return { key: payload.unikey, image: await qrImage("https://music.163.com/login?codekey=" + payload.unikey) }
  }

  /**
   * 检查扫码和手机确认状态，服务端成功后仍核对 Chromium 中的认证 Cookie。
   * 扫码成功的账号数据不会返回界面或写入音乐索引。
   */
  async check(context, operation) {
    const payload = await context.json("https://music.163.com/api/login/qrcode/client/login", {
      method: "POST",
      body: new URLSearchParams({ type: "1", key: operation.key }),
    })
    return { 800: "expired", 801: "waiting", 802: "confirming", 803: "authorized" }[payload.code] ?? "waiting"
  }
}

/**
 * 适配 QQ 音乐官方扫码图像、签名和手机确认流程。
 * 回调文本只按固定字段解析，完成授权仍交由受限官方地址处理。
 */
export class QqQrStrategy {
  /**
   * QQ 音乐官方网页登录参数，回调仍进入平台自己的授权交换流程。
   */
  constructor() {
    this.application = "716027609"
    this.redirect = "https://graph.qq.com/oauth2.0/login_jump"
  }

  /**
   * 获取 QQ 官方二维码图片与同一会话的扫码签名，图片直接从官方认证域获取。
   */
  async create(context) {
    const query = new URLSearchParams({
      appid: this.application,
      e: "2",
      l: "M",
      s: "3",
      d: "72",
      v: "4",
      t: String(Math.random()),
      daid: "383",
      pt_3rd_aid: "100497308",
    })
    const response = await context.request("https://ssl.ptlogin2.qq.com/ptqrshow?" + query, {
      headers: { Referer: "https://xui.ptlogin2.qq.com/", "User-Agent": "Mozilla/5.0" },
    })
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > 1048576 || bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a") {
      throw new Error("QQ 暂时无法生成二维码，请重试")
    }
    const signature = (await context.session.cookies.get({ name: "qrsig" }))[0]?.value
    if (!signature) {
      throw new Error("QQ 扫码会话未建立，请重试")
    }
    return { key: signature, image: "data:image/png;base64," + bytes.toString("base64") }
  }

  /**
   * 根据当前二维码签名检查 QQ 手机确认，成功时只访问官方返回的受限授权地址。
   * 回调文本按固定字段解析，不执行平台返回的 JavaScript。
   */
  async check(context, operation) {
    const token = [...operation.key].reduce((hash, character) => (hash + (hash << 5) + character.charCodeAt(0)) & 0x7fffffff, 0)
    const query = new URLSearchParams({
      u1: this.redirect,
      ptqrtoken: String(token),
      ptredirect: "0",
      h: "1",
      t: "1",
      g: "1",
      from_ui: "1",
      ptlang: "2052",
      action: "0-0-" + Date.now(),
      js_ver: "22080914",
      js_type: "1",
      login_sig: "",
      pt_uistyle: "40",
      aid: this.application,
      daid: "383",
      pt_3rd_aid: "100497308",
    })
    const response = await context.request("https://ssl.ptlogin2.qq.com/ptqrlogin?" + query, {
      headers: { Referer: "https://xui.ptlogin2.qq.com/", "User-Agent": "Mozilla/5.0" },
    })
    const text = await response.text()
    const fields = [...text.matchAll(/'([^']*)'/gu)].map(match => match[1])
    if (fields[0] === "0") {
      await context.complete(fields[2])
      return "authorizing"
    }
    return { 65: "expired", 66: "waiting", 67: "confirming" }[fields[0]] ?? "waiting"
  }
}
