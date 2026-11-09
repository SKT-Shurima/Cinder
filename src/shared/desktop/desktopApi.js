/**
 * 统一取得受限 preload 暴露的桌面接口，功能模块不直接散落访问全局对象。
 * 此入口只复用既有能力，不提供 Node.js 或任意通道调用；测试可向各 Hook 传入替代接口。
 */
const desktopApi = window.cinder

export default desktopApi
