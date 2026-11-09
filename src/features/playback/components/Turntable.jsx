/**
 * 单曲大图的立体彩胶唱机，唱片跟随真实播放状态旋转，唱臂独立落下与抬起。
 * 结构由 CSS 与内联矢量组成，无额外图片或逐帧脚本；系统减少动态效果时保留静态层次。
 */
import React from "react"
import { Pause, Play } from "lucide-react"

/**
 * 以当前真实专辑封面作为唱片中心，外圈、底座和唱臂使用主题色与中性金属材质。
 * 点击碟片通过外层统一控制器暂停或继续，支持键盘，不创建音频或改变播放队列。
 */
export default function Turntable({ track, playing, Cover, onToggle }) {
  return (
    <div
      className={`turntable-player ${playing ? "is-playing" : ""}`}
      aria-label={playing ? "彩胶唱片正在播放" : "彩胶唱片已暂停"}
    >
      <div className="turntable-bed">
        <span className="turntable-wordmark">CINDER / SOUND</span>
        <span className="turntable-power">
          <i />
          {playing ? "PLAYING" : "STANDBY"}
        </span>
        <span className="turntable-speed">33⅓ RPM</span>
      </div>
      <div className="platter-shadow" />
      <button
        type="button"
        className={`turntable ${playing ? "is-playing" : ""}`}
        aria-label={playing ? "暂停唱片" : "播放唱片"}
        aria-pressed={playing}
        onClick={onToggle}
      >
        <span className="record-surface">
          <div className="turntable-grooves" />
          <div className="record-sheen" />
          <Cover track={track} className="now-disc-cover" />
          <span className="spindle" />
        </span>
      </button>
      <span className="disc-action" aria-hidden="true">
        {playing ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}
      </span>
      <div className="tonearm-mount">
        <span />
        <i />
      </div>
      <svg className="tonearm" viewBox="0 0 160 350" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="tonearm-metal" x1="70" y1="0" x2="105" y2="0" gradientUnits="userSpaceOnUse">
            <stop stopColor="#212b33" />
            <stop offset=".38" stopColor="#778c97" />
            <stop offset=".55" stopColor="#c1d0d6" />
            <stop offset=".72" stopColor="#526873" />
            <stop offset="1" stopColor="#18242c" />
          </linearGradient>
          <linearGradient id="tonearm-head" x1="20" y1="276" x2="73" y2="318" gradientUnits="userSpaceOnUse">
            <stop stopColor="#6d848e" />
            <stop offset=".45" stopColor="#263640" />
            <stop offset="1" stopColor="#111d25" />
          </linearGradient>
        </defs>
        <path
          d="M112 29 L94 208 Q92 235 73 256 L43 288"
          stroke="#07171e"
          strokeOpacity=".18"
          strokeWidth="19"
          transform="translate(4 7)"
        />
        <path d="M112 29 L94 208 Q92 235 73 256 L43 288" stroke="#1b2931" strokeWidth="17" strokeLinecap="round" />
        <path d="M112 29 L94 208 Q92 235 73 256 L43 288" stroke="url(#tonearm-metal)" strokeWidth="12" strokeLinecap="round" />
        <path d="M107 62 L91 207 Q89 233 69 256" stroke="#d5e5ec" strokeOpacity=".55" strokeWidth="1.5" />
        <g transform="rotate(14 112 29)">
          <rect x="91" y="1" width="42" height="45" rx="6" fill="#1f2c35" />
          <rect x="94" y="3" width="36" height="8" rx="3" fill="#4e626d" />
          <path d="M97 33H127M97 38H127" stroke="#50626b" strokeWidth="1.5" />
        </g>
        <g transform="rotate(43 41 292)">
          <rect x="24" y="269" width="33" height="49" rx="5" fill="url(#tonearm-head)" />
          <path d="M31 278H50M31 283H50" stroke="#94a8b1" strokeOpacity=".6" />
          <circle cx="41" cy="299" r="3" fill="#8fa3ac" />
          <path d="M37 318V326H46" stroke="#1b2931" strokeWidth="3" strokeLinecap="round" />
        </g>
      </svg>
      <span className="turntable-screw screw-one" />
      <span className="turntable-screw screw-two" />
    </div>
  )
}
