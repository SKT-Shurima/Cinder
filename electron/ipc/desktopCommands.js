/**
 * 将受信桌面 IPC 转换为曲库用例，文件对话框和系统动作集中在此适配层。
 * 仅主窗口顶层 frame 能调用这些命令，账号官方表单不能访问曲库、本地文件或系统播放菜单。
 */
import fs from "node:fs/promises"
import path from "node:path"
import { dialog, shell } from "electron"
import { catalogKey } from "../domain/catalog/trackRules.js"
import { sanitizePlayback } from "../application/catalog/libraryService.js"
import { PreferenceService } from "../application/catalog/preferenceService.js"
import { remoteLibraryPresets } from "#shared/remotePresets"
import { PlaylistService } from "../application/catalog/playlistService.js"
import { containsLocalPath } from "../domain/catalog/localPaths.js"

/**
 * 将固定 IPC 命令映射到音乐库、账号和服务器应用用例。
 * 每次调用核对唯一主窗口与顶层框架，官方登录内容不拥有这些能力。
 */
export class DesktopCommands {
  /**
   * 组合桌面依赖与用例门面，注册表只绑定固定能力，不暴露任意路径或方法名。
   */
  constructor(context) {
    Object.assign(this, context)
    this.playlists = new PlaylistService(this.library)
    this.preferences = new PreferenceService(this.library, input => {
      if (input.musicSources || input.musicProviders) {
        this.online.searchCache.clear()
        this.online.themes.close()
        this.online.refreshAvailability().catch(() => {})
      }
      this.appearance()
    })
  }

  /**
   * 构建固定命令表，后台长任务走统一调度，其余命令返回各自的业务结果。
   * 适配层负责参数收敛，实际索引修改仍由应用服务和仓储完成；即时播放状态仅用于系统菜单。
   */
  entries() {
    const { library, online, remote, accounts } = this
    return {
      "window:state": this.windowState,
      "window:control": action => this.controlWindow(null, action),
      "player:state": value => this.playerState(value),
      "library:snapshot": () => library.snapshot(),
      "library:scan": () => this.background(() => library.scan()),
      "library:scrape": retry => this.background(() => library.scrape(retry === true)),
      "library:stop-scrape": () => {
        library.cancelScrape = true
        return { stopping: true }
      },
      "library:add-root": () => this.addFolders(),
      "library:remove-root": root => this.removeFolder(root),
      "library:favorite": id => this.favorite(id),
      "playlist:save": input => this.playlists.save(input),
      "playlist:remove": id => this.playlists.remove(id),
      "library:played": id => this.remember(id),
      "library:player": value => this.playback(value),
      "library:settings": value => this.preferences.update(value),
      "library:lyrics": (id, options) => library.lyrics(id, { online: options?.online === true, force: options?.force === true }),
      "library:candidates": id => library.candidates(id),
      "library:apply-candidate": (id, candidate) => library.applyCandidate(id, candidate),
      "library:choose-cover": (kind, id) => this.chooseArtwork(kind, id),
      "library:reveal": id => this.reveal(id),
      "library:open-source": id => this.openSource(id),
      "online:search": input => online.search(input),
      "online:recommendations": input => online.recommendations(input),
      "online:theme": input => online.themes.read(input),
      "online:theme-cancel": id => {
        online.themes.cancel(id)
        return true
      },
      "online:artists": () => online.artists.list(),
      "online:artist-tracks": id => online.artists.detail(id),
      "online:prepare": id => online.prepare(id),
      "online:add": ids => online.add(ids),
      "online:accounts": () => accounts.status(),
      "online:login": (provider, method) => {
        online.provider(provider)
        return accounts.login(provider, method)
      },
      "online:login-check": id => accounts.check(id),
      "online:login-close": () => accounts.cancel(),
      "online:login-view": (provider, bounds) => {
        online.provider(provider)
        return accounts.attach(provider, bounds)
      },
      "online:login-detach": () => {
        accounts.detach()
        return true
      },
      "online:login-phone": (action, input) => {
        online.provider("netease")
        return accounts.phone(action, input)
      },
      "remote:key": () => this.selectKey(),
      "remote:configure": (input, save) => this.configureRemote(input, save),
      "remote:scan": id => this.background(() => remote.scan(id)),
      "remote:remove": id => remote.remove(id),
      "remote:metadata": id => remote.metadata(id).then(() => true),
      "remote:recommendations": (id, enabled) => remote.setRecommendations(id, enabled),
      "remote:preset-info": id => this.remotePresetInfo(id),
    }
  }

