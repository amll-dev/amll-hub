import React from 'react';
import { createRoot } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import {
  PrebuiltLyricPlayer,
  enableLyricLineBlurEffectAtom,
  enableLyricLineScaleEffectAtom,
  enableLyricLineSpringAnimationAtom,
  enableLyricRomanLineAtom,
  enableLyricTranslationLineAtom,
  isLyricPageOpenedAtom,
  lyricBackgroundFPSAtom,
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

// 真机排查用：把页面里的异常都转到原生 logcat（AmllLyricView 的 onConsoleMessage）
console.log('[amll] page boot, ua =', navigator.userAgent);
window.addEventListener('error', (e) => {
  console.error('[amll] window error:', e.message, `${e.filename}:${e.lineno}:${e.colno}`);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[amll] unhandled rejection:', String(e.reason));
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
store.set(lyricBackgroundFPSAtom, 30);

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
  // 封面驱动 AMLL 的背景渐变，没有它页面就是纯黑
  setCover(url: string) {
    console.log('[amll] setCover:', url);
    store.set(musicCoverAtom, url || '');
  },
  setTheme(dark: boolean) {
    document.documentElement.classList.toggle('dark', dark);
    document.body.style.background = dark ? '#0B0B0F' : '#FBFBFD';
  },
};

// 首帧渲染后探测一次：根节点有没有内容、播放器节点在不在、WebGL2 是否可用
requestAnimationFrame(() => {
  const root = document.getElementById('root');
  const player = document.getElementById('amll-lyric-player');
  const canvas = document.createElement('canvas');
  console.log(
    '[amll] rendered:',
    JSON.stringify({
      bridge: typeof window.amllNative,
      rootChildren: root?.childElementCount ?? -1,
      player: Boolean(player),
      playerSize: player ? [player.clientWidth, player.clientHeight] : null,
      webgl2: Boolean(canvas.getContext('webgl2')),
      size: [window.innerWidth, window.innerHeight],
    }),
  );
});

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
