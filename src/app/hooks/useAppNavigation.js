import { useCallback, useEffect, useRef, useState } from "react"

/**
 * 管理当前页面、筛选和全局弹层的可见状态，不保存歌曲、音频节点或服务器数据。
 * 普通导航清理列表筛选但保留播放；来源关闭时退出对应在线页，设置和服务器入口负责恢复滚动位置。
 */
export default function useAppNavigation({ api, busy, onlineEnabled }) {
  const [page, setPage] = useState("home")
  const [settingsTab, setSettingsTab] = useState("appearance")
  const [onlineProvider, setOnlineProvider] = useState(null)
  const [loginProvider, setLoginProvider] = useState(null)
  const [remoteAddRequested, setRemoteAddRequested] = useState(false)
  const [nowOpen, setNowOpen] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [artistLayoutSeed, setArtistLayoutSeed] = useState(() => Date.now())
  const [query, setQuery] = useState("")
  const [searchComposing, setSearchComposing] = useState(false)
  const [songQuery, setSongQuery] = useState("")
  const [queueOpen, setQueueOpen] = useState(false)
  const [soundOpen, setSoundOpen] = useState(false)
  const [sort, setSort] = useState("default")
  const [onlyMissing, setOnlyMissing] = useState(false)
  const mainContent = useRef(null)

  /**
   * 收起账号认证并释放其视图，稳定回调避免重复绑定主进程的关闭通知。
   */
  const closeAccountDialog = useCallback(() => setLoginProvider(null), [])
  useEffect(() => api.onOnlineLoginDismiss(closeAccountDialog), [api, closeAccountDialog])
  useEffect(() => {
    if (page === "online" && !onlineEnabled) {
      setPage("home")
    }
  }, [page, onlineEnabled])

  /**
   * 切换浏览集合并重置集合内筛选，详情和音效收起后仍保持原来的音频与队列。
   * 歌单和歌手只保存稳定标识，刷新曲库时不重新创建集合。
   */
  const navigate = useCallback((nextPage, id = null) => {
    setNowOpen(false)
    setSoundOpen(false)
    setPage(nextPage)
    setSelectedId(id)
    setSongQuery("")
    setOnlyMissing(false)
    setSort("default")
    if (nextPage !== "search") {
      setQuery("")
    }
  }, [])

  /**
   * 进入服务器管理页，添加操作在后台任务空闲时才允许展开连接表单。
   * 新页面回到顶部，正在播放的音乐不受影响。
   */
  const openRemoteLibrary = useCallback(
    (add = false) => {
      if (add && busy) {
        return
      }
      setRemoteAddRequested(add)
      navigate("remote")
      mainContent.current?.scrollTo({ top: 0, behavior: "instant" })
    },
    [busy, navigate],
  )

  /**
   * 从来源或侧栏进入在线搜索，清理全局搜索并收起互斥浮层，保留现有播放队列。
   */
  const openOnlineLibrary = useCallback((provider = null) => {
    setNowOpen(false)
    setSoundOpen(false)
    setQueueOpen(false)
    setOnlineProvider(provider)
    setPage("online")
    setQuery("")
  }, [])

  /**
   * 从未配置或失败的在线页面进入来源设置，便于调整平台开关或关联账号。
   */
  const configureOnlineLibrary = useCallback(() => {
    setPage("settings")
    setSettingsTab("sources")
    setQuery("")
  }, [])

  /**
   * 将统一搜索提交为完整结果页，保留明确提交的关键词并清理旧的列表内筛选。
   */
  const searchAll = useCallback(value => {
    setQuery(value)
    setNowOpen(false)
    setPage("search")
    setSongQuery("")
  }, [])

  /**
   * 系统菜单打开设置时仅收起播放浮层，不清除当前搜索上下文或播放状态。
   */
  const openSettingsFromMenu = useCallback(() => {
    setNowOpen(false)
    setSoundOpen(false)
    setPage("settings")
  }, [])

  /**
   * 在允许的设置分类间切换并返回内容顶部，离开来源表单后释放秘密输入。
   */
  const selectSettingsTab = useCallback(value => {
    if (!["appearance", "sources", "sound", "covers"].includes(value)) {
      return
    }
    setSettingsTab(value)
    mainContent.current?.scrollTo({ top: 0, behavior: "instant" })
  }, [])

  /**
   * 主动重新排列歌手卡片，种子只在明确操作时变化，播放进度更新不会扰动布局。
   */
  const shuffleArtists = useCallback(() => setArtistLayoutSeed(value => value + 1), [])

  return {
    page,
    selectedId,
    settingsTab,
    onlineProvider,
    loginProvider,
    remoteAddRequested,
    nowOpen,
    artistLayoutSeed,
    query,
    searchComposing,
    songQuery,
    queueOpen,
    soundOpen,
    sort,
    onlyMissing,
    mainContent,
    setQuery,
    setSearchComposing,
    setSongQuery,
    setSort,
    setOnlyMissing,
    setNowOpen,
    setQueueOpen,
    setSoundOpen,
    setLoginProvider,
    navigate,
    closeAccountDialog,
    openRemoteLibrary,
    openOnlineLibrary,
    configureOnlineLibrary,
    searchAll,
    openSettingsFromMenu,
    selectSettingsTab,
    shuffleArtists,
  }
}
