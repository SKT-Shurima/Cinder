/**
 * 根据设置页签装配外观、来源、音效和封面面板，各面板在自己的模块内维护展示职责。
 * 切换页签不重建音频；离开来源页后销毁表单，秘密输入不会保留在隐藏面板中。
 */
import React from "react"
import { AudioLines } from "lucide-react"
import SettingsTabs from "./SettingsTabs.jsx"
import AppearanceSettings from "./AppearanceSettings.jsx"
import LibrarySourceSettings from "./LibrarySourceSettings.jsx"
import ArtworkSettings from "./ArtworkSettings.jsx"
import { SoundControls } from "@/features/playback/components/SoundEffects.jsx"
/**
 * 根据页签选择单个面板，所有面板共用偏好模型和稳定业务动作。
 */
export default function SettingsPage({ api, library, tab, onTab, busy, sound, actions }) {
  return (
    <div className="settings-content">
      <span className="eyebrow">MAKE IT YOURS</span>
      <h1>设置</h1>
      <SettingsTabs value={tab} onChange={onTab} />
      <div
        className="settings-tab-panel"
        role="tabpanel"
        id={"settings-panel-" + tab}
        aria-labelledby={"settings-tab-" + tab}
        tabIndex={0}
      >
        {tab === "appearance" && <AppearanceSettings settings={library.settings} actions={actions} />}
        {tab === "sources" && <LibrarySourceSettings api={api} library={library} busy={busy} actions={actions} />}
        {tab === "covers" && <ArtworkSettings api={api} library={library} busy={busy} actions={actions} />}
        {tab === "sound" && (
          <section className="settings-section sound-settings">
            <h2>
              <AudioLines size={20} />
              听感
            </h2>
            <p>选择一种听感，或按喜好微调。调整会同步到播放栏。</p>
            <SoundControls value={sound} onPreview={actions.soundPreview} onCommit={actions.soundCommit} expanded />
          </section>
        )}
      </div>
      <p className="about-text">
        Cinder 0.1.0 · 你的私人音乐库
        {library.scannedAt && <span>上次扫描 {new Date(library.scannedAt).toLocaleString("zh-CN")}</span>}
      </p>
    </div>
  )
}
