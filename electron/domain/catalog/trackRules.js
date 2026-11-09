/**
 * 定义曲库标识、文件名标签和歌词时间轴的领域规则。
 * 这些规则不读取磁盘、不联网；标识算法保持兼容，保证已有收藏和队列继续有效。
 */
import path from "node:path"
import { createHash } from "node:crypto"

/**
 * 为路径或来源键生成可持久化的短标识。
 * 输入保持原始大小写和路径形式，避免升级后已保存歌曲被当作新歌曲。
 */
export function catalogKey(input) {
  const digest = createHash("sha256")
  digest.update(input)
  return digest.digest("hex").substring(0, 24)
}

/**
 * 从缺失标签的文件名恢复歌手与标题，不改变文件本身。
 * 仅识别第一个明确的连字符分隔，尾部数字序号不作为歌名的一部分。
 */
export function filenameLabels(filename) {
  const stem = path.parse(filename).name.replace(/-\d+$/, "")
  const boundary = stem.search(/\s*[-－–]\s*/u)
  if (boundary < 1) {
    return { title: stem, artist: "未知歌手" }
  }
  const separator = /\s*[-－–]\s*/u.exec(stem)
  return {
    artist: stem.substring(0, separator.index).trim(),
    title: stem.substring(separator.index + separator[0].length).trim() || stem,
  }
}

/**
 * 将 LRC 转为受限的同步时间轴，保留原文供纯文本歌词展示。
 * offset 按毫秒解释；多时间标签展开后最多保留两千行，超出一天的时间点忽略。
 */
export function lyricsTimeline(input) {
  const text = String(input ?? "").substring(0, 1048576)
  const offsetTag = /\[offset:([+-]?\d+)\]/iu.exec(text)
  const shift = offsetTag ? Number(offsetTag[1]) / 1000 : 0
  const lines = []
  for (const raw of text.split(/\r?\n/u)) {
    const content = raw.replace(/\[[^\]]+\]/gu, "").trim()
    for (const stamp of raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/gu)) {
      const seconds = Number(stamp[1]) * 60 + Number(stamp[2]) + shift
      if (Number.isFinite(seconds) && seconds <= 86400) {
        lines.push({ text: content, time: Math.max(0, seconds) })
      }
      if (lines.length === 2000) {
        return { text, lines: lines.sort((a, b) => a.time - b.time) }
      }
    }
  }
  lines.sort((a, b) => a.time - b.time)
  return { text, lines }
}

/**
 * 支持直接解析的音频格式与默认隔离目录，扫描器和远程来源共用格式约束。
 */
export const audioFormats = new Set("mp3 flac ogg opus wav m4a aac aiff aif mp4".split(" ").map(extension => `.${extension}`))
export const isolatedFolders = new Set([
  "异常文件",
  "疑似问题文件",
  "重复ogg文件",
  "解密失败",
  "待解密",
  "加密文件",
  "$RECYCLE.BIN",
])
