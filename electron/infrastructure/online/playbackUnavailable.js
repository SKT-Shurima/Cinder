/**
 * 区分平台已拒绝的歌曲与暂时网络失败，供播放反馈和可播放列表筛选复用。
 */
export class PlaybackUnavailable extends Error {
  /**
   * 标记当前会话或资源已经无法播放，调用者可临时隐藏歌曲并在后续重新核验。
   * 该标记不删除用户收藏、原始索引或本地文件，也不代表其他账号永远没有播放权限。
   */
  constructor(message) {
    super(message)
    this.name = "PlaybackUnavailable"
  }
}
