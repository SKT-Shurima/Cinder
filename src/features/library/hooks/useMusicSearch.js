/**
 * 全局搜索即时匹配本地与远程索引，停止输入后再补充已启用的在线平台。
 * 同一份结果同时服务建议框和完整结果页，播放进度不会触发重复请求。
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { isTrackEnabled } from "@/features/library/model/libraryVisibility.js"

/**
 * 合并索引匹配和延迟在线匹配，所有网络结果都校验查询版本与来源设置。
 * 输入法组合期间不请求；清空、改词或禁用平台会立即隐藏旧结果，迟到响应不能回填。
 * 当前会话确认无法播放的在线歌曲不参与索引与联网结果合并，避免已经隐藏的歌曲再次出现在建议中。
 */
export default function useMusicSearch({ api, query, library, composing }) {
  const keyword = query.trim().toLocaleLowerCase()
  const revision = useRef(0)
  const [remote, setRemote] = useState({ key: "", tracks: [], errors: [], loading: false })
  const onlineEnabled = library?.settings.musicSources?.online !== false
  const providerKey = JSON.stringify(library?.settings.musicProviders || {})
  const key = `${keyword}:${onlineEnabled}:${providerKey}`
  const indexed = useMemo(
    () =>
      !keyword
        ? []
        : (library?.tracks || []).filter(
            track =>
              isTrackEnabled(track, library?.settings) &&
              `${track.title} ${track.artist} ${track.album} ${track.filename}`.toLocaleLowerCase().includes(keyword),
          ),
    [library?.tracks, library?.settings, keyword],
  )
  useEffect(() => {
    const version = ++revision.current
    if (
      !keyword ||
      !onlineEnabled ||
      composing ||
      !api.onlineSearch ||
      !Object.values(library?.settings.musicProviders || { default: true }).some(value => value !== false)
    ) {
      return
    }
    setRemote({ key, tracks: [], errors: [], loading: true })
    const timer = setTimeout(async () => {
      try {
        const result = await api.onlineSearch({ keyword, provider: "all", page: 1 })
        if (version === revision.current) {
          setRemote({ key, tracks: result.tracks, errors: result.errors, loading: false })
        }
      } catch {
        if (version === revision.current) {
          setRemote({ key, tracks: [], errors: [{ message: "在线平台暂时无法连接，本地与远程结果仍可使用。" }], loading: false })
        }
      }
    }, 450)
    return () => {
      clearTimeout(timer)
      revision.current++
    }
  }, [key, composing, api])
  const active = !composing && onlineEnabled && remote.key === key
  const tracks = useMemo(
    () => [
      ...new Map(
        [...indexed, ...(active ? remote.tracks : [])]
          .filter(track => library?.onlineAvailability?.[track.id] !== false)
          .map(track => [track.id, track]),
      ).values(),
    ],
    [indexed, active, remote.tracks, library?.onlineAvailability],
  )
  return { tracks, loading: active && remote.loading, errors: active ? remote.errors : [], onlineEnabled }
}
