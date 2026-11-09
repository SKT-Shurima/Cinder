import React from "react"
import { ImagePlus, RefreshCw, Sparkles } from "lucide-react"
import { clockLabel } from "@/shared/media/trackPresentation.js"
/**
 * 汇总封面覆盖与历史文件问题，刮削请求通过统一任务入口保持互斥。
 * 问题文件仅展示已识别信息，不修复、不改写或删除原始音频。
 */
export default function ArtworkSettings({ api, library, busy, actions }) {
  const { covered, tracks } = library.stats
  const warnings = library.tracks.filter(track => track.warnings?.length)
  const issueGroups = [
    {
      title: "需留意的历史文件",
      entries: warnings.map(track => ({
        title: `${track.title} · ${track.artist}`,
        path: track.path,
        detail: `已识别 ${clockLabel(track.duration)} 音频 · 原文件保持不变`,
      })),
    },
    {
      title: "无法读取的文件",
      entries: library.failures.map(failure => ({
        title: failure.path.split("/").pop(),
        path: failure.path,
        detail: failure.error,
      })),
    },
  ]
  return (
    <>
      <section className="settings-section">
        <h2>
          <ImagePlus size={20} />
          封面管理
        </h2>
        <div className="cover-progress">
          <div>
            <b>{covered.toLocaleString()}</b>
            <span> / {tracks.toLocaleString()} 首已有封面</span>
          </div>
          <div className="coverage-bar">
            <i style={{ width: `${tracks ? (covered * 100) / tracks : 0}%` }} />
          </div>
        </div>
        <p>优先采用内嵌封面和本地图片，再通过 QQ 音乐、网易云与 MusicBrainz 核对录音。相似版本由你手动确认。</p>
        <div className="settings-buttons">
          <button disabled={busy} className="primary-button" onClick={() => actions.task(() => api.scrape(false))}>
            <Sparkles size={16} />
            刮削缺失封面
          </button>
          <button disabled={busy} className="outline-button" onClick={() => actions.task(() => api.scrape(true))}>
            <RefreshCw size={16} />
            重试未匹配歌曲
          </button>
          <button className="text-button" onClick={actions.missing}>
            查看缺失封面
          </button>
        </div>
        <small className="settings-hint">
          只查询歌曲标签，音频保留在原位置。封面缓存可离线使用，文件夹歌单支持手动选择封面。
        </small>
      </section>
      {issueGroups
        .filter(group => group.entries.length)
        .map(group => (
          <section className="settings-section" key={group.title}>
            <h2>
              {group.title}
              <span className="count-pill">{group.entries.length}</span>
            </h2>
            <div className="failure-list">
              {group.entries.map((entry, index) => (
                <div key={index}>
                  <b>{entry.title}</b>
                  <small title={entry.path}>{entry.path}</small>
                  <span>{entry.detail}</span>
                </div>
              ))}
            </div>
          </section>
        ))}
    </>
  )
}
