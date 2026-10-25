import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider, createStore, useAtom } from 'jotai';
import {
  PrebuiltLyricPlayer,
  LyricSizePreset,
  PlayerControlsType,
  cssBackgroundPropertyAtom,
  enableLyricRomanLineAtom,
  enableLyricTranslationLineAtom,
  hideLyricViewAtom,
  isLyricPageOpenedAtom,
  lyricBackgroundRendererAtom,
  lyricSizePresetAtom,
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
  playerControlsTypeAtom,
  showMusicNameAtom,
} from '@applemusic-like-lyrics/react-full';
import { MeshGradientRenderer } from '@applemusic-like-lyrics/core';
// 与网页端 PlayerBoot 完全相同：歌词解析全部交给 AMLL 官方解析器，
// 原生侧只传原始 TTML / LRC 文本，避免两边解析结果不一致（英文空格就是这样丢的）
import { parseLrc, parseTTML } from '@applemusic-like-lyrics/lyric';
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
 * 这些配置 atom 都是 atomWithStorage：挂载时会用 localStorage 里的旧值覆盖默认值。
 * 旧版本页面可能在本地存过别的值（例如播放控制被存成 fft/none，底部就没有播控按钮），
 * 所以启动时和挂载后再各写一次，保证与网页端默认一致。
 */
function applyPrebuiltDefaults() {
  // 播放控制组件：controls = 上一首 / 播放暂停 / 下一首
  store.set(playerControlsTypeAtom, PlayerControlsType.Controls);
  store.set(showMusicNameAtom, true);
  store.set(enableLyricTranslationLineAtom, true);
  store.set(enableLyricRomanLineAtom, true);
  // 网页端默认档在手机上偏小，这里统一用「大」档（6vh，约比默认大 20%）
  store.set(lyricSizePresetAtom, LyricSizePreset.Large);
}
applyPrebuiltDefaults();

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

/** ⋯ 按钮在 AMLL 内部触发，页面内菜单通过这个引用打开 */
const menuRequest: { listener: (() => void) | null } = { listener: null };

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
// 右上角「⋯」：与网页端一致，弹出页面内菜单
store.set(
  onRequestOpenMenuAtom,
  toEmit(() => {
    menuRequest.listener?.();
  }),
);

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

const MENU_WIDTH = 208;
const LONG_PRESS_MS = 480;

type MenuAnchor = { x: number; y: number };

function clampMenu(anchor: MenuAnchor): MenuAnchor {
  const margin = 8;
  const maxX = Math.max(margin, window.innerWidth - MENU_WIDTH - margin);
  // 菜单高度约 260px，避免贴着屏幕下沿
  const maxY = Math.max(margin, window.innerHeight - 280);
  return {
    x: Math.min(Math.max(anchor.x, margin), maxX),
    y: Math.min(Math.max(anchor.y, margin), maxY),
  };
}

