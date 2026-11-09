/**
 * 组织三类来源与原生在线搜索，在线歌曲交给Cinder 自己的播放、队列、歌词和音效。
 * 游客可直接搜索和播放平台允许的资源，账号认证在统一应用内弹层完成。
 */
import React, { useEffect, useMemo, useRef, useState, memo } from "react"
import { ArrowUpRight, Cloud, LoaderCircle, Music2, Pause, Play, Plus, ListPlus, Search, UserRound, X } from "lucide-react"
import { musicProviders, normalizeMusicProviders } from "#shared/musicSources"
import { ProviderIcon } from "@/shared/ui/MusicSourceIcon.jsx"
import useOnlineAccounts from "@/features/accounts/hooks/useOnlineAccounts.js"
import AccountStatusBadge, { AccountConnectionSummary } from "@/features/accounts/components/AccountStatusBadge.jsx"

/**
 * 用原生搜索列表展示多个平台的资源，用户播放后进入统一队列，不创建或显示远程网页。
 * 请求按版本丢弃过期结果；只在明确搜索时联网，离页不打断已经开始的在线音频。
 * 组件记忆化，播放秒数变化不重复渲染整批搜索结果。
 * 主进程确认某首歌已无法播放后，同步从当前结果中移除，账号变化后的新检索可恢复已获授权的歌曲。
 * 加入歌单是独立的用户动作，搜索、播放和加入播放队列不会自动创建个人歌单。
 */
