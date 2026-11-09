/**
 * 保存首页已经展示的最近十批歌曲身份，浏览、重启和换来源时仍遵守重复限制。
 * 只保存无凭据的作品比较键，不包含平台 Cookie、播放地址或完整歌曲对象。
 */
import { recommendationHistory, recommendationKey } from "#shared/recommendationRules"

const storageKey = "cinder.recommendation-history.v1"

/**
 * 恢复最近批次，存储被禁用或损坏时使用空历史，让音乐浏览仍可继续。
 * 输入经过统一长度限制，不信任来自旧版本存储的任意结构。
 */
export function readRecommendationHistory(storage = globalThis.localStorage) {
  try {
    return recommendationHistory(JSON.parse(storage.getItem(storageKey) || "[]"))
  } catch {
    return []
  }
}

/**
 * 仅在新批次实际完成展示后记录歌曲，同一批的元数据刷新不会多占一个历史位置。
 * 写入失败仍返回本次内存历史；空批次不挤掉此前真正展示过的内容。
 */
export function rememberRecommendationBatch(history, tracks, storage = globalThis.localStorage) {
  const keys = [...new Set(tracks.map(recommendationKey))].slice(0, 30)
  if (!keys.length || keys.every(key => history[0]?.includes(key))) {
    return history
  }
  const next = recommendationHistory([keys, ...history])
  try {
    storage.setItem(storageKey, JSON.stringify(next))
  } catch {
    /* 系统禁用持久存储时，本次页面内仍保持最近十批约束。 */
  }
  return next
}