function MenuRow(props: { label: string; disabled?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      className="menu-item"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

function App() {
  const [hideLyric, setHideLyric] = useAtom(hideLyricViewAtom);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  // 菜单刚弹出时手指还没抬起，紧接着的 click 会落在遮罩上，先忽略一小段时间
  const openedAtRef = useRef(0);

  // atomWithStorage 在挂载时会读 localStorage 覆盖默认值，这里在挂载后再纠正一次
  useEffect(() => {
    applyPrebuiltDefaults();
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const openMenu = useCallback((next: MenuAnchor) => {
    openedAtRef.current = Date.now();
    setAnchor(clampMenu(next));
  }, []);

  // AMLL 右上角「⋯」→ 页面内菜单
  useEffect(() => {
    menuRequest.listener = () =>
      openMenu({ x: window.innerWidth - MENU_WIDTH - 16, y: 64 });
    return () => {
      menuRequest.listener = null;
    };
  }, [openMenu]);

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    startRef.current = { x: touch.clientX, y: touch.clientY };
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      openMenu({ x: touch.clientX, y: touch.clientY });
    }, LONG_PRESS_MS);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const start = startRef.current;
    if (!start) return;
    const touch = e.touches[0];
    if (Math.abs(touch.clientX - start.x) > 10 || Math.abs(touch.clientY - start.y) > 10) {
      clearTimer();
    }
  };

  const closeMenu = () => setAnchor(null);

  return (
    <div
      className="stage"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={clearTimer}
      onTouchCancel={clearTimer}
      onContextMenu={(e) => {
        // 安卓 WebView 长按默认会弹系统菜单，这里统一走页面内菜单
        e.preventDefault();
        openMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <PrebuiltLyricPlayer id="amll-lyric-player" style={{ width: '100%', height: '100%' }} />

      {anchor && (
        <div
          className="menu-backdrop"
          onClick={() => {
            if (Date.now() - openedAtRef.current > 300) closeMenu();
          }}
        >
          <div
            className="menu-card"
            style={{ left: anchor.x, top: anchor.y, width: MENU_WIDTH }}
            onClick={(e) => e.stopPropagation()}
          >
            <MenuRow label="上一首" disabled />
            <MenuRow
              label="暂停 / 继续"
              onClick={() => {
                closeMenu();
                host('playPause');
              }}
            />
            <MenuRow label="下一首" disabled />
            <div className="menu-sep" />
            <MenuRow
              label={hideLyric ? '显示歌词' : '隐藏歌词'}
              onClick={() => {
                setHideLyric(!hideLyric);
                closeMenu();
              }}
            />
            <div className="menu-sep" />
            <MenuRow
              label="退出歌词页面"
              onClick={() => {
                closeMenu();
                host('close');
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

type NativeBridge = {
  /** 原始歌词文本：format = "ttml" | "lrc"，translation 只对 LRC 有效 */
  setRawLyric: (raw: string, format: string, translation: string) => void;
  setTime: (ms: number) => void;
  setPlaying: (playing: boolean) => void;
  setMeta: (name: string, artists: string, duration: number) => void;
  setCover: (url: string) => void;
  setTheme: (dark: boolean) => void;
  /** 状态栏 / 导航栏高度（CSS px），用于给内容留出安全区，背景仍然铺满 */
  setInsets: (top: number, bottom: number) => void;
};

declare global {
  interface Window {
    amllNative: NativeBridge;
  }
}

window.amllNative = {
  setRawLyric(raw: string, format: string, translation: string) {
    try {
      if (!raw) {
        store.set(musicLyricLinesAtom, []);
        return;
      }
      // 与 PlayerBoot.tsx L1294-1331 一致：TTML 走 parseTTML，
      // LRC 走 parseLrc 并按行开始时间合并 tlyric 翻译
      if (format === 'ttml') {
        const lines = parseTTML(raw).lines;
        console.log('[amll] parseTTML lines:', lines.length);
        store.set(musicLyricLinesAtom, lines);
        return;
      }
      const lines = parseLrc(raw);
      if (translation) {
        const transMap = new Map<number, string>();
        for (const t of parseLrc(translation)) {
          transMap.set(Math.round(t.startTime), t.words[0]?.word ?? '');
        }
        for (const line of lines) {
          line.translatedLyric = transMap.get(Math.round(line.startTime)) ?? '';
        }
      }
      console.log('[amll] parseLrc lines:', lines.length);
      store.set(musicLyricLinesAtom, lines);
    } catch (err) {
      console.warn('[amll] setRawLyric failed', err);
      store.set(musicLyricLinesAtom, []);
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
  // edge-to-edge 下 WebView 会铺到状态栏/导航栏后面，原生把两个高度传进来，
  // 页面只把内容往内缩（背景渐变仍然满屏，状态栏不会出现一条黑带）
  setInsets(top: number, bottom: number) {
    const root = document.documentElement;
    root.style.setProperty('--amll-inset-top', `${Math.max(0, top)}px`);
    root.style.setProperty('--amll-inset-bottom', `${Math.max(0, bottom)}px`);
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
