'use client';

// 海帆 SailHai 品牌标识（替换上游 Postiz 图标）。
// 图形与 sira-overseas/infra/brand-site/logo.svg 一致：深墨圆角方 + 青绿放射。
// 沿用 128 的 viewBox 而非重算坐标 —— 改显示尺寸只动 width/height 即可。
export const Logo = () => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="60"
      height="60"
      viewBox="0 0 128 128"
      fill="none"
      className="mt-[8px] min-w-[60px] min-h-[60px]"
    >
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
    </svg>
  );
};
