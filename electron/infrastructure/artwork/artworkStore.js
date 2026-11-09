/**
 * 管理经过图片签名校验的内容寻址缓存，本地、在线与服务器图片共用此边界。
 * 不支持 SVG、HTML 或超过 10 MB 的内容，缓存文件名不能用于访问任意磁盘路径。
 */
import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"

/**
 * 识别支持的二进制图片文件头，扩展名与响应 Content-Type 不作为可信依据。
 */
export function imageMime(data) {
  if (data.length >= 2 && data.readUInt16BE(0) === 65496) {
    return "image/jpeg"
  }
  if (data.length >= 8 && data.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") {
    return "image/png"
  }
  if (data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp"
  }
  return null
}

/**
 * 以图片内容哈希保存与核对封面缓存，供所有音乐来源共同使用。
 * 缓存键受到格式限制，文件头与大小检查通过后才允许写入。
 */
export class ArtworkStore {
  /**
   * 绑定应用数据中的封面目录；目录由曲库启动流程创建。
   */
  constructor(directory) {
    this.directory = directory
  }

  /**
   * 核对持久封面引用对应的文件是否仍存在，非法缓存名直接返回不可用。
   */
  async exists(key) {
    if (!/^[a-f0-9]{64}\.(?:jpg|png|webp)$/u.test(key)) {
      return false
    }
    return fs.access(path.join(this.directory, key)).then(
      () => true,
      () => false,
    )
  }

  /**
   * 校验图片后按内容哈希保存，重复内容继续引用相同文件。
   * 不修改来源音频、用户选择的原图片或音乐目录。
   */
  async store(input) {
    const bytes = Buffer.from(input)
    const mime = imageMime(bytes)
    if (!mime || bytes.length > 10485760) {
      throw new Error("请选择小于 10 MB 的 JPEG、PNG 或 WebP 图片")
    }
    const suffix = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[mime]
    const key = createHash("sha256").update(bytes).digest("hex") + "." + suffix
    await fs.writeFile(path.join(this.directory, key), bytes)
    return key
  }
}
