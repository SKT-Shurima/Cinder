/**
 * 编排封面刮削、候选预览和人工确认，所有变更通过曲库门面提交。
 * 候选地址只保存在主进程，界面提交候选标识不能绕过下载和图片验证。
 */
import { ArtworkLookup } from "./artworkLookup.js"
import { RecordingMatch } from "../../domain/artwork/recordingMatch.js"
import { filenameLabels } from "../../domain/catalog/trackRules.js"

/**
 * 执行封面补全、人工预览和确认用例，统一提交曲库封面变更。
 * 候选缓存属于当前进程，取消任务只丢弃未提交结果，不删除已完成缓存。
 */
export class ArtworkService {
  /**
   * 绑定索引门面、图片仓储和可替换查询器，不在构造时启动后台任务。
   */
  constructor(library, store, lookup = new ArtworkLookup()) {
    this.library = library
    this.store = store
    this.lookup = lookup
    this.previews = new Map()
  }

  /**
   * 从可靠候选中选择可下载的封面，标签有差异时再核对同歌手的文件名。
   * 下载失败继续尝试后续候选，最终仍不可靠时保留空封面及来源缺口。
   */
  async resolve(song) {
    const result = await this.lookup.search(song)
    if (result.skippedReason) {
      return { reason: result.skippedReason }
    }
    const filename = filenameLabels(song.path)
    const key = RecordingMatch.key
    if (
      !result.candidates.some(item => item.automatic) &&
      song.artist !== "未知歌手" &&
      key(filename.artist) === key(song.artist) &&
      key(filename.title) !== key(song.title)
    ) {
      const fallback = await this.lookup.search({ ...song, title: filename.title })
      result.candidates.push(...fallback.candidates.map(item => ({ ...item, matchedBy: "filename" })))
      result.errors.push(...fallback.errors)
    }
    for (const item of result.candidates.filter(candidate => candidate.automatic).slice(0, 3)) {
      try {
        const image = await this.lookup.download(item.imageUrl)
        const source = Object.fromEntries(
          ["source", "sourceUrl", "title", "artist", "album", "score"].map(field => [field, item[field]]),
        )
        return {
          cover: await this.store.store(image.bytes),
          source: { ...source, matchedBy: item.matchedBy ?? "tags", at: Date.now() },
        }
      } catch (failure) {
        result.errors.push(failure.message)
      }
    }
    const reason = result.candidates.length ? "候选录音尚未可靠匹配，请手动核对版本" : "已检索目录暂无匹配封面"
    return { reason: result.errors.length ? `${reason}；来源缺口：${[...new Set(result.errors)].join("；")}` : reason }
  }

  /**
   * 以四路并发补全封面，相同录音共用请求、已确认的同专辑封面优先复用。
   * 停止只影响尚未提交的结果；每八项落盘，任务结束统一通知界面刷新。
   */
  async enrich(retry) {
    const library = this.library
    library.cancelScrape = false
    const selected = library.state.tracks.filter(song => !song.cover && (retry || !song.coverAttempt))
    const requests = new Map()
    const albums = new Map()
    const key = RecordingMatch.key
    for (const song of library.state.tracks) {
      if (song.cover && song.album && song.coverSource?.album && key(song.album) === key(song.coverSource.album)) {
        albums.set(key(song.artist) + "|" + key(song.album), { cover: song.cover, source: song.coverSource })
      }
    }
    const progress = {
      phase: "scrape",
      total: selected.length,
      done: 0,
      matched: 0,
      missing: 0,
      error: null,
      message: "正在检索缺失封面…",
    }
    library.progress(progress)
    const iterator = selected.values()
    /**
     * 为共享任务队列领取歌曲，取消后不再修改该歌曲的封面和失败记录。
     */
    const worker = async () => {
      for (const song of iterator) {
        if (library.cancelScrape) {
          return
        }
        const recording = [song.artist, song.title, song.album].map(key).join("|")
        const album = song.album ? key(song.artist) + "|" + key(song.album) : null
        let result
        try {
          if (album && albums.has(album)) {
            result = albums.get(album)
          } else {
            if (!requests.has(recording)) {
              requests.set(recording, this.resolve(song))
            }
            result = await requests.get(recording)
          }
        } catch (failure) {
          result = { reason: failure.message }
        }
        if (library.cancelScrape) {
          return
        }
        if (result.cover) {
          Object.assign(song, { cover: result.cover, coverSource: result.source })
          progress.matched += 1
          if (album && result.source?.album && key(song.album) === key(result.source.album)) {
            albums.set(album, result)
          }
        } else {
          progress.missing += 1
        }
        song.coverAttempt = { at: Date.now(), reason: result.reason ?? null }
        progress.done += 1
        library.progress({ ...progress, message: song.artist + " · " + song.title })
        if (progress.done % 8 === 0) {
          await library.save()
          library.emit("changed")
        }
        await new Promise(resolve => setTimeout(resolve, 450))
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, selected.length) }, worker))
    await library.save()
    library.emit("changed")
    library.progress({
      ...progress,
      phase: "idle",
      message: `${library.cancelScrape ? "已停止" : "封面刮削完成"} · 补全 ${progress.matched} 首，${progress.missing} 首待匹配`,
    })
    return library.snapshot()
  }

  /**
   * 下载手动核对所需的至多十二张缩略图，最多四张并行。
   * 暂存候选仅在当前进程内有效，不将第三方 URL 接收为确认参数。
   */
  async preview(id) {
    const result = await this.lookup.search(this.library.track(id), true)
    const pending = result.candidates.slice(0, 12).values()
    const candidates = []
    /**
     * 读取候选图片并记住可信缓存位置，单张图片失败仍展示其他可用候选。
     */
    const worker = async () => {
      for (const candidate of pending) {
        try {
          const downloaded = await this.lookup.download(candidate.imageUrl)
          const preview = { ...candidate, cover: await this.store.store(downloaded.bytes) }
          this.previews.set(id + ":" + candidate.id, preview)
          candidates.push(preview)
        } catch (failure) {
          result.errors.push(failure.message)
        }
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker))
    return { candidates: candidates.sort((a, b) => b.score - a.score), errors: result.errors }
  }

  /**
   * 确认此前预览的候选，持久化人工确认标记并通知曲库订阅者。
   * 已失效候选必须重新查询，不能据此下载另一个任意地址。
   */
  async confirm(id, candidateId) {
    const candidate = this.previews.get(id + ":" + candidateId)
    if (!candidate) {
      throw new Error("候选已失效，请重新搜索")
    }
    const track = this.library.track(id)
    const source = Object.fromEntries(["source", "sourceUrl", "title", "artist", "album"].map(field => [field, candidate[field]]))
    Object.assign(track, { cover: candidate.cover, coverSource: { ...source, manual: true, at: Date.now() } })
    await this.library.save()
    this.library.emit("changed")
    return this.library.snapshot()
  }
}
