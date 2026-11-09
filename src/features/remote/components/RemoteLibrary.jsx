/**
 * 远程音乐库设置：连接音乐服务器或 SFTP 文件目录，将远程索引加入现有歌单。
 * 密码与私钥口令只用于本次提交，不写入前端存储，服务器文件始终只读。
 */
import React, { useEffect, useRef, useState } from "react"
import { FolderPlus, KeyRound, LoaderCircle, Power, RefreshCw, Server, X } from "lucide-react"
import { publicPresetCredentials } from "#shared/remotePresets"
import RemotePresetList from "@/features/remote/components/RemotePresetList.jsx"

/**
 * 创建不包含登录秘密的新表单，新连接默认选择音乐服务器。
 * 旧来源没有协议字段时按 SFTP 恢复；私人密码始终为空，官方公开演示凭据按预设填充。
 */
function newConnection(source = {}) {
  return {
    id: source.id,
    protocol: source.protocol || (source.id ? "sftp" : "subsonic"),
    serverUrl: source.serverUrl || "",
    name: source.name || "",
    host: source.host || "",
    port: source.port || 22,
    username: source.username || "",
    root: source.root || "",
    auth: source.auth || "password",
    presetId: source.presetId,
    remember: source.remember || false,
    password: publicPresetCredentials(source)?.password || "",
    passphrase: "",
    keyToken: "",
    keyName: "",
  }
}

/**
 * 展示已连接来源及连接表单，测试与导入分别给出明确反馈。
 * 后台任务期间禁止重复提交；提交成功后销毁表单中的秘密，连接失败保留输入供修正。
 * 从主页的添加入口进入时直接展开表单；首次打开远程音乐库也可直接配置，无需再到设置中寻找。
 * 自有连接排在公开演示连接前，重新登录不会把主要曲库挤到演示库后面。
 */
