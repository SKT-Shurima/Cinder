/**
 * 展示有官方出处的连接模板，公开演示与需自有账号的音乐服务明确区分。
 * 选择模板只填写表单，用户提交后才连接和同步，不在启动时批量导入远程曲目。
 */
import React from "react"
import { ExternalLink } from "lucide-react"
import { remoteLibraryPresets } from "#shared/remotePresets"

/**
 * 提供多个可独立添加的正规来源，以及运营方说明的固定入口。
 * 已添加的公开演示标为已连接；自有账号模板保留添加能力，允许同一服务连接多个账号。
 */
export default function RemotePresetList({ sources, disabled, onSelect, onInfo }) {
  return (
    <div className="remote-presets">
      <h3>内置曲库</h3>
      <div className="remote-preset-grid">
        {remoteLibraryPresets.map(preset => {
          const connected = sources.some(source => source.presetId === preset.id)
          return (
            <article className="remote-preset-card" key={preset.id}>
              <b>{preset.name}</b>
              <p>{preset.description}</p>
              <div className="remote-preset-actions">
                <button
                  className="outline-button"
                  type="button"
                  disabled={disabled || connected}
                  aria-label={`${connected ? "已连接" : "选择"}${preset.name}`}
                  onClick={() => onSelect(preset)}
                >
                  {connected ? "已连接" : preset.access === "public" ? "使用此曲库" : "填写账号"}
                </button>
                <button
                  className="text-button"
                  type="button"
                  disabled={disabled}
                  aria-label={`查看${preset.name}的官方说明`}
                  onClick={() => onInfo(preset.id)}
                >
                  <ExternalLink size={12} />
                  来源
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
