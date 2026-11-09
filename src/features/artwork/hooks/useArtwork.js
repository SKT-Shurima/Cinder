import { useCallback, useRef, useState } from "react"

/**
 * 管理封面候选、手动确认与窗口状态，保存后的曲库刷新通过调用方提供的统一入口完成。
 * 每次搜索、切歌或关闭都会推进请求版本，旧请求只能自行结束，不会重新打开窗口或覆盖新候选。
 */
export default function useArtwork({ api, tracksById, setLibrary, refresh, onError: report, onNotice: setToast }) {
  const [coverTrack, setCoverTrack] = useState(null)
  const [candidates, setCandidates] = useState(null)
  const [coverLoading, setCoverLoading] = useState(false)
  const coverRequest = useRef(0)
  /**
   * 打开歌曲封面核对窗口，取消上一首尚未完成的界面结果更新。
   * 在线发现结果先验证并保存元数据；迟到的入库请求不重新打开已经关闭的窗口。
   */
  async function openCover(track) {
    const revision = ++coverRequest.current
    try {
      if (!tracksById.has(track.id)) {
        const result = await api.onlineAdd([track.id])
        setLibrary(result.library)
      }
      if (revision !== coverRequest.current) {
        return
      }
      setCoverTrack(track)
      setCandidates(null)
      setCoverLoading(false)
    } catch (error) {
      report(error)
    }
  }

  /**
   * 请求多个目录的封面候选，并防止迟到结果覆盖已关闭或切换的窗口。
   * 用户可手动确认相似版本，自动刮削没有可靠命中的歌曲不会被静默替换。
   */
  async function searchCover() {
    const request = ++coverRequest.current
    setCoverLoading(true)
    setCandidates(null)
    try {
      const result = await api.candidates(coverTrack.id)
      if (request === coverRequest.current) {
        setCandidates(result)
      }
    } catch (error) {
      report(error)
    } finally {
      if (request === coverRequest.current) {
        setCoverLoading(false)
      }
    }
  }

  /**
   * 应用用户选择的候选封面，完成后重新读取统一索引。
   * 候选只保存到应用缓存，不改写音频标签或音乐目录。
   */
  async function applyCover(candidateId) {
    try {
      await api.applyCandidate(coverTrack.id, candidateId)
      await refresh()
      setCoverTrack(null)
      setToast("封面已更新，已保存在本机")
    } catch (error) {
      report(error)
    }
  }

  /**
   * 收起封面窗口并让未结束的候选请求失效，不取消其他曲库任务或改动音乐文件。
   */
  const closeCover = useCallback(() => {
    coverRequest.current++
    setCoverTrack(null)
  }, [])
  return { coverTrack, candidates, coverLoading, openCover, searchCover, applyCover, closeCover }
}
