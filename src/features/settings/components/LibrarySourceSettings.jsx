import React from "react"
import { Folder, FolderPlus, RefreshCw } from "lucide-react"
import MusicSourceSettings from "@/features/accounts/components/MusicSourceSettings.jsx"
import RemoteLibrary from "@/features/remote/components/RemoteLibrary.jsx"
/**
 * 将平台关联、本地根目录和服务器来源组合在来源面板中，操作统一交由应用任务入口。
 * 移除目录只更新索引配置，不删除音乐文件。
 */
export default function LibrarySourceSettings({ api, library, busy, actions }) {
  return (
    <>
      <MusicSourceSettings
        api={api}
        settings={library.settings}
        onChange={actions.update}
        onOpen={actions.online}
        onLogin={actions.login}
      />
      <section className="settings-section">
        <h2>
          <Folder size={20} />
          音乐文件夹
        </h2>
        <p>文件夹分类会自动成为歌单。所有索引和封面保存在应用数据中。</p>
        {library.roots.map(directory => (
          <div className="root-row" key={directory}>
            <Folder size={20} />
            <span title={directory}>{directory}</span>
            <button disabled={busy} className="text-button" onClick={() => actions.task(() => api.removeRoot(directory))}>
              移除
            </button>
          </div>
        ))}
        <div className="settings-buttons">
          <button disabled={busy} className="primary-button" onClick={() => actions.task(api.addRoot)}>
            <FolderPlus size={16} />
            添加音乐文件夹
          </button>
          <button disabled={busy} className="outline-button" onClick={() => actions.task(api.scan)}>
            <RefreshCw size={16} />
            重新扫描
          </button>
        </div>
        <label className="toggle-row">
          <span>
            <b>跳过整理与异常目录</b>
            <small>异常文件、疑似问题文件、重复ogg文件、待解密、加密文件、解密失败。修改后重新扫描生效。</small>
          </span>
          <input
            type="checkbox"
            checked={library.settings.skipProblemFolders}
            onChange={event => actions.update({ skipProblemFolders: event.target.checked })}
          />
        </label>
      </section>
      <RemoteLibrary api={api} sources={library.remoteSources} busy={busy} onChanged={actions.refresh} onError={actions.report} />
    </>
  )
}
