/**
 * 统一微信网页授权的二维码读取和扫码状态解析，各音乐平台只负责自己的会话交换。
 * 授权页脚本不会在主进程执行；扫码键、授权码和回调参数不通过 IPC 返回渲染层。
 */

/**
 * 提供无平台状态的微信扫码传输能力，所有请求沿用调用方的平台隔离会话。
 * 请求取消、官方地址限制和超时统一由账号门面控制，不维护额外轮询定时器。
 */
export class WechatQrClient {
  /**
   * 从官方授权入口跟随跳转读取真实二维码，保留平台本次生成的回调和状态参数。
   * 只接受微信扫码页及固定图片路径，不把任意页面里的外链当作二维码加载。
   */
  async create(context, address) {
    const response = await context.request(address)
    const resolved = new URL(response.url || address)
    if (resolved.origin !== "https://open.weixin.qq.com" || resolved.pathname !== "/connect/qrconnect") {
      throw new Error("平台未返回微信扫码授权页，请稍后重试")
    }
    const html = await response.text()
    if (html.length > 1048576) {
      throw new Error("微信授权响应超过大小限制")
    }
    const key = html.match(/src=["'](?:https:\/\/open\.weixin\.qq\.com)?\/connect\/qrcode\/([\w-]{8,128})["']/u)?.[1]
    if (!key) {
      throw new Error("平台暂时无法生成微信二维码，请刷新重试")
    }
    const image = await context.request("https://open.weixin.qq.com/connect/qrcode/" + key)
    const bytes = Buffer.from(await image.arrayBuffer())
    const mime = bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
      ? "image/png"
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        ? "image/jpeg"
        : null
    if (!mime || bytes.length > 1048576) {
      throw new Error("微信二维码图片暂不可用，请刷新重试")
    }
    const pollingHost = /usenewdomain\s*=\s*["']?1/u.test(html)
      ? "https://lp.open.weixin.qq.com"
      : "https://long.open.weixin.qq.com"
    return {
      key,
      pollingHost,
      state: resolved.searchParams.get("state") || "",
      redirect: resolved.searchParams.get("redirect_uri") || "",
      image: `data:${mime};base64,${bytes.toString("base64")}`,
    }
  }

  /**
   * 将微信官方长轮询结果转换成等待、手机确认、失效或已确认授权码四类状态。
   * 三十秒等待超时可继续轮询；取消和未知响应不触发后续平台授权，不执行返回的脚本。
   */
  async check(context, operation) {
    const query = new URLSearchParams({
      uuid: operation.key,
      ...(operation.last ? { last: String(operation.last) } : {}),
      _: String(Date.now()),
    })
    let response
    try {
      response = await context.request(operation.pollingHost + "/connect/l/qrconnect?" + query, { timeoutMs: 35000 })
    } catch (error) {
      if (error.name === "TimeoutError") {
        return { status: operation.last === 404 ? "confirming" : "waiting" }
      }
      throw error
    }
    const text = await response.text()
    if (text.length > 16384) {
      throw new Error("微信扫码响应超过大小限制")
    }
    const status = Number(text.match(/window\.wx_errcode\s*=\s*(\d+)/u)?.[1])
    if (status === 405) {
      const code = text.match(/window\.wx_code\s*=\s*["']([\w-]{1,512})["']/u)?.[1]
      if (!code) {
        throw new Error("微信未返回有效授权，请刷新二维码")
      }
      return { status: "confirmed", code }
    }
    if ([402, 403, 500].includes(status)) {
      return { status: "expired" }
    }
    if (![404, 408].includes(status)) {
      throw new Error("微信扫码状态暂不可用，请刷新重试")
    }
    if (status === 404) {
      operation.last = 404
    }
    return { status: operation.last === 404 ? "confirming" : "waiting" }
  }
}
