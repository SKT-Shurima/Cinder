/**
 * 统一管理只读服务器音乐库，按 SFTP 或 Subsonic 策略接入，索引与本地歌曲共存。
 * 登录凭据只保留在主进程；用户选择记住后，才用系统加密能力写入独立文件。
 */
import fs from "node:fs/promises"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { Readable } from "node:stream"
import { Client } from "ssh2"
import { parseWebStream } from "music-metadata"
import { SubsonicSourceAdapter } from "./subsonicSourceAdapter.js"
import { publicPresetCredentials } from "#shared/remotePresets"
import {
  audioFormats as AUDIO_EXTENSIONS,
  filenameLabels as inferTags,
  lyricsTimeline as parseLyrics,
  catalogKey as stableId,
} from "../../domain/catalog/trackRules.js"

/**
 * 校验远程连接表单，统一使用服务器上的绝对 POSIX 目录。
 * 不接受 URL、相对路径或控制字符，避免把粘贴的连接命令当作主机名使用。
 */
function connectionConfig(input = {}) {
  const host = String(input.host || "").trim()
  const username = String(input.username || "").trim()
  const root = String(input.root || "").trim()
  const port = Number(input.port || 22)
  if (!host || host.length > 253 || /[\s/@\x00-\x1f]/.test(host)) {
    throw new Error("请填写服务器 IP 或域名，不包含协议和端口")
  }
  if (!username || username.length > 128 || /[\x00-\x1f]/.test(username)) {
    throw new Error("请填写有效的登录用户名")
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("端口应在 1–65535 之间")
  }
  if (!root.startsWith("/") || root.length > 4096 || /[\x00-\x1f]/.test(root)) {
    throw new Error("请填写服务器音乐目录的绝对路径，例如 /data/music")
  }
  return {
    id: input.id,
    name: String(input.name || host)
      .trim()
      .slice(0, 80),
    host,
    port,
    username,
    root: path.posix.normalize(root),
    auth: input.auth === "key" ? "key" : "password",
    remember: input.remember === true,
  }
}

/**
 * 判断规范化后的服务器路径是否仍位于已授权的音乐根目录中。
 * 根目录本身允许访问，兄弟目录和符号链接解析后的越界路径被拒绝。
 */
function within(root, filename) {
  return filename === root || filename.startsWith(root === "/" ? "/" : `${root}/`)
}

/**
 * 将 SFTP 回调转换为有限时长的操作，连接断开时立即拒绝。
 * 超时会关闭会话，防止离线服务器让扫描和界面任务永久挂起。
 */
function request(session, method, ...args) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error, value) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      session.client.off("close", closed)
      error ? reject(error) : resolve(value)
    }
    const closed = () => finish(new Error("服务器连接已断开，请重新连接"))
    const timer = setTimeout(() => {
      finish(new Error("读取服务器超时，请检查网络后重试"))
      session.client.destroy()
    }, 20000)
    session.client.once("close", closed)
    try {
      session.sftp[method](...args, finish)
    } catch (error) {
      finish(error)
    }
  })
}

/**
 * 协调远程连接、曲库同步与可拖动进度的音频流，协议细节交给来源策略。
 * 旧配置默认沿用 SFTP；移除来源或退出时释放对应会话和正在读取的音频。
 */
export class RemoteSources {
  /**
   * 注入主进程提供的指纹确认和系统加密函数，便于隔离测试与界面能力。
   * 构造后先调用 initialize；音乐索引只保存非敏感配置与已确认指纹。
   */
  constructor(library, { trustHost, encrypt, decrypt, fetch: fetcher }) {
    this.library = library
    this.trustHost = trustHost
    this.encrypt = encrypt
    this.decrypt = decrypt
    this.credentialsFile = path.join(library.dataDir, "remote-credentials.json")
    this.encrypted = {}
    this.credentials = new Map()
    this.sessions = new Map()
    this.connecting = new Map()
    this.trusted = new Map()
    this.metadataTasks = new Map()
    this.subsonic = new SubsonicSourceAdapter(this, fetcher)
  }

