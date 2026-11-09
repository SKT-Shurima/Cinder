/**
 * 从私人曲库和已启用在线平台汇集默认主题，优先展示自动分类后的本地与远程歌曲。
 * 分类使用现有索引，远程音频仍由原播放通道按需读取，不为主题扫描下载音频。
 */
import { musicThemes } from "#shared/musicThemes"
import { recommendationKey } from "#shared/recommendationRules"
import { normalizeMusicProviders, normalizeMusicSources } from "#shared/musicSources"
import { selectLibraryThemeTracks, themeLibraryKey } from "#shared/libraryThemeRules"
import { ThemePlaylistSources } from "./themePlaylistSources.js"

/**
 * 每类以一百首真实匹配歌曲为目标，索引变更与账号变化分别参与缓存失效。
 * 同时只补充当前打开的主题；关闭在线来源后仍可使用私人曲库，不创建个人歌单记录。
 */
export class ThemeMusicCatalog {
  /**
   * 组合分类规则、平台策略和可用性服务，构造时不读取音频或发起网络请求。
   * 换批序号独立于轮询版本，后台查询不会意外改变当前曲目集合。
   */
  constructor(online) {
    this.online = online
    this.sources = new ThemePlaylistSources(online)
    this.cache = new Map()
    this.active = null
    this.revision = 0
    this.requestedId = null
    this.batches = new Map()
  }

  /**
   * 查询在线推荐所需的账号上下文，保留首页在线候选接口的既有约束。
   * 没有启用平台时明确拒绝；主题分类通过独立上下文允许仅本地或远程来源。
   */
  async context() {
    const enabled = normalizeMusicProviders(this.online.library.state.settings.musicProviders)
    const providers = [...this.online.availability.keys()].filter(id => enabled[id])
    const keys = await Promise.all(
      providers.map(async id => {
        this.online.provider(id)
        return [id, (await this.online.availability.get(id).context()).key]
      }),
    )
    if (!providers.length) {
      throw new Error("请先启用 QQ 音乐或网易云音乐。")
    }
    return { providers, key: JSON.stringify(keys) }
  }

  /**
   * 为主题组合曲库版本与可选在线上下文，索引新增或来源关闭后不复用旧分类。
   * 平台关闭或账号暂不可用时继续返回私人曲库，不让在线错误清空远程歌曲。
   */
  async themeContext() {
    const state = this.online.library.state
    const libraryKey = themeLibraryKey(state)
    const modes = normalizeMusicSources(state.settings.musicSources)
    const enabled = normalizeMusicProviders(state.settings.musicProviders)
    if (!modes.online || ![...this.online.availability.keys()].some(id => enabled[id])) {
      return { providers: [], key: JSON.stringify([libraryKey]), warning: "" }
    }
    try {
      const online = await this.context()
      return { ...online, key: JSON.stringify([libraryKey, online.key]), warning: "" }
    } catch {
      return {
        providers: [],
        key: JSON.stringify([libraryKey, "online-unavailable"]),
        warning: "在线资源暂不可用，可以稍后重试或检查音乐来源。",
      }
    }
  }

  /**
   * 将平台候选登记到短期资源索引，本地和远程歌曲继续使用现有曲库标识。
   * 分类本身不把文件曲目写入在线记录，也不改变收藏、历史或播放队列。
   */
  rememberOnline(tracks) {
    const online = tracks.filter(track => track.kind === "online")
    if (online.length) {
      this.online.remember(online)
    }
  }

  /**
   * 立即返回私人曲库的主题匹配，不足目标且有在线平台时再渐进补充。
   * 新扫描、偏好变化或手动换批都会更新结果；异步旧请求不能覆盖较新的主题。
   */
  async read(input) {
    const theme = musicThemes.find(item => item.id === input?.id)
    if (!theme) {
      throw new Error("这个音乐主题不存在。")
    }
    const revision = ++this.revision
    this.requestedId = theme.id
    const context = await this.themeContext()
    if (revision !== this.revision) {
      throw new Error("音乐主题已切换。")
    }
    let entry = this.cache.get(theme.id)
    if (this.active && (this.active.id !== theme.id || this.active.context.key !== context.key || input?.refresh === true)) {
      this.active.controller.abort()
    }
    if (
      !entry ||
      entry.context.key !== context.key ||
      input?.refresh === true ||
      (entry.phase !== "loading" && entry.until < Date.now()) ||
      entry.controller.signal.aborted
    ) {
      const batch = (this.batches.get(theme.id) || 0) + (input?.refresh === true ? 1 : 0)
      this.batches.set(theme.id, batch)
      const tracks = selectLibraryThemeTracks(this.online.library.state, theme, { batch })
      const loading = context.providers.length > 0 && tracks.length < theme.target
      entry = {
        id: theme.id,
        context,
        tracks,
        checked: tracks.length,
        phase: loading ? "loading" : "ready",
        message: context.warning || (!loading && !tracks.length ? "当前曲库中没有匹配这个主题的歌曲。" : ""),
        until: Date.now() + 120000,
        controller: new AbortController(),
      }
      this.cache.delete(theme.id)
      this.cache.set(theme.id, entry)
      this.active = entry
      if (loading) {
        this.load(theme, entry).catch(() => {
          if (!entry.controller.signal.aborted) {
            entry.phase = "partial"
            entry.message = "在线歌曲暂时无法继续补充，可以稍后重试。"
            entry.until = Date.now() + 10000
          }
        })
      }
      while (this.cache.size > 8) {
        this.cache.delete(this.cache.keys().next().value)
      }
    }
    const tracks = entry.tracks.filter(
      track => track.kind !== "online" || this.online.availability.get(track.provider)?.visible(track.id) === true,
    )
    this.rememberOnline(tracks)
    return { id: theme.id, tracks, checked: entry.checked, target: theme.target, phase: entry.phase, message: entry.message }
  }

