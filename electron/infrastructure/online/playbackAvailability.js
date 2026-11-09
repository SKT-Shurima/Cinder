/**
 * 按当前平台会话批量核验播放授权并探测音频头，搜索、推荐和已保存曲库共用同一短期结果。
 */
import { createHash } from "node:crypto"
import { PlaybackUnavailable } from "./playbackUnavailable.js"
import { OnlineRequestError } from "./onlineRequestError.js"

/**
 * 管理只存在于内存的可播放结果，账号变化时立即丢弃旧账号的授权和签名地址。
 * 每批最多二十首共用一次平台请求，音频头探测最多四路；暂时网络错误只短期隐藏。
 */
export class PlaybackAvailability {
  /**
   * 注入账号读取、平台请求、只读音频探测及变更通知，构造时不访问网络或磁盘。
   * 回调仅接收受信歌曲元数据，缓存不会把 Cookie、账号或签名地址发送到渲染进程。
   */
  constructor({ platform, authFor, resolveBatch, probe, changed }) {
    Object.assign(this, { platform, authFor, resolveBatch, probe, changed })
    this.cache = new Map()
    this.previousIds = new Set()
    this.pending = new Map()
    this.key = null
    this.controller = new AbortController()
    this.tail = Promise.resolve()
  }

  /**
   * 为当前会话生成不可逆缓存键，登录、退出或切换身份后中止旧探测并重置结果。
   * 只比较内存中的散列，原始凭据不进入歌曲、持久文件和通知内容。
   */
  async context() {
    const auth = await this.authFor()
    const key = createHash("sha256")
      .update(JSON.stringify([auth.cookie || "", auth.uin || ""]))
      .digest("hex")
    if (key !== this.key) {
      this.controller.abort()
      this.controller = new AbortController()
      this.key = key
      this.previousIds = new Set([...this.previousIds, ...this.cache.keys()].slice(-1500))
      this.cache.clear()
      this.pending.clear()
      this.changed()
    }
    return { auth, key, signal: this.controller.signal }
  }

  /**
   * 等待缺少有效缓存的本平台歌曲检查完成，返回当前会话已经验证可播放的原始记录。
   * 相同歌曲的并发检查合并；账号在等待中切换时拒绝旧结果，避免覆盖新账号的列表。
   * 整批失败时保留限流、超时或响应异常分类，不再统一覆盖为无法确认状态。
   */
  async filter(tracks) {
    const wanted = [
      ...new Map(tracks.filter(track => track.provider === this.platform.id).map(track => [track.id, track])).values(),
    ]
    if (!wanted.length) {
      return tracks
    }
    const context = await this.context()
    const missing = wanted.filter(track => (this.cache.get(track.id)?.until || 0) <= Date.now() && !this.pending.has(track.id))
    if (missing.length) {
      const task = this.tail
        .catch(() => {})
        .then(() => this.inspect(missing, context))
        .finally(() => {
          for (const track of missing) {
            if (this.pending.get(track.id) === task) {
              this.pending.delete(track.id)
            }
          }
        })
      this.tail = task
      for (const track of missing) {
        this.pending.set(track.id, task)
      }
    }
    await Promise.all([...new Set(wanted.map(track => this.pending.get(track.id)).filter(Boolean))])
    if (context.signal.aborted || context.key !== (await this.context()).key) {
      throw new Error("账号状态已变化，请重新检索歌曲。")
    }
    if (wanted.every(track => this.cache.get(track.id)?.state === "unknown")) {
      const issues = wanted.map(track => this.cache.get(track.id)?.error).filter(Boolean)
      const issue = issues.find(error => error.kind === "limited") || issues.find(error => error.kind !== "unknown") || issues[0]
      throw new Error(OnlineRequestError.from(issue).describe(this.platform.name))
    }
    return tracks.filter(track => track.provider !== this.platform.id || this.cache.get(track.id)?.state === "ready")
  }