  /**
   * 恢复已加密的凭据容器，不向界面返回或预先解密其中的内容。
   * 文件缺失或损坏时要求重新登录，已保存的服务器索引仍可浏览。
   * 旧版官方演示来源首次升级时关闭推荐；已有明确开关值的来源保持用户选择。
   */
  async initialize() {
    try {
      this.encrypted = JSON.parse(await fs.readFile(this.credentialsFile, "utf8"))
    } catch {
      this.encrypted = {}
    }
    let changed = false
    for (const source of this.library.state.remoteSources) {
      if (typeof source.recommendationsEnabled !== "boolean" && publicPresetCredentials(source)) {
        source.recommendationsEnabled = false
        changed = true
      }
    }
    if (changed) {
      await this.library.save()
    }
  }

  /**
   * 以受限权限原子保存系统加密后的凭据，避免明文密码落入音乐库快照。
   * 用户未选择记住时删除该来源之前保存的密文，只在内存保留本次登录。
   */
  async saveCredentials(id, credentials, remember) {
    const encrypted = remember ? this.encrypt(JSON.stringify(credentials)) : null
    const next = { ...this.encrypted }
    if (encrypted) {
      next[id] = encrypted
    } else {
      delete next[id]
    }
    await fs.writeFile(`${this.credentialsFile}.tmp`, JSON.stringify(next), { mode: 0o600 })
    await fs.rename(`${this.credentialsFile}.tmp`, this.credentialsFile)
    this.encrypted = next
    this.credentials.set(id, credentials)
  }

  /**
   * 按来源获取登录材料，只有连接时才解密持久凭据。
   * 官方演示来源使用运营方已公开的预设凭据；私人凭据未保存或无法解密时要求重新登录。
   */
  credentialsFor(id) {
    if (this.credentials.has(id)) {
      return this.credentials.get(id)
    }
    const published = publicPresetCredentials(this.library.state.remoteSources.find(source => source.id === id))
    if (published) {
      return published
    }
    try {
      if (this.encrypted[id]) {
        return JSON.parse(this.decrypt(this.encrypted[id]))
      }
    } catch {}
    throw new Error("请在设置的远程音乐库中重新登录此服务器")
  }

  /**
   * 建立已校验主机指纹的 SSH 会话，认证完成后只启用 SFTP 文件读取。
   * 未知指纹必须经用户确认；保存过的指纹发生变化时直接阻止连接。
   */
  async connect(source, credentials) {
    const endpoint = `${source.host}:${source.port}`
    const expected = source.fingerprint || this.trusted.get(endpoint)
    let fingerprint
    let failure
    const client = new Client()
    const streams = new Set()
    const session = { client, streams, sftp: null, closed: false }
    client.on("error", error => {
      failure ||= error
      for (const stream of streams) {
        stream.destroy(new Error("服务器连接中断，请重试"))
      }
    })
    client.on("close", () => {
      session.closed = true
      for (const stream of streams) {
        stream.destroy(new Error("服务器连接已断开"))
      }
    })
    try {
      await new Promise((resolve, reject) => {
        client.once("error", reject)
        client.once("close", () => reject(failure || new Error("服务器在登录完成前断开了连接")))
        client.once("ready", resolve)
        client.connect({
          host: source.host,
          port: source.port,
          username: source.username,
          ...(source.auth === "key"
            ? { privateKey: credentials.privateKey, passphrase: credentials.passphrase || undefined }
            : { password: credentials.password }),
          readyTimeout: 90000,
          keepaliveInterval: 15000,
          keepaliveCountMax: 2,
          hostVerifier: (key, callback) => {
            fingerprint = `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`
            if (expected) {
              if (expected !== fingerprint) {
                failure = new Error("服务器指纹已变化，连接已停止。请核实服务器后重新添加")
              }
              callback(expected === fingerprint)
            } else {
              this.trustHost({ host: source.host, port: source.port, fingerprint })
                .then(accepted => {
                  if (!accepted) {
                    failure = new Error("已取消服务器指纹确认")
                  }
                  callback(accepted)
                })
                .catch(error => {
                  failure = error
                  callback(false)
                })
            }
          },
        })
      })
      session.sftp = await new Promise((resolve, reject) => client.sftp((error, sftp) => (error ? reject(error) : resolve(sftp))))
      this.trusted.set(endpoint, fingerprint)
      session.fingerprint = fingerprint
      return session
    } catch (error) {
      client.destroy()
      throw (
        failure ||
        new Error(
          error.message === "All configured authentication methods failed"
            ? "登录失败，请检查用户名、密码或私钥"
            : `无法连接服务器：${error.message}`,
        )
      )
    }
  }