  /**
   * 将命令注册到唯一主窗口，并在每一次请求时核对 sender 与顶层 frame。
   * 窗口已销毁、子框架或其他认证内容的请求会立即拒绝。
   */
  install(ipc) {
    for (const [channel, command] of Object.entries(this.entries())) {
      ipc.handle(channel, (event, ...parameters) => {
        const target = this.mainWindow()?.webContents
        if (!target || target.isDestroyed() || event.sender !== target || event.senderFrame !== target.mainFrame) {
          throw new Error("不受信任的界面请求")
        }
        return command(...parameters)
      })
    }
  }

  /**
   * 规范新增根目录并消除父子目录重复，再启动本地索引任务。
   * 文件选择取消时不提交状态；任务运行中不允许更改扫描范围。
   * 目录范围比较兼容 Windows 盘符根目录和大小写，不把同盘兄弟目录误判为子目录。
   */
  async addFolders() {
    const library = this.library
    library.requireIdle()
    const selection = await dialog.showOpenDialog(this.mainWindow(), {
      properties: ["openDirectory", "multiSelections"],
      title: "选择音乐文件夹",
    })
    if (selection.canceled) {
      return { canceled: true }
    }
    let roots = library.state.roots.slice()
    for (const filename of selection.filePaths) {
      const full = await fs.realpath(filename)
      if (roots.some(root => containsLocalPath(root, full))) {
        continue
      }
      roots = roots.filter(root => !containsLocalPath(full, root)).concat(full)
    }
    library.state.roots = roots
    await library.save()
    return this.background(() => library.scan())
  }

  /**
   * 移除根目录配置后重新生成本地索引，原音乐目录与文件保持只读。
   */
  async removeFolder(root) {
    this.library.requireIdle()
    this.library.state.roots = this.library.state.roots.filter(directory => directory !== root)
    await this.library.save()
    return this.background(() => this.library.scan())
  }

  /**
   * 切换已知歌曲的收藏并发布索引事件，未知歌曲不能借此写入任意记录。
   */
  async favorite(id) {
    const library = this.library
    library.track(id)
    const ids = new Set(library.state.favorites)
    if (ids.has(id)) {
      ids.delete(id)
    } else {
      ids.add(id)
    }
    library.state.favorites = [...ids]
    await library.save()
    library.emit("changed")
    return library.state.favorites
  }

  /**
   * 将当前歌曲更新为最新播放记录，按歌曲去重并限制到最近两百首。
   */
  async remember(id) {
    const library = this.library
    library.track(id)
    const earlier = library.state.history.filter(entry => entry.id !== id)
    earlier.unshift({ id, at: Date.now() })
    library.state.history = earlier.slice(0, 200)
    await library.save()
    return library.state.history
  }

  /**
   * 保存经过领域校验的播放进度，独立小文件写入不触碰大曲库索引。
   */
  async playback(input) {
    const library = this.library
    library.state.player = sanitizePlayback(input, library.state.tracks.concat(library.state.onlineTracks))
    await library.savePlayback()
    return true
  }

