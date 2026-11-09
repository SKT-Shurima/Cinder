/**
 * 独立的在线热门歌手发现页，展示二百位平台热门歌手的随机圆形卡片。
 * 图片按视口延迟加载，容器宽度改变时重新排布，不读取个人曲库或导入目录。
 */
import React, { memo, useEffect, useMemo, useRef, useState } from "react"
import { LoaderCircle, MicVocal, Search, Shuffle } from "lucide-react"
import ArtistCard from "@/features/library/components/ArtistCard.jsx"
import { layoutArtistCards } from "@/features/library/model/artistPresentation.js"
import useArtistBubbles from "@/features/library/hooks/useArtistBubbles.js"

/**
 * 将目录、搜索及可拖动的气泡场组合为歌手发现页，主动换排布时重新随机化。
 * 圆形位移由统一碰撞模型协调，ResizeObserver 和动画循环随页面释放，尺寸差始终不超过 65%。
 */
function ArtistLibrary({ catalog, seed, onShuffle, onOpen, onConfigure }) {
  const [query, setQuery] = useState("")
  const [width, setWidth] = useState(0)
  const container = useRef(null)
  const { artists, source, loading, error, retry } = catalog
  const visible = useMemo(
    () =>
      artists.filter(artist =>
        `${artist.name} ${artist.aliases.join(" ")}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
      ),
    [artists, query],
  )
  useEffect(() => {
    const element = container.current
    if (!element) {
      return
    }
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const layout = useMemo(() => layoutArtistCards(visible, width || 800, seed), [visible, width, seed])
  const interactions = useArtistBubbles({ layout, width, container, onOpen })
  const positions = useMemo(() => new Map(layout.cards.map(card => [card.id, card])), [layout])
  return (
    <section className="artist-library">
      <header className="artist-library-heading">
        <div>
          <span className="eyebrow">DISCOVER THE VOICES</span>
          <h1>热门歌手</h1>
          <p>
            {artists.length ? `${artists.length} 位热门歌手` : "发现喜欢的声音"} · {source}
            <span className="artist-gesture-hint"> · 拖动调整位置</span>
          </p>
        </div>
        <div className="artist-library-actions">
          <button className="outline-button" onClick={onShuffle} disabled={!artists.length}>
            <Shuffle size={15} />
            换个排布
          </button>
          <label className="inline-search">
            <Search size={16} />
            <input
              aria-label="搜索热门歌手"
              placeholder="搜索热门歌手"
              value={query}
              onChange={event => setQuery(event.target.value)}
            />
          </label>
        </div>
      </header>
      {loading && (
        <div className="artist-status" role="status">
          <LoaderCircle className="spin" size={19} />
          正在寻找热门的声音…
        </div>
      )}
      {error && (
        <div className="artist-status" role="alert">
          <p>{error}</p>
          <button className="outline-button" onClick={retry}>
            重试
          </button>
          <button className="text-button" onClick={onConfigure}>
            音乐来源设置
          </button>
        </div>
      )}
      <div
        ref={container}
        className="artist-cloud"
        aria-label="热门歌手"
        style={{ height: !error && !loading ? layout.height : 0, visibility: width ? "visible" : "hidden" }}
      >
        {!loading &&
          !error &&
          visible.map(artist => (
            <ArtistCard key={artist.id} artist={artist} placement={positions.get(artist.id)} interactions={interactions} />
          ))}
      </div>
      {!loading && !error && !visible.length && (
        <div className="empty-state">
          <MicVocal size={34} />
          <h3>热门目录中没有找到这位歌手</h3>
          <p>试试其他名字，或到在线音乐搜索更多歌手和作品。</p>
        </div>
      )}
    </section>
  )
}

export default memo(ArtistLibrary)