  /**
   * 按协议验证目录或音乐服务器的可读性，重新登录时只更新该来源的连接材料。
   * 验证失败不改写旧配置和索引；旧版没有协议字段的配置继续走 SFTP。
   */
  async configure(input, credentials, save = false) {
    if (input?.protocol === "subsonic") {
      return this.subsonic.configure(input, credentials, save)
    }
    if (input?.protocol && input.protocol !== "sftp") {
      throw new Error("不支持的远程音乐库类型")
    }
    if (this.library.status.phase !== "idle") {
      throw new Error("请先等待当前音乐库任务完成")
    }
    const source = connectionConfig(input)
    const old = this.library.state.remoteSources.find(
      item =>
        item.id === source.id ||
        (item.host === source.host &&
          item.port === source.port &&
          item.username === source.username &&
          item.root === source.root),
    )
    if (source.id && !old) {
      throw new Error("服务器来源已不存在，请重新添加")
    }
    if (
      old &&
      (old.host !== source.host || old.port !== source.port || old.username !== source.username || old.root !== source.root)
    ) {
      throw new Error("重新登录时不能修改服务器位置，请另行添加来源")
    }
    if (source.auth === "password" && !credentials?.password) {
      throw new Error("请输入登录密码")
    }
    if (source.auth === "key" && !credentials?.privateKey) {
      throw new Error("请选择 SSH 私钥文件")
    }
    const config = { ...source, id: old?.id || randomUUID(), fingerprint: old?.fingerprint }
    let session
    this.library.progress({ phase: "connect", error: null, message: `正在连接 ${config.name}…` })
    try {
      session = await this.connect(config, credentials)
      const resolvedRoot = await request(session, "realpath", config.root)
      const stat = await request(session, "stat", resolvedRoot)
      if (!stat.isDirectory()) {
        throw new Error("音乐目录不是文件夹")
      }
      await request(session, "readdir", resolvedRoot)
      if (!save) {
        return { message: "连接成功，音乐目录可读取" }
      }
      await this.saveCredentials(config.id, credentials, config.remember)
      this.disconnect(config.id)
      const saved = { ...old, ...config, resolvedRoot, fingerprint: session.fingerprint }
      this.library.state.remoteSources = [...this.library.state.remoteSources.filter(item => item.id !== saved.id), saved]
      await this.library.save()
      this.library.emit("changed")
      return { sourceId: saved.id }
    } finally {
      session?.client.end()
      this.library.progress({ phase: "idle", message: "" })
    }
  }

  /**
   * 获取来源的共享 SFTP 会话，合并同时发生的歌词、元信息与音频请求。
   * 断线会话不复用，下一次请求用已保存或本次登录的凭据重新建立连接。
   */
  async session(id) {
    const source = this.library.state.remoteSources.find(item => item.id === id)
    if (!source) {
      throw new Error("服务器来源已移除")
    }
    if (this.sessions.has(id) && !this.sessions.get(id).closed) {
      return this.sessions.get(id)
    }
    if (!this.connecting.has(id)) {
      const pending = this.connect(source, this.credentialsFor(id))
        .then(session => {
          if (!this.library.state.remoteSources.includes(source)) {
            session.client.destroy()
            throw new Error("服务器来源已移除或更新，请重试")
          }
          this.sessions.set(id, session)
          return session
        })
        .finally(() => this.connecting.delete(id))
      this.connecting.set(id, pending)
    }
    return this.connecting.get(id)
  }

