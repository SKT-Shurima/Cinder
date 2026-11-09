/**
 * 使用现有曲库的目录、标题和标签为五十个聆听主题提供真实候选。
 * 分类只读取索引，不下载或分析音频；没有匹配依据的主题保持为空。
 */
import { normalizeMusicSources } from "#shared/musicSources"
import { isRecommendationAllowed, recommendationKey } from "#shared/recommendationRules"

/**
 * 补充主题名称和检索词在私人目录中的常见表达，兼容扫描时尚未读取音频标签的歌曲。
 * 别名表达分类线索，不按歌手或文件扩展名猜测曲风，也不把“经典”当作“古典”。
 */
const themeAliases = Object.freeze({
  smoky: ["烟嗓", "沙哑", "沧桑", "磁性", "磁性男声"],
  memories: ["怀旧", "经典金曲", "经典老歌", "老歌", "往事", "回忆"],
  inspiration: ["励志", "追梦", "梦想", "倔强", "海阔天空", "不再犹豫", "我的未来不是梦"],
  electronic: ["电音", "电子", "DJ", "EDM", "舞曲", "慢摇", "remix"],
  journey: ["旅途", "旅行", "长途", "远行", "自驾", "公路"],
  night: ["深夜", "午夜", "夜晚", "夜曲", "夜色", "夜空", "深夜电台"],
  healing: ["治愈", "温柔", "暖心", "治愈时光", "温柔女声", "清新女声"],
  heartbreak: ["失恋", "伤感", "分手", "遗憾", "离别", "心痛", "错过", "放手", "情感共鸣", "情感驿站"],
  romance: ["浪漫", "甜蜜", "热恋", "情歌对唱", "浪漫情歌", "告白", "初恋", "心动"],
  solitude: ["独处", "孤独", "一个人", "孤单", "寂寞", "独白"],
  rain: ["雨天", "雨中", "雨夜", "听雨", "下雨", "雨爱", "雨蝶", "雨一直下"],
  morning: ["清晨", "早安", "元气", "晨光", "日出", "朝阳"],
  sunset: ["落日", "日落", "黄昏", "夕阳", "晚霞"],
  city: ["城市", "都市", "霓虹", "夜行", "街道", "夜色"],
  driving: ["驾驶", "车载", "开车", "公路", "长途", "自驾"],
  workout: ["运动", "健身", "燃脂", "动感", "高能", "workout", "fitness"],
  running: ["跑步", "奔跑", "running", "节拍", "动感"],
  focus: ["专注", "学习", "静心", "背景音乐", "轻音乐", "纯音乐"],
  sleep: ["助眠", "睡眠", "晚安", "舒缓", "轻柔", "摇篮曲", "催眠"],
  cafe: ["咖啡", "午后", "慵懒", "下午茶", "lounge", "bossa nova"],
  weekend: ["周末", "松弛", "放松", "惬意", "轻松", "休闲"],
  party: ["派对", "party", "disco", "舞曲", "慢摇", "DJ"],
  chinese: ["华语", "国语", "中文", "港台", "Chinese", "Mandarin"],
  cantonese: ["粤语", "港乐", "广东话", "Cantonese"],
  western: ["欧美", "英文", "英语", "English", "Western"],
  japanese: ["日语", "日系", "日本", "JPOP", "J-POP", "Japanese"],
  korean: ["韩语", "韩流", "韩国", "KPOP", "K-POP", "Korean"],
  minnan: ["闽南", "台语", "台灣話", "闽南语"],
  folk: ["民谣", "民謠", "Folk", "民谣慢歌", "民谣新语"],
  rock: ["摇滚", "搖滾", "Rock", "摇滚力量", "金属", "Metal"],
  jazz: ["爵士", "Jazz", "Swing", "bossa nova"],
  blues: ["蓝调", "藍調", "Blues", "布鲁斯"],
  classical: ["古典", "交响", "交響", "奏鸣", "协奏曲", "Classical", "Symphony", "Sonata"],
  piano: ["钢琴", "鋼琴", "Piano"],
  guitar: ["吉他", "指弹", "Guitar", "Acoustic"],
  strings: ["弦乐", "弦樂", "小提琴", "大提琴", "Violin", "Cello"],
  "chinese-instrument": ["国乐", "民乐", "古筝", "二胡", "琵琶", "古琴", "扬琴", "笛子"],
  instrumental: ["纯音乐", "纯音", "轻音乐", "器乐", "伴奏", "Instrumental"],
  soundtrack: ["影视", "原声", "电影", "电视剧", "片头曲", "片尾曲", "主题曲", "OST", "Soundtrack"],
  anime: ["动漫", "动画", "次元", "卡通", "Anime", "ACG"],
  game: ["游戏", "Game", "原神", "崩坏", "王者荣耀", "英雄联盟", "塞尔达", "仙剑"],
  rap: ["说唱", "嘻哈", "Hip Hop", "Hip-Hop", "Rap"],
  rnb: ["R&B", "RNB", "节奏布鲁斯", "Rhythm and Blues"],
  indie: ["独立", "Indie", "独立音乐"],
  retro: ["复古", "怀旧", "老歌", "Disco", "City Pop"],
  eighties: ["80年代", "八十年代", "80s"],
  nineties: ["90年代", "九十年代", "90s"],
  millennium: ["00年代", "2000年代", "千禧", "零零年代"],
  campus: ["校园", "青春", "毕业", "同桌", "少年"],
  ancient: ["古风", "国风", "国韵", "戏腔", "仙侠", "中国风", "国风雅韵"],
})

