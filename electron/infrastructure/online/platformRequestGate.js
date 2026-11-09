/**
 * 限制主题汇集、推荐和普通搜索对同一平台的请求密度，避免连续操作造成短时请求堆积。
 */
import { setTimeout as delay } from "node:timers/promises"
import { OnlineRequestError } from "./onlineRequestError.js"

/**
 * 按平台串行安排请求起点，元数据间隔至少三百五十毫秒，授权检查间隔至少一千一百毫秒。
 * 平台返回临时拒绝后退避一分钟，等待可取消；此服务不改变会员权限或重新尝试绕过授权。
 */
export class PlatformRequestGate {
  /**
   * 注入时钟和等待器，方便在测试中核对节奏而不真实等待一分钟。
   * 构造时不启动计时器，只有有请求时才进入等待队列。
   */
  constructor({ now = Date.now, wait = delay } = {}) {
    this.now = now
    this.wait = wait
    this.last = new Map()
    this.lastAuthorization = new Map()
    this.cooldowns = new Map()
    this.tails = new Map()
    this.controller = new AbortController()
  }

  /**
   * 在发起官方请求前等待本平台的可用时隙，同平台并发调用仍按先后顺序领取。
   * 平台处于退避期时直接返回可重试提示，不让页面长时间等待；取消后不消耗请求时隙。
   */
  enter(provider, signal, authorization = false) {
    const combined = signal ? AbortSignal.any([this.controller.signal, signal]) : this.controller.signal
    const task = (this.tails.get(provider) || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        combined.throwIfAborted()
        this.requireAvailable(provider)
        const remaining = Math.max(
          0,
          (this.last.get(provider) ?? -Infinity) + 350 - this.now(),
          authorization ? (this.lastAuthorization.get(provider) ?? -Infinity) + 1100 - this.now() : 0,
        )
        if (remaining) {
          await this.wait(remaining, undefined, { signal: combined })
        }
        combined.throwIfAborted()
        this.requireAvailable(provider)
        this.last.set(provider, this.now())
        if (authorization) {
          this.lastAuthorization.set(provider, this.now())
        }
      })
    this.tails.set(provider, task)
    return task
  }

  /**
   * 检查平台是否仍在短暂退避，并保留剩余秒数供播放检查缓存使用。
   * 退避不是单曲授权拒绝，不能把它转换为会员不足或永久不可播放。
   */
  requireAvailable(provider) {
    const remaining = (this.cooldowns.get(provider) || 0) - this.now()
    if (remaining > 0) {
      throw new OnlineRequestError("limited", { retryAfterSeconds: remaining / 1000 })
    }
  }

  /**
   * 遇到平台的暂时拒绝响应时开始退避，普通单曲无播放权限不触发全平台暂停。
   * 只检查固定状态码，不把平台原始正文、账号或签名地址带到错误提示里。
   */
  inspect(provider, data, status = 200) {
    if (
      status === 429 ||
      [405, 429].includes(data?.code) ||
      data?.req_0?.code === 104009 ||
      data?.req_0?.data?.retcode === 104009
    ) {
      this.cooldowns.set(provider, this.now() + 60000)
      this.requireAvailable(provider)
    }
  }

  /**
   * 应用退出时取消尚未获得时隙的请求，清除平台的临时调度状态。
   */
  close() {
    this.controller.abort()
    this.tails.clear()
    this.cooldowns.clear()
  }
}
