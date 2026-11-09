/**
 * 管理平台认证会话和应用内登录流程，界面只读取状态与二维码图片。
 * 扫码采用平台策略；账号输入使用受限的官方认证视图或平台验证码接口，不创建新窗口。
 */
import { session, WebContentsView } from "electron"
import { randomUUID } from "node:crypto"
import { musicProviders } from "#shared/musicSources"
import { QqQrStrategy, NeteaseQrStrategy } from "../../infrastructure/accounts/qrAuthStrategies.js"
import { QqWechatQrStrategy } from "../../infrastructure/accounts/qqWechatQrStrategy.js"
import { NeteaseWechatQrStrategy } from "../../infrastructure/accounts/neteaseWechatQrStrategy.js"
import { requestAccountResource } from "../../infrastructure/accounts/accountHttpClient.js"

/**
 * 限制认证导航到当前平台及其官方 OAuth 域名，拒绝本地文件和携带账号信息的网址。
 */
export function accountAddress(provider, address) {
  const allowed = {
    qq: ["qq.com", "weixin.qq.com"],
    netease: ["music.163.com", "reg.163.com", "passport.163.com", "music.126.net", "weixin.qq.com"],
  }
  try {
    const url = new URL(address)
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (allowed[provider] ?? []).some(host => url.hostname === host || url.hostname.endsWith("." + host))
    )
  } catch {
    return false
  }
}

/**
 * 资源请求允许读取的认证 Cookie 白名单；扫码临时签名与其他网站 Cookie 不对外提供。
 */
const cookieNames = {
  qq: ["uin", "wxuin", "wxopenid", "qqmusic_key", "qm_keyst", "qqmusic_uin", "login_type", "tmeLoginType"],
  netease: ["MUSIC_U", "MUSIC_A", "__csrf"],
}

/**
 * QQ 音乐官方 OAuth 入口，扫码与账号表单在同一官方流程中完成音乐会话交换。
 * 回调只回到 QQ 音乐官网，不把授权码发送给应用外的自建服务。
 */
function qqAuthorizationAddress() {
  const values = new URLSearchParams({
    response_type: "code",
    client_id: "100497308",
    redirect_uri: "https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/",
    scope: "all",
    state: randomUUID(),
  })
  return "https://graph.qq.com/oauth2.0/authorize?" + values
}

/**
 * 协调平台会话、扫码策略和内嵌官方表单，作为桌面账号认证门面。
 * 同一时刻只保留一个活动扫码任务与认证视图，关闭时释放临时资源。
 */
export class OnlineAccounts {
  /**
   * 绑定主窗口和认证事件出口，扫码与内嵌视图均由同一个协调器管理生命周期。
   * 不在应用启动时自动联网、显示登录或发出短信。
   */
  constructor(parent, notify) {
    this.parent = parent
    this.notify = notify
    this.watched = new Set()
    this.timers = new Map()
    this.operations = new Map()
    this.strategies = { qq: new QqQrStrategy(), netease: new NeteaseQrStrategy() }
    this.wechat = { qq: new QqWechatQrStrategy(), netease: new NeteaseWechatQrStrategy() }
    this.view = null
    this.viewProvider = null
  }

  /**
   * 复用历史平台的持久化 Chromium 会话，账号 Cookie 不写入曲库和渲染状态。
   * 拒绝权限请求和文件下载，Cookie 变化合并为一次布尔登录状态通知。
   */
  session(provider) {
    if (!this.strategies[provider]) {
      throw new Error("不支持的账号平台")
    }
    const current = session.fromPartition("persist:cinder-music-" + provider)
    if (!this.watched.has(provider)) {
      this.watched.add(provider)
      current.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
      current.setPermissionCheckHandler(() => false)
      current.on("will-download", event => event.preventDefault())
      current.cookies.on("changed", () => {
        clearTimeout(this.timers.get(provider))
        this.timers.set(
          provider,
          setTimeout(
            () =>
              this.status()
                .then(this.notify)
                .catch(() => {}),
            250,
          ),
        )
      })
    }
    return current
  }

  /**
   * 提供同平台资源请求所需的最少认证字段，完整会话从不通过 IPC 返回。
   * 认证标记仅代表保存了平台会话，音频可播放范围仍由平台服务端判断。
   * 微信登录优先使用 wxuin，避免同一持久会话残留的 QQ 号覆盖当前微信音乐身份。
   */
  async credentials(provider) {
    const selected = (await this.session(provider).cookies.get({})).filter(
      cookie =>
        cookieNames[provider].includes(cookie.name) && accountAddress(provider, "https://" + cookie.domain.replace(/^\./u, "")),
    )
    const values = Object.fromEntries(selected.map(cookie => [cookie.name, cookie.value]))
    const authenticated = provider === "qq" ? values.qqmusic_key || values.qm_keyst : values.MUSIC_U
    const uin =
      provider === "qq" && values.login_type === "2"
        ? values.wxuin || values.qqmusic_uin
        : values.qqmusic_uin || values.uin || values.wxuin
    return {
      cookie: selected
        .map(cookie => cookie.name + "=" + cookie.value)
        .sort()
        .join("; "),
      uin: String(uin || "").replace(/^o/u, ""),
      signedIn: Boolean(authenticated),
    }
  }