function OnlineLibrary({
  api,
  settings,
  availability,
  initialProvider,
  onConfigure,
  onLogin,
  onPlay,
  onQueue,
  onPlaylist,
  currentId,
  playing,
  onToggle,
  Cover,
}) {
  const enabled = useMemo(() => {
    const values = normalizeMusicProviders(settings.musicProviders)
    return musicProviders.filter(item => values[item.id])
  }, [settings.musicProviders])
  const [chosen, setChosen] = useState(initialProvider || "all")
  const provider = chosen === "all" || enabled.some(item => item.id === chosen) ? chosen : "all"
  const [keyword, setKeyword] = useState("")
  const [searched, setSearched] = useState("")
  const [results, setTracks] = useState([])
  const [page, setPage] = useState(1)
  const tracks = useMemo(() => results.filter(track => availability?.[track.id] !== false), [results, availability])
  const [loading, setLoading] = useState(false)
  const [preparing, setPreparing] = useState(null)
  const [error, setError] = useState("")
  const [warnings, setWarnings] = useState([])
  const request = useRef(0)
  const connection = useOnlineAccounts(api)
  const { accounts } = connection
  useEffect(() => {
    if (initialProvider) {
      setChosen(initialProvider)
    }
  }, [initialProvider])
  useEffect(
    () => () => {
      request.current++
    },
    [],
  )

  /**
   * 显式提交关键词后检索选中的平台，翻页替换当前批次，不修改现有播放队列。
   * 连续搜索时仅采用最新返回值，服务端单源错误在结果旁单独提示。
   */
  async function search(value = keyword, nextPage = 1, target = provider) {
    const text = value.trim()
    if (!text) {
      return
    }
    const revision = ++request.current
    setLoading(true)
    setError("")
    setWarnings([])
    try {
      const result = await api.onlineSearch({ keyword: text, provider: target, page: nextPage })
      if (revision === request.current) {
        setTracks(result.tracks)
        setWarnings(result.errors)
        setSearched(text)
        setPage(nextPage)
      }
    } catch (failure) {
      if (revision === request.current) {
        setError(failure.message)
        setTracks([])
      }
    } finally {
      if (revision === request.current) {
        setLoading(false)
      }
    }
  }

  /**
   * 在已启用的平台之间切换资源筛选，有关键词时重新搜索首批，不停止正在播放的歌曲。
   */
  function choose(id) {
    const shouldSearch = loading || Boolean(searched)
    setChosen(id)
    request.current++
    setTracks([])
    setError("")
    setLoading(false)
    if (shouldSearch) {
      search(searched || keyword, 1, id)
    }
  }

  /**
   * 播放前等待后台验证真实音频；失败保留当前歌曲，并在本页显示账号或版权限制。
   * 当前曲目直接切换暂停与继续，不重建媒体实例。
   */
  async function play(track) {
    if (track.id === currentId) {
      onToggle()
      return
    }
    setPreparing(track.id)
    setError("")
    try {
      await onPlay(
        track.id,
        tracks.map(item => item.id),
      )
    } catch (failure) {
      setError(failure.message)
    } finally {
      setPreparing(value => (value === track.id ? null : value))
    }
  }

  /**
   * 把用户选择的结果追加到已有队列，保持当前歌曲与播放位置。
   */
  async function enqueue(id) {
    try {
      await onQueue(id)
    } catch (failure) {
      setError(failure.message)
    }
  }

  if (!enabled.length) {
    return (
      <div className="online-empty">
        <Cloud size={30} />
        <h2>选择一个喜欢的音乐平台</h2>
        <p>在音乐来源中关联 QQ 音乐或网易云音乐。</p>
        <button className="primary-button" onClick={onConfigure}>
          管理在线平台
        </button>
      </div>
    )
  }
  return (
    <div className="online-native-workspace">
      <div className="online-page-heading">
        <div>
          <span className="eyebrow">ONE PLAYER, EVERYWHERE</span>
          <h1>在线音乐</h1>
        </div>
        <button className="text-button" onClick={onConfigure}>
          管理平台
          <ArrowUpRight size={13} />
        </button>
      </div>
      <form
        className="online-search-form"
        onSubmit={event => {
          event.preventDefault()
          search()
        }}
      >
        <Search size={18} />
        <input
          aria-label="搜索在线音乐"
          placeholder="搜索歌曲、歌手或专辑"
          value={keyword}
          maxLength={120}
          onChange={event => setKeyword(event.target.value)}
        />
        {keyword && (
          <button type="button" className="icon-button" aria-label="清空在线搜索" onClick={() => setKeyword("")}>
            <X size={14} />
          </button>
        )}
        <button className="primary-button" disabled={loading || !keyword.trim()}>
          {loading ? <LoaderCircle size={15} className="spin" /> : <Search size={15} />}搜索
        </button>
      </form>
      <div className="online-resource-toolbar">
        <div className="online-tabs" role="group" aria-label="在线音乐平台">
          <button aria-pressed={provider === "all"} className={provider === "all" ? "active" : ""} onClick={() => choose("all")}>
            <Cloud size={15} />
            全部平台
          </button>
          {enabled.map(item => (
            <button
              key={item.id}
              aria-pressed={provider === item.id}
              className={provider === item.id ? "active" : ""}
              onClick={() => choose(item.id)}
            >
              <ProviderIcon id={item.id} />
              {item.name}
            </button>
          ))}
        </div>
        <div className="online-account-controls">
          {provider === "all" ? (
            <AccountConnectionSummary {...connection} providers={enabled} />
          ) : (
            <AccountStatusBadge
              account={accounts[provider]}
              pending={connection.pending}
              error={connection.error}
              name={musicProviders.find(item => item.id === provider).name}
            />
          )}
          <button className="text-button" onClick={() => (provider === "all" ? onConfigure() : onLogin(provider))}>
            <UserRound size={15} />
            {provider === "all" ? "管理账号" : accounts[provider]?.signedIn ? "重新登录" : "关联账号"}
          </button>
        </div>
      </div>
      {error && (
        <div role="alert" className="online-search-error">
          {error}
          <button className="text-button" onClick={onConfigure}>
            管理账号
            <ArrowUpRight size={12} />
          </button>
        </div>
      )}
      {warnings.length > 0 && <p className="online-search-warning">{warnings.map(item => item.message).join(" ")}</p>}
      {loading ? (
        <div className="online-native-empty" role="status">
          <LoaderCircle className="spin" size={25} />
          <p>正在寻找你的下一首</p>
        </div>
      ) : tracks.length ? (
        <>
          <div className="online-results-heading">
            <span>
              {searched} <small>· 本批 {tracks.length} 首</small>
            </span>
            <small>资源来自对应平台，播放权限以平台为准</small>
          </div>
          <div className="online-results">
            {tracks.map(track => (
              <div key={track.id} className={`online-result ${track.id === currentId ? "is-current" : ""}`}>
                <button
                  className="online-result-play"
                  aria-label={`播放 ${track.title} · ${musicProviders.find(item => item.id === track.provider).name}`}
                  onClick={() => play(track)}
                >
                  <span className="online-result-art">
                    <Cover track={track} />
                    <i>
                      {preparing === track.id ? (
                        <LoaderCircle size={17} className="spin" />
                      ) : track.id === currentId && playing ? (
                        <Pause size={16} fill="currentColor" />
                      ) : (
                        <Play size={16} fill="currentColor" />
                      )}
                    </i>
                  </span>
                  <span>
                    <b>{track.title}</b>
                    <small>
                      {track.artist} · {track.album || "单曲"}
                    </small>
                  </span>
                </button>
                <span className="online-result-source">
                  <ProviderIcon id={track.provider} />
                  <small>{track.restricted ? "平台权限" : accounts[track.provider]?.signedIn ? "账号已关联" : "公开曲目"}</small>
                </span>
                <time>
                  {Math.floor(track.duration / 60)}:{String(Math.floor(track.duration % 60)).padStart(2, "0")}
                </time>
                {onPlaylist && (
                  <button className="icon-button" aria-label={`将 ${track.title} 加入歌单`} onClick={() => onPlaylist(track)}>
                    <ListPlus size={17} />
                  </button>
                )}
                <button className="icon-button" aria-label={`将 ${track.title} 加入播放队列`} onClick={() => enqueue(track.id)}>
                  <Plus size={17} />
                </button>
              </div>
            ))}
          </div>
          <div className="online-pagination">
            <button className="outline-button" disabled={page <= 1} onClick={() => search(searched, page - 1)}>
              上一页
            </button>
            <span>第 {page} 页</span>
            <button className="outline-button" disabled={!tracks.length} onClick={() => search(searched, page + 1)}>
              下一页
            </button>
          </div>
        </>
      ) : (
        <div className="online-native-empty">
          <span className="online-empty-icon">
            <Music2 size={29} strokeWidth={1.3} />
          </span>
          <h2>{searched ? "没有找到这首歌" : "让下一首，来自更远的地方"}</h2>
          <p>{searched ? "换个关键词，或选择另一个音乐平台。" : "搜索 QQ 音乐与网易云音乐，直接在 Cinder 里聆听。"}</p>
          {!searched && (
            <div className="online-discovery-chips">
              {["纯音乐", "华语经典", "流行"].map(text => (
                <button
                  key={text}
                  onClick={() => {
                    setKeyword(text)
                    search(text)
                  }}
                >
                  {text}
                  <ArrowUpRight size={11} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default memo(OnlineLibrary)
