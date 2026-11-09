import { app, nativeImage, nativeTheme } from "electron"
import { readFileSync } from "node:fs"
import { PNG } from "pngjs"
import { brandHueRotations, tintBrandPixels } from "#shared/brand"

/**
 * 将窗口外观和程序坞图标同步到用户设置，品牌原图始终作为唯一图案来源。
 * 色相结果只缓存在内存中，不改写安装资源或用户图片。
 */
export class DesktopAppearance {
  #icon
  #getWindow
  #icons = new Map()
  #accent

  /**
   * 保存品牌图片位置与主窗口访问器，首次应用设置时才读取图标。
   * 访问器避免持有已经关闭的窗口，窗口重建后仍能应用最新外观。
   */
  constructor(icon, getWindow) {
    this.#icon = icon
    this.#getWindow = getWindow
  }

  /**
   * 同步系统浅深外观、Windows 底色及 macOS 程序坞图标。
   * 相同配色复用缓存；只有本应用受影响，不修改操作系统的全局外观设置。
   */
  apply(settings = {}) {
    nativeTheme.themeSource = ["light", "dark", "system"].includes(settings.theme) ? settings.theme : "dark"
    const window = this.#getWindow()
    if (process.platform !== "darwin" && window && !window.isDestroyed()) {
      window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#191a22" : "#f4f4f8")
    }
    if (!app.dock) {
      return
    }
    const accent = settings.accent || "flame"
    if (this.#accent === accent) {
      return
    }
    if (!this.#icons.has(accent)) {
      const degrees = brandHueRotations[accent] || 0
      if (!degrees) {
        this.#icons.set(accent, nativeImage.createFromPath(this.#icon))
      } else {
        const png = PNG.sync.read(readFileSync(this.#icon))
        tintBrandPixels(png.data, degrees)
        this.#icons.set(accent, nativeImage.createFromBuffer(PNG.sync.write(png)))
      }
    }
    app.dock.setIcon(this.#icons.get(accent))
    this.#accent = accent
  }
}
