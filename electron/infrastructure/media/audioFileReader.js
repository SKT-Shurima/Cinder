/**
 * 适配本地音频元数据解析器，并按用户确认、内嵌图片、本地图片的顺序选择封面。
 * 文件始终只读；已变化音频会重新解析，失效的封面引用不继续当作有效缓存。
 */
import fs from "node:fs/promises"
import path from "node:path"
import { parseFile } from "music-metadata"
import { catalogKey, filenameLabels } from "../../domain/catalog/trackRules.js"

/**
 * 将音频解析器与文件系统适配为曲库记录，保持历史标识及确认来源。
 * 只读原音频，封面存储通过注入仓储完成，失效缓存需要重新寻找。
 */
export class AudioFileReader {
  /**
   * 接收封面存储器，元数据适配器不自行决定图片的缓存路径或文件名。
   */
  constructor(artwork) {
    this.artwork = artwork
  }

  /**
   * 从完整 Ogg 页的最大粒度位置估算历史残缺文件的可播放时长。
   * 只读取末尾 256 KB，拒绝跨出读取范围的页和超过一天的异常采样计数。
   */
  async recoverDuration(filename, sampleRate) {
    if (!(sampleRate > 0)) {
      return 0
    }
    const handle = await fs.open(filename, "r")
    try {
      const info = await handle.stat()
      const tail = Buffer.alloc(Math.min(info.size, 262144))
      await handle.read(tail, 0, tail.length, info.size - tail.length)
      let maximum = 0
      let cursor = 0
      while ((cursor = tail.indexOf("OggS", cursor)) !== -1) {
        const start = cursor
        cursor += 4
        if (start + 27 > tail.length || tail[start + 4] !== 0) {
          continue
        }
        const count = tail[start + 26]
        const headerEnd = start + 27 + count
        if (headerEnd > tail.length) {
          continue
        }
        const payload = tail.subarray(start + 27, headerEnd).reduce((sum, size) => sum + size, 0)
        if (headerEnd + payload > tail.length) {
          continue
        }
        const position = tail.readBigUInt64LE(start + 6)
        if (position < BigInt(sampleRate * 86400)) {
          maximum = Math.max(maximum, Number(position))
        }
      }
      return maximum / sampleRate
    } finally {
      await handle.close()
    }
  }

  /**
   * 依次尝试内嵌封面与音乐目录中的约定图片，单张损坏图片不阻止标签入库。
   * 本地图片先检查体积再读取，避免把目录中的大文件全部载入内存。
   */
  async artworkFor(filename, pictures) {
    const front = pictures?.find(picture => picture.type === "Cover (front)") ?? pictures?.[0]
    if (front) {
      try {
        return { cover: await this.artwork.store(Buffer.from(front.data)), coverSource: { source: "音频内嵌封面" } }
      } catch {}
    }
    const directory = path.dirname(filename)
    for (const name of [path.parse(filename).name, "cover", "Cover", "folder", "Folder", "front", "封面"]) {
      for (const extension of ["jpg", "jpeg", "png", "webp", "JPG", "PNG"]) {
        const candidate = path.join(directory, `${name}.${extension}`)
        try {
          if ((await fs.stat(candidate)).size > 10485760) {
            continue
          }
          return { cover: await this.artwork.store(await fs.readFile(candidate)), coverSource: { source: "本地封面图片" } }
        } catch {}
      }
    }
    return { cover: null, coverSource: null }
  }

  /**
   * 将解析器字段转换为曲库记录，并复用未变化且封面仍存在的历史记录。
   * 标签不完整时才回退到文件名；封面确认来源、加入时间和解析警告均随记录保留。
   */
  async read(filename, previous) {
    const info = await fs.stat(filename)
    const hasArtwork = previous?.cover && (await this.artwork.exists(previous.cover))
    if (previous && info.size === previous.size && info.mtimeMs === previous.modified && (!previous.cover || hasArtwork)) {
      return previous
    }
    const metadata = await parseFile(filename, { duration: true })
    const { common: tags, format } = metadata
    if (!format.hasAudio || !format.codec) {
      throw new Error("无法识别可播放的音频流")
    }
    const inferred = filenameLabels(filename)
    const artwork = hasArtwork
      ? { cover: previous.cover, coverSource: previous.coverSource }
      : await this.artworkFor(filename, tags.picture)
    const lyricText = (tags.lyrics ?? [])
      .map(lyric => (typeof lyric === "string" ? lyric : (lyric.text ?? lyric.syncText?.map(line => line.text).join("\n") ?? "")))
      .join("\n")
    const track = {
      id: catalogKey(filename),
      filename: path.basename(filename),
      path: filename,
      extension: path.extname(filename).toLowerCase(),
      title: tags.title || inferred.title,
      artist: tags.artist || tags.artists?.join(" / ") || inferred.artist,
      album: tags.album || "",
      duration: format.duration || (format.container === "Ogg" ? await this.recoverDuration(filename, format.sampleRate) : 0),
      size: info.size,
      modified: info.mtimeMs,
      codec: format.codec,
      lyricText,
      ...artwork,
      addedAt: previous?.addedAt ?? Date.now(),
      coverAttempt: previous?.coverAttempt ?? null,
      warnings: metadata.quality?.warnings?.map(warning => warning.message) ?? [],
    }
    for (const field of ["bitrate", "sampleRate", "bitsPerSample"]) {
      track[field] = format[field] || 0
    }
    return track
  }
}
