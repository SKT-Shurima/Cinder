/**
 * 解析单段 HTTP Range，统一约束本地文件和服务器音频的字节范围。
 * 不接受多段、不安全整数或零长度后缀，非法请求返回可供 416 响应使用的总大小。
 */
export class ByteRange {
  /**
   * 根据文件大小创建完整或局部范围，结束位置采用包含式字节偏移。
   */
  static parse(header, size) {
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error("无效的媒体文件大小")
    }
    if (!header) {
      return { start: 0, end: Math.max(0, size - 1), length: size, partial: false }
    }
    const parts = /^bytes=(\d*)-(\d*)$/u.exec(header)
    if (!parts || (!parts[1] && !parts[2]) || size === 0) {
      return null
    }
    const first = parts[1] ? Number(parts[1]) : null
    const last = parts[2] ? Number(parts[2]) : null
    if ([first, last].some(value => value !== null && !Number.isSafeInteger(value))) {
      return null
    }
    if (first === null && last === 0) {
      return null
    }
    const start = first ?? Math.max(0, size - last)
    const end = first === null || last === null ? size - 1 : Math.min(last, size - 1)
    return start < size && end >= start ? { start, end, length: end - start + 1, partial: true } : null
  }
}