  /**
   * 返回各平台登录布尔标记，不将昵称、手机号或认证值写入产品日志。
   */
  async status() {
    const entries = await Promise.all(
      musicProviders.map(async platform => [platform.id, { signedIn: (await this.credentials(platform.id)).signedIn }]),
    )
    return Object.fromEntries(entries)
  }

  /**
   * 在当前平台的网络上下文中发起认证请求，每一次重定向都重新核对官方域名。
   * 普通请求最长十秒，微信长轮询最多三十五秒；切换登录方式会同步中止旧任务请求。
   * 失败只返回业务原因，不把含账号信息的响应正文显示到界面。
   * 网易云旧版授权结果页的 HTTP 重定向只升级为同地址 HTTPS，始终不使用明文传输授权结果。
   * 每一跳通过原生手动重定向事件读取，避免 Chromium fetch 将跳转直接报告为取消。
   */
  async request(provider, address, options = {}) {
    const { timeoutMs = 10000, signal, ...settings } = options
    const timeout = AbortSignal.timeout(Math.max(1000, Math.min(35000, timeoutMs)))
    const cancellation = signal ? AbortSignal.any([signal, timeout]) : timeout
    let target = address
    let init = settings
    for (let hop = 0; hop < 6; hop += 1) {
      if (!accountAddress(provider, target)) {
        throw new Error("认证地址不属于当前平台")
      }
      let response
      try {
        response = await requestAccountResource(this.session(provider), target, {
          ...init,
          signal: cancellation,
          headers: { Referer: musicProviders.find(item => item.id === provider).url, ...init.headers },
        })
      } catch (error) {
        if (cancellation.aborted) {
          throw cancellation.reason
        }
        throw error
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel()
        const next = new URL(response.headers.get("location"), target)
        if (
          provider === "netease" &&
          next.protocol === "http:" &&
          next.hostname === "music.163.com" &&
          next.pathname === "/back/sns"
        ) {
          next.protocol = "https:"
        }
        target = next.href
        if (response.status === 303 || ([301, 302].includes(response.status) && init.method === "POST")) {
          init = {}
        }
        continue
      }
      if (!response.ok) {
        throw new Error("平台认证服务暂不可用，请稍后重试")
      }
      return response
    }
    throw new Error("平台认证重定向次数过多")
  }

  /**
   * 为扫码策略提供受限的同平台网络与会话能力，不允许策略创建独立窗口。
   * 二维码任务被替换后中止请求并拒绝迟到响应，防止旧任务继续提交登录回调。
   */
  context(provider, operation) {
    /**
     * 判断响应是否仍属于当前扫码任务，短信等非二维码调用不绑定任务版本。
     */
    const active = () => !operation || this.operations.get(operation.id) === operation
    /**
     * 为本次请求绑定任务取消信号，返回结果前再次检查版本，阻止迟到响应继续授权。
     */
    const request = async (url, init) => {
      if (!active()) {
        throw new Error("登录操作已关闭")
      }
      const response = await this.request(provider, url, {
        ...init,
        ...(operation ? { signal: operation.controller.signal } : {}),
      })
      if (!active()) {
        await response.body?.cancel()
        throw new Error("登录操作已关闭")
      }
      return response
    }
    return {
      session: this.session(provider),
      active,
      request,
      json: async (url, init) => {
        const response = await request(url, init)
        const text = await response.text()
        if (text.length > 1048576) {
          throw new Error("认证响应超过大小限制")
        }
        if (!active()) {
          throw new Error("登录操作已关闭")
        }
        try {
          return JSON.parse(text)
        } catch {
          throw new Error("平台认证响应暂不可用")
        }
      },
      complete: url => this.completeRedirect(provider, url, operation),
    }
  }

