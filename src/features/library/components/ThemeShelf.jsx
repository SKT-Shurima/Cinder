/**
 * 以主题唱片卡呈现默认发现目录，显示与个人歌单分离，沿用应用当前主题色。
 */
import React, { memo, useMemo, useState } from "react"
import { ArrowRight, Search } from "lucide-react"
import { musicThemes } from "#shared/musicThemes"
import { themeCoverAddress } from "@/features/library/model/themeArtwork.js"
import "@/features/library/themes.css"

/**
 * 使用随应用打包的 AI 生成摄影与插画封面，首页、完整目录和分类详情共用同一图片。
 * 名称与介绍由外层统一呈现，不直接使用现有唱片封面、平台商标或第三方角色图片。
 * 图片按需加载并淡入；失败时保留主题底色，不向音乐平台追加请求。
 */
export function ThemeArtwork({ theme }) {
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <span className="theme-artwork" data-cover-ready={ready} aria-hidden="true">
      {!failed && (
        <img
          className="theme-cover-image"
          src={themeCoverAddress(theme.id)}
          alt=""
          loading="lazy"
          decoding="async"
          width="640"
          height="640"
          draggable={false}
          onLoad={() => setReady(true)}
          onError={() => {
            setFailed(true)
            setReady(false)
          }}
        />
      )}
    </span>
  )
}

/**
 * 首页展示十二个主题与完整目录入口，独立主题页可筛选五十类并按名称检索。
 * 所有来源共用主题入口，百首只表达汇集目标，实际数量按曲库匹配和在线核验结果展示。
 * 目录展示不读取音频，关闭在线音乐仍可进入私人曲库的主题分类。
 */
function ThemeShelf({ compact = false, onOpen, onAll }) {
  const [group, setGroup] = useState("全部")
  const [query, setQuery] = useState("")
  const groups = ["全部", ...new Set(musicThemes.map(theme => theme.group))]
  const themes = useMemo(
    () =>
      musicThemes
        .filter(
          theme =>
            (group === "全部" || theme.group === group) &&
            `${theme.name} ${theme.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
        )
        .slice(0, compact ? 12 : 50),
    [group, query, compact],
  )
  return (
    <section className={`theme-shelf ${compact ? "is-compact" : ""}`} aria-label="主题歌单">
      <div className="theme-section-heading">
        <div>
          {compact ? (
            <h2>
              按心情，发现好音乐 <small>50 个主题</small>
            </h2>
          ) : (
            <h1>主题歌单</h1>
          )}
        </div>
        {compact && (
          <button className="text-button" onClick={onAll}>
            全部 50 类<ArrowRight size={16} />
          </button>
        )}
      </div>
      {!compact && (
        <div className="theme-filters">
          <div className="category-tabs" role="group" aria-label="主题分组">
            {groups.map(value => (
              <button
                key={value}
                className={group === value ? "active" : ""}
                aria-pressed={group === value}
                onClick={() => setGroup(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <label className="inline-search">
            <Search size={15} />
            <input
              value={query}
              aria-label="搜索音乐主题"
              placeholder="搜索心情、曲风或场景"
              onChange={event => setQuery(event.target.value)}
            />
          </label>
        </div>
      )}
      <div className="theme-grid">
        {themes.map(theme => (
          <button key={theme.id} className="theme-card" onClick={() => onOpen(theme.id)} aria-label={`打开主题 ${theme.name}`}>
            <ThemeArtwork key={theme.id} theme={theme} />
            <span className="theme-card-title">{theme.name}</span>
            <span className="theme-card-description">{theme.description}</span>
          </button>
        ))}
      </div>
      {!themes.length && (
        <p className="theme-no-results" role="status">
          没有匹配的主题，试试其他关键词。
        </p>
      )}
    </section>
  )
}

export default memo(ThemeShelf)
