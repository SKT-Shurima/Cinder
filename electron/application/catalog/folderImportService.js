/**
 * 负责发现目录音频与控制导入并发，业务索引的提交由调用方统一完成。
 * 文件读取通过注入的读取器完成，扫描器无需了解封面、歌词和持久化细节。
 */
import fs from "node:fs/promises"
import path from "node:path"
import { audioFormats, isolatedFolders } from "../../domain/catalog/trackRules.js"

/**
 * 执行一次本地导入的文件发现与并发解析，输出可提交的完整结果。
 * 读取器和进度通知由外部注入，服务不持有或改写音乐库持久状态。
 */
export class FolderImportService {
  /**
   * 注入单曲读取与进度通知，构造阶段不读取目录或修改索引。
   */
  constructor(read, notify) {
    this.read = read
    this.notify = notify
  }

  /**
   * 使用显式目录栈收集音频，符号链接、隐藏项和配置隔离项不会进入索引。
   * 单个目录不可访问时记录失败并继续，不会拖垮其他根目录。
   */
  async collect(roots, skipIsolated) {
    const folders = [...roots]
    const files = new Set()
    const failures = []
    while (folders.length) {
      const directory = folders.pop()
      try {
        const entries = await fs.readdir(directory, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.name[0] === "." || entry.isSymbolicLink()) {
            continue
          }
          const filename = path.join(directory, entry.name)
          if (entry.isDirectory()) {
            if (!(skipIsolated && isolatedFolders.has(entry.name))) {
              folders.push(filename)
            }
          } else if (entry.isFile() && audioFormats.has(path.extname(filename).toLowerCase())) {
            files.add(filename)
          }
        }
      } catch (failure) {
        failures.push({ path: directory, error: failure.message })
      }
    }
    return { files: [...files].sort(), failures }
  }

  /**
   * 以最多六个工作协程解析变化文件，原有远程记录交由上层保留。
   * 完成计数按任务结束递增，失败记录始终关联实际文件路径。
   */
  async execute(state) {
    const { files, failures } = await this.collect(state.roots, state.settings.skipProblemFolders)
    const existing = new Map(state.tracks.filter(song => !song.sourceId).map(song => [song.path, song]))
    const tracks = []
    const iterator = files.values()
    let completed = 0
    this.notify({ total: files.length })
    /**
     * 从共享迭代器领取独立文件，读取失败仅影响本项，不重试无效音频。
     */
    const worker = async () => {
      for (const filename of iterator) {
        try {
          tracks.push(await this.read(filename, existing.get(filename)))
        } catch (failure) {
          failures.push({ path: filename, error: failure.message })
        }
        completed += 1
        if (completed % 15 === 0 || completed === files.length) {
          this.notify({ done: completed, message: path.basename(filename) })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, files.length) }, worker))
    return { tracks, failures, total: files.length }
  }
}