  /**
   * 申请新的平台二维码，旧任务作废；请求完成晚于取消时不再恢复旧弹层。
   * 返回随机任务标识与图片，不返回原始二维码键或会话签名。
   * 微信与 QQ 扫码使用独立策略；不支持的方式在发起网络请求前拒绝。
   */
  async login(provider, method = "qr") {
    const strategy = method === "wechat" ? this.wechat[provider] : method === "qr" ? this.strategies[provider] : null
    if (!strategy) {
      throw new Error("当前平台不支持这种扫码方式")
    }
    this.cancel()
    const id = randomUUID()
    const operation = { id, provider, method, strategy, created: Date.now(), controller: new AbortController() }
    this.operations.set(id, operation)
    try {
      operation.initialCookie = (await this.credentials(provider)).cookie
      if (!this.operations.has(id)) {
        throw new Error("登录操作已关闭")
      }
      const result = await strategy.create(this.context(provider, operation))
      if (!this.operations.has(id)) {
        throw new Error("登录操作已关闭")
      }
      Object.assign(operation, result)
      return { id, image: result.image, status: "waiting", provider, method }
    } catch (failure) {
      this.operations.delete(id)
      operation.controller.abort()
      throw failure
    }
  }

  /**
   * 查询当前二维码状态，过期或关闭的任务停止访问平台。
   * 平台报告授权成功后必须存在相应认证 Cookie，避免把“已扫码”显示成“已登录”。
   * 已有账号不视作本次扫码完成，同一任务的并发查询合并为一个检查请求。
   * 二维码三分钟过期；已进入官方账号验证的流程另留十分钟，避免短信验证期间突然关闭。
   */
  async check(id) {
    const operation = this.operations.get(id)
    const expired =
      operation && Date.now() - (operation.authorizationStarted || operation.created) > (operation.continuing ? 600000 : 180000)
    if (!operation || expired) {
      operation?.controller.abort()
      this.operations.delete(id)
      if (expired) {
        this.detach()
      }
      return { status: "expired" }
    }
    if (!operation.checking) {
      operation.checking = this.checkOperation(operation).finally(() => {
        operation.checking = null
      })
    }
    return operation.checking
  }

  /**
   * 对当前扫码任务执行一次检查，官方确认与实际音乐会话同时成立才发布成功。
   * QQ 官方回调继续授权时等待认证票据变化，微信直接交换成功后仍核对本地会话。
   * 网易云的网页回调还需产生本次新的认证票据，旧账号不会掩盖授权失败。
   */
  async checkOperation(operation) {
    if (operation.authorized) {
      return { status: "authorized" }
    }
    const status = operation.continuing
      ? "authorizing"
      : await operation.strategy.check(this.context(operation.provider, operation), operation)
    if (!this.operations.has(operation.id)) {
      return { status: "expired" }
    }
    const credentials = await this.credentials(operation.provider)
    if (!this.operations.has(operation.id)) {
      return { status: "expired" }
    }
    const fresh = credentials.cookie !== operation.initialCookie
    const accepted = status === "authorized" && (operation.method !== "wechat" || operation.provider === "qq" || fresh)
    if (credentials.signedIn && (accepted || (operation.continuing && fresh))) {
      operation.authorized = true
      this.detach()
      this.notify(await this.status())
      return { status: "authorized" }
    }
    if (status === "authorizing" && !operation.continuing) {
      operation.continuing = true
      operation.authorizationStarted = Date.now()
    }
    if (status === "authorized" && operation.method === "wechat") {
      throw new Error(
        `微信已确认，但${musicProviders.find(item => item.id === operation.provider).name}会话尚未建立，请刷新或改用 App 扫码重试`,
      )
    }
    return { status: status === "authorized" ? "confirming" : status }
  }

  /**
   * QQ 授权回调在同一弹层的受限视图内完成官方会话交换，不新建页面或窗口。
   * 同一回调只加载一次，避免轮询重复触发认证跳转。
   * 扫码任务关闭后不再挂载认证视图，避免迟到回调重新打开已经关闭的登录内容。
   */
  async completeRedirect(provider, url, operation) {
    if (!accountAddress(provider, url)) {
      throw new Error("平台返回了无效的授权地址")
    }
    await this.request(provider, url, operation ? { signal: operation.controller.signal } : {})
    if (operation && !this.operations.has(operation.id)) {
      throw new Error("登录操作已关闭")
    }
    this.createView(provider)
    await this.view.webContents.loadURL(provider === "qq" ? qqAuthorizationAddress() : url)
  }

