/**
 * 渲染层组合入口，仅挂载应用，不维护音乐业务状态或桌面通信逻辑。
 */
import React from "react"
import { createRoot } from "react-dom/client"
import PlayerApp from "@/app/PlayerApp.jsx"

createRoot(document.getElementById("root")).render(<PlayerApp />)
