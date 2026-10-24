import React from 'react';
import { createRoot } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import {
  PrebuiltLyricPlayer,
  cssBackgroundPropertyAtom,
  isLyricPageOpenedAtom,
  lyricBackgroundRendererAtom,
  musicArtistsAtom,
  musicCoverAtom,
  musicDurationAtom,
  musicLyricLinesAtom,
  musicNameAtom,
  musicPlayingAtom,
  musicPlayingPositionAtom,
  musicVolumeAtom,
  onChangeVolumeAtom,
  onClickControlThumbAtom,
  onCycleRepeatModeAtom,
  onLyricLineClickAtom,
  onPlayOrResumeAtom,
  onRequestNextSongAtom,
  onRequestOpenMenuAtom,
  onRequestPrevSongAtom,
  onSeekPositionAtom,
  onToggleShuffleAtom,
} from '@applemusic-like-lyrics/react-full';
import { MeshGradientRenderer } from '@applemusic-like-lyrics/core';
import '@applemusic-like-lyrics/core/style.css';
import '@applemusic-like-lyrics/react-full/style.css';
import './page.css';

/**
 * 与网页端 components/LyricsPage.tsx 相同的渲染层：
 * PrebuiltLyricPlayer + jotai atoms，原生侧只负责把
 * 歌词行 / 进度 / 播放态写进 atoms，并把页面上的操作回传原生。
 */
const store = createStore();

store.set(isLyricPageOpenedAtom, true);
store.set(musicPlayingAtom, false);
store.set(musicVolumeAtom, 1);

/**
 * 背景默认先走纯色（安全），封面确认能加载后再切回和网页端一致的流体渐变。
 * 封面加载失败时流体渲染器会退化成一片白，白字直接看不见，所以必须先探测。
 */
let usingMesh = false;
function useMeshBackground() {
  if (usingMesh) return;
  usingMesh = true;
  store.set(lyricBackgroundRendererAtom, { renderer: MeshGradientRenderer });
}

function useSolidBackground() {
  if (!usingMesh) return;
  usingMesh = false;
  store.set(lyricBackgroundRendererAtom, { renderer: 'css-bg' });
}

store.set(lyricBackgroundRendererAtom, { renderer: 'css-bg' });
store.set(cssBackgroundPropertyAtom, '#141019');

/** 将回调包装为 AMLL 期望的 { onEmit } 结构 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toEmit = <T,>(onEmit: T): any => ({ onEmit });

/** 页面 → 原生：优先走 JS 接口，接口不可用时退回控制台日志 */
function host(command: string, value?: number) {
  try {
    const bridge = (window as unknown as {
      amllHost?: { postMessage?: (json: string) => void };
    }).amllHost;
    if (bridge && typeof bridge.postMessage === 'function') {
      bridge.postMessage(JSON.stringify({ command, value }));
      return;
    }
  } catch (err) {
    console.warn('[amll-host] bridge failed', err);
  }
  console.log('[amll-host]', command, value ?? '');
}

// 与网页端一致的交互回调
store.set(onPlayOrResumeAtom, toEmit(() => host('playPause')));
store.set(onSeekPositionAtom, toEmit((ms: number) => host('seek', ms)));
store.set(
  onLyricLineClickAtom,
  toEmit((evt: { line: { getLine: () => { startTime: number } } }) => {
    host('seek', evt.line.getLine().startTime);
  }),
);
store.set(onChangeVolumeAtom, toEmit((v: number) => host('volume', v)));
store.set(onToggleShuffleAtom, toEmit(() => host('shuffle')));
store.set(onCycleRepeatModeAtom, toEmit(() => host('repeat')));
store.set(onRequestNextSongAtom, toEmit(() => host('next')));
store.set(onRequestPrevSongAtom, toEmit(() => host('prev')));
// 顶部拖动条 / 点击封面缩略图：网页端用来退出歌词页
store.set(onClickControlThumbAtom, toEmit(() => host('close')));
// 右上角「⋯」菜单
store.set(onRequestOpenMenuAtom, toEmit(() => host('menu')));

/**
 * 原生每 120ms 才推一次进度，直接写进 atom 会让逐字高亮一跳一跳的。
 * 这里和网页端的 rAF 循环一样自己做插值，只在偏差超过 250ms 时才校正。
 */
let basePosition = 0;
let baseTimestamp = performance.now();
let playing = false;
let lastNativePosition = 0;

const tick = () => {
  if (playing) {
    const projected = basePosition + (performance.now() - baseTimestamp);
    store.set(musicPlayingPositionAtom, Math.round(projected));
  }
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);

function applyPosition(ms: number) {
  lastNativePosition = ms;
  const now = performance.now();
  if (!playing) {
    basePosition = ms;
    baseTimestamp = now;
    store.set(musicPlayingPositionAtom, ms);
    return;
  }
  const projected = basePosition + (now - baseTimestamp);
  if (Math.abs(projected - ms) > 250) {
    basePosition = ms;
    baseTimestamp = now;
    store.set(musicPlayingPositionAtom, ms);
  }
}

function App() {
  return (
    <div className="stage">
      <PrebuiltLyricPlayer
        id="amll-lyric-player"
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}

type NativeBridge = {
  setLines: (json: string) => void;
  setTime: (ms: number) => void;
  setPlaying: (playing: boolean) => void;
  setMeta: (name: string, artists: string, duration: number) => void;
  setCover: (url: string) => void;
  setTheme: (dark: boolean) => void;
};

declare global {
  interface Window {
    amllNative: NativeBridge;
  }
}

window.amllNative = {
  setLines(json: string) {
    try {
      const lines = JSON.parse(json);
      console.log('[amll] setLines:', Array.isArray(lines) ? lines.length : lines);
      store.set(musicLyricLinesAtom, lines);
    } catch (err) {
      console.warn('[amll] setLines failed', err);
    }
  },
  setTime(ms: number) {
    applyPosition(ms);
  },
  setPlaying(next: boolean) {
    console.log('[amll] setPlaying:', next);
    playing = next;
    if (next) {
      basePosition = lastNativePosition;
      baseTimestamp = performance.now();
    }
    store.set(musicPlayingAtom, next);
  },
  setMeta(name: string, artists: string, duration: number) {
    console.log('[amll] setMeta:', name, artists, duration);
    store.set(musicNameAtom, name);
    store.set(
      musicArtistsAtom,
      artists
        .split(' / ')
        .map((n) => n.trim())
        .filter(Boolean)
        .map((n) => ({ id: n, name: n })),
    );
    store.set(musicDurationAtom, duration);
  },
  // 封面驱动背景流体渐变（与网页端一致）；加载失败时退回纯色，保证歌词可读
  setCover(url: string) {
    console.log('[amll] setCover:', url);
    const cover = url || '';
    store.set(musicCoverAtom, cover);
    if (!cover) {
      useSolidBackground();
      return;
    }
    const probe = new Image();
    probe.crossOrigin = 'anonymous';
    probe.onload = () => useMeshBackground();
    probe.onerror = () => useSolidBackground();
    probe.src = cover;
  },
  setTheme(dark: boolean) {
    document.documentElement.classList.toggle('dark', dark);
    document.body.style.background = dark ? '#0B0B0F' : '#FBFBFD';
  },
};

/** AMLL 渲染抛异常时把堆栈画出来，避免整页黑屏且无从排查 */
class PageErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[amll] render crashed:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div className="page-error">
          <div className="page-error-title">歌词页渲染失败</div>
          <pre>{String(error.stack || error)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
    <PageErrorBoundary>
      <App />
    </PageErrorBoundary>
  </Provider>,
);
