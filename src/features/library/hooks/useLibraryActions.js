import { useCallback } from "react"

/**
 * 提供曲库写入的统一入口，扫描与封面任务结束后刷新索引，收藏则采用主进程确认结果。
 * 在线发现歌曲先保存稳定元数据；写入失败只反馈业务错误，不改变已有播放或清空曲库。
 */
export default function useLibraryActions({ api, tracksById, setLibrary, refresh, onError }) {
  /**
   * 执行主进程用例并刷新快照，长任务的后续进度仍由曲库订阅负责接收。
   */
  const action = useCallback(
    async task => {
      try {
        await task()
        await refresh()
      } catch (error) {
        onError(error)
      }
    },
    [refresh, onError],
  )

  /**
   * 收藏本地或已发现的在线歌曲，只有后台确认后才提交新的收藏列表。
   */
  const favorite = useCallback(
    async id => {
      try {
        if (!tracksById.has(id)) {
          const result = await api.onlineAdd([id])
          setLibrary(result.library)
        }
        const favorites = await api.favorite(id)
        setLibrary(value => ({ ...value, favorites }))
      } catch (error) {
        onError(error)
      }
    },
    [api, tracksById, setLibrary, onError],
  )

  /**
   * 从首页选择音乐文件夹，沿用后台索引互斥与统一错误反馈，不隐式创建用户歌单。
   */
  const addLocalMusic = useCallback(() => action(api.addRoot), [api, action])

  /**
   * 重读已配置文件夹的曲目，稳定入口避免播放进度变化导致首页重新渲染。
   */
  const scanLocalMusic = useCallback(() => action(api.scan), [api, action])

  return { action, favorite, addLocalMusic, scanLocalMusic }
}
