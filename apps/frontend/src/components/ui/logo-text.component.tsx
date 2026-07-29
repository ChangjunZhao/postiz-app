import React from 'react';

// 海帆 SailHai 横版标识（替换上游 "postiz" 字样），用于登录页与计费页。
// 图标沿用 128 的 viewBox 整体缩放进 31×31 方块，免去逐点重算坐标；
// 文字保留 currentColor —— 上游在深/浅两种背景下都用这个组件，写死颜色会看不见。
export const LogoTextComponent = () => {
  return (
    <svg
      width="101"
      height="33"
      viewBox="0 0 101 33"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform="translate(1,1) scale(0.2422)">
        <rect width="128" height="128" rx="28" fill="#0b1016" />
        <g transform="translate(24,24) scale(2.5)">
          <circle cx="16" cy="16" r="4" fill="#35e0c8" />
          <g
            stroke="#6ff0dc"
            strokeWidth="1.6"
            strokeLinecap="round"
            opacity="0.9"
          >
            <path d="M16 4v5" />
            <path d="M16 23v5" />
            <path d="M4 16h5" />
            <path d="M23 16h5" />
            <path d="M7.5 7.5l3.5 3.5" />
            <path d="M21 21l3.5 3.5" />
            <path d="M24.5 7.5L21 11" />
            <path d="M11 21l-3.5 3.5" />
          </g>
        </g>
      </g>
      <text
        x="39"
        y="22.5"
        fontFamily="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
        fontSize="15"
        fontWeight="600"
        letterSpacing="-0.2"
        fill="currentColor"
      >
        SailHai
      </text>
    </svg>
  );
};
