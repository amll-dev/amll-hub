import type { LyricLine } from '@applemusic-like-lyrics/lyric';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from 'jotai';
import { api } from '@/lib/api';
import type { SearchHit } from '@/lib/types';
import {
  NCM_QUALITY_ORDER,
  PlayerContext,
  type NcmQuality,
  type PlayerContextValue,
  type PlaylistItem,
  type PlayerTrack,
  type RepeatMode,
  type SelectRequest,
} from '@/hooks/usePlayer';

/** 背景鼓点跳动开关 */
const BEAT_ENABLED = true;

/** 自然播完续播的交叉淡化秒数 */
const CROSSFADE_NATURAL = 6;
/** 手动切歌的快速淡化秒数 */
const CROSSFADE_MANUAL = 0.6;
/** 转场时旧轨送入混响的量 */
const REVERB_SEND_LEVEL = 0.3;
/** 转场前段保持透明的比例：此区间内纯 crossfade，扫频/混响之后才渐入 */
const TRANSITION_HOLD_RATIO = 0.4;
/** 预加载 URL 新鲜度阈值：超过该时长且距曲目结束不足 60s 时重新解析 */
const PRELOAD_REFRESH_MS = 10 * 60_000;

// 恒功率淡化曲线
const POWER_CURVE_STEPS = 64;
const POWER_DOWN_CURVE = new Float32Array(POWER_CURVE_STEPS);
const POWER_UP_CURVE = new Float32Array(POWER_CURVE_STEPS);
for (let i = 0; i < POWER_CURVE_STEPS; i++) {
  const angle = (i / (POWER_CURVE_STEPS - 1)) * (Math.PI / 2);
  POWER_DOWN_CURVE[i] = Math.cos(angle);
  POWER_UP_CURVE[i] = Math.sin(angle);
}

// 复位扫频滤波器为透明
const resetFilterParam = (filter: BiquadFilterNode | null, ctx: AudioContext) => {
  if (!filter) return;
  filter.frequency.cancelScheduledValues(ctx.currentTime);
  filter.frequency.setValueAtTime(22050, ctx.currentTime);
  filter.type = 'lowpass';
};

// 程序生成混响脉冲响应
const createReverbIR = (ctx: AudioContext): AudioBuffer => {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * 2.5);
  const decay = 2.5;
  const impulse = ctx.createBuffer(2, length, rate);
  for (let c = 0; c < 2; c++) {
    const d = impulse.getChannelData(c);
    for (let i = 0; i < length; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
};

// 等待 audio 元素缓冲就绪，用于上一曲即时混音切换
const waitForReady = (el: HTMLAudioElement, timeoutMs: number) =>
  new Promise<boolean>((resolve) => {
    if (el.readyState >= el.HAVE_FUTURE_DATA) {
      resolve(true);
      return;
    }
    const done = (ok: boolean) => {
      window.clearTimeout(timer);
      el.removeEventListener('canplay', onCanPlay);
      el.removeEventListener('error', onError);
      resolve(ok);
    };
    const onCanPlay = () => done(true);
    const onError = () => done(false);
    const timer = window.setTimeout(
      () => done(el.readyState >= el.HAVE_FUTURE_DATA),
      timeoutMs
    );
    el.addEventListener('canplay', onCanPlay);
    el.addEventListener('error', onError);
  });

// 扫描 AudioBuffer 首尾静音：以 50ms 窗口计算峰值，低于阈值视为静音
const SILENCE_WIN = 0.05;
const SILENCE_THRESHOLD = 0.01; // ~-40dB
const SILENCE_MAX_SCAN = 15; // 最多扫描首/尾各 15 秒
const detectSilence = (buffer: AudioBuffer): { leading: number; trailing: number } => {
  const ch = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const win = Math.max(1, Math.floor(sr * SILENCE_WIN));
  const isSilent = (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      if (Math.abs(ch[i] ?? 0) > SILENCE_THRESHOLD) return false;
    }
    return true;
  };
  let leading = 0;
  const leadingLimit = Math.min(buffer.length, sr * SILENCE_MAX_SCAN);
  for (let i = 0; i + win <= leadingLimit; i += win) {
    if (!isSilent(i, i + win)) break;
    leading = (i + win) / sr;
  }
  let trailing = 0;
  const trailingLimit = Math.max(0, buffer.length - sr * SILENCE_MAX_SCAN);
  for (let i = buffer.length; i - win >= trailingLimit; i -= win) {
    if (!isSilent(i - win, i)) break;
    trailing = (buffer.length - (i - win)) / sr;
  }
  return { leading, trailing };
};

/** 已预解析并缓冲到 standby 元素的下一首 */
interface PreloadedNext {
  /** 播放列表索引 */
  index: number;
  songId: string;
  quality: NcmQuality;
  /** 已解析完成的完整曲目信息 */
  track: PlayerTrack;
  /** 解析完成时间戳，用于新鲜度判断 */
  resolvedAt: number;
  /** 新歌开头静音秒数 */
  leadingSilence: number;
  /** 新歌结尾静音秒数 */
  trailingSilence: number;
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  // 双 audio 元素 A/B 轮换：active 播放当前曲目，standby 预加载下一首，
  const audioARef = useRef<HTMLAudioElement | null>(null);
  const audioBRef = useRef<HTMLAudioElement | null>(null);
  const activeElRef = useRef<HTMLAudioElement | null>(null);
  const standbyElRef = useRef<HTMLAudioElement | null>(null);
  // Web Audio 图中与两个元素一一对应的 GainNode
  const activeGainRef = useRef<GainNode | null>(null);
  const standbyGainRef = useRef<GainNode | null>(null);
  // 转场扫频滤波器
  const activeFilterRef = useRef<BiquadFilterNode | null>(null);
  const standbyFilterRef = useRef<BiquadFilterNode | null>(null);
  // 转场混响 send
  const activeSendRef = useRef<GainNode | null>(null);
  const standbySendRef = useRef<GainNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  // 用 ref 持有 audio，避免 effect 重建
  if (audioARef.current === null && typeof Audio !== 'undefined') {
    const createEl = () => {
      const el = new Audio();
      el.preload = 'auto';
      // 必须设置 crossOrigin：createMediaElementSource 会把 audio 输出
      el.crossOrigin = 'anonymous';
      return el;
    };
    audioARef.current = createEl();
    audioBRef.current = createEl();
    activeElRef.current = audioARef.current;
    standbyElRef.current = audioBRef.current;
  }

