/**
 * 以策略链协调封面目录、健康冷却与录音评分，提供自动匹配和人工候选两种用例。
 * 下载经过独立的域名与二进制校验，界面不能指定任意下载目标。
 */
import { createHash } from "node:crypto"
import { RecordingMatch } from "../../domain/artwork/recordingMatch.js"
import {
  QqArtworkProvider,
  NeteaseArtworkProvider,
  MusicBrainzArtworkProvider,
} from "../../infrastructure/artwork/catalogProviders.js"
import { imageMime } from "../../infrastructure/artwork/artworkStore.js"

/**
 * 以可替换的目录策略链执行封面候选查找，并集中执行下载边界校验。
 * 每个实例维护自身的冷却状态，目录故障不改变其他来源的健康记录。
 */
export class ArtworkLookup {
  /**
   * 接收可替换的目录策略，健康状态与匹配器随服务实例独立维护。
   */
  constructor(providers = [new QqArtworkProvider(), new NeteaseArtworkProvider(), new MusicBrainzArtworkProvider()]) {
    this.providers = providers
    this.health = new Map()
    this.matcher = new RecordingMatch()
  }

  /**
   * 顺序执行目录策略；自动模式出现可靠录音即停止，手动模式合并多个来源。
   * 含手机号或未知歌手的私人录音标签留在本机；目录限流和未命中分别记录。
   */
  async search(track, manual = false) {
    const contact = /(?:^|\D)1[3-9](?:[\s-]?\d){9}(?:\D|$)/u
    if (
      contact.test(track.title + " " + track.artist) ||
      (track.artist === "未知歌手" && /录音|会议记录|通话记录|voice memo/iu.test(track.title))
    ) {
      return { candidates: [], errors: [], skippedReason: "私人录音或联系信息不参与联网封面查询" }
    }
    const candidates = []
    const errors = []
    for (const strategy of this.providers) {
      const health = this.health.get(strategy.name) ?? { failures: 0, until: 0 }
      if (health.until > Date.now()) {
        errors.push(strategy.name + " 正在冷却，稍后可重试")
        continue
      }
      try {
        const ranked = (await strategy.search(track))
          .map(candidate => this.matcher.evaluate(track, candidate))
          .sort((a, b) => b.score - a.score)
          .slice(0, strategy.name === "MusicBrainz" ? 3 : 8)
        candidates.push(...ranked)
        this.health.delete(strategy.name)
      } catch (failure) {
        const failures = health.failures + (failure.queryFailure ? 0 : 1)
        this.health.set(strategy.name, { failures, until: Date.now() + (failure.cooldown || (failures >= 2 ? 120000 : 0)) })
        errors.push(`${strategy.name}：${failure.name === "TimeoutError" ? "连接超时" : failure.message}`)
      }
      if (!manual && candidates.some(candidate => candidate.automatic)) {
        break
      }
    }
    return { candidates: candidates.sort((a, b) => b.score - a.score), errors }
  }

  /**
   * 从支持的目录下载图片，每一次重定向都重新检查官方图片域名。
   * 响应累计超过 10 MB 时终止；错误页、无效图片及任意外部重定向不会进入缓存。
   */
  async download(address) {
    const domains = ["music.126.net", "y.gtimg.cn", "coverartarchive.org", "archive.org"]
    let target = new URL(address)
    for (let hop = 0; hop < 5; hop += 1) {
      if (
        target.protocol !== "https:" ||
        target.username ||
        target.password ||
        !domains.some(domain => target.hostname === domain || target.hostname.endsWith("." + domain))
      ) {
        throw new Error("封面地址不属于已支持的音乐目录")
      }
      const response = await fetch(target, { redirect: "manual", signal: AbortSignal.timeout(15000) })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel()
        target = new URL(response.headers.get("location"), target)
        continue
      }
      if (!response.ok) {
        throw new Error(`封面下载暂不可用（${response.status}）`)
      }
      if (Number(response.headers.get("content-length")) > 10485760) {
        await response.body?.cancel()
        throw new Error("封面图片过大")
      }
      const reader = response.body.getReader()
      const chunks = []
      let size = 0
      while (true) {
        const part = await reader.read()
        if (part.done) {
          break
        }
        size += part.value.length
        if (size > 10485760) {
          await reader.cancel()
          throw new Error("封面图片过大")
        }
        chunks.push(Buffer.from(part.value))
      }
      const bytes = Buffer.concat(chunks)
      const mime = imageMime(bytes)
      if (!mime) {
        throw new Error("下载内容不是支持的封面图片")
      }
      return { bytes, mime, hash: createHash("sha256").update(bytes).digest("hex") }
    }
    throw new Error("封面目录重定向次数过多")
  }
}
