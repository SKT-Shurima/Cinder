/**
 * 管理在线热门歌手目录及作品加载，状态不依赖个人音乐库中的歌手分组。
 * 页面离开、来源关闭或歌手切换后忽略迟到响应，避免旧作品覆盖新页面。
 */
import { useCallback, useEffect, useMemo, useState } from "react"

/**
 * 进入歌手页时读取目录，进入详情后按需读取作品；返回列表保留之前的数据。
 * 每次详情读取都会恢复主进程资源索引，失败后由用户重试，不循环发起请求。
 */
export default function usePopularArtists({ api, active, selectedId, enabled }) {
  const [catalog, setCatalog] = useState({ artists: [], source: "网易云音乐", loading: true, error: "" })
  const [detail, setDetail] = useState({ id: null, tracks: [], loading: true, error: "" })
  const [revision, setRevision] = useState(0)
  /**
   * 重新发起当前页的数据请求，保留布局种子，等待状态由对应请求独立维护。
   */
  const retry = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    if (!active) {
      return
    }
    if (!enabled) {
      setCatalog(value => ({ ...value, loading: false, error: "请在音乐来源中启用在线音乐和网易云音乐，查看热门歌手。" }))
      return
    }
    let alive = true
    setCatalog(value => ({ ...value, loading: true, error: "" }))
    api
      .onlineArtists()
      .then(value => {
        if (alive) {
          setCatalog({ ...value, loading: false, error: "" })
        }
      })
      .catch(error => {
        if (alive) {
          setCatalog(value => ({
            ...value,
            loading: false,
            error: error.message.replace(/^Error invoking remote method '[^']+': Error: /, ""),
          }))
        }
      })
    return () => {
      alive = false
    }
  }, [api, active, enabled, revision])
  useEffect(() => {
    if (!active || !selectedId || !enabled || catalog.loading || catalog.error) {
      return
    }
    let alive = true
    setDetail({ id: selectedId, tracks: [], loading: true, error: "" })
    api
      .onlineArtistTracks(selectedId)
      .then(value => {
        if (alive) {
          setDetail({ ...value, id: selectedId, loading: false, error: "" })
        }
      })
      .catch(error => {
        if (alive) {
          setDetail({
            id: selectedId,
            tracks: [],
            loading: false,
            error: error.message.replace(/^Error invoking remote method '[^']+': Error: /, ""),
          })
        }
      })
    return () => {
      alive = false
    }
  }, [api, active, selectedId, enabled, catalog.loading, catalog.error, revision])
  return useMemo(
    () => ({ ...catalog, detail: detail.id === selectedId ? detail : { tracks: [], loading: true, error: "" }, retry }),
    [catalog, detail, selectedId, retry],
  )
}
