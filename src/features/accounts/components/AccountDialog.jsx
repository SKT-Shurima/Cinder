/**
 * 为支持的平台提供相同的登录弹层、方式切换、加载反馈与关闭交互。
 * 二维码本地展示；网易云验证码表单不持久保存输入，QQ 官方账号表单嵌入当前区域。
 */
import React, { useEffect, useRef, useState } from "react"
import { Check, LoaderCircle, QrCode, RefreshCw, Smartphone, X } from "lucide-react"
import IconButton from "@/shared/ui/IconButton.jsx"
import { ProviderIcon } from "@/shared/ui/MusicSourceIcon.jsx"
import { musicProviders } from "#shared/musicSources"
import useAccountLogin from "@/features/accounts/hooks/useAccountLogin.js"
import { accountLoginMethods } from "@/features/accounts/model/accountMethods.js"
import useOnlineAccounts from "@/features/accounts/hooks/useOnlineAccounts.js"
import AccountStatusBadge from "@/features/accounts/components/AccountStatusBadge.jsx"

/**
 * 将官方账号表单的原生视图对齐到弹层，窗口缩放时只更新边界。
 * 卸载后销毁认证视图；请求失败保留明确重试入口，不打开外部网页。
 */
function OfficialAccountForm({ api, provider }) {
  const host = useRef(null)
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setError("")
    /**
     * 使用当前可见区域的内容坐标同步原生表单，忽略卸载后的失败回调。
     */
    const align = () => {
      const { x, y, width, height } = host.current.getBoundingClientRect()
      api.onlineLoginView(provider, { x, y, width, height }).catch(() => {
        if (active) {
          setError("平台账号表单暂时不可用，可以重试或切换扫码登录")
        }
      })
    }
    align()
    const observer = new ResizeObserver(align)
    observer.observe(host.current)
    window.addEventListener("resize", align)
    return () => {
      active = false
      observer.disconnect()
      window.removeEventListener("resize", align)
      api.onlineLoginDetach().catch(() => {})
    }
  }, [api, provider, attempt])
  return (
    <div className="official-account-area">
      <div ref={host} className="official-account-host" />
      {error && (
        <div className="account-error" role="alert">
          {error}
          <button className="text-button" onClick={() => setAttempt(value => value + 1)}>
            重新加载
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * 网易云手机号验证码登录，只在用户点击后发送短信或提交验证码。
 * 发送成功后冷却六十秒，失败时保留输入供修正；组件销毁后不再更新状态。
 */
function PhoneAccountForm({ api, onSuccess }) {
  const [phone, setPhone] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [message, setMessage] = useState("")
  const alive = useRef(true)
  useEffect(
    () => () => {
      alive.current = false
    },
    [],
  )
  useEffect(() => {
    if (!cooldown) {
      return
    }
    const timer = setTimeout(() => setCooldown(value => value - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])
  /**
   * 将这一次表单输入提交给平台认证命令，不写入曲库、日志或本地存储。
   */
  async function submit(action) {
    setBusy(true)
    setMessage("")
    try {
      const result = await api.onlineLoginPhone(action, { phone, code })
      if (!alive.current) {
        return
      }
      if (result.sent) {
        setCooldown(60)
        setMessage("验证码已发送，请在手机上查看")
      } else if (result.signedIn) {
        onSuccess()
      }
    } catch {
      if (alive.current) {
        setMessage(
          action === "send" ? "短信未发送，平台可能要求验证，请重试或使用扫码登录" : "登录未完成，请检查验证码或使用扫码登录",
        )
      }
    } finally {
      if (alive.current) {
        setBusy(false)
      }
    }
  }
  return (
    <form
      className="phone-account-form"
      onSubmit={event => {
        event.preventDefault()
        submit("login")
      }}
    >
      <label>
        手机号
        <span className="account-input">
          <span>+86</span>
          <input
            aria-label="手机号"
            inputMode="tel"
            autoComplete="tel-national"
            maxLength={11}
            value={phone}
            onChange={event => setPhone(event.target.value.replace(/\D/gu, ""))}
            placeholder="请输入手机号"
          />
        </span>
      </label>
      <label>
        短信验证码
        <span className="account-input">
          <input
            aria-label="短信验证码"
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={8}
            value={code}
            onChange={event => setCode(event.target.value.replace(/\D/gu, ""))}
            placeholder="输入验证码"
          />
          <button
            type="button"
            className="text-button"
            disabled={busy || cooldown > 0 || !/^1\d{10}$/u.test(phone)}
            onClick={() => submit("send")}
          >
            {cooldown ? `${cooldown} 秒后重发` : "获取验证码"}
          </button>
        </span>
      </label>
      {message && (
        <p className="account-feedback" role="status">
          {message}
        </p>
      )}
      <button className="primary-button" disabled={busy || !/^1\d{10}$/u.test(phone) || !/^\d{4,8}$/u.test(code)}>
        {busy && <LoaderCircle className="spin" size={16} />}登录网易云音乐
      </button>
    </form>
  )
}

/**
 * 组合当前平台的认证方式和状态，登录全过程保留在当前应用弹层。
 * 关闭时终止轮询并清除账号输入；平台已保存的认证会话继续保留。
 * 支持的平台默认显示微信扫码，可在同一弹层切换平台扫码和账号表单，不跳转外部页面。
 * 当前关联状态独立展示，扫码是否成功仍以当前扫码任务的最终检查为准。
 */
export default function AccountDialog({ api, provider, onClose }) {
  const platform = musicProviders.find(item => item.id === provider)
  const methods = accountLoginMethods(provider)
  const connection = useOnlineAccounts(api)
  const [mode, setMode] = useState(methods[0].id)
  const [phoneSuccess, setPhoneSuccess] = useState(false)
  const { state, refresh } = useAccountLogin(api, provider, mode)
  const dialog = useRef(null)
  const selected = methods.find(method => method.id === mode)
  const qrMode = selected.kind === "qr"
  const scanner = selected.scanner
  const success = phoneSuccess || state.status === "authorized"
  /**
   * 在登录方式标签之间响应方向键及首尾键，焦点与选中方式同步切换。
   * 切换由扫码 Hook 取消旧任务；普通 Tab 键继续参与弹层自身的焦点循环。
   */
  function navigateMethods(event) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return
    }
    event.preventDefault()
    const current = methods.findIndex(method => method.id === mode)
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? methods.length - 1
          : (current + (event.key === "ArrowRight" ? 1 : -1) + methods.length) % methods.length
    setMode(methods[next].id)
    event.currentTarget.querySelectorAll('[role="tab"]')[next]?.focus()
  }
  useEffect(() => {
    const previous = document.activeElement
    dialog.current.querySelector("button")?.focus()
    /**
     * 弹层内循环键盘焦点，Escape 关闭后恢复触发登录的控件。
     */
    const keyboard = event => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
      }
      if (event.key !== "Tab") {
        return
      }
      const controls = [...dialog.current.querySelectorAll("button:not(:disabled), input:not(:disabled)")]
      const first = controls[0]
      const last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener("keydown", keyboard)
    return () => {
      document.removeEventListener("keydown", keyboard)
      previous?.focus()
      api.onlineLoginClose().catch(() => {})
    }
  }, [api, onClose])
  return (
    <div
      className="modal-backdrop account-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <section className="account-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="account-dialog-title">
        <header className="modal-heading">
          <div className="account-platform-heading">
            <ProviderIcon id={provider} />
            <div>
              <span className="eyebrow">CONNECT YOUR MUSIC</span>
              <h2 id="account-dialog-title">登录{platform.name}</h2>
            </div>
          </div>
          <IconButton icon={X} label="关闭登录" onClick={onClose} />
        </header>
        <div className="account-current-status">
          <span>当前账号</span>
          <AccountStatusBadge
            account={connection.accounts[provider]}
            pending={connection.pending}
            error={connection.error}
            name={platform.name}
          />
        </div>
        {success ? (
          <div className="account-success" role="status">
            <Check size={38} />
            <h3>账号已关联</h3>
            <p>继续在 Cinder 里聆听你喜欢的音乐</p>
            <button className="primary-button" onClick={onClose}>
              完成
            </button>
          </div>
        ) : (
          <>
            <div className="account-methods" role="tablist" aria-label="登录方式" onKeyDown={navigateMethods}>
              {methods.map(({ id, label, kind }) => {
                const Glyph = kind === "qr" ? QrCode : Smartphone
                return (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === id}
                    tabIndex={mode === id ? 0 : -1}
                    key={id}
                    className={mode === id ? "active" : ""}
                    onClick={() => setMode(id)}
                  >
                    <Glyph size={16} />
                    {label}
                  </button>
                )
              })}
            </div>
            {qrMode && state.status === "authorizing" ? (
              <>
                <p className="account-instruction">请完成平台账号授权，确认后会自动关联。</p>
                <OfficialAccountForm api={api} provider={provider} />
              </>
            ) : qrMode ? (
              <div className="account-qr-panel">
                <div className="account-qr-frame">
                  {state.image && <img src={state.image} alt={`${platform.name}${scanner}扫码登录二维码`} />}
                  {state.status === "loading" && (
                    <div className="account-qr-overlay">
                      <LoaderCircle size={28} className="spin" />
                      <span>正在生成二维码</span>
                    </div>
                  )}
                  {["expired", "error"].includes(state.status) && (
                    <div className="account-qr-overlay">
                      <p>{state.status === "expired" ? "二维码已过期" : state.image ? "登录未完成" : "二维码暂不可用"}</p>
                      <button className="primary-button" onClick={refresh}>
                        <RefreshCw size={15} />
                        重新获取
                      </button>
                    </div>
                  )}
                  {state.status === "confirming" && (
                    <div className="account-qr-overlay">
                      <Smartphone size={30} />
                      <span>已扫码，请在手机上确认</span>
                    </div>
                  )}
                </div>
                <p className="account-instruction" role="status">
                  {state.status === "error" ? state.message : `使用${scanner}扫码登录`}
                </p>
                <button className="text-button" disabled={state.status === "loading"} onClick={refresh}>
                  <RefreshCw size={13} />
                  刷新二维码
                </button>
              </div>
            ) : provider === "netease" ? (
              <PhoneAccountForm api={api} onSuccess={() => setPhoneSuccess(true)} />
            ) : (
              <OfficialAccountForm api={api} provider={provider} />
            )}
            <p className="account-privacy">登录用于关联平台账号，歌曲权限以平台为准。</p>
          </>
        )}
      </section>
    </div>
  )
}