  /**
   * 创建主窗口中的隔离认证视图，不注入登录实现，不开放 IPC、Node 或不安全网络权限。
   * 官方 OAuth 弹窗重定向到当前认证区域，所有新窗口请求均被拒绝。
   * 登录脚本和账号验证由官网执行，音乐认证凭据只保留在对应平台的持久会话中。
   */
  createView(provider) {
    if (this.view && this.viewProvider === provider) {
      return this.view
    }
    this.detach()
    this.viewProvider = provider
    this.view = new WebContentsView({
      webPreferences: {
        session: this.session(provider),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    })
    const contents = this.view.webContents
    /**
     * 认证期间只接受官方导航；被拒绝的协议不能唤起系统应用。
     */
    const guard = (event, url) => {
      if (!accountAddress(provider, url || event.url)) {
        event.preventDefault()
      }
    }
    contents.on("will-navigate", guard)
    contents.on("will-redirect", guard)
    contents.on("will-attach-webview", event => event.preventDefault())
    contents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown" && input.key === "Escape") {
        event.preventDefault()
        this.parent()?.webContents.send("online:login-dismiss")
      }
    })
    contents.setWindowOpenHandler(({ url }) => {
      if (accountAddress(provider, url)) {
        contents.loadURL(url).catch(() => {})
      }
      return { action: "deny" }
    })
    const parent = this.parent()
    if (!parent || parent.isDestroyed()) {
      throw new Error("播放器窗口已关闭")
    }
    parent.contentView.addChildView(this.view)
    this.view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    return this.view
  }

  /**
   * 将官方账号表单放入界面指定的弹层区域，坐标必须在主窗口内容范围内。
   * 调整尺寸只更新布局，不重新载入表单，避免用户输入被窗口缩放清空。
   * 原生账号表单仅用于 QQ 音乐，网易云使用应用内的验证码表单。
   */
  async attach(provider, bounds) {
    if (provider !== "qq") {
      throw new Error("当前平台不使用官方账号表单")
    }
    const parent = this.parent()
    if (!parent || parent.isDestroyed()) {
      throw new Error("播放器窗口已关闭")
    }
    const [width, height] = parent.getContentSize()
    const values = ["x", "y", "width", "height"].map(name => Math.round(bounds?.[name]))
    if (
      values.some(value => !Number.isFinite(value)) ||
      values[0] < 0 ||
      values[1] < 0 ||
      values[2] < 200 ||
      values[3] < 200 ||
      values[0] + values[2] > width + 2 ||
      values[1] + values[3] > height + 2
    ) {
      throw new Error("登录表单布局无效")
    }
    const view = this.createView(provider)
    view.setBounds(Object.fromEntries(["x", "y", "width", "height"].map((key, index) => [key, values[index]])))
    if (!view.webContents.getURL()) {
      await view.webContents.loadURL(qqAuthorizationAddress())
    }
    return { ready: true }
  }

  /**
   * 用户明确请求后发送或验证网易云短信，手机号和验证码只在这次平台请求中使用。
   * 不记录输入、不自动发送短信；服务端要求额外验证时返回提示由用户处理。
   */
  async phone(action, input) {
    if (!/^1\d{10}$/u.test(input?.phone || "")) {
      throw new Error("请输入有效的中国大陆手机号")
    }
    if (!["send", "login"].includes(action)) {
      throw new Error("不支持的账号操作")
    }
    if (action === "login" && !/^\d{4,8}$/u.test(input?.code || "")) {
      throw new Error("请输入短信验证码")
    }
    const body = new URLSearchParams({
      phone: input.phone,
      countrycode: "86",
      ...(action === "login" ? { captcha: input.code, rememberLogin: "true" } : {}),
    })
    const result = await this.context("netease").json(
      "https://music.163.com/api/" + (action === "send" ? "sms/captcha/sent" : "login/cellphone"),
      { method: "POST", body },
    )
    if (result.code !== 200) {
      throw new Error(
        action === "send"
          ? "短信未发送，平台可能要求额外验证，请使用扫码登录"
          : "验证码未通过或平台要求额外验证，请重试或扫码登录",
      )
    }
    if (action === "send") {
      return { sent: true }
    }
    const signedIn = (await this.credentials("netease")).signedIn
    if (!signedIn) {
      throw new Error("平台尚未完成认证，请使用扫码登录")
    }
    this.notify(await this.status())
    return { signedIn }
  }

  /**
   * 移除并销毁内嵌认证内容，保留平台持久会话以供资源请求继续使用。
   */
  detach() {
    if (!this.view) {
      return
    }
    const view = this.view
    this.view = null
    this.viewProvider = null
    const parent = this.parent()
    if (parent && !parent.isDestroyed()) {
      parent.contentView.removeChildView(view)
    }
    if (!view.webContents.isDestroyed()) {
      view.webContents.close()
    }
  }

  /**
   * 关闭弹层时中止二维码任务请求并清除官方表单，已登录会话不受影响。
   */
  cancel() {
    for (const operation of this.operations.values()) {
      operation.controller.abort()
    }
    this.operations.clear()
    this.detach()
    return true
  }

  /**
   * 应用退出时释放认证视图与通知定时器，不删除已保存的账号 Cookie。
   */
  close() {
    this.cancel()
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
  }
}
