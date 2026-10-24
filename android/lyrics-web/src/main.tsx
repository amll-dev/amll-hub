import React from 'react';
import { createRoot } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import {
  PrebuiltLyricPlayer,
  cssBackgroundPropertyAtom,
  enableLyricLineBlurEffectAtom,
  enableLyricLineScaleEffectAtom,
  enableLyricLineSpringAnimationAtom,
  enableLyricRomanLineAtom,
  enableLyricTranslationLineAtom,
  isLyricPageOpenedAtom,
  musicAlbumNameAtom,
  musicArtistsAtom,
  musicCoverAtom,
  musicDurationAtom,
  musicLyricLinesAtom,
  musicNameAtom,
  musicPlayingAtom,
  musicPlayingPositionAtom,
  showBottomControlAtom,
  showMusicAlbumAtom,
  showMusicArtistsAtom,
  showMusicNameAtom,
  showRemainingTimeAtom,
  showVolumeControlAtom,
  lyricBackgroundRendererAtom,
} from '@applemusic-like-lyrics/react-full';
import '@applemusic-like-lyrics/core/style.css';
import '@applemusic-like-lyrics/react-full/style.css';
import './page.css';

/**
 * 与网页端 components/LyricsPage.tsx 相同的渲染层：
 * PrebuiltLyricPlayer + jotai atoms。原生侧只负责把
 * 歌词行 / 进度 / 播放态写进 atoms。
 */
const store = createStore();

let lineCount = 0;
let currentPosition = 0;

/** 页面底部横幅：只要能看见它，就说明 WebView 确实在绘制页面 */
function setPageOk(detail: string) {
  const el = document.getElementById('page-ok-detail');
  if (el) el.textContent = detail;
}

/** 把页面 DOM 的真实状态回传给原生，原生把它固定显示在调试面板顶部 */
function report(stage: string, extra: Record<string, unknown> = {}) {
  try {
    const root = document.getElementById('root');
    const player = document.getElementById('amll-lyric-player');
    const stageEl = document.querySelector('.stage');
    const rect = player?.getBoundingClientRect();
    const cs = player ? getComputedStyle(player) : null;
    const payload = {
      stage,
      rootChildren: root?.childElementCount ?? -1,
      player: Boolean(player),
      playerSize: rect ? [Math.round(rect.width), Math.round(rect.height)] : null,
      heights: {
        html: document.documentElement.clientHeight,
        body: document.body.clientHeight,
        root: root?.clientHeight ?? -1,
        stage: stageEl?.clientHeight ?? -1,
      },
      text: (player?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 24),
      color: cs?.color ?? '',
      blend: cs?.mixBlendMode ?? '',
      opacity: cs?.opacity ?? '',
      lines: lineCount,
      pos: Math.round(currentPosition),
      webgl: Boolean(document.createElement('canvas').getContext('webgl')),
      view: [window.innerWidth, window.innerHeight],
      ...extra,
    };
    const json = JSON.stringify(payload);
    console.log('[amll] report', json);
  } catch (err) {
    console.log('[amll] report failed', String(err));
  }
}

// 真机排查用：把页面里的异常都转到原生 logcat（AmllLyricView 的 onConsoleMessage）
console.log('[amll] page boot, ua =', navigator.userAgent);
window.addEventListener('error', (e) => {
  console.error('[amll] window error:', e.message, `${e.filename}:${e.lineno}:${e.colno}`);
  report('window-error', { message: e.message });
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[amll] unhandled rejection:', String(e.reason));
  report('unhandled-rejection', { message: String(e.reason) });
});

store.set(isLyricPageOpenedAtom, true);
store.set(showBottomControlAtom, false);
store.set(showVolumeControlAtom, false);
store.set(showMusicNameAtom, false);
store.set(showMusicArtistsAtom, false);
store.set(showMusicAlbumAtom, false);
store.set(showRemainingTimeAtom, false);
store.set(enableLyricLineBlurEffectAtom, true);
store.set(enableLyricLineScaleEffectAtom, true);
store.set(enableLyricLineSpringAnimationAtom, true);
store.set(enableLyricTranslationLineAtom, true);
store.set(enableLyricRomanLineAtom, true);
// 默认的流体背景走 WebGL，WebView 上初始化失败时整层不可见；
// 改用不依赖 GPU 的 CSS 背景（封面作为压暗后的底图，见 setCover）
store.set(lyricBackgroundRendererAtom, { renderer: 'css-bg' });
store.set(cssBackgroundPropertyAtom, '#141019');

function App() {
  return (
    <div className="stage">
      <PrebuiltLyricPlayer
        id="amll-lyric-player"
        style={{ width: '100%', height: '100%' }}
      />
      <div className="page-ok">
        AMLL PAGE OK · <span id="page-ok-detail">载入中</span>
      </div>
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
      lineCount = Array.isArray(lines) ? lines.length : 0;
      console.log('[amll] setLines:', lineCount);
      setPageOk(`${lineCount} 行 / ${Math.round(currentPosition)}ms`);
      store.set(musicLyricLinesAtom, lines);
      requestAnimationFrame(() => report('setLines'));
    } catch (err) {
      console.warn('[amll] setLines failed', err);
    }
  },
  setTime(ms: number) {
    currentPosition = ms;
    setPageOk(`${lineCount} 行 / ${Math.round(ms)}ms`);
    store.set(musicPlayingPositionAtom, ms);
  },
  setPlaying(playing: boolean) {
    console.log('[amll] setPlaying:', playing);
    store.set(musicPlayingAtom, playing);
  },
  setMeta(name: string, artists: string, duration: number) {
    console.log('[amll] setMeta:', name, artists, duration);
    store.set(musicNameAtom, name);
    store.set(musicArtistsAtom, [{ id: '1', name: artists }] as never);
    store.set(musicDurationAtom, duration);
  },
  // 封面作为压暗底图（css-bg 背景），不再依赖 WebGL 流体背景
  setCover(url: string) {
    console.log('[amll] setCover:', url);
    store.set(
      cssBackgroundPropertyAtom,
      url
        ? `linear-gradient(rgba(11,11,15,.82), rgba(11,11,15,.94)), url("${url}") center / cover no-repeat`
        : '#141019',
    );
    store.set(musicCoverAtom, url || '');
  },
  setTheme(dark: boolean) {
    document.documentElement.classList.toggle('dark', dark);
    document.body.style.background = dark ? '#0B0B0F' : '#FBFBFD';
  },
};

// 首帧渲染后探测一次：根节点有没有内容、播放器节点在不在、WebGL 是否可用
requestAnimationFrame(() => report('boot'));
setTimeout(() => report('boot+1s'), 1000);

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
    report('render-crashed', { message: String(error.message) });
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
