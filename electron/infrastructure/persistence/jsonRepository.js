/**
 * 将曲库和播放状态保存到各自的原子 JSON 文件，集中处理串行提交和损坏恢复。
 * 序列化在提交时完成，调用后的对象变化不会混入已排队的写入。
 */
import fs from "node:fs/promises"

/**
 * 维护单个 JSON 状态文件的读取、故障备份与串行原子提交。
 * 实例之间不共享写入队列，每次提交固定调用时的完整快照。
 */
export class JsonRepository {
  /**
   * 绑定唯一文件，队列属于仓储实例，曲库与播放进度互不阻塞。
   */
  constructor(filename) {
    this.filename = filename
    this.pending = Promise.resolve()
  }

  /**
   * 读取保存的数据；缺失时返回空值，损坏文件保留原件和备份后交由上层恢复默认状态。
   */
  async read() {
    try {
      return JSON.parse(await fs.readFile(this.filename, "utf8"))
    } catch (failure) {
      if (failure.code !== "ENOENT") {
        await fs.copyFile(this.filename, `${this.filename}.backup-${Date.now()}`).catch(() => {})
      }
      return null
    }
  }

  /**
   * 排队写入调用时的快照，并以同目录 rename 一次提交。
   * 前次失败不阻塞后续保存，但本次失败仍返回给调用者，不能伪装为保存成功。
   */
  commit(value) {
    const snapshot = JSON.stringify(value)
    const temporary = `${this.filename}.tmp`
    const write = async () => {
      await fs.writeFile(temporary, snapshot)
      await fs.rename(temporary, this.filename)
    }
    this.pending = this.pending.then(write, write)
    return this.pending
  }
}
