/**
 * 以字段规则表校验可修改偏好，持久索引与界面输入不直接合并。
 * 来源开关保留至少一种聆听方式，所有音效参数继续使用同一规范化器。
 */
import { normalizeSound } from "#shared/audioSettings"
import { brandHueRotations } from "#shared/brand"
import { musicProviders, normalizeMusicProviders, updateMusicSources } from "#shared/musicSources"

/**
 * 校验用户可修改的偏好字段，并协调持久化后的原生外观刷新。
 * 只接受规则表内的枚举、数值和来源设置，未知字段不会合入索引。
 */
export class PreferenceService {
  /**
   * 注入曲库与原生外观刷新回调，偏好保存完成后才触发系统层同步。
   */
  constructor(library, changed) {
    this.library = library
    this.changed = changed
  }

  /**
   * 逐项校验配置并提交索引，不接受曲库记录、路径或未知字段的覆盖。
   * 数值输入以界面单位解释，范围裁剪不会改变正在拖动的渲染预览值。
   */
  async update(input) {
    const settings = this.library.state.settings
    const enums = { theme: ["light", "dark", "system"], accent: Object.keys(brandHueRotations) }
    const ranges = { themeCoverage: [10, 90], glassOpacity: [10, 100], volume: [0, 1] }
    for (const [field, allowed] of Object.entries(enums)) {
      if (allowed.includes(input?.[field])) {
        settings[field] = input[field]
      }
    }
    for (const [field, [minimum, maximum]] of Object.entries(ranges)) {
      if (Number.isFinite(input?.[field])) {
        settings[field] = Math.min(maximum, Math.max(minimum, input[field]))
      }
    }
    if (typeof input?.skipProblemFolders === "boolean") {
      settings.skipProblemFolders = input.skipProblemFolders
    }
    if (input?.musicSources && typeof input.musicSources === "object") {
      settings.musicSources = updateMusicSources(settings.musicSources, input.musicSources)
    }
    if (input?.musicProviders && typeof input.musicProviders === "object") {
      const providers = normalizeMusicProviders(settings.musicProviders)
      for (const platform of musicProviders) {
        if (typeof input.musicProviders[platform.id] === "boolean") {
          providers[platform.id] = input.musicProviders[platform.id]
        }
      }
      settings.musicProviders = providers
    }
    if (input?.soundEffects && typeof input.soundEffects === "object") {
      settings.soundEffects = normalizeSound(input.soundEffects, settings.soundEffects)
    }
    await this.library.save()
    this.changed(input)
    return settings
  }
}