export default function RemoteLibrary({ api, sources = [], busy, onChanged, onError, initiallyOpen = false }) {
  const [form, setForm] = useState(() => (initiallyOpen ? newConnection() : null))
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const hostInput = useRef(null)
  const disabled = busy || pending
  const formOpen = Boolean(form)
  const orderedSources = [...sources].sort(
    (first, second) => Number(Boolean(publicPresetCredentials(first))) - Number(Boolean(publicPresetCredentials(second))),
  )
  useEffect(() => {
    if (formOpen) {
      hostInput.current?.focus()
    }
  }, [formOpen, form?.protocol])

  /**
   * 修改表单字段并清除过期的测试结果，避免把旧地址的成功提示用于新配置。
   * 切换协议或认证方式时清除原认证材料，减少未使用秘密的停留，并重置不适用的私钥认证。
   */
  function field(key, value) {
    setFeedback(null)
    setForm(previous => ({
      ...previous,
      [key]: value,
      ...(["auth", "protocol"].includes(key) ? { password: "", passphrase: "", keyToken: "", keyName: "" } : {}),
      ...(["protocol", "serverUrl", "username", "host"].includes(key) ? { presetId: undefined } : {}),
      ...(key === "protocol" ? { auth: "password" } : {}),
    }))
  }

  /**
   * 将选中的正规来源填入新连接表单，保留其他已连接曲库及其索引。
   * 公开演示使用运营方发布的账号，自有账号服务只填写地址，仍需用户输入登录材料。
   */
  function selectPreset(preset) {
    setFeedback(null)
    setForm({
      ...newConnection(),
      presetId: preset.id,
      name: preset.name,
      protocol: preset.protocol,
      serverUrl: preset.serverUrl,
      username: preset.username || "",
      password: preset.password || "",
    })
  }

  /**
   * 通过受限桌面命令打开运营方说明，地址由主进程按预设标识查找。
   * 打开失败沿用统一错误提示，不影响正在播放的歌曲或表单内容。
   */
  async function showPresetInfo(id) {
    try {
      await api.remotePresetInfo(id)
    } catch (error) {
      onError(error)
    }
  }

  /**
   * 使用系统文件选择器获取私钥令牌，实际私钥由主进程读取并保管。
   * 取消选择保持当前输入，不在网页中展示私钥内容或真实磁盘路径。
   */
  async function chooseKey() {
    try {
      const result = await api.remoteKey()
      if (result) {
        setForm(previous => ({ ...previous, keyToken: result.id, keyName: result.name }))
      }
    } catch (error) {
      onError(error)
    }
  }

  /**
   * 按协议测试曲库或目录，保存后开始同步；SFTP 指纹确认由原生对话框完成。
   * 保存成功关闭表单以清除秘密；失败原因显示在表单内，便于直接修正连接参数。
   */
  async function submit(save) {
    setPending(true)
    setFeedback(null)
    try {
      const result = await api.remoteConfigure(form, save)
      if (save) {
        setForm(null)
        await onChanged()
      }
      setFeedback({ error: false, text: save ? "曲库已连接" : result.message })
    } catch (error) {
      setFeedback({
        error: true,
        text: String(error.message || error).replace(/^Error invoking remote method '[^']+': Error: /, ""),
      })
    } finally {
      setPending(false)
    }
  }

  /**
   * 执行推荐开关、扫描或移除后刷新曲库快照，原服务器的目录和歌曲不会被修改。
   * 推荐开关只改变参与资格；移除才删除本地连接和索引，失败时沿用播放器的统一提示。
   */
  async function operate(callback) {
    setPending(true)
    try {
      await callback()
      await onChanged()
    } catch (error) {
      onError(error)
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="settings-section remote-settings">
      <h2>
        <Server size={20} />
        远程音乐库
      </h2>
      <p>连接音乐服务器或远程文件夹，直接播放远程歌曲。</p>
      <details className="remote-test-presets">
        <summary>官方连接测试库</summary>
        <RemotePresetList sources={sources} disabled={disabled} onSelect={selectPreset} onInfo={showPresetInfo} />
      </details>
      {orderedSources.map(source => (
        <div className="remote-source" key={source.id}>
          <Server size={21} />
          <div>
            <b>
              {source.name}
              {source.recommendationsEnabled === false && <span className="source-recommendation-off">推荐已关闭</span>}
            </b>
            <small>
              {source.protocol === "subsonic"
                ? `${source.username} · ${source.serverUrl}`
                : `${source.username}@${source.host}:${source.port} · ${source.root}`}
            </small>
            <small>
              {source.scannedAt ? `上次同步 ${new Date(source.scannedAt).toLocaleString("zh-CN")}` : "尚未同步"} ·{" "}
              {publicPresetCredentials(source)
                ? "官方演示账号 · 重启自动连接"
                : source.remember
                  ? "已记住凭据"
                  : "退出后需重新登录"}
            </small>
          </div>
          <div className="source-actions">
            <button
              className="text-button"
              role="switch"
              aria-checked={source.recommendationsEnabled !== false}
              aria-label={`${source.name}参与推荐`}
              disabled={disabled}
              onClick={() => operate(() => api.remoteRecommendations(source.id, source.recommendationsEnabled === false))}
            >
              <Power size={13} />
              {source.recommendationsEnabled === false ? "开启推荐" : "关闭推荐"}
            </button>
            <button className="text-button" disabled={disabled} onClick={() => operate(() => api.remoteScan(source.id))}>
              <RefreshCw size={13} />
              同步
            </button>
            <button
              className="text-button"
              disabled={disabled}
              onClick={() => {
                setForm(newConnection(source))
                setFeedback(null)
              }}
            >
              重新登录
            </button>
            <button className="text-button" disabled={disabled} onClick={() => operate(() => api.remoteRemove(source.id))}>
              移除
            </button>
          </div>
        </div>
      ))}
      {!form && (
        <button
          className="outline-button"
          disabled={disabled}
          onClick={() => {
            setForm(newConnection())
            setFeedback(null)
          }}
        >
          <FolderPlus size={16} />
          添加远程音乐
        </button>
      )}
      {form && (
        <form
          className="remote-form"
          onSubmit={event => {
            event.preventDefault()
            submit(true)
          }}
        >
          <div className="remote-form-heading">
            <b>{form.id ? `重新登录 ${form.name}` : "添加远程音乐"}</b>
            <button
              type="button"
              aria-label="取消添加服务器"
              disabled={pending}
              onClick={() => {
                setForm(null)
                setFeedback(null)
              }}
            >
              <X size={17} />
            </button>
          </div>
          <div className="connection-fields">
            <label>
              曲库类型
              <select
                value={form.protocol}
                disabled={pending || Boolean(form.id)}
                onChange={event => field("protocol", event.target.value)}
              >
                <option value="subsonic">Navidrome / Subsonic</option>
                <option value="sftp">SFTP / SSH 文件目录</option>
              </select>
            </label>
            <label>
              显示名称
              <input
                value={form.name}
                maxLength={80}
                onChange={event => field("name", event.target.value)}
                placeholder="我的音乐服务器"
                disabled={pending}
              />
            </label>
            {form.protocol === "subsonic" ? (
              <label className="connection-wide">
                曲库地址
                <input
                  ref={hostInput}
                  required
                  type="url"
                  value={form.serverUrl}
                  onChange={event => field("serverUrl", event.target.value)}
                  placeholder="https://music.example.com"
                  disabled={pending || Boolean(form.id)}
                  autoCapitalize="none"
                  spellCheck="false"
                />
              </label>
            ) : (
              <>
                <label>
                  服务器地址
                  <input
                    ref={hostInput}
                    required
                    value={form.host}
                    onChange={event => field("host", event.target.value)}
                    placeholder="192.168.1.20 或 music.example.com"
                    disabled={pending || Boolean(form.id)}
                    autoCapitalize="none"
                    spellCheck="false"
                  />
                </label>
                <label>
                  SSH 端口
                  <input
                    required
                    type="number"
                    min="1"
                    max="65535"
                    value={form.port}
                    onChange={event => field("port", event.target.value)}
                    disabled={pending || Boolean(form.id)}
                  />
                </label>
              </>
            )}
            <label>
              用户名
              <input
                required
                value={form.username}
                onChange={event => field("username", event.target.value)}
                placeholder="music"
                disabled={pending || Boolean(form.id)}
                autoCapitalize="none"
                spellCheck="false"
              />
            </label>
            {form.protocol === "sftp" && (
              <>
                <label className="connection-wide">
                  音乐目录
                  <input
                    required
                    value={form.root}
                    onChange={event => field("root", event.target.value)}
                    placeholder="/data/music"
                    disabled={pending || Boolean(form.id)}
                    autoCapitalize="none"
                    spellCheck="false"
                  />
                </label>
                <label>
                  登录方式
                  <select value={form.auth} disabled={pending} onChange={event => field("auth", event.target.value)}>
                    <option value="password">密码</option>
                    <option value="key">SSH 私钥</option>
                  </select>
                </label>
              </>
            )}
            {form.auth === "password" ? (
              <label>
                密码
                <input
                  required
                  type="password"
                  autoComplete="off"
                  value={form.password}
                  disabled={pending}
                  onChange={event => field("password", event.target.value)}
                />
              </label>
            ) : (
              <>
                <div className="key-field">
                  <span>SSH 私钥</span>
                  <button type="button" className="outline-button" disabled={pending} onClick={chooseKey}>
                    <KeyRound size={14} />
                    {form.keyName || "选择私钥文件"}
                  </button>
                </div>
                <label className="connection-wide">
                  私钥口令（可选）
                  <input
                    type="password"
                    autoComplete="off"
                    value={form.passphrase}
                    disabled={pending}
                    onChange={event => field("passphrase", event.target.value)}
                  />
                </label>
              </>
            )}
          </div>
          {publicPresetCredentials(form)?.password === form.password ? (
            <p className="remote-public-account">使用运营方公开的演示账号</p>
          ) : (
            <label className="remember-credentials">
              <input
                type="checkbox"
                checked={form.remember}
                disabled={pending}
                onChange={event => field("remember", event.target.checked)}
              />
              <span>
                记住登录凭据<small>使用操作系统安全存储加密；不勾选时仅本次运行有效。</small>
              </span>
            </label>
          )}
          <div className="settings-buttons">
            <button type="submit" className="primary-button" disabled={disabled}>
              {pending ? <LoaderCircle className="spin" size={16} /> : <Server size={16} />}
              {pending ? "正在连接…" : "连接并导入音乐"}
            </button>
            <button type="button" className="outline-button" disabled={disabled} onClick={() => submit(false)}>
              测试连接
            </button>
            <button
              type="button"
              className="text-button"
              disabled={pending}
              onClick={() => {
                setForm(null)
                setFeedback(null)
              }}
            >
              取消
            </button>
          </div>
        </form>
      )}
      {feedback && (
        <div className={`connection-feedback ${feedback.error ? "has-error" : ""}`} role={feedback.error ? "alert" : "status"}>
          {feedback.text}
        </div>
      )}
      {form?.protocol === "sftp" && <small className="settings-hint">首次连接需核对 SSH 指纹。</small>}
    </section>
  )
}