  /**
   * 从系统选择器读取小于 1 MB 的 SSH 私钥，界面只得到临时引用。
   * 密钥正文仅保存在当前命令适配器使用的内存表中。
   */
  async selectKey() {
    const chosen = await dialog.showOpenDialog(this.mainWindow(), {
      properties: ["openFile", "showHiddenFiles"],
      title: "选择 SSH 私钥",
    })
    if (chosen.canceled) {
      return null
    }
    const filename = chosen.filePaths[0]
    if ((await fs.stat(filename)).size > 1048576) {
      throw new Error("私钥文件过大，请选择有效的 SSH 私钥")
    }
    const id = catalogKey(filename)
    this.selectedKeys.set(id, await fs.readFile(filename, "utf8"))
    return { name: path.basename(filename), id }
  }

  /**
   * 通过临时密钥引用或用户本次输入建立服务器配置，保存后再调度扫描。
   * 成功保存时释放临时私钥，实际凭据持久化仍由服务器来源服务决定。
   */
  async configureRemote(input, save) {
    const secret =
      input?.auth === "key"
        ? { privateKey: this.selectedKeys.get(input.keyToken), passphrase: String(input.passphrase || "") }
        : { password: String(input?.password || "") }
    const result = await this.remote.configure(input, secret, save === true)
    if (save === true) {
      this.selectedKeys.clear()
      this.background(() => this.remote.scan(result.sourceId))
    }
    return result
  }

  /**
   * 打开内置曲库运营方的官方说明，方便用户核实来源及公开账号用途。
   * 界面只能提交预设标识，不能利用此命令打开任意地址或本地文件。
   */
  remotePresetInfo(id) {
    const preset = remoteLibraryPresets.find(item => item.id === id)
    if (!preset) {
      throw new Error("未找到此曲库的官方说明")
    }
    return shell.openExternal(preset.infoUrl)
  }

  /**
   * 为已知歌曲或歌单选择本地图片，缓存和索引提交成功后再通知界面。
   * 取消选择不改变封面，其他类型或不存在的歌单立即拒绝。
   */
  async chooseArtwork(kind, id) {
    const library = this.library
    if (kind !== "track" && kind !== "playlist") {
      throw new Error("不支持的封面类型")
    }
    const track = kind === "track" ? library.track(id) : null
    if (!track && !library.snapshot().playlists.some(group => group.id === id)) {
      throw new Error("歌单已不存在")
    }
    const selection = await dialog.showOpenDialog(this.mainWindow(), {
      properties: ["openFile"],
      title: "选择封面图片",
      filters: [{ extensions: ["jpg", "jpeg", "png", "webp"], name: "封面图片" }],
    })
    if (selection.canceled) {
      return { canceled: true }
    }
    if ((await fs.stat(selection.filePaths[0])).size > 10485760) {
      throw new Error("封面图片不能超过 10 MB")
    }
    const image = await library.cacheImage(await fs.readFile(selection.filePaths[0]))
    if (track) {
      Object.assign(track, { cover: image, coverSource: { manual: true, source: "手动选择本地图片" } })
    } else {
      library.state.playlistCovers[id] = image
    }
    await library.save()
    library.emit("changed")
    return library.snapshot()
  }

  /**
   * 只允许本地索引歌曲在系统文件管理器中定位，远程与在线记录不解释为本机路径。
   */
  reveal(id) {
    const track = this.library.track(id)
    if (track.kind === "online" || track.sourceId) {
      throw new Error("这首歌曲没有可在文件管理器中定位的本地文件")
    }
    shell.showItemInFolder(track.path)
    return true
  }

  /**
   * 打开已知歌曲的公开封面来源，地址限制为支持目录的 HTTPS 页面。
   */
  openSource(id) {
    const address = this.library.track(id).coverSource?.sourceUrl
    if (!address) {
      return false
    }
    const url = new URL(address)
    return url.protocol === "https:" && ["music.163.com", "y.qq.com", "musicbrainz.org"].includes(url.hostname)
      ? shell.openExternal(address)
      : false
  }
}