  const [track, setTrack] = useState<PlayerTrack | null>(null);
  // track 的 ref 镜像
  const trackRef = useRef<PlayerTrack | null>(null);
  trackRef.current = track;
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectRequest, setSelectRequest] = useState<SelectRequest | null>(null);
  const [shuffle, setShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off');
  const [volume, setVolumeState] = useState(1);
  const [muted, setMuted] = useState(false);
  const [lyricData, setLyricData] = useState<LyricLine[] | null>(null);
  const [lyricLoading, setLyricLoading] = useState(false);
  const [lyricError, setLyricError] = useState<string | null>(null);
  const [quality, setQuality] = useState<NcmQuality>('exhigh');
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [showPlaylistPanel, setShowPlaylistPanel] = useState(false);
  // 保存 playHit 调用时的 resolver，弹窗选择后继续播放流程
  const selectResolverRef = useRef<((songId: string | null) => void) | null>(null);

  // refs：让 onEnd 闭包能读到最新值
  const playlistRef = useRef(playlist);
  playlistRef.current = playlist;
  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;
  const repeatModeRef = useRef(repeatMode);
  repeatModeRef.current = repeatMode;
  const shuffleRef = useRef(shuffle);
  shuffleRef.current = shuffle;
  const qualityRef = useRef(quality);
  qualityRef.current = quality;
  const playNextRef = useRef<(auto?: boolean) => void>(() => {});

  // 已预加载的下一首
  const preloadedRef = useRef<PreloadedNext | null>(null);
  // 预定的下一首索引
  const plannedNextIdxRef = useRef(-1);
  // crossfade 进行中标记
  const transitionRef = useRef(false);
  // 淡变结束清理旧元素的定时器
  const transitionCleanupRef = useRef<number | null>(null);
  // 预加载请求编号
  const preloadReqIdRef = useRef(0);
  // 淡变期间挂起的预加载
  const pendingPreloadRef = useRef(false);
  // 上一曲即时混音加载进行中
  const manualLoadRef = useRef(false);
  // 当前 active 曲目的尾部静音秒数
  const currentTrailingSilenceRef = useRef(0);
  // timeupdate 驱动的交叉淡化检查
  const crossfadeCheckRef = useRef<(remaining: number) => void>(() => {});

  // 绑定 audio 事件
  useEffect(() => {
    const els = [audioARef.current, audioBRef.current].filter(
      (el): el is HTMLAudioElement => !!el
    );
    const onTime = (e: Event) => {
      const el = e.target as HTMLAudioElement;
      if (el !== activeElRef.current) return;
      setCurrent(el.currentTime || 0);
      const dur = el.duration;
      if (Number.isFinite(dur)) crossfadeCheckRef.current(dur - el.currentTime);
    };
    const onDur = (e: Event) => {
      const el = e.target as HTMLAudioElement;
      if (el !== activeElRef.current) return;
      setDuration(el.duration || 0);
    };
    const onEnd = (e: Event) => {
      const el = e.target as HTMLAudioElement;
      if (el !== activeElRef.current) return;
      setPlaying(false);
      // 单曲循环：重播当前
      if (repeatModeRef.current === 'one') {
        el.currentTime = 0;
        void el.play().catch(() => setPlaying(false));
        return;
      }
      // 否则交给 playNext
      playNextRef.current(true);
    };
    const onPlay = (e: Event) => {
      if (e.target !== activeElRef.current) return;
      setPlaying(true);
    };
    const onPause = (e: Event) => {
      if (e.target !== activeElRef.current) return;
      setPlaying(false);
    };
    // standby 加载失败（如 URL 过期）：清空预加载，切歌时回退普通路径
    const onError = (e: Event) => {
      const el = e.target as HTMLAudioElement;
      if (el !== standbyElRef.current) return;
      preloadedRef.current = null;
    };
    for (const el of els) {
      el.addEventListener('timeupdate', onTime);
      el.addEventListener('durationchange', onDur);
      el.addEventListener('ended', onEnd);
      el.addEventListener('play', onPlay);
      el.addEventListener('pause', onPause);
      el.addEventListener('error', onError);
    }
    return () => {
      for (const el of els) {
        el.removeEventListener('timeupdate', onTime);
        el.removeEventListener('durationchange', onDur);
        el.removeEventListener('ended', onEnd);
        el.removeEventListener('play', onPlay);
        el.removeEventListener('pause', onPause);
        el.removeEventListener('error', onError);
      }
    };
  }, []);

  // 切换曲目时设置 src 并播放
  const pendingSeekRef = useRef<number | null>(null);
  useEffect(() => {
    const audio = activeElRef.current;
    if (!audio || !track) return;
    // crossfade 路径：standby 已设置好 src 且正在播放，重设 src 会中断淡化
    if (transitionRef.current) return;
    audio.src = track.audioUrl;
    // 如果有挂起的进度恢复，恢复到该进度
    const seekTo = pendingSeekRef.current;
    pendingSeekRef.current = null;
    if (seekTo !== null && Number.isFinite(seekTo) && seekTo > 0) {
      const onLoaded = () => {
        try {
          audio.currentTime = Math.min(seekTo, audio.duration || seekTo);
        } catch {
          // 忽略 seek 失败
        }
        setCurrent(audio.currentTime || seekTo);
        audio.play().catch((e) => {
          setError(`播放失败：${e instanceof Error ? e.message : String(e)}`);
          setPlaying(false);
        });
      };
      audio.addEventListener('loadedmetadata', onLoaded, { once: true });
    } else {
      audio.currentTime = 0;
      setCurrent(0);
      audio.play().catch((e) => {
        setError(`播放失败：${e instanceof Error ? e.message : String(e)}`);
        setPlaying(false);
      });
    }
    setDuration(0);
    // 常规切歌
    currentTrailingSilenceRef.current = 0;
    const ctx = audioContextRef.current;
    if (ctx) {
      const now = ctx.currentTime;
      activeGainRef.current?.gain.cancelScheduledValues(now);
      activeGainRef.current?.gain.setValueAtTime(1, now);
      standbyGainRef.current?.gain.cancelScheduledValues(now);
      standbyGainRef.current?.gain.setValueAtTime(0, now);
      resetFilterParam(activeFilterRef.current, ctx);
      resetFilterParam(standbyFilterRef.current, ctx);
      activeSendRef.current?.gain.cancelScheduledValues(ctx.currentTime);
      activeSendRef.current?.gain.setValueAtTime(0, ctx.currentTime);
      standbySendRef.current?.gain.cancelScheduledValues(ctx.currentTime);
      standbySendRef.current?.gain.setValueAtTime(0, ctx.currentTime);
    }
  }, [track]);

  // 初始化 AudioContext + AnalyserNode
  const [analyserReady, setAnalyserReady] = useState(false);
  const ensureAudioContext = useCallback(() => {
    if (audioContextRef.current || !audioARef.current || !audioBRef.current) return;
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      const srcA = ctx.createMediaElementSource(audioARef.current);
      const srcB = ctx.createMediaElementSource(audioBRef.current);
      const gainA = ctx.createGain();
      const gainB = ctx.createGain();
      const mkFilter = () => {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 22050;
        return f;
      };
      const filterA = mkFilter();
      const filterB = mkFilter();
      const sendA = ctx.createGain();
      const sendB = ctx.createGain();
      sendA.gain.value = 0;
      sendB.gain.value = 0;
      const reverb = ctx.createConvolver();
      reverb.buffer = createReverbIR(ctx);
      srcA.connect(gainA);
      srcB.connect(gainB);
      gainA.connect(filterA);
      gainB.connect(filterB);
      filterA.connect(analyser);
      filterB.connect(analyser);
      filterA.connect(sendA);
      filterB.connect(sendB);
      sendA.connect(reverb);
      sendB.connect(reverb);
      reverb.connect(analyser);
      analyser.connect(ctx.destination);
      audioContextRef.current = ctx;
      analyserRef.current = analyser;
      // 按当前角色关联 GainNode / Filter / Send
      const aIsA = activeElRef.current === audioARef.current;
      activeGainRef.current = aIsA ? gainA : gainB;
      standbyGainRef.current = aIsA ? gainB : gainA;
      activeFilterRef.current = aIsA ? filterA : filterB;
      standbyFilterRef.current = aIsA ? filterB : filterA;
      activeSendRef.current = aIsA ? sendA : sendB;
      standbySendRef.current = aIsA ? sendB : sendA;
      activeGainRef.current.gain.value = 1;
      standbyGainRef.current.gain.value = 0;
      setAnalyserReady(true);
    } catch (e) {
      console.warn('[PlayerContext] AudioContext 初始化失败，背景跳动与交叉淡化将不可用:', e);
    }
  }, []);

  const toggle = useCallback(() => {
    const audio = activeElRef.current;
    if (!audio || !track) return;
    if (audio.paused) {
      ensureAudioContext();
      audioContextRef.current?.resume().catch(() => {});
      audio.play().catch(() => setPlaying(false));
      // 淡变中恢复
      if (transitionRef.current) standbyElRef.current?.play().catch(() => {});
    } else {
      audio.pause();
      // 淡变中暂停
      if (transitionRef.current) standbyElRef.current?.pause();
    }
  }, [track, ensureAudioContext]);

  // 预解析并预加载预定下一首到 standby 元素
  const preloadNext = useCallback(async () => {
    const standby = standbyElRef.current;
    const idx = plannedNextIdxRef.current;
    const item = playlistRef.current[idx];
    if (!standby || idx < 0 || !item) {
      preloadedRef.current = null;
      return;
    }
    // 淡变进行中 standby 是旧元素，延迟到淡变结束后再预加载
    if (transitionRef.current) {
      pendingPreloadRef.current = true;
      return;
    }
    // 上一曲即时混音加载进行中：standby 被占用，跳过
    if (manualLoadRef.current) return;
    const reqId = ++preloadReqIdRef.current;
    try {
      const info = await api.parseNcmMusic(item.songId, qualityRef.current);
      if (reqId !== preloadReqIdRef.current) return;
      if (!info.url) {
        preloadedRef.current = null;
        return;
      }
      const nextTrack: PlayerTrack = {
        title: info.name || item.name || '未知歌曲',
        artists: info.artists || item.artists || '未知歌手',
        cover: info.cover || item.cover,
        audioUrl: info.url,
        ncmSongId: item.songId,
        ncmLyric: info.lyric,
        ncmTLyric: info.tlyric,
      };
      // 后台解码检测首尾静音
      let leadingSilence = 0;
      let trailingSilence = 0;
      const ctx = audioContextRef.current;
      if (ctx) {
        try {
          const res = await fetch(info.url);
          const ab = await res.arrayBuffer();
          if (reqId !== preloadReqIdRef.current) return;
          const decoded = await ctx.decodeAudioData(ab);
          if (reqId !== preloadReqIdRef.current) return;
          const silence = detectSilence(decoded);
          leadingSilence = silence.leading;
          trailingSilence = silence.trailing;
        } catch {
          // 解码失败（格式/内存）：跳过静音检测
        }
      }
      // preload='auto'：设置 src 后浏览器即开始缓冲
      standby.src = info.url;
      preloadedRef.current = {
        index: idx,
        songId: item.songId,
        quality: qualityRef.current,
        track: nextTrack,
        resolvedAt: Date.now(),
        leadingSilence,
        trailingSilence,
      };
    } catch {
      preloadedRef.current = null;
    }
  }, []);

  // 立即中止进行中的 crossfade：硬停旧元素、增益包络复位
  const abortTransition = useCallback(() => {
    if (!transitionRef.current) return;
    if (transitionCleanupRef.current !== null) {
      window.clearTimeout(transitionCleanupRef.current);
      transitionCleanupRef.current = null;
    }
    const oldEl = standbyElRef.current;
    if (oldEl) {
      oldEl.pause();
      oldEl.removeAttribute('src');
      oldEl.load();
    }
    const ctx = audioContextRef.current;
    if (ctx) {
      const now = ctx.currentTime;
      activeGainRef.current?.gain.cancelScheduledValues(now);
      activeGainRef.current?.gain.setValueAtTime(1, now);
      standbyGainRef.current?.gain.cancelScheduledValues(now);
      standbyGainRef.current?.gain.setValueAtTime(0, now);
      resetFilterParam(activeFilterRef.current, ctx);
      resetFilterParam(standbyFilterRef.current, ctx);
      activeSendRef.current?.gain.cancelScheduledValues(ctx.currentTime);
      activeSendRef.current?.gain.setValueAtTime(0, ctx.currentTime);
      standbySendRef.current?.gain.cancelScheduledValues(ctx.currentTime);
      standbySendRef.current?.gain.setValueAtTime(0, ctx.currentTime);
    }
    transitionRef.current = false;
    // 补执行淡变期间挂起的预加载
    if (pendingPreloadRef.current) {
      pendingPreloadRef.current = false;
      void preloadNext();
    }
  }, [preloadNext]);

  // 恒功率交叉淡化 + 双向扫频
  // 跳过新歌开头静音；dur 秒完成过渡
  const startCrossfade = useCallback(
    (dur: number) => {
      const pre = preloadedRef.current;
      const active = activeElRef.current;
      const standby = standbyElRef.current;
      if (!pre || !active || !standby || transitionRef.current) return;
      transitionRef.current = true;
      preloadedRef.current = null;
      plannedNextIdxRef.current = -1;

      const ctx = audioContextRef.current;
      if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {});
      if (ctx && activeGainRef.current && standbyGainRef.current) {
        const now = ctx.currentTime;
        // 恒功率曲线（cos/sin）：中点两轨各 -3dB
        const outGain = activeGainRef.current.gain;
        const inGain = standbyGainRef.current.gain;
        outGain.cancelScheduledValues(now);
        inGain.cancelScheduledValues(now);
        outGain.setValueCurveAtTime(POWER_DOWN_CURVE, now, dur);
        inGain.setValueCurveAtTime(POWER_UP_CURVE, now, dur);
        if (dur >= CROSSFADE_NATURAL) {
          const hold = now + dur * TRANSITION_HOLD_RATIO;
          const outFilter = activeFilterRef.current;
          const inFilter = standbyFilterRef.current;
          if (outFilter && inFilter) {
            outFilter.type = 'highpass';
            outFilter.frequency.cancelScheduledValues(now);
            outFilter.frequency.setValueAtTime(20, now);
            outFilter.frequency.setValueAtTime(20, hold);
            outFilter.frequency.exponentialRampToValueAtTime(4000, now + dur);
            inFilter.type = 'lowpass';
            inFilter.frequency.cancelScheduledValues(now);
            inFilter.frequency.setValueAtTime(1200, now);
            inFilter.frequency.setValueAtTime(1200, hold);
            inFilter.frequency.exponentialRampToValueAtTime(22050, now + dur);
          }
          // 混响余韵：send 渐入，half 处爬到目标值；
          // convolver 接在扫频后，被滤掉的低频不进混响，湿声拖尾 2.5s
          const send = activeSendRef.current?.gain;
          if (send) {
            send.cancelScheduledValues(now);
            send.setValueAtTime(0, now);
            send.linearRampToValueAtTime(REVERB_SEND_LEVEL, now + dur * 0.5);
          }
        }
      } else {
        // 无 AudioContext：降级为硬切
        active.pause();
      }
      // 跳过新歌开头静音
      if (pre.leadingSilence > 0.3) {
        try {
          standby.currentTime = pre.leadingSilence;
        } catch {
          // 忽略 seek 失败，从头播放
        }
      }
      standby.play().catch(() => {});

      // 立即交换角色：此后事件与 UI 状态跟踪新曲目
      const oldEl = active;
      activeElRef.current = standby;
      standbyElRef.current = oldEl;
      const oldGain = activeGainRef.current;
      activeGainRef.current = standbyGainRef.current;
      standbyGainRef.current = oldGain;
      const oldFilter = activeFilterRef.current;
      activeFilterRef.current = standbyFilterRef.current;
      standbyFilterRef.current = oldFilter;
      const oldSend = activeSendRef.current;
      activeSendRef.current = standbySendRef.current;
      standbySendRef.current = oldSend;
      // 新歌的尾部静音：它成为旧轨时据此提前转场
      currentTrailingSilenceRef.current = pre.trailingSilence;

      // UI/歌词立即切换到新歌
      // duration 直接取自 standby 元素
      setTrack(pre.track);
      setCurrentIndex(pre.index);
      currentIndexRef.current = pre.index;
      setCurrent(standby.currentTime || 0);
      setDuration(standby.duration || 0);
      setPlaying(true);

      // 淡变结束后清理旧元素、复位滤波器，并补执行挂起的预加载
      if (transitionCleanupRef.current !== null) {
        window.clearTimeout(transitionCleanupRef.current);
      }
      transitionCleanupRef.current = window.setTimeout(() => {
        const c = audioContextRef.current;
        if (c) {
          resetFilterParam(activeFilterRef.current, c);
          resetFilterParam(standbyFilterRef.current, c);
          // send 归零
          activeSendRef.current?.gain.setValueAtTime(0, c.currentTime);
          standbySendRef.current?.gain.setValueAtTime(0, c.currentTime);
        }
        oldEl.pause();
        oldEl.removeAttribute('src');
        oldEl.load();
        transitionRef.current = false;
        transitionCleanupRef.current = null;
        if (pendingPreloadRef.current) {
          pendingPreloadRef.current = false;
          void preloadNext();
        }
      }, dur * 1000 + 100);
    },
    [preloadNext]
  );

  // timeupdate 驱动：临近结束触发转场
  const crossfadeCheck = useCallback(
    (remaining: number) => {
      if (transitionRef.current) return;
      // 单曲循环：不淡化，由 ended 原地重播
      if (repeatModeRef.current === 'one') return;
      const pre = preloadedRef.current;
      // 长曲目场景：预加载 URL 可能过期，临近结束时刷新一次
      if (pre && remaining <= 60 && Date.now() - pre.resolvedAt > PRELOAD_REFRESH_MS) {
        // 乐观更新时间戳，避免 timeupdate 连续触发重复刷新
        pre.resolvedAt = Date.now();
        void preloadNext();
      }
      // 尾部静音提前
      if (remaining > CROSSFADE_NATURAL + currentTrailingSilenceRef.current) return;
      if (!pre || pre.index !== plannedNextIdxRef.current) return;
      const standby = standbyElRef.current;
      if (!standby || standby.readyState < standby.HAVE_FUTURE_DATA) return;
      startCrossfade(CROSSFADE_NATURAL);
    },
    [preloadNext, startCrossfade]
  );
  crossfadeCheckRef.current = crossfadeCheck;

  const seek = useCallback(
    (sec: number) => {
      const audio = activeElRef.current;
      if (!audio) return;
      // 淡变中拖进度：立即中止淡变
      abortTransition();
      audio.currentTime = sec;
      setCurrent(sec);
    },
    [abortTransition]
  );

  // FFT 数据采集 + 低频能量提取
  useEffect(() => {
    let rafId = 0;
    let cancelled = false;
    void (async () => {
      const [{ fftDataAtom, lowFreqVolumeAtom }, { SoundProcessor }] = await Promise.all([
        import('@applemusic-like-lyrics/react-full'),
        import('sound-processor'),
      ]);
      if (cancelled) return;
      // 开关关闭：固定输出 0，不启动 RAF 循环
      if (!BEAT_ENABLED) {
        store.set(lowFreqVolumeAtom, 0);
        return;
      }
      const analyser = analyserRef.current;
      if (!analyser) return;
      const buffer = new Uint8Array(analyser.frequencyBinCount);
      // 鼓点区频带数：前 9 个 band 对应 50~250Hz
      const DRUM_BANDS = 9;
      const sp = new SoundProcessor({
        sampleRate: analyser.context.sampleRate,
        fftSize: analyser.fftSize,
        // 倍频程对数分割为 64 个频带；起止频率使前 9 个 band 恰好覆盖
        // 50~250Hz 鼓点区
        outBandsQty: 64,
        startFrequency: 50,
        endFrequency: 50 * Math.pow(250 / 50, 64 / DRUM_BANDS),
        // 高斯滤波：sigma=1、radius=2 滤频谱毛刺
        filterParams: { sigma: 1, radius: 2 },
        // 时间计权：前 5 帧历史平均；A 计权默认开启
        tWeight: true,
      });
      const onFrame = () => {
        analyser.getByteFrequencyData(buffer);
        store.set(fftDataAtom, Array.from(buffer));
        const bands = sp.process(buffer);
        let sum = 0;
        for (let i = 0; i < DRUM_BANDS; i++) sum += bands[i] ?? 0;
        const volume = Math.min(1, ((sum / DRUM_BANDS) / 255) * 6);
        store.set(lowFreqVolumeAtom, volume);
        rafId = requestAnimationFrame(onFrame);
      };
      rafId = requestAnimationFrame(onFrame);
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      void import('@applemusic-like-lyrics/react-full').then((m) =>
        store.set(m.lowFreqVolumeAtom, 0)
      );
    };
  }, [store, analyserReady]);

  // 实际执行解析+播放
  const resolveAndPlay = useCallback(
    async (
      songId: string,
      opts: {
        hit?: SearchHit;
        meta?: {
          name?: string;
          artists?: string;
          cover?: string;
          skipTtml?: boolean;
          customTtml?: string;
        };
        q?: NcmQuality;
      } = {}
    ) => {
      const useQ = opts.q ?? quality;
      setLoading(true);
      setError(null);
      // 常规切歌路径：中止进行中的淡变
      abortTransition();
      ensureAudioContext();
      audioContextRef.current?.resume().catch(() => {});
      try {
        const info = await api.parseNcmMusic(songId, useQ);
        if (!info.url) {
          throw new Error('未能获取播放链接（可能无版权）');
        }
        const hit = opts.hit;
        setTrack({
          title: info.name || opts.meta?.name || hit?.musicNames[0] || '未知歌曲',
          artists: opts.meta?.artists || hit?.artists.join(' / ') || info.artists || '未知歌手',
          cover: info.cover || opts.meta?.cover,
          audioUrl: info.url,
          hit,
          ncmSongId: songId,
          ncmLyric: info.lyric,
          ncmTLyric: info.tlyric,
          skipTtml: opts.meta?.skipTtml,
          customTtml: opts.meta?.customTtml,
        });
        // 切歌时清空旧歌词
        setLyricData(null);
        setLyricError(null);
        // 播放的曲目在当前播放列表中时同步 currentIndex
        const list = playlistRef.current;
        const curIdx = currentIndexRef.current;
        if (list.length > 0 && list[curIdx]?.songId !== songId) {
          const idx = list.findIndex((it) => it.songId === songId);
          if (idx >= 0) {
            setCurrentIndex(idx);
            currentIndexRef.current = idx;
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : '解析失败');
      } finally {
        setLoading(false);
      }
    },
    [quality, ensureAudioContext, abortTransition]
  );

  // 搜索命中播放
  const playBySongId = useCallback(
    (songId: string, hit: SearchHit, q?: NcmQuality) => resolveAndPlay(songId, { hit, q }),
    [resolveAndPlay]
  );

  // 网易云解析页播放
  const playNcmSong = useCallback(
    (
      songId: string,
      meta: {
        name?: string;
        artists?: string;
        cover?: string;
        skipTtml?: boolean;
        customTtml?: string;
      }
    ) => resolveAndPlay(songId, { meta }),
    [resolveAndPlay]
  );

  // 直接播放指定 URL 的音频
  const playDirect = useCallback(
    (opts: {
      audioUrl: string;
      title: string;
      artists?: string;
      cover?: string;
      customTtml?: string;
    }) => {
      abortTransition();
      setCurrent(0);
      setDuration(0);
      setError(null);
      setLoading(false);
      setTrack({
        title: opts.title,
        artists: opts.artists || '未知歌手',
        cover: opts.cover,
        audioUrl: opts.audioUrl,
        customTtml: opts.customTtml,
        skipTtml: true,
      });
      setPlaying(true);
    },
    [abortTransition]
  );

  // 切换到下一个音质
  const cycleQuality = useCallback(() => {
    setQuality((q) => {
      const idx = NCM_QUALITY_ORDER.indexOf(q);
      const next = NCM_QUALITY_ORDER[(idx + 1) % NCM_QUALITY_ORDER.length];
      return next ?? q;
    });
  }, []);

  // 用指定音质重新加载当前曲目，保持当前播放进度
  const reloadWithQuality = useCallback(
    async (q: NcmQuality) => {
      if (!track) return;
      // 记录当前进度，track 更新后恢复
      pendingSeekRef.current = current;
      setQuality(q);
      await resolveAndPlay(
        track.ncmSongId ?? '',
        track.hit
          ? { hit: track.hit, q }
          : { meta: { name: track.title, artists: track.artists, cover: track.cover }, q }
      );
    },
    [track, current, resolveAndPlay]
  );

  // 对外入口：处理多 ncm id 选择
  const playHit = useCallback(
    async (hit: SearchHit) => {
      const ncmIds = hit.platformIds['ncm'] ?? [];
      if (ncmIds.length === 0) {
        setError('该歌曲没有网易云 ID，无法播放');
        return;
      }
      if (ncmIds.length === 1) {
        await playBySongId(ncmIds[0] ?? '', hit);
        return;
      }
      // 多个 id：弹窗让用户选择
      await new Promise<void>((resolve) => {
        selectResolverRef.current = (songId) => {
          setSelectRequest(null);
          // 异步解析，不阻塞 promise
          if (songId) {
            void playBySongId(songId, hit);
          }
          resolve();
        };
        setSelectRequest({ ids: ncmIds, hit });
      });
    },
    [playBySongId]
  );

  const resolveSelect = useCallback((songId: string | null) => {
    const resolver = selectResolverRef.current;
    selectResolverRef.current = null;
    resolver?.(songId);
  }, []);

  // 播放下一首
  const playNext = useCallback(
    (auto?: boolean) => {
      const isAuto = auto === true;
      const list = playlistRef.current;
      const idx = currentIndexRef.current;
      if (list.length === 0) return;
      const pre = preloadedRef.current;
      if (
        pre &&
        pre.index === plannedNextIdxRef.current &&
        standbyElRef.current &&
        !transitionRef.current
      ) {
        startCrossfade(isAuto ? CROSSFADE_NATURAL : CROSSFADE_MANUAL);
        return;
      }
    if (list.length === 1) {
      // 只有一首：all 则重播，off 则停止
      if (repeatModeRef.current === 'all' && activeElRef.current) {
        activeElRef.current.currentTime = 0;
        void activeElRef.current.play().catch(() => setPlaying(false));
      }
      return;
    }
    let nextIdx: number;
    if (plannedNextIdxRef.current >= 0) {
      // 与预加载一致的预定下一首（shuffle 时为当前歌开始播放时随机选定的结果）
      nextIdx = plannedNextIdxRef.current;
    } else if (shuffleRef.current) {
      do {
        nextIdx = Math.floor(Math.random() * list.length);
      } while (nextIdx === idx);
    } else {
      nextIdx = idx + 1;
      if (nextIdx >= list.length) {
        if (repeatModeRef.current === 'all') nextIdx = 0;
        else {
          setPlaying(false);
          return;
        }
      }
    }
    setCurrentIndex(nextIdx);
    currentIndexRef.current = nextIdx;
    const item = list[nextIdx];
    if (!item) return;
    void resolveAndPlay(item.songId, {
      meta: { name: item.name, artists: item.artists, cover: item.cover },
    });
  }, [resolveAndPlay, startCrossfade]);
  // 同步到 ref，供 onEnd 闭包调用（auto=true 表示自然续播）
  playNextRef.current = (auto = false) => playNext(auto);

  // 即时加载指定索引曲目并混音切换（用于上一曲：standby 预加载的是下一首，不含上一曲）。
  // 加载期间旧歌继续播放不中断；解析失败/缓冲超时/期间用户切歌则回退普通路径
  const crossfadeToIndex = useCallback(
    async (index: number) => {
      const list = playlistRef.current;
      const item = list[index];
      const standby = standbyElRef.current;
      // 竞态基准：加载期间用户切歌（track/active 变化）或自动转场则放弃
      const startTrack = trackRef.current;
      const startEl = activeElRef.current;
      if (!item) return;
      if (!standby || transitionRef.current) {
        void resolveAndPlay(item.songId, {
          meta: { name: item.name, artists: item.artists, cover: item.cover },
        });
        return;
      }
      // 占用 standby，阻止预加载 effect 抢占；立即反馈 UI（解析+缓冲需 1-2s）
      manualLoadRef.current = true;
      try {
        const info = await api.parseNcmMusic(item.songId, qualityRef.current);
        if (trackRef.current !== startTrack || activeElRef.current !== startEl) return;
        if (!info.url) throw new Error('no url');
        if (transitionRef.current) throw new Error('transition started');
        const nextTrack: PlayerTrack = {
          title: info.name || item.name || '未知歌曲',
          artists: info.artists || item.artists || '未知歌手',
          cover: info.cover || item.cover,
          audioUrl: info.url,
          ncmSongId: item.songId,
          ncmLyric: info.lyric,
          ncmTLyric: info.tlyric,
        };
        standby.src = info.url;
        const ok = await waitForReady(standby, 2500);
        if (trackRef.current !== startTrack || activeElRef.current !== startEl) return;
        if (!ok || transitionRef.current) throw new Error('standby not ready');
        preloadedRef.current = {
          index,
          songId: item.songId,
          quality: qualityRef.current,
          track: nextTrack,
          resolvedAt: Date.now(),
          // 即时路径跳过静音检测
          leadingSilence: 0,
          trailingSilence: 0,
        };
        startCrossfade(CROSSFADE_MANUAL);
      } catch {
        // 回退普通切歌路径
        void resolveAndPlay(item.songId, {
          meta: { name: item.name, artists: item.artists, cover: item.cover },
        });
      } finally {
        manualLoadRef.current = false;
      }
    },
    [resolveAndPlay, startCrossfade]
  );

  // 播放上一首：即时混音切换
  const playPrev = useCallback(() => {
    const list = playlistRef.current;
    const idx = currentIndexRef.current;
    if (list.length === 0) return;
    if (list.length === 1) {
      if (activeElRef.current) activeElRef.current.currentTime = 0;
      return;
    }
    let prevIdx: number;
    if (shuffleRef.current) {
      do {
        prevIdx = Math.floor(Math.random() * list.length);
      } while (prevIdx === idx);
    } else {
      prevIdx = idx - 1;
      if (prevIdx < 0) prevIdx = repeatModeRef.current === 'all' ? list.length - 1 : 0;
    }
    setCurrentIndex(prevIdx);
    currentIndexRef.current = prevIdx;
    const item = list[prevIdx];
    if (!item) return;
    void crossfadeToIndex(prevIdx);
  }, [crossfadeToIndex]);

  // 播放整个列表：设置列表并从第一首开始
  const playAll = useCallback(
    (items: PlaylistItem[]) => {
      if (items.length === 0) return;
      setPlaylist(items);
      setCurrentIndex(0);
      // 立即同步 ref，避免 onEnd 在 state 更新前读到旧值
      playlistRef.current = items;
      currentIndexRef.current = 0;
      const first = items[0];
      if (!first) return;
      void resolveAndPlay(first.songId, {
        meta: { name: first.name, artists: first.artists, cover: first.cover },
      });
    },
    [resolveAndPlay]
  );

  // 播放列表中指定索引
  const playAtIndex = useCallback(
    (index: number) => {
      const list = playlistRef.current;
      if (index < 0 || index >= list.length) return;
      setCurrentIndex(index);
      currentIndexRef.current = index;
      const item = list[index];
      if (!item) return;
      void resolveAndPlay(item.songId, {
        meta: { name: item.name, artists: item.artists, cover: item.cover },
      });
    },
    [resolveAndPlay]
  );

  // 从列表移除
  const removeFromPlaylist = useCallback((index: number) => {
    const list = playlistRef.current;
    if (index < 0 || index >= list.length) return;
    const newList = list.filter((_, i) => i !== index);
    setPlaylist(newList);
    playlistRef.current = newList;
    const curIdx = currentIndexRef.current;
    if (index < curIdx) {
      setCurrentIndex(curIdx - 1);
      currentIndexRef.current = curIdx - 1;
    } else if (index === curIdx) {
      setCurrentIndex(-1);
      currentIndexRef.current = -1;
    }
  }, []);

  const clearPlaylist = useCallback(() => {
    setPlaylist([]);
    setCurrentIndex(-1);
    playlistRef.current = [];
    currentIndexRef.current = -1;
  }, []);

  // 预加载预定下一首：曲目/列表/模式/音质变化时重算并失效旧预加载
  useEffect(() => {
    const list = playlistRef.current;
    const idx = currentIndexRef.current;
    // 计算预定下一首（与 playNext 索引逻辑一致；单曲循环/列表过短不预加载）
    let nextIdx = -1;
    if (list.length > 1 && idx >= 0 && repeatModeRef.current !== 'one') {
      if (shuffleRef.current) {
        do {
          nextIdx = Math.floor(Math.random() * list.length);
        } while (nextIdx === idx);
      } else {
        nextIdx = idx + 1;
        if (nextIdx >= list.length) nextIdx = repeatModeRef.current === 'all' ? 0 : -1;
      }
    }
    plannedNextIdxRef.current = nextIdx;
    preloadedRef.current = null;
    // 使任何在途预加载结果失效
    ++preloadReqIdRef.current;
    if (nextIdx >= 0) void preloadNext();
  }, [track, playlist, currentIndex, shuffle, repeatMode, quality, preloadNext]);

  const togglePlaylistPanel = useCallback(() => setShowPlaylistPanel((v) => !v), []);
  const closePlaylistPanel = useCallback(() => setShowPlaylistPanel(false), []);

  // 音量或静音变化时同步到两个 audio 元素
  useEffect(() => {
    const vol = muted ? 0 : volume;
    for (const el of [audioARef.current, audioBRef.current]) {
      if (el) el.volume = vol;
    }
  }, [volume, muted]);

  const toggleShuffle = useCallback(() => setShuffle((v) => !v), []);

  const cycleRepeatMode = useCallback(() => {
    setRepeatMode((m) => (m === 'off' ? 'all' : m === 'all' ? 'one' : 'off'));
  }, []);

  const setVolume = useCallback(
    (v: number) => {
      const clamped = Math.max(0, Math.min(1, v));
      setVolumeState(clamped);
      // 调高音量时自动取消静音
      if (clamped > 0 && muted) setMuted(false);
    },
    [muted]
  );

  const toggleMute = useCallback(() => setMuted((v) => !v), []);

  // 自动获取歌词
  useEffect(() => {
    if (!track) return;
    let cancelled = false;
    setLyricLoading(true);
    setLyricError(null);

    (async () => {
      try {
        const { parseLrc, parseTTML } = await import('@applemusic-like-lyrics/lyric');
        if (track.customTtml) {
          setLyricData(parseTTML(track.customTtml).lines);
          return;
        }
        const rawLyricFile = track.hit?.rawLyricFile;
        if (rawLyricFile && !track.skipTtml) {
          const ttml = await api.getRawLyricTtml(rawLyricFile);
          if (cancelled) return;
          setLyricData(parseTTML(ttml).lines);
          return;
        }
        if (track.ncmSongId && !track.skipTtml) {
          const ttml = await api.getNcmLyricTtml(track.ncmSongId);
          if (cancelled) return;
          if (ttml !== null) {
            setLyricData(parseTTML(ttml).lines);
            return;
          }
        }
        if (track.ncmLyric) {
          const lines = parseLrc(track.ncmLyric);
          if (track.ncmTLyric) {
            const transLines = parseLrc(track.ncmTLyric);
            const transMap = new Map<number, string>();
            for (const t of transLines) {
              transMap.set(Math.round(t.startTime), t.words[0]?.word ?? '');
            }
            for (const m of lines) {
              m.translatedLyric = transMap.get(Math.round(m.startTime)) ?? '';
            }
          }
          if (cancelled) return;
          setLyricData(lines);
          return;
        }
        // 无任何歌词来源
        setLyricData(null);
      } catch (e) {
        if (cancelled) return;
        setLyricError(e instanceof Error ? e.message : '获取歌词失败');
      } finally {
        if (!cancelled) setLyricLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [track]);

  // 打开歌词页面
  const openLyricsPage = useCallback(() => {
    if (!track) return;
    void import('@applemusic-like-lyrics/react-full').then((m) =>
      store.set(m.isLyricPageOpenedAtom, true)
    );
  }, [track, store]);

  const close = useCallback(() => {
    abortTransition();
    for (const el of [audioARef.current, audioBRef.current]) {
      if (el) {
        el.pause();
        el.removeAttribute('src');
        el.load();
      }
    }
    setTrack(null);
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    setError(null);
    setShuffle(false);
    setRepeatMode('off');
    setVolumeState(1);
    setMuted(false);
    void import('@applemusic-like-lyrics/react-full').then((m) =>
      store.set(m.isLyricPageOpenedAtom, false)
    );
    setLyricData(null);
    setLyricLoading(false);
    setLyricError(null);
    setPlaylist([]);
    setCurrentIndex(-1);
    setShowPlaylistPanel(false);
    playlistRef.current = [];
    currentIndexRef.current = -1;
    currentTrailingSilenceRef.current = 0;
  }, [store, abortTransition]);

  const value = useMemo<PlayerContextValue>(
    () => ({
      track,
      playing,
      current,
      duration,
      loading,
      error,
      toggle,
      seek,
      playHit,
      playNcmSong,
      playDirect,
      close,
      selectRequest,
      resolveSelect,
      shuffle,
      toggleShuffle,
      repeatMode,
      cycleRepeatMode,
      volume,
      setVolume,
      muted,
      toggleMute,
      lyricData,
      lyricLoading,
      lyricError,
      openLyricsPage,
      quality,
      setQuality,
      cycleQuality,
      reloadWithQuality,
      playlist,
      currentIndex,
      showPlaylistPanel,
      togglePlaylistPanel,
      closePlaylistPanel,
      playAll,
      playNext,
      playPrev,
      playAtIndex,
      removeFromPlaylist,
      clearPlaylist,
    }),
    [
      track,
      playing,
      current,
      duration,
      loading,
      error,
      toggle,
      seek,
      playHit,
      playNcmSong,
      playDirect,
      close,
      selectRequest,
      resolveSelect,
      shuffle,
      toggleShuffle,
      repeatMode,
      cycleRepeatMode,
      volume,
      setVolume,
      muted,
      toggleMute,
      lyricData,
      lyricLoading,
      lyricError,
      openLyricsPage,
      quality,
      setQuality,
      cycleQuality,
      reloadWithQuality,
      playlist,
      currentIndex,
      showPlaylistPanel,
      togglePlaylistPanel,
      closePlaylistPanel,
      playAll,
      playNext,
      playPrev,
      playAtIndex,
      removeFromPlaylist,
      clearPlaylist,
    ]
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