  /**
   * 为不足百首的主题补充真实平台候选，跨来源同一录音只占一个位置。
   * 在线核验失败仍保留已匹配的私人曲库；目录、标签或来源状态变化后中止旧补充任务。
   * 每轮及最终校验都只把在线曲目交给平台，远程文件不会被当作在线资源重新入库。
   */
  async load(theme, entry) {
    const seen = new Set(entry.tracks.map(track => track.id))
    const recordings = new Set(entry.tracks.map(recommendationKey))
    const signal = entry.controller.signal
    let failedRounds = 0
    for (let round = 0; round < 36 && entry.tracks.length < theme.target && entry.checked < 4000; round++) {
      if (signal.aborted) {
        return
      }
      const result = await this.sources.candidates(theme, entry.context.providers, round, signal)
      if (signal.aborted || (await this.themeContext()).key !== entry.context.key) {
        entry.controller.abort()
        return
      }
      failedRounds = result.errors.length === entry.context.providers.length ? failedRounds + 1 : 0
      if (failedRounds >= 2) {
        break
      }
      const candidates = result.tracks.filter(track => {
        if (track.kind !== "online" || seen.has(track.id)) {
          return false
        }
        seen.add(track.id)
        return true
      })
      for (let start = 0; start < candidates.length && entry.tracks.length < theme.target && entry.checked < 4000; start += 20) {
        if (signal.aborted) {
          return
        }
        const batch = candidates.slice(start, start + 20)
        let available = []
        try {
          available = await this.online.playableTracks(batch)
        } catch {
          /* 保留私人曲库，继续尝试其他在线候选。 */
        }
        if (signal.aborted) {
          return
        }
        entry.checked += batch.length
        for (const track of available) {
          const key = recommendationKey(track)
          if (!recordings.has(key) && entry.tracks.length < theme.target) {
            recordings.add(key)
            entry.tracks.push(track)
          }
        }
        this.rememberOnline(entry.tracks)
      }
      if (entry.context.providers.every(id => (this.online.requestGate?.cooldowns.get(id) || 0) > Date.now())) {
        break
      }
    }
    if (signal.aborted) {
      return
    }
    const verified = await Promise.allSettled(
      entry.context.providers.map(id =>
        this.online.playableTracks(entry.tracks.filter(track => track.kind === "online" && track.provider === id)),
      ),
    )
    if (signal.aborted || (await this.themeContext()).key !== entry.context.key) {
      entry.controller.abort()
      return
    }
    entry.tracks = entry.tracks
      .filter(track => track.kind !== "online")
      .concat(verified.flatMap(result => (result.status === "fulfilled" ? result.value : [])))
    entry.phase = entry.tracks.length >= theme.target ? "ready" : "partial"
    entry.until = Date.now() + 120000
    entry.message = entry.phase === "partial" ? "已找到 " + entry.tracks.length + " 首匹配歌曲，可以换一批继续发现。" : ""
  }

  /**
   * 离开主题页时停止指定分类的在线补充，已显示索引继续供当前播放使用。
   * 只取消匹配的任务，旧页面迟到的清理不会中断新分类。
   */
  cancel(id) {
    if (this.requestedId === id) {
      this.revision++
    }
    if (this.active?.id === id && this.active.phase === "loading") {
      this.active.controller.abort()
    }
  }

  /**
   * 退出应用或修改来源偏好时清除主题缓存、换批序号及在线任务。
   * 此操作不删除私人曲库、服务器文件或用户创建的歌单。
   */
  close() {
    this.revision++
    this.requestedId = null
    this.active?.controller.abort()
    this.cache.clear()
    this.batches.clear()
  }
}
