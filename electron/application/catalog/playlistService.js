/**
 * 管理用户主动创建的歌单和成员关系，导入、专辑扫描及平台检索不调用此服务。
 * 修改只作用于本机歌单记录，不修改音乐文件、远程服务器或正在播放的队列。
 */
import { randomUUID } from "node:crypto"

/**
 * 将已知歌曲组成用户歌单，统一校验名称、成员和持久化边界。
 * 在线临时结果必须先通过现有在线保存用例登记，不能把任意网络地址写入歌单。
 */
export class PlaylistService {
  /**
   * 复用曲库仓储和变更事件，所有歌单变更与现有索引任务共享互斥条件。
   */
  constructor(library) {
    this.library = library
  }

  /**
   * 创建、重命名或增减歌单成员，仅在用户明确提交时写入。
   * 名称不能为空或重名，未知歌单和歌曲整次拒绝；成员去重并保持加入顺序，允许保存空歌单。
   */
  async save(input = {}) {
    const library = this.library
    library.requireIdle()
    const playlists = library.state.userPlaylists
    const previous = playlists.find(playlist => playlist.id === input.id)
    if (input.id && !previous) {
      throw new Error("歌单已不存在")
    }
    const name = String(input.name ?? previous?.name ?? "")
      .normalize("NFKC")
      .trim()
    if (!name || name.length > 64 || /[\x00-\x1f]/u.test(name)) {
      throw new Error("歌单名称应为 1–64 个字符")
    }
    if (
      playlists.some(playlist => playlist.id !== previous?.id && playlist.name.toLocaleLowerCase() === name.toLocaleLowerCase())
    ) {
      throw new Error("已有同名歌单，请换个名称")
    }
    const add = input.addTrackIds ?? []
    const remove = input.removeTrackIds ?? []
    if (![add, remove].every(ids => Array.isArray(ids) && ids.length <= 20000 && ids.every(id => typeof id === "string"))) {
      throw new Error("歌单歌曲参数无效")
    }
    const known = new Set(library.state.tracks.concat(library.state.onlineTracks).map(track => track.id))
    if (add.some(id => !known.has(id))) {
      throw new Error("部分歌曲已不可用，请刷新后重试")
    }
    const excluded = new Set(remove)
    const trackIds = [...new Set([...(previous?.trackIds || []), ...add])].filter(id => !excluded.has(id))
    if (trackIds.length > 20000) {
      throw new Error("每个歌单最多保存两万首歌曲")
    }
    const playlist = {
      ...previous,
      id: previous?.id || randomUUID(),
      name,
      trackIds,
      createdAt: previous?.createdAt || Date.now(),
    }
    library.state.userPlaylists = previous
      ? playlists.map(item => (item.id === playlist.id ? playlist : item))
      : [...playlists, playlist]
    try {
      await library.save()
    } catch (error) {
      library.state.userPlaylists = playlists
      throw error
    }
    library.emit("changed")
    return playlist
  }

  /**
   * 删除用户确认移除的歌单及其自定义封面关联，保留歌曲、收藏、历史和播放队列。
   * 不接受专辑或来源分组标识，保存失败时恢复原歌单和封面关联。
   */
  async remove(id) {
    const library = this.library
    library.requireIdle()
    const previous = library.state.userPlaylists
    const covers = library.state.playlistCovers
    if (!previous.some(playlist => playlist.id === id)) {
      throw new Error("歌单已不存在")
    }
    library.state.userPlaylists = previous.filter(playlist => playlist.id !== id)
    library.state.playlistCovers = { ...covers }
    delete library.state.playlistCovers[id]
    try {
      await library.save()
    } catch (error) {
      library.state.userPlaylists = previous
      library.state.playlistCovers = covers
      throw error
    }
    library.emit("changed")
    return true
  }
}