  /**
   * 校验真实路径后获取远程文件属性，音频、歌词与扫描都受来源根目录约束。
   * 服务器上的符号链接被重新解析，防止扫描后替换链接读取授权目录之外的文件。
   */
  async locate(sourceId, filename) {
    const source = this.library.state.remoteSources.find(item => item.id === sourceId)
    if (!source || !within(source.resolvedRoot, path.posix.normalize(filename))) {
      throw new Error("文件不在此服务器音乐目录中")
    }
    const session = await this.session(sourceId)
    const real = await request(session, "realpath", filename)
    if (!within(source.resolvedRoot, real)) {
      throw new Error("远程文件指向音乐目录之外")
    }
    return { session, filename: real, stat: await request(session, "stat", real) }
  }

  /**
   * 创建按字节范围读取的音频流，支持进度拖动且不下载整首歌曲到本机。
   * 停滞读取会中断，正常结束、取消或移除来源都会释放远程文件句柄。
   */
  stream(session, filename, options) {
    const stream = session.sftp.createReadStream(filename, options)
    session.streams.add(stream)
    const timer = setInterval(() => {
      if (Date.now() - lastData > 30000) {
        stream.destroy(new Error("远程音频读取超时"))
      }
    }, 5000)
    let lastData = Date.now()
    stream.on("data", () => {
      lastData = Date.now()
    })
    stream.pause()
    stream.once("close", () => {
      clearInterval(timer)
      session.streams.delete(stream)
    })
    stream.on("error", () => {})
    return stream
  }

  /**
   * 按协议同步单个来源，成功后只替换此来源的歌曲，保留本地与其他服务器的索引。
   * SFTP 跳过隐藏项和符号链接；任一协议读取失败都保留原索引。
   */
  async scan(id) {
    if (this.library.state.remoteSources.find(source => source.id === id)?.protocol === "subsonic") {
      return this.subsonic.scan(id)
    }
    const library = this.library
    if (library.status.phase !== "idle") {
      throw new Error("请等待当前任务完成")
    }
    const source = library.state.remoteSources.find(item => item.id === id)
    if (!source) {
      throw new Error("服务器来源已移除")
    }
    library.progress({ phase: "remote", done: 0, total: 0, error: null, message: `正在连接 ${source.name}…` })
    try {
      const session = await this.session(id)
      const tracks = []
      const pending = [{ directory: source.resolvedRoot, depth: 0 }]
      const old = new Map(library.state.tracks.filter(item => item.sourceId === id).map(item => [item.path, item]))
      while (pending.length) {
        const { directory, depth } = pending.pop()
        if (depth > 64) {
          throw new Error("目录层级过深，请选择更具体的音乐目录")
        }
        const { filename } = await this.locate(id, directory)
        const entries = await request(session, "readdir", filename)
        for (const entry of entries) {
          const name = entry.filename
          if (name.startsWith(".") || name.includes("/") || entry.attrs.isSymbolicLink()) {
            continue
          }
          const full = path.posix.join(filename, name)
          if (entry.attrs.isDirectory()) {
            if (
              library.state.settings.skipProblemFolders &&
              ["异常文件", "疑似问题文件", "重复ogg文件", "解密失败", "待解密", "加密文件", "$RECYCLE.BIN"].includes(name)
            ) {
              continue
            }
            pending.push({ directory: full, depth: depth + 1 })
          } else if (entry.attrs.isFile() && AUDIO_EXTENSIONS.has(path.posix.extname(name).toLowerCase())) {
            const previous = old.get(full)
            const unchanged = previous?.size === entry.attrs.size && previous?.mtimeMs === entry.attrs.mtime * 1000
            tracks.push({
              ...(unchanged ? previous : inferTags(full)),
              id: stableId(`remote:${id}:${full}`),
              sourceId: id,
              path: full,
              filename: name,
              extension: path.posix.extname(name).toLowerCase(),
              size: entry.attrs.size,
              mtimeMs: entry.attrs.mtime * 1000,
              album: unchanged ? previous.album : path.posix.basename(filename),
              duration: unchanged ? previous.duration : 0,
              codec: unchanged ? previous.codec : "SFTP",
              sampleRate: unchanged ? previous.sampleRate : 0,
              ...(previous?.coverSource?.manual ? { cover: previous.cover, coverSource: previous.coverSource } : {}),
            })
          }
          if (tracks.length + pending.length > 100000) {
            throw new Error("目录条目过多，请拆分音乐目录后导入")
          }
        }
        library.progress({ done: tracks.length, message: `${source.name} · 已找到 ${tracks.length} 首歌曲` })
      }
      library.state.tracks = [...library.state.tracks.filter(item => item.sourceId !== id), ...tracks].sort((a, b) =>
        a.path.localeCompare(b.path, "zh-CN", { numeric: true }),
      )
      source.scannedAt = Date.now()
      await library.save()
      library.emit("changed")
      library.progress({
        phase: "idle",
        done: tracks.length,
        total: tracks.length,
        message: `${source.name} · 已导入 ${tracks.length} 首歌曲`,
      })
      return library.snapshot()
    } catch (error) {
      library.progress({ phase: "idle", error: error.message, message: `远程扫描失败：${error.message}` })
      throw error
    }
  }

