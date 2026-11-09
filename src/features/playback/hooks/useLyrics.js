import { useCallback, useEffect, useRef, useState } from "react"

/**
 * 读取当前歌曲的歌词并协调手动重试与详情页的联网请求。
 * 切歌、收起详情或卸载后忽略上一请求的返回值，不把旧歌词提交给新歌曲；读取失败保留明确的重试状态。
 */
export default function useLyrics(api, currentId, detailOpen) {
  const [lyricRetry, setLyricRetry] = useState(0)
  const lastLyricRetry = useRef(0)
  const [lyrics, setLyrics] = useState({ lines: [], text: "" })
  useEffect(() => {
    if (!currentId) {
      return
    }
    let alive = true
    setLyrics({ lines: [], text: "", loading: detailOpen })
    const force = lyricRetry !== lastLyricRetry.current
    lastLyricRetry.current = lyricRetry
    api
      .lyrics(currentId, { online: detailOpen, force })
      .then(value => {
        if (alive) {
          setLyrics(value)
        }
      })
      .catch(() => {
        if (alive) {
          setLyrics({ lines: [], text: "", status: "error", message: "歌词暂时无法加载，请稍后重试。" })
        }
      })
    return () => {
      alive = false
    }
  }, [currentId, detailOpen, lyricRetry])

  const retryLyrics = useCallback(() => setLyricRetry(value => value + 1), [])
  return { lyrics, retryLyrics }
}
