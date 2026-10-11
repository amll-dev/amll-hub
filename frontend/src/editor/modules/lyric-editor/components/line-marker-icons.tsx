/*
 * 背景歌词 / 对唱歌词行标记图标
 */

const SIZE = 20;

/** 背景歌词标记，`VideoBackgroundEffectFilled`，蓝色 */
export function BackgroundLyricIcon({ size = SIZE, color = '#4466FF' }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill={color}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M6.2 4 2 8.2V6.8L4.8 4zm7 0-1.46 1.46a4 4 0 0 0-1.02-.39L11.79 4zm-1.08 3.17a2.5 2.5 0 0 0-2.34-1.16 2.5 2.5 0 1 0 2.34 1.16m.72-.72q.3.43.48.94L16.69 4 16.5 4h-1.2zM7.5 12q-.12 0-.22.02A1.5 1.5 0 0 0 6 13.5V16h8v-2.5a1.5 1.5 0 0 0-1.5-1.5zm5-1q.33 0 .63.08L18 6.2V5.5q0-.3-.12-.59l-4.5 4.5a3.5 3.5 0 0 1-.93 1.59zm1.9.88q.35.4.5.93L18 9.7V8.29zM15 16v-1.2l3-3v1.4L15.2 16zm-10-.3v-1.4l-1.7 1.69.2.01h1.2zm1.57-6.48q.12.54.4 1.02L2.11 15.1A2 2 0 0 1 2 14.5v-.7zM9.71 4 2 11.7v-1.4L8.3 4z" />
    </svg>
  );
}

/** 对唱歌词标记，`TextAlignRightFilled`，绿色 */
export function DuetLyricIcon({ size = SIZE, color = '#44AA33' }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill={color}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M6 4.25c0-.41.34-.75.75-.75h10.5a.75.75 0 0 1 0 1.5H6.75A.75.75 0 0 1 6 4.25m-4 5c0-.41.34-.75.75-.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 9.25m7.75 4.25a.75.75 0 0 0 0 1.5h7.5a.75.75 0 0 0 0-1.5z" />
    </svg>
  );
}