  /**
   * SFTP 播放时按需读取音频头部，音乐服务器使用同步时已有的歌曲标签。
   * 每首 SFTP 歌曲最多读取 2 MB，避免扫描时下载所有音频。
   */
  async metadata(id) {
    if (this.metadataTasks.has(id)) {
      return this.metadataTasks.get(id)
    }
    const task = (async () => {
      const track = this.library.track(id)
      if (!track.sourceId || track.metadataRead) {
        return
      }
      if (this.library.state.remoteSources.find(source => source.id === track.sourceId)?.protocol === "subsonic") {
        return
      }
      const { session, filename, stat } = await this.locate(track.sourceId, track.path)
      const stream = this.stream(session, filename, { start: 0, end: Math.min(stat.size, 2 * 1024 * 1024) - 1 })
      try {
        const mimeType = {
          ".mp3": "audio/mpeg",
          ".flac": "audio/flac",
          ".ogg": "audio/ogg",
          ".opus": "audio/ogg",
          ".wav": "audio/wav",
          ".m4a": "audio/mp4",
          ".mp4": "audio/mp4",
          ".aac": "audio/aac",
          ".aiff": "audio/aiff",
          ".aif": "audio/aiff",
        }[track.extension]
        const metadata = await parseWebStream(Readable.toWeb(stream), { size: stat.size, mimeType }, { duration: false })
        if (!this.library.state.tracks.includes(track)) {
          return
        }
        const { common, format } = metadata
        track.title = common.title || track.title
        track.artist = common.artist || track.artist
        track.album = common.album || track.album
        track.duration = format.duration || track.duration
        track.sampleRate = format.sampleRate || 0
        track.bitsPerSample = format.bitsPerSample || 0
        track.codec = format.codec || track.codec
        if (common.picture?.[0] && !track.coverSource?.manual) {
          track.cover = await this.library.cacheImage(common.picture[0].data)
          track.coverSource = { source: "远程音频内嵌封面" }
        }
        track.metadataRead = true
        await this.library.save()
        this.library.emit("changed")
      } finally {
        stream.destroy()
      }
    })().finally(() => this.metadataTasks.delete(id))
    this.metadataTasks.set(id, task)
    return task
  }