/**
 * 统一私人目录和标签的文字形式，去除下载文件名的哈希前缀，避免随机字符参与匹配。
 * 保留词间边界并兼容全角标点；仅处理文本，不改变曲目名称或服务器路径。
 */
function normalizedText(value) {
  const parts = Array.isArray(value) ? value : [value]
  return parts
    .filter(item => typeof item === "string" || typeof item === "number")
    .join(" ")
    .slice(0, 8192)
    .normalize("NFKC")
    .replace(/\b[0-9a-f]{8,64}(?=[_\s-])/giu, " ")
    .replace(/([a-z])([A-Z])/gu, "$1 $2")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{Z}\s]+/gu, " ")
    .trim()
}

/**
 * 匹配中文分类片段与完整的英文词，避免把 most 误认为 OST 等短词。
 * 目录中的复合中文名称允许包含匹配，英文和数字词必须有清楚的词边界。
 */
function containsTerm(text, term) {
  if (!term) {
    return false
  }
  if (/^[a-z0-9 ]+$/u.test(term)) {
    return new RegExp("(^|[^a-z0-9])" + term.replace(/ /gu, "\\s+") + "($|[^a-z0-9])", "u").test(text)
  }
  return text.includes(term)
}

/**
 * 根据分类证据计算单曲与主题的相关度，目录及曲风标签优先于标题中的偶然匹配。
 * 只有明确的年份标签才参与年代推断，经典歌曲不会被全部归到八十年代。
 */
function matchScore(track, theme, terms) {
  const directory = String(track.path || "")
    .split(/[\\/]/u)
    .slice(0, -1)
    .join(" ")
  const fields = [
    [normalizedText([track.album, directory]), 12],
    [normalizedText([].concat(track.genre || [], track.genres || [], track.tags || [], track.language || [])), 16],
    [normalizedText(track.title), 4],
    [normalizedText(track.artist), 3],
  ]
  let score = 0
  for (const [text, weight] of fields) {
    if (terms.some(term => containsTerm(text, term))) {
      score += weight
    }
  }
  if (normalizedText(track.album) === normalizedText(theme.name)) {
    score += 12
  }
  const year = Number(String(track.year || track.date || "").slice(0, 4))
  if (
    (theme.id === "eighties" && year >= 1980 && year < 1990) ||
    (theme.id === "nineties" && year >= 1990 && year < 2000) ||
    (theme.id === "millennium" && year >= 2000 && year < 2010)
  ) {
    score += 30
  }
  return score
}

/**
 * 从启用的本地及远程索引中自动组建一个主题，不依赖在线账号或服务器音频读取。
 * 尊重来源开关和连接的推荐资格，跨来源的同一录音仅保留一条；不足目标数量时返回真实数量。
 * 换批在匹配集合中轮换，返回原有歌曲对象和标识，收藏、播放队列及源文件保持不变。
 */
export function selectLibraryThemeTracks(state, theme, { batch = 0 } = {}) {
  const modes = normalizeMusicSources(state.settings?.musicSources)
  const sources = state.remoteSources || []
  const sourceIds = new Set(sources.map(source => source.id))
  const terms = [
    ...new Set([theme.name, ...theme.keywords, ...(themeAliases[theme.id] || [])].map(normalizedText).filter(Boolean)),
  ]
  const matches = []
  for (const track of state.tracks || []) {
    if (track.kind === "online" || !isRecommendationAllowed(track, sources)) {
      continue
    }
    if (track.sourceId ? !modes.remote || !sourceIds.has(track.sourceId) : !modes.local) {
      continue
    }
    const score = matchScore(track, theme, terms)
    if (score > 0) {
      matches.push({ track, score })
    }
  }
  matches.sort(
    (first, second) =>
      second.score - first.score ||
      Number(Boolean(first.track.sourceId)) - Number(Boolean(second.track.sourceId)) ||
      String(first.track.title).localeCompare(String(second.track.title), "zh-CN") ||
      first.track.id.localeCompare(second.track.id),
  )
  const seen = new Set()
  const tracks = matches
    .filter(({ track }) => {
      const key = recommendationKey(track)
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
    .map(item => item.track)
  const limit = Math.min(100, Math.max(1, theme.target || 100))
  const turn = Number.isSafeInteger(batch) && batch >= 0 ? batch : 0
  const offset = tracks.length ? (turn * Math.min(limit, tracks.length)) % tracks.length : 0
  return tracks.slice(offset).concat(tracks.slice(0, offset)).slice(0, limit)
}

/**
 * 标识当前主题可使用的索引及偏好，供界面重新查询和后台缓存失效共用。
 * 包括扫描时间、推荐资格和分类字段，新连接、重新同步或标签更新后自动重建结果。
 * 连接只取公开标识，不把密码、私钥或账号会话材料放入缓存键。
 */
export function themeLibraryKey(state) {
  return JSON.stringify([
    state.settings?.musicSources,
    state.settings?.musicProviders,
    state.scannedAt,
    (state.remoteSources || []).map(source => [source.id, source.scannedAt, source.recommendationsEnabled]),
    (state.tracks || [])
      .filter(track => track.kind !== "online")
      .map(track => [
        track.id,
        track.sourceId,
        track.path,
        track.title,
        track.artist,
        track.album,
        track.genre,
        track.genres,
        track.tags,
        track.language,
        track.year,
        track.date,
        track.size,
        track.mtimeMs,
      ]),
  ])
}
