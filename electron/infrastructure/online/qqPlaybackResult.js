/**
 * 解释 QQ 音乐播放授权结果，将账号关联状态与单曲播放授权区分，避免统一要求用户重新登录。
 */
import { PlaybackUnavailable } from "./playbackUnavailable.js"

/**
 * 从 QQ 官方播放响应中取出相对音频路径和 CDN 根地址，供外层继续校验域名并探测音频头。
 * 104003 表示本次播放请求未获授权，不能仅凭这个码认定用户未登录或未开通某种会员。
 * 其他业务异常保留受限的数字错误码，不把平台原始正文、账号资料或签名地址显示到界面。
 */
export function qqPlaybackAddress(response, signedIn) {
  const module = response?.req_0
  const data = module?.data
  const item = data?.midurlinfo?.[0]
  const failure = [response?.code, module?.code, data?.retcode, item?.result]
    .map(Number)
    .find(code => Number.isFinite(code) && code !== 0)
  if (failure === 104003) {
    throw new PlaybackUnavailable(
      signedIn
        ? "QQ 音乐未授予当前会话这首歌的播放权限（104003）。请在官方客户端用同一账号核对该曲是否可播放。"
        : "QQ 音乐尚未授权播放这首歌（104003），请关联账号后重试。",
    )
  }
  if (failure !== undefined) {
    throw new Error(`QQ 音乐播放请求失败（${failure}），请稍后重试。`)
  }
  const base = Array.isArray(data?.sip) && data.sip.find(address => typeof address === "string" && address)
  if (typeof item?.purl === "string" && item.purl && base) {
    return new URL(item.purl, base).href
  }
  if (item && typeof item.purl === "string" && !item.purl) {
    throw new PlaybackUnavailable("QQ 音乐暂未提供这首歌的播放地址。")
  }
  throw new Error("QQ 音乐播放响应暂不可用，请稍后重试。")
}
