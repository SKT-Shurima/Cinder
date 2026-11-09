import React from "react"
import { ArrowLeft, Moon, Settings, Sun } from "lucide-react"
import IconButton from "@/shared/ui/IconButton.jsx"
import LibrarySearch from "@/features/library/components/LibrarySearch.jsx"

/**
 * 展示当前页位置、统一搜索与外观入口，搜索和导航动作由应用层注入。
 * 在线页保留独立标题，收起详情前的原页面仍由导航模型持有，不重新创建播放器。
 */
export default function AppHeader({
  page,
  pageTitle,
  detailOpen,
  resolvedTheme,
  sourceModes,
  search,
  onBack,
  onThemeChange,
  onSettings,
}) {
  return (
    <header className="topbar">
      <div className="breadcrumb">
        <IconButton
          icon={ArrowLeft}
          label={page === "artist" ? "返回歌手" : page === "theme" ? "返回主题歌单" : "返回我的音乐"}
          onClick={onBack}
        />
        <span>
          {detailOpen
            ? "正在播放"
            : page === "home"
              ? "我的音乐"
              : page === "settings"
                ? "设置"
                : page === "remote"
                  ? "远程音乐库"
                  : page === "online"
                    ? "在线音乐"
                    : pageTitle}
        </span>
      </div>
      <>{page === "online" ? <span className="online-top-label">ONLINE LIBRARY</span> : <LibrarySearch {...search} />}</>
      <div className="top-actions">
        <IconButton
          icon={resolvedTheme === "dark" ? Sun : Moon}
          label={resolvedTheme === "dark" ? "切换浅色模式" : "切换深色模式"}
          onClick={onThemeChange}
        />
        <IconButton icon={Settings} label="设置" onClick={onSettings} />
        <span className="library-mode">
          <span className="status-dot" />
          {[
            [sourceModes.local, "本地"],
            [sourceModes.online, "在线"],
            [sourceModes.remote, "远程"],
          ]
            .filter(([enabled]) => enabled)
            .map(([, label]) => label)
            .join(" · ")}
        </span>
      </div>
    </header>
  )
}