  /**
   * 按来源读取歌词，音乐服务器使用歌曲接口，SFTP 使用相邻的同名 LRC。
   * 文件歌词限制为 1 MB；歌词缺失或读取失败不影响音频播放。
   */
  async lyrics(track) {
    if (this.library.state.remoteSources.find(source => source.id === track.sourceId)?.protocol === "subsonic") {
      return this.subsonic.lyrics(track)
    }
    const stem = track.path.slice(0, -path.posix.extname(track.path).length)
    for (const candidate of [
      `${stem}.lrc`,
      path.posix.join(path.posix.dirname(track.path), "lyrics", `${path.posix.basename(stem)}.lrc`),
    ]) {
      try {
        const { session, filename, stat } = await this.locate(track.sourceId, candidate)
        if (!stat.isFile() || stat.size > 1024 * 1024) {
          continue
        }
        const chunks = []
        for await (const bytes of this.stream(session, filename, { start: 0, end: stat.size - 1 })) {
          chunks.push(bytes)
        }
        return parseLyrics(Buffer.concat(chunks).toString("utf8"))
      } catch {}
    }
    return parseLyrics("")
  }

  /**
   * 关闭来源的活动会话及音频句柄，移除来源和退出应用时共用此清理路径。
   * 索引与服务器原文件均不会因断开连接而被删除。
   */
  disconnect(id) {
    this.subsonic.disconnect(id)
    const session = this.sessions.get(id)
    if (session) {
      for (const stream of session.streams) {
        stream.destroy()
      }
      session.client.destroy()
    }
    this.sessions.delete(id)
  }

  /**
   * 移除来源的本地索引、收藏引用和登录凭据，服务器文件保持原样。
   * 后台扫描期间拒绝移除，避免旧任务完成后重新写回已删除的来源。
   * 只清理被移除来源的引用，在线歌曲和其他来源的收藏、历史继续保留。
   */
  async remove(id) {
    if (this.library.status.phase !== "idle") {
      throw new Error("请先等待当前音乐库任务完成")
    }
    if (!this.library.state.remoteSources.some(item => item.id === id)) {
      throw new Error("服务器来源已不存在")
    }
    this.disconnect(id)
    await this.saveCredentials(id, {}, false)
    this.credentials.delete(id)
    this.library.state.remoteSources = this.library.state.remoteSources.filter(item => item.id !== id)
    this.library.state.tracks = this.library.state.tracks.filter(item => item.sourceId !== id)
    const ids = new Set([...this.library.state.tracks, ...(this.library.state.onlineTracks || [])].map(item => item.id))
    this.library.state.favorites = this.library.state.favorites.filter(id => ids.has(id))
    this.library.state.history = this.library.state.history.filter(item => ids.has(item.id))
    await this.library.save()
    this.library.emit("changed")
    return this.library.snapshot()
  }

  /**
   * 切换单个连接的推荐资格并持久保存，重启与重新登录后继续沿用此选择。
   * 不断开音频会话，不删除索引、凭据或收藏，当前歌曲和手动队列继续播放。
   */
  async setRecommendations(id, enabled) {
    if (this.library.status.phase !== "idle") {
      throw new Error("请先等待当前音乐库任务完成")
    }
    if (typeof enabled !== "boolean") {
      throw new Error("请选择开启或关闭推荐")
    }
    const source = this.library.state.remoteSources.find(source => source.id === id)
    if (!source) {
      throw new Error("此远程音乐库已移除")
    }
    source.recommendationsEnabled = enabled
    await this.library.save()
    this.library.emit("changed")
    return this.library.snapshot()
  }

  /**
   * 在应用退出时结束全部服务器连接，停止后台读取并释放内存凭据。
   * 已明确选择记住的系统加密凭据保留，供下次运行恢复连接。
   */
  close() {
    this.subsonic.close()
    for (const id of this.sessions.keys()) {
      this.disconnect(id)
    }
    this.credentials.clear()
  }

  /**
   * 将音乐服务器音频交给对应策略代理，SFTP 返回空值以沿用文件范围读取。
   * 界面只能提交已索引歌曲，请求不接受任意服务器 URL。
   */
  media(track, request) {
    return this.library.state.remoteSources.find(source => source.id === track.sourceId)?.protocol === "subsonic"
      ? this.subsonic.media(track, request)
      : null
  }

  /**
   * 按已索引歌曲读取音乐服务器封面，认证材料只由主进程内的策略使用。
   */
  cover(id) {
    return this.subsonic.cover(id)
  }
}
