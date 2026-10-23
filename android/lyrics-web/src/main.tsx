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
      store.set(musicLyricLinesAtom, lines);
    } catch (err) {
      console.warn('[amll] setLines failed', err);
    }
  },
  setTime(ms: number) {
    store.set(musicPlayingPositionAtom, ms);
  },
  setPlaying(playing: boolean) {
    store.set(musicPlayingAtom, playing);
  },
  setMeta(name: string, artists: string, duration: number) {
    store.set(musicNameAtom, name);
    store.set(musicArtistsAtom, [{ id: '1', name: artists }] as never);
    store.set(musicDurationAtom, duration);
  },
  // 封面驱动 AMLL 的背景渐变，没有它页面就是纯黑
  setCover(url: string) {
    store.set(musicCoverAtom, url || '');
  },
  setTheme(dark: boolean) {
    document.documentElement.classList.toggle('dark', dark);
    document.body.style.background = dark ? '#0B0B0F' : '#FBFBFD';
  },
};

createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
    <App />
  </Provider>,
);
