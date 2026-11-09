/**
 * 对桌面命令提供曲库门面，协调仓储、导入、封面和歌词服务。
 * 门面保留持久索引格式及事件协议，升级结构不会迁移或重建用户音乐数据。
 */
import fs from "node:fs/promises"
import path from "node:path"
import { EventEmitter } from "node:events"
import { JsonRepository } from "../../infrastructure/persistence/jsonRepository.js"
import { AudioFileReader } from "../../infrastructure/media/audioFileReader.js"
import { ArtworkStore } from "../../infrastructure/artwork/artworkStore.js"
import { CatalogProjection } from "../../domain/catalog/catalogProjection.js"
import { FolderImportService } from "./folderImportService.js"
import { LyricsService } from "./lyricsService.js"
import { ArtworkService } from "../artwork/artworkService.js"
import { OnlineLyrics } from "../../infrastructure/lyrics/lyricsProviderChain.js"
import { normalizeSound } from "#shared/audioSettings"
import { musicProviders, normalizeMusicSources, normalizeMusicProviders } from "#shared/musicSources"

/**
 * 定义首次运行的索引结构，后续恢复只补充缺失字段，不覆盖用户已保存偏好。
 */
function initialCatalog() {
  return {
    version: 1,
    roots: [],
    tracks: [],
    onlineTracks: [],
    remoteSources: [],
    userPlaylists: [],
    favorites: [],
    history: [],
    failures: [],
    playlistCovers: {},
    player: {},
    scannedAt: null,
    settings: { volume: 0.7, accent: "flame", theme: "dark", themeCoverage: 70, glassOpacity: 70, skipProblemFolders: true },
  }
}

/**
 * 校验恢复和保存的播放状态，过期歌曲与异常进度不会传入媒体协议。
 * 队列最多两万项，循环模式只接受界面支持的三个固定值。
 */
export function sanitizePlayback(value, tracks) {
  const ids = new Set(tracks.map(track => track.id))
  return {
    trackId: ids.has(value?.trackId) ? value.trackId : null,
    queue: (Array.isArray(value?.queue) ? value.queue : []).filter(id => ids.has(id)).slice(0, 20000),
    mode: new Set(["list", "shuffle", "one"]).has(value?.mode) ? value.mode : "list",
    position: Number.isFinite(value?.position) && value.position > 0 ? value.position : 0,
  }
}

/**
 * 作为音乐库应用服务门面，对外保留快照、扫描、封面和歌词用例。
 * 仓储与来源服务各自拥有资源，门面协调任务互斥并发布兼容的变更事件。
 */
export class LibraryService extends EventEmitter {
  /**
   * 组合领域服务与基础设施，构造阶段不读取文件或发起网络请求。
   * 应用数据路径与旧版保持一致，调用 initialize 后才允许读取快照。
   */
  constructor(dataDirectory, defaultRoot) {
    super()
    this.dataDir = dataDirectory
    this.defaultRoot = defaultRoot
    this.coverDir = path.join(dataDirectory, "covers")
    this.repository = new JsonRepository(path.join(dataDirectory, "library.json"))
    this.playbackRepository = new JsonRepository(path.join(dataDirectory, "playback.json"))
    this.artworkStore = new ArtworkStore(this.coverDir)
    this.reader = new AudioFileReader(this.artworkStore)
    this.projection = new CatalogProjection()
    this.importer = new FolderImportService(
      (filename, previous) => this.reader.read(filename, previous),
      update => this.progress(update),
    )
    this.artwork = new ArtworkService(this, this.artworkStore)
    this.lyricService = new LyricsService(this, new OnlineLyrics(path.join(dataDirectory, "lyrics")))
    this.state = initialCatalog()
    this.status = { phase: "idle", done: 0, total: 0, matched: 0, missing: 0, message: "" }
    this.cancelScrape = false
  }

  /**
   * 恢复保存的索引与独立播放文件，规范旧版缺少的设置和在线歌曲记录。
   * 缺失索引时才采用默认音乐根目录；损坏数据由仓储保留备份。
   * 在线记录仅恢复当前支持的平台，已移除平台的旧歌曲和队列项不再进入可播放快照。
   * 旧版本没有用户歌单时保持空列表，不把自动生成的专辑或目录分组当作用户创建记录。
   */
  async initialize() {
    await fs.mkdir(this.coverDir, { recursive: true })
    const stored = await this.repository.read()
    if (stored) {
      this.state = { ...this.state, ...stored, settings: { ...this.state.settings, ...stored.settings } }
    } else if (
      this.defaultRoot &&
      (await fs.stat(this.defaultRoot).then(
        info => info.isDirectory(),
        () => false,
      ))
    ) {
      this.state.roots.push(this.defaultRoot)
    }
    const settings = this.state.settings
    this.state.userPlaylists = (Array.isArray(this.state.userPlaylists) ? this.state.userPlaylists : []).filter(
      playlist => typeof playlist?.id === "string" && typeof playlist.name === "string" && Array.isArray(playlist.trackIds),
    )
    Object.assign(settings, {
      soundEffects: normalizeSound(settings.soundEffects),
      musicSources: normalizeMusicSources(settings.musicSources),
      musicProviders: normalizeMusicProviders(settings.musicProviders),
    })
    this.state.onlineTracks = (Array.isArray(this.state.onlineTracks) ? this.state.onlineTracks : []).filter(
      track =>
        track?.kind === "online" &&
        musicProviders.some(provider => provider.id === track.provider) &&
        /^[a-f0-9]{24}$/u.test(track.id),
    )
    this.state.player = sanitizePlayback(
      (await this.playbackRepository.read()) ?? this.state.player,
      this.state.tracks.concat(this.state.onlineTracks),
    )
    return this.snapshot()
  }

