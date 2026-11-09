/**
 * 根据导航模型展示音乐来源、歌手与用户歌单，侧栏只负责浏览和发起创建动作。
 * 导入、封面筛选与平台入口由应用层回调注入，避免依赖桌面 IPC 实现。
 */
import React from "react"
import { ChevronRight, Clock3, Cloud, Disc3, ListPlus, Heart, ListMusic, MicVocal, Music2, Server, Compass } from "lucide-react"
import IconButton from "@/shared/ui/IconButton.jsx"
import brandIcon from "@/assets/brand-icon.png"

/**
 * 音乐库固定导航模型，在线和远程管理项按来源偏好隐藏。
 * 主题分类同时服务私人曲库与在线资源，入口不随在线音乐开关消失。
 */
const destinations = [
  { id: "home", title: "我的音乐", icon: Disc3 },
  { id: "songs", title: "全部音乐", icon: Music2 },
  { id: "themes", title: "主题歌单", icon: Compass },
  { id: "artists", title: "热门歌手", icon: MicVocal },
  { id: "online", title: "在线音乐", icon: Cloud, source: "online" },
  { id: "remote", title: "远程音乐库", icon: Server, source: "remote" },
  { id: "favorites", title: "我喜欢的音乐", icon: Heart },
  { id: "recent", title: "最近播放", icon: Clock3 },
]

/**
 * 保持导航与当前浏览页关联，播放详情覆盖层不会改变侧栏选中项。
 * 关闭来源只隐藏对应管理入口，主题入口及已保存歌单继续保留。
 * 我的歌单只展示用户保存的记录，空歌单仍保留；加号不再导入文件夹或生成来源分组。
 */
export default function LibrarySidebar({
  page,
  selectedId,
  library,
  sourceModes,
  status,
  busy,
  artists,
  onNavigate,
  onOnline,
  onRemote,
  onAdd,
  onMissing,
  windowControls,
}) {
  const activePage = page === "search" ? "songs" : page === "artist" ? "artists" : page === "theme" ? "themes" : page
  return (
    <aside className="sidebar">
      <div className="traffic-space">{windowControls}</div>
      <button type="button" className="brand" onClick={() => onNavigate("home")}>
        <span className="brand-icon">
          <img src={brandIcon} alt="" />
        </span>
        <span>Cinder</span>
      </button>
      <div className="sidebar-scroll">
        <div className="nav-caption">你的音乐空间</div>
        <nav className="main-nav" aria-label="音乐库导航">
          {destinations
            .filter(item => !item.source || sourceModes[item.source])
            .map(({ id, title, icon: Glyph }) => (
              <button
                key={id}
                type="button"
                className={activePage === id ? "active" : ""}
                onClick={() => (id === "online" ? onOnline() : id === "remote" ? onRemote() : onNavigate(id))}
              >
                <Glyph size={20} />
                <span>{title}</span>
                {id === "songs" && <small>{library.stats.tracks}</small>}
                {id === "artists" && artists > 0 && <small>{artists}</small>}
                {id === "themes" && <small>50</small>}
              </button>
            ))}
        </nav>
        <div className="playlist-caption">
          <span>
            我的歌单 <small>{library.playlists.length}</small>
          </span>
          <IconButton icon={ListPlus} label="创建歌单" disabled={busy} onClick={() => onAdd()} />
        </div>
        <nav className="playlist-nav" aria-label="我创建的歌单">
          {library.playlists.map(group => (
            <button
              key={group.id}
              title={group.name}
              className={page === "playlist" && selectedId === group.id ? "active" : ""}
              onClick={() => onNavigate("playlist", group.id)}
            >
              <ListMusic size={17} />
              <span>{group.name}</span>
              <small>{group.trackIds.length}</small>
            </button>
          ))}
        </nav>
      </div>
      <button className="library-health" onClick={onMissing}>
        <span className={`status-dot ${busy ? "working" : ""}`} />
        <span>
          {busy ? { scrape: "封面刮削中", connect: "服务器连接中" }[status.phase] || "音乐库扫描中" : "私人音乐库"}
          <small>
            {library.stats.covered.toLocaleString()} / {library.stats.tracks.toLocaleString()} 首已有封面
          </small>
        </span>
        <ChevronRight size={15} />
      </button>
    </aside>
  )
}
