/**
 * 展示单个平台的资源入口、账号关联状态与启用开关，三种能力使用独立的文字和交互。
 */
import React from "react"
import { ArrowUpRight, UserRound } from "lucide-react"
import { ProviderIcon } from "@/shared/ui/MusicSourceIcon.jsx"
import AccountStatusBadge from "@/features/accounts/components/AccountStatusBadge.jsx"

/**
 * 在平台名称旁固定展示关联标签，登录按钮明确区分首次关联和重新登录。
 * 资源开关只控制歌曲来源是否启用，不把开关状态冒充账号登录状态，也不清除已保存会话。
 */
export default function ProviderAccountRow({ provider, account, pending, error, online, enabled, onOpen, onLogin, onToggle }) {
  const linked = account?.signedIn === true
  return (
    <div className="provider-row" role="listitem" data-provider={provider.id}>
      <ProviderIcon id={provider.id} />
      <span className="provider-info">
        <span className="provider-name">
          <b>{provider.name}</b>
          <AccountStatusBadge account={account} pending={pending} error={error} name={provider.name} />
        </span>
        <small>{provider.description}</small>
      </span>
      <button className="text-button provider-open" disabled={!online || !enabled} onClick={onOpen}>
        搜索歌曲
        <ArrowUpRight size={13} />
      </button>
      <button
        className="provider-login provider-account-action"
        disabled={!online || !enabled}
        aria-label={`${linked ? "重新登录" : "关联"}${provider.name}账号`}
        onClick={onLogin}
      >
        <UserRound size={14} />
        {linked ? "重新登录" : "关联账号"}
      </button>
      <label className="sound-toggle" title="启用平台音乐资源">
        <input
          type="checkbox"
          aria-label={`启用${provider.name}资源`}
          disabled={!online}
          checked={enabled}
          onChange={event => onToggle(event.target.checked)}
        />
        <span aria-hidden="true" />
      </label>
    </div>
  )
}
