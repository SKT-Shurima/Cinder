/**
 * 将账号关联、未关联和未确认状态展示为独立标签，状态含明确文字，不只依赖颜色。
 */
import React from "react"
import { CheckCircle2, CircleHelp, LoaderCircle, UserRound } from "lucide-react"

/**
 * 在平台名称旁展示当前账号状态，初次查询完成前不提前判定是否已关联。
 * 已知状态在后台刷新时保留；查询失败显示待确认，避免把失败误当成退出账号。
 */
export default function AccountStatusBadge({ account, pending, error, name }) {
  const status = error
    ? "unknown"
    : typeof account?.signedIn === "boolean"
      ? account.signedIn
        ? "linked"
        : "unlinked"
      : pending
        ? "checking"
        : "unknown"
  const [label, Icon] = {
    linked: ["已关联", CheckCircle2],
    unlinked: ["未关联", UserRound],
    checking: ["检查中", LoaderCircle],
    unknown: ["状态待确认", CircleHelp],
  }[status]
  return (
    <span className={`account-status-badge is-${status}`} role="status" aria-label={`${name}账号${label}`}>
      <Icon size={13} className={status === "checking" ? "spin" : undefined} />
      <span>{label}</span>
    </span>
  )
}

/**
 * 汇总当前平台集合的关联数量，查询不完整或失败时显示明确的过程状态。
 * 设置页汇总全部平台，在线音乐只汇总当前启用的平台。
 */
export function AccountConnectionSummary({ accounts, providers, pending, error }) {
  const known = providers.filter(provider => typeof accounts[provider.id]?.signedIn === "boolean").length
  const count = providers.filter(provider => accounts[provider.id]?.signedIn).length
  return (
    <span className="account-connection-summary" role="status">
      {error ? "账号状态待确认" : pending && known < providers.length ? "正在检查账号" : `已关联 ${count} / ${providers.length}`}
    </span>
  )
}
