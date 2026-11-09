/**
 * 按真实文件头识别服务器标注错误的音频，并提供不改动原文件的播放视图。
 * 兼容被错误附加 ID3 标签的 MP4 音频，浏览器字节位置与服务器原文件位置分别计算。
 */
import { remoteBytes } from "./subsonicClient.js"

/**
 * 识别 ISO 媒体容器的首个文件类型盒，避免根据 .mp3 扩展名强行选择 MPEG 解码器。
 * 仅判断容器，不推断 AAC 或 ALAC 等具体编码，编码仍由播放器解析。
 */
function isMp4(bytes) {
  return bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp" && bytes.readUInt32BE(0) >= 12
}

/**
 * 合并单曲的轻量探测，正常已有时长的歌曲直接沿用服务器描述。
 * 只为缺失时长的可疑条目读取最多两段文件头，不缓冲整首歌曲；移除来源时释放缓存。
 */
export class RemoteAudioLayout {
  /**
   * 创建只保存布局描述和待完成探测的缓存，不持有音频文件或登录材料。
   */
  constructor() {
    this.entries = new Map()
  }

  /**
   * 读取指定位置的短文件头，只有准确支持范围读取的服务器才允许执行偏移兼容。
   * 不支持 Range 时保留普通播放方式；异常范围或过大正文立即停止读取。
   */
  async probe(client, track, start) {
    const response = await client.open(
      "stream",
      { id: track.remoteId, format: "raw" },
      { headers: { Range: `bytes=${start}-${start + 63}` } },
    )
    if (response.status !== 206) {
      await response.body?.cancel()
      return null
    }
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(response.headers.get("content-range") || "")
    if (!range || Number(range[1]) !== start || Number(range[2]) > start + 63 || !Number.isSafeInteger(Number(range[3]))) {
      await response.body?.cancel()
      throw new Error("服务器返回了异常音频范围，请重新同步曲库")
    }
    const bytes = await remoteBytes(response, 64)
    if (bytes.length !== Number(range[2]) - start + 1) {
      throw new Error("远程音频头读取不完整，请稍后重试")
    }
    return { bytes, total: Number(range[3]) }
  }

  /**
   * 在时长缺失时核对实际容器，识别 MP4 前面误加的完整 ID3v2 标签。
   * 标签仍留在服务器上，只为本次播放跳过；标签越界或服务器不支持定位时不猜测偏移。
   */
  async inspect(track, client) {
    const original = { offset: 0, size: track.size, mime: null }
    const head = await this.probe(client, track, 0)
    if (!head) {
      return original
    }
    if (isMp4(head.bytes)) {
      return { offset: 0, size: head.total, mime: "audio/mp4" }
    }
    if (head.bytes.length < 10 || head.bytes.toString("ascii", 0, 3) !== "ID3") {
      return original
    }
    const version = head.bytes[3]
    if (![2, 3, 4].includes(version) || head.bytes.subarray(6, 10).some(value => value & 128)) {
      return original
    }
    let tagSize = 0
    for (const value of head.bytes.subarray(6, 10)) {
      tagSize = tagSize * 128 + value
    }
    const offset = 10 + tagSize + (version === 4 && head.bytes[5] & 16 ? 10 : 0)
    if (offset >= head.total) {
      throw new Error("远程音频的标签超出了文件大小，请修复源文件")
    }
    const payload = await this.probe(client, track, offset)
    if (!payload || payload.total !== head.total || !isMp4(payload.bytes)) {
      return original
    }
    return { offset, size: head.total - offset, mime: "audio/mp4" }
  }

  /**
   * 为同一来源和文件大小复用探测结果，网络失败不缓存，允许用户稍后重试。
   * 普通曲目不增加请求；共享探测由来源客户端负责取消，切歌不会取消其他读取者的探测。
   */
  read(track, client) {
    if (track.duration > 0) {
      return Promise.resolve({ offset: 0, size: track.size, mime: null })
    }
    const key = `${track.sourceId}:${track.remoteId}:${track.size}`
    if (!this.entries.has(key)) {
      const entry = this.inspect(track, client).catch(error => {
        if (this.entries.get(key) === entry) {
          this.entries.delete(key)
        }
        throw error
      })
      this.entries.set(key, entry)
    }
    return this.entries.get(key)
  }

  /**
   * 重新登录或移除来源时丢弃该来源布局，后续按新连接重新核对文件。
   */
  clear(sourceId) {
    for (const key of this.entries.keys()) {
      if (key.startsWith(`${sourceId}:`)) {
        this.entries.delete(key)
      }
    }
  }
}
