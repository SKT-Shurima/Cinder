import React from "react"
import { Check, Cloud, Folder, Server } from "lucide-react"
import { musicProviders, normalizeMusicSources, normalizeMusicProviders } from "#shared/musicSources"
import useOnlineAccounts from "../hooks/useOnlineAccounts.js"
import { AccountConnectionSummary } from "./AccountStatusBadge.jsx"
import ProviderAccountRow from "./ProviderAccountRow.jsx"
/**
 * 允许单独或组合启用三种来源，至少保留一项；平台开关与官方入口放在同一张设置卡中。
 * 关闭来源只隐藏对应索引，不删除文件、服务器配置或平台会话；资源搜索与播放均使用 Cinder 界面。
 * 平台资源开关与账号关联状态分别表达，初次查询和失败不会被误显示为未登录。
 */
export default function MusicSourceSettings({ api, settings, onChange, onOpen, onLogin }) {
  const connection = useOnlineAccounts(api)
  const { accounts } = connection
  const modes = normalizeMusicSources(settings.musicSources)
  const providers = normalizeMusicProviders(settings.musicProviders)
  const choices = [
    ["local", "本地音乐", "读取本机的音乐文件夹", Folder],
    ["online", "在线音乐", "连接喜欢的音乐平台", Cloud],
    ["remote", "远程音乐", "播放服务器上的音乐", Server],
  ]
  const enabledCount = Object.values(modes).filter(Boolean).length
  return (
    <>
      <section className="settings-section source-mode-section">
        <div className="source-section-heading">
          <div>
            <span className="eyebrow">YOUR MUSIC, YOUR WAY</span>
            <h2>聆听方式</h2>
          </div>
          <span className="source-count">已开启 {enabledCount} 种</span>
        </div>
        <p>可以只选一种，也可以同时开启。关闭来源会隐藏歌曲，文件和连接会保留。</p>
        <div className="source-mode-options">
          {choices.map(([id, label, description, Icon]) => (
            <button
              key={id}
              aria-label={label}
              aria-pressed={modes[id]}
              disabled={modes[id] && enabledCount === 1}
              className={modes[id] ? "active" : ""}
              onClick={() => onChange({ musicSources: { ...modes, [id]: !modes[id] } })}
            >
              <span className="source-choice-top">
                <Icon size={20} strokeWidth={1.5} />
                <i>{modes[id] && <Check size={10} />}</i>
              </span>
              <b>{label}</b>
              <small>{description}</small>
            </button>
          ))}
        </div>
      </section>
      <section className={`settings-section online-providers ${!modes.online ? "is-disabled" : ""}`}>
        <div className="source-section-heading">
          <div>
            <span className="eyebrow">CONNECTED LIBRARIES</span>
            <h2>在线音乐平台</h2>
          </div>
          <AccountConnectionSummary {...connection} providers={musicProviders} />
        </div>
        <p>关联平台账号以使用对应音乐权限。平台开关控制资源是否启用，账号关联状态见名称旁的标签。</p>
        <div className="provider-list" role="list" aria-label="平台账号关联状态">
          {musicProviders.map(provider => (
            <ProviderAccountRow
              key={provider.id}
              provider={provider}
              account={accounts[provider.id]}
              pending={connection.pending}
              error={connection.error}
              online={modes.online}
              enabled={providers[provider.id]}
              onOpen={() => onOpen(provider.id)}
              onLogin={() => onLogin(provider.id)}
              onToggle={enabled => onChange({ musicProviders: { ...providers, [provider.id]: enabled } })}
            />
          ))}
        </div>
        {connection.error && (
          <p className="account-status-error" role="alert">
            {connection.error}
            <button className="text-button" onClick={connection.refresh}>
              重新检查
            </button>
          </p>
        )}
        <small className="source-platform-note">
          本地、在线与远程歌曲共用播放队列、歌词和音效。可播放内容以平台账号的会员与地区权限为准。
        </small>
      </section>
    </>
  )
}
