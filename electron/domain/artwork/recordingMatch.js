/**
 * 根据录音标签评估候选封面，避免把同名翻唱、现场版或不同歌手的图片自动套用。
 * 自动确认需要标题、歌手一致，并由专辑或接近的时长提供第二项证据。
 */
export class RecordingMatch {
  /**
   * 将展示标签转换为比较键，保留版本词，只消除兼容字符、标点与空白差异。
   */
  static key(label = "") {
    return String(label)
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\p{P}\p{S}\s]+/gu, "")
  }

  /**
   * 为候选附加分数和自动确认资格；未知歌手不能提供有效的身份匹配证据。
   * 时长单位为秒，差值必须小于八秒；仅命中歌名时仍需用户手动核对。
   */
  evaluate(song, candidate) {
    const title = RecordingMatch.key(song.title) === RecordingMatch.key(candidate.title)
    const singer = RecordingMatch.key(song.artist)
    const other = RecordingMatch.key(candidate.artist)
    const artist = Boolean(
      singer &&
      singer !== RecordingMatch.key("未知歌手") &&
      (singer === other || (Math.min(singer.length, other.length) >= 2 && (singer.includes(other) || other.includes(singer)))),
    )
    const album = Boolean(song.album && RecordingMatch.key(song.album) === RecordingMatch.key(candidate.album))
    const duration = Boolean(song.duration && candidate.duration && Math.abs(song.duration - candidate.duration) < 8)
    const evidence = new Map([
      [50, title],
      [30, artist],
      [15, album],
      [5, duration],
    ])
    return {
      ...candidate,
      automatic: title && artist && (album || duration),
      score: [...evidence].reduce((score, [weight, matches]) => score + (matches ? weight : 0), 0),
    }
  }
}
