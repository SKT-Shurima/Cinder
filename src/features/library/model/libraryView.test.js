import test from "node:test"
import assert from "node:assert/strict"
import { getLibraryPagePresentation, selectLibraryTracks } from "./libraryView.js"

/**
 * 建立包含本地、服务器和在线记录的最小曲库，模拟已移除条目及用户自定收藏顺序。
 * 所有数据仅存在于当前测试内，不读取本机曲库或连接任何音乐服务。
 */
function createView() {
  const base = { artist: "示例歌手", album: "测试专辑", filename: "试听.wav", duration: 120 }
  const tracks = [
    { ...base, id: "local10", title: "曲目10", cover: "cover.webp" },
    { ...base, id: "local2", title: "曲目2", cover: null },
    { ...base, id: "server", title: "远程歌曲", sourceId: "server1" },
    { ...base, id: "online", title: "在线歌曲", kind: "online", provider: "qq" },
  ]
  return {
    library: {
      tracks,
      favorites: ["online", "local2", "removed", "local10"],
      history: [{ id: "local2" }, { id: "local10" }],
      settings: { musicSources: { local: true, online: false, remote: false }, musicProviders: { qq: true } },
    },
    tracksById: new Map(tracks.map(track => [track.id, track])),
    popularArtists: { loading: false, error: null, detail: { loading: false, error: null, tracks: [tracks[0]] } },
    musicSearch: { tracks },
    page: "songs",
  }
}

test("收藏保留用户顺序并过滤已删除及已关闭来源的歌曲", () => {
  const view = createView()
  assert.deepEqual(
    selectLibraryTracks({ ...view, page: "favorites" }).map(track => track.id),
    ["local2", "local10"],
  )
  assert.deepEqual(view.library.favorites, ["online", "local2", "removed", "local10"])
})

test("歌单只展示当前允许的来源，不把筛选结果写回原歌单", () => {
  const view = createView()
  const selected = { trackIds: ["server", "local2", "local10"] }
  assert.deepEqual(
    selectLibraryTracks({ ...view, page: "playlist", selected }).map(track => track.id),
    ["local2", "local10"],
  )
  assert.deepEqual(selected.trackIds, ["server", "local2", "local10"])
})

test("按歌名进行自然排序时不重排曲库与播放队列的数据源", () => {
  const view = createView()
  assert.deepEqual(
    selectLibraryTracks({ ...view, sort: "title" }).map(track => track.id),
    ["local2", "local10"],
  )
  assert.deepEqual(
    view.library.tracks.map(track => track.id),
    ["local10", "local2", "server", "online"],
  )
})

test("列表搜索与缺失封面筛选可以同时生效", () => {
  const view = createView()
  assert.deepEqual(
    selectLibraryTracks({ ...view, trackSearch: "示例歌手", onlyMissing: true }).map(track => track.id),
    ["local2"],
  )
})

test("歌手详情失败后不继续展示上一批作品", () => {
  const view = createView()
  view.popularArtists.detail.error = "请求已失效"
  assert.deepEqual(selectLibraryTracks({ ...view, page: "artist" }), [])
})

test("已不存在的歌单和歌手使用通用页面名称", () => {
  assert.equal(getLibraryPagePresentation({ page: "playlist" }).pageTitle, "歌单")
  assert.equal(getLibraryPagePresentation({ page: "artist", popularArtists: { source: "平台" } }).pageTitle, "歌手")
})
