/**
 * 用有限的业务分类保留在线请求失败原因，供播放检查和平台退避共用。
 * 不将原始响应、请求地址、Cookie 或底层异常正文带入界面提示。
 */

/**
 * 表达可重试的平台请求问题，授权明确拒绝仍使用独立的 PlaybackUnavailable。
 * 错误码和退避时间只接受受限数字，实例仅保存在本次运行的检查缓存中。
 */
export class OnlineRequestError extends Error {
  /**
   * 根据请求阶段生成明确提示，退避秒数限定在一分钟内。
   * retryAt 为毫秒时间戳，用于阻止短期缓存提前重试；普通网络故障沿用检查器的十秒缓存。
   */
  constructor(kind, { status, businessCode, retryAfterSeconds = 0 } = {}) {
    const seconds = Math.max(0, Math.min(60, Math.ceil(Number(retryAfterSeconds) || 0)))
    const http = Number.isInteger(status) && status >= 400 && status <= 599 ? status : null
    const code = Number.isInteger(businessCode) && businessCode > 0 && businessCode < 100000000 ? businessCode : null
    const messages = {
      limited: `请求暂时受限，请${seconds ? `约 ${seconds} 秒后` : "稍后"}重试。`,
      timeout: "核验播放状态超时，请稍后重试。",
      connection: "播放核验的网络连接失败，请检查网络后重试。",
      response: `返回的播放核验结果异常${http ? `（HTTP ${http}）` : code ? `（${code}）` : ""}，请稍后重试。`,
      unknown: "暂时未取得有效的播放核验结果，请稍后重试。",
    }
    super(messages[kind] || messages.unknown)
    this.name = "OnlineRequestError"
    this.kind = Object.hasOwn(messages, kind) ? kind : "unknown"
    this.retryAt = this.kind === "limited" && seconds ? Date.now() + seconds * 1000 : 0
  }

  /**
   * 在用户重试时按实际剩余时间生成平台提示，缓存命中也不会重新显示完整一分钟。
   * 平台名称由应用固定目录提供；只生成展示文字，不延长退避或修改检查缓存。
   */
  describe(platformName) {
    const message =
      this.kind === "limited" && this.retryAt
        ? new OnlineRequestError("limited", { retryAfterSeconds: Math.max(0, this.retryAt - Date.now()) / 1000 }).message
        : this.message
    return `${platformName}${message}`
  }

  /**
   * 将检查器收到的失败转换为安全分类，只识别标准异常名、网络错误码和本地生成的 QQ 数字码。
   * 其他错误保持未知，不直接拼接可能含签名地址或账号材料的原始 message。
   */
  static from(failure) {
    if (failure instanceof OnlineRequestError) {
      return failure
    }
    if (
      failure?.name === "TimeoutError" ||
      ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(
        failure?.cause?.code || failure?.code,
      )
    ) {
      return new OnlineRequestError("timeout")
    }
    if (failure instanceof SyntaxError) {
      return new OnlineRequestError("response")
    }
    if (
      ["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH"].includes(failure?.cause?.code || failure?.code) ||
      (failure instanceof TypeError && /fetch/i.test(failure.message))
    ) {
      return new OnlineRequestError("connection")
    }
    const businessCode = /^QQ 音乐播放请求失败（(\d{1,8})）/.exec(failure?.message || "")
    return new OnlineRequestError(businessCode ? "response" : "unknown", {
      businessCode: businessCode ? Number(businessCode[1]) : undefined,
    })
  }
}