  /**
   * 提交当前索引快照；仓储负责原子写入与提交顺序，错误继续返回给调用方。
   */
  save() {
    return this.repository.commit(this.state)
  }

  /**
   * 仅保存播放进度和队列，避免高频写入重写整个音乐库。
   */
  savePlayback() {
    return this.playbackRepository.commit(this.state.player)
  }

  /**
   * 合并后台任务进度并发布事件，重新打开界面仍能读取最后任务状态。
   */
  progress(update) {
    Object.assign(this.status, update)
    this.emit("progress", { ...this.status })
  }

  /**
   * 提供只读派生快照，目录分类与统计由独立领域投影计算。
   * 在线可用性仅参与展示投影，隐藏歌曲不会删改原索引、收藏、历史记录或用户文件。
   */
  snapshot() {
    const onlineTracks = this.state.onlineTracks.filter(track => this.onlineVisibility?.(track) !== false)
    return {
      ...this.projection.build({ ...this.state, onlineTracks }, this.status),
      onlineAvailability: this.onlineAvailability?.() || {},
    }
  }

  /**
   * 在索引中定位歌曲，未知标识不允许进入文件、封面或歌词操作。
   */
  track(id) {
    const song = this.state.tracks.concat(this.state.onlineTracks).find(track => track.id === id)
    if (song) {
      return song
    }
    throw new Error("歌曲不在当前音乐库中，请重新扫描")
  }

  /**
   * 将经过签名校验的图片交给统一封面仓储，供远程元数据与手动导入复用。
   */
  cacheImage(bytes) {
    return this.artworkStore.store(bytes)
  }

  /**
   * 拒绝与扫描、远程连接或刮削并发的索引任务，避免相互覆盖结果。
   */
  requireIdle() {
    if (this.status.phase !== "idle") {
      throw new Error("请先等待当前任务完成或停止封面刮削")
    }
  }

  /**
   * 导入本地文件并保留服务器记录，全部解析结果完成后才提交新的本地索引。
   * 任务异常恢复空闲状态；只记录问题文件，不改写音乐或自动删除用户收藏。
   */
  async scan() {
    this.requireIdle()
    this.progress({ phase: "scan", done: 0, total: 0, error: null, message: "正在查找音乐文件…" })
    try {
      const result = await this.importer.execute(this.state)
      const remote = this.state.tracks.filter(track => track.sourceId)
      Object.assign(this.state, {
        tracks: remote.concat(result.tracks).sort((a, b) => a.path.localeCompare(b.path, "zh-CN", { numeric: true })),
        failures: result.failures,
        scannedAt: Date.now(),
      })
      await this.save()
      this.emit("changed")
      this.progress({
        phase: "idle",
        done: result.total,
        message: `已导入 ${result.tracks.length.toLocaleString()} 首歌曲${result.failures.length ? `，${result.failures.length} 项无法读取` : ""}`,
      })
      return this.snapshot()
    } catch (failure) {
      this.progress({ phase: "idle", error: failure.message, message: "扫描未完成" })
      throw failure
    }
  }

  /**
   * 执行独立封面补全用例并保证失败后可再次启动，已提交结果不会被回滚。
   */
  async scrape(retry = false) {
    this.requireIdle()
    try {
      return await this.artwork.enrich(retry)
    } catch (failure) {
      this.progress({ phase: "idle", error: failure.message, message: "封面刮削中断，可重试" })
      throw failure
    }
  }

  /**
   * 按来源策略读取歌词，在线访问开关由受信桌面命令显式传入。
   */
  lyrics(id, options) {
    return this.lyricService.read(id, options)
  }

  /**
   * 请求封面人工核对候选，下载和候选缓存不暴露给渲染进程自行管理。
   */
  candidates(id) {
    return this.artwork.preview(id)
  }

  /**
   * 确认当前进程已预览的封面，旧候选失效时提示用户重新查询。
   */
  applyCandidate(id, candidateId) {
    return this.artwork.confirm(id, candidateId)
  }
}