  /**
   * 委托平台适配器批量获取当前会话允许的播放路径，逐首验证后再写入对应结果。
   * 授权拒绝和空播放路径隐藏一分钟，网络失败隐藏十秒并保留重试机会，限流等待平台退避结束。
   * 失败仅保留安全分类，不修改用户索引，也不把网络失败升级为没有播放权限。
   */
  async inspect(tracks, context) {
    for (let start = 0; start < tracks.length; start += 20) {
      if (context.signal.aborted) {
        return
      }
      const batch = tracks.slice(start, start + 20)
      let resolved
      try {
        resolved = await this.resolveBatch(batch, context.auth, context.signal)
      } catch (failure) {
        if (!context.signal.aborted) {
          for (const track of batch) {
            this.store(track.id, { state: "unknown", error: OnlineRequestError.from(failure) }, context)
          }
        }
        continue
      }
      let next = 0
      /**
       * 从本批依次领取歌曲，最多四个工作者共用队列，避免搜索时同时打开大量音频请求。
       */
      const worker = async () => {
        while (next < batch.length && !context.signal.aborted) {
          const index = next++
          const track = batch[index]
          try {
            const result = resolved.get(track.id)
            if (result?.error) {
              throw result.error
            }
            if (!result?.url) {
              throw new Error("平台未返回有效播放结果。")
            }
            await this.probe(track, result.url, context.signal)
            this.store(track.id, { state: "ready", url: result.url }, context)
          } catch (failure) {
            if (!context.signal.aborted) {
              this.store(
                track.id,
                failure instanceof PlaybackUnavailable
                  ? { state: "blocked" }
                  : { state: "unknown", error: OnlineRequestError.from(failure) },
                context,
              )
            }
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, batch.length) }, worker))
    }
    if (!context.signal.aborted) {
      this.changed()
    }
  }

  /**
   * 提交仍属于当前账号的短期结果，并限制缓存数量，签名地址不会持久化。
   * 普通网络失败使用十秒期限，限流不早于平台指定的退避时间复核；不会永久排除歌曲。
   */
  store(id, value, context) {
    if (context.signal.aborted || context.key !== this.key) {
      return
    }
    this.cache.delete(id)
    this.cache.set(id, {
      ...value,
      until: Math.max(
        Date.now() + (value.state === "ready" ? 120000 : value.state === "blocked" ? 60000 : 10000),
        value.error?.retryAt || 0,
      ),
    })
    while (this.cache.size > 1500) {
      this.cache.delete(this.cache.keys().next().value)
    }
  }

  /**
   * 为已保存的在线索引提供同步展示判断，首次检查完成前保持隐藏，避免先显示随后又消失。
   */
  visible(id) {
    return this.cache.get(id)?.state === "ready"
  }

  /**
   * 导出仅包含不可播放标识的临时投影，供已展示的推荐和搜索及时移除后来失效的歌曲。
   */
  hidden() {
    return Object.fromEntries(
      [...this.previousIds].map(id => [id, false]).concat([...this.cache].map(([id, value]) => [id, value.state === "ready"])),
    )
  }

  /**
   * 复用当前歌曲已验证的短期地址；播放前的完整有效性仍由音频协议继续校验。
   */
  address(id) {
    const value = this.cache.get(id)
    return value?.state === "ready" && value.until > Date.now() ? value.url : ""
  }

  /**
   * 播放前复核已经过期的检查，只有成功验证的当前会话地址可以交给音频协议。
   * 暂时网络失败保留为可重试错误，不升级为明确的平台授权拒绝。
   */
  async resolve(track) {
    const available = await this.filter([track])
    if (!available.length) {
      if (this.cache.get(track.id)?.state === "blocked") {
        throw new PlaybackUnavailable("这首歌当前无法播放，已从可播放列表中隐藏。")
      }
      throw new Error(OnlineRequestError.from(this.cache.get(track.id)?.error).describe(this.platform.name))
    }
    return this.address(track.id)
  }

  /**
   * 在播放阶段发现地址拒绝后立即隐藏该曲，并通知所有曲库视图刷新。
   * 暂时断网保留十秒结果，平台限流保留至退避结束；重试或后台复核可以恢复显示。
   * 发起请求时的账号缓存键已经失效时忽略失败，避免旧账号的错误隐藏新账号可播的歌曲。
   */
  reject(id, failure, key = this.key) {
    if (key !== this.key) {
      return
    }
    this.store(
      id,
      failure instanceof PlaybackUnavailable
        ? { state: "blocked" }
        : { state: "unknown", error: OnlineRequestError.from(failure) },
      { key, signal: this.controller.signal },
    )
    this.changed()
  }

  /**
   * 退出应用时中止待完成的检查，清理当前账号的临时播放地址。
   */
  close() {
    this.controller.abort()
    this.cache.clear()
    this.previousIds.clear()
    this.pending.clear()
  }
}
