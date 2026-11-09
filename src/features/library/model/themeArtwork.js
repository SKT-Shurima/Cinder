/**
 * 为聆听主题提供随应用打包的 AI 生成封面，兼顾摄影、复古插画与简洁音乐器物风格。
 * 图片在构建时收录到安装包，展示期间不依赖外部图库或音乐平台，也不读取个人曲库。
 */
import { musicThemes } from "#shared/musicThemes"

/**
 * 以固定目录建立主题和图片的对应关系，使构建器能够收录全部离线封面。
 * 标识只来自内部主题定义，界面输入不能借此拼接任意文件路径。
 */
const themeCovers = new Map(
  musicThemes.map(theme => [theme.id, new URL(`../../../assets/theme-covers/${theme.id}.webp`, import.meta.url).href]),
)

/**
 * 为已登记主题返回包内封面地址，首页、列表和详情共用同一张图片。
 * 未知标识返回空值，不读取磁盘、拼接外部地址或发起额外的图库查询。
 */
export function themeCoverAddress(id) {
  return themeCovers.get(id)
}
