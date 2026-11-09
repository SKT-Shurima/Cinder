/**
 * 用 Chromium 原生请求读取平台认证资源，为账号门面提供可核验的单次 HTTPS 响应。
 * 手动重定向通过原生 redirect 事件返回，不依赖 session.fetch 无法读取的手动跳转响应。
 */
import { net } from "electron"

/**
 * 将原生响应转成统一读取接口，并保留本次实际请求地址供 OAuth 参数核验。
 * 认证 Cookie 由隔离 Chromium 会话接收，响应对象只供主进程策略使用。
 */
function accountResponse(address, status, input, bytes = null) {
  const headers = new Headers()
  for (const [name, values] of Object.entries(input)) {
    for (const value of Array.isArray(values) ? values : [values]) {
      if (value !== undefined) {
        headers.append(name, String(value))
      }
    }
  }
  const response = new Response([204, 205, 304].includes(status) ? null : bytes, { status, headers })
  Object.defineProperty(response, "url", { value: address })
  return response
}

/**
 * 在指定音乐平台会话中请求一跳资源，遇到重定向后交给调用方重新检查目标地址。
 * 认证请求不复用 HTTP 缓存，取消信号覆盖请求和响应读取，正文超过一兆字节立即中止。
 * 不创建视图或记录认证响应，二维码刷新不会重新拿到缓存中的旧任务。
 */
export function requestAccountResource(current, address, options = {}) {
  const { signal, body, headers: supplied, method = "GET" } = options
  if (signal?.aborted) {
    return Promise.reject(signal.reason)
  }
  return new Promise((resolve, reject) => {
    const headers = new Headers(supplied)
    if (body instanceof URLSearchParams && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8")
    }
    const request = net.request({
      url: address,
      method,
      session: current,
      credentials: "include",
      redirect: "manual",
      cache: "no-store",
      headers: Object.fromEntries(headers),
    })
    let settled = false
    /**
     * 只提交一次响应或失败，并释放本次取消监听，避免请求结束后仍被旧任务持有。
     */
    const finish = (error, response) => {
      if (settled) {
        return
      }
      settled = true
      signal?.removeEventListener("abort", abort)
      if (error) {
        reject(error)
      } else {
        resolve(response)
      }
    }
    /**
     * 用户切换或关闭登录时中止原生请求，保留任务取消或超时的真实原因。
     */
    const abort = () => {
      finish(signal.reason)
      request.abort()
    }
    signal?.addEventListener("abort", abort, { once: true })
    request.on("error", error => finish(signal?.aborted ? signal.reason : error))
    request.on("redirect", (status, _method, target, values) => {
      const headers = Object.fromEntries(Object.entries(values).filter(([name]) => name.toLowerCase() !== "location"))
      finish(null, accountResponse(address, status, { ...headers, location: target }))
      request.abort()
    })
    request.on("response", response => {
      const chunks = []
      let size = 0
      response.on("data", chunk => {
        if (settled) {
          return
        }
        size += chunk.length
        if (size > 1048576) {
          finish(new Error("认证响应超过大小限制"))
          request.abort()
        } else {
          chunks.push(chunk)
        }
      })
      response.on("error", error => finish(error))
      response.on("aborted", () => finish(new Error("平台认证响应已中断，请重试")))
      response.on("end", () => {
        if (!settled) {
          finish(null, accountResponse(address, response.statusCode, response.headers, Buffer.concat(chunks)))
        }
      })
    })
    if (signal?.aborted) {
      abort()
      return
    }
    if (body !== undefined && body !== null) {
      request.write(body instanceof URLSearchParams ? body.toString() : body)
    }
    request.end()
  })
}
