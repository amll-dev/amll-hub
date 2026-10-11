import { Eye, EyeOff, Music, Timer } from 'lucide-react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { type FC, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { audioEngine } from '$/modules/audio/audio-engine.ts';
import { useBpmTapEngine } from '$/modules/audio/hooks';
import {
  audioEngineStateAtom,
  currentDurationAtom,
  isAuditioningAtom,
  pcmDataReadyAtom,
} from '$/modules/audio/states/index.ts';
import { useReviewSpectrogramTimingOverlay } from '$/modules/review/services/review-timing-overlay-service.tsx';
import { useScrubbing } from '$/modules/spectrogram/hooks/useScrubbing';
import { useSpectrogramInteraction } from '$/modules/spectrogram/hooks/useSpectrogramInteraction.ts';
import { useSpectrogramResize } from '$/modules/spectrogram/hooks/useSpectrogramResize.ts';
import { useSpectrogramWorker } from '$/modules/spectrogram/hooks/useSpectrogramWorker.ts';
import { useTimelineEditing } from '$/modules/spectrogram/hooks/useTimelineEditing.ts';
import {
  currentPaletteAtom,
  showBeatLinesAtom,
  spectrogramContainerWidthAtom,
  spectrogramGainAtom,
  spectrogramHeightAtom,
  spectrogramHoverPxAtom,
  spectrogramHoverTimeMsAtom,
} from '$/modules/spectrogram/states';
import { isDraggingAtom } from '$/modules/spectrogram/states/dnd.ts';
import { reviewSessionAtom, selectedLinesAtom, showUnselectedLinesAtom } from '$/states/main.ts';
import { msToTimestamp } from '@/lib/format';
import styles from './AudioSpectrogram.module.css';
import { BeatLinesOverlay } from './BeatLinesOverlay.tsx';
import { LyricTimelineOverlay } from './LyricTimelineOverlay.tsx';
import { type ISpectrogramContext, SpectrogramContext } from './SpectrogramContext.ts';
import { TileComponent, type TileComponentProps } from './TileComponent.tsx';
import { DEFAULT_RULER_HEIGHT, TimelineRuler, type TimelineRulerHandle } from './TimelineRuler.tsx';

const TILE_DURATION_S = 5;
const LOD_WIDTHS = [512, 1024, 2048, 4096, 8192] as const;
const MAX_LOD_WIDTH = LOD_WIDTHS[LOD_WIDTHS.length - 1]!;

const ReviewLyricTimelineOverlay: FC<{
  clientWidth: number;
  hiddenLineIds?: Set<string> | null;
}> = ({ clientWidth, hiddenLineIds }) => {
  const renderLineOverlay = useReviewSpectrogramTimingOverlay();

  return (
    <LyricTimelineOverlay
      clientWidth={clientWidth}
      hiddenLineIds={hiddenLineIds}
      renderLineOverlay={renderLineOverlay}
    />
  );
};

export const AudioSpectrogram: FC = () => {
  const pcmDataReady = useAtomValue(pcmDataReadyAtom);
  const currentDurationMs = useAtomValue(currentDurationAtom);
  const engineState = useAtomValue(audioEngineStateAtom);
  const selectedLines = useAtomValue(selectedLinesAtom);
  const reviewSession = useAtomValue(reviewSessionAtom);

  const isAuditioning = useAtomValue(isAuditioningAtom);
  const playheadCursorRef = useRef<HTMLDivElement>(null);
  const playheadScrubHandleRef = useRef<HTMLDivElement>(null);
  const auditionCursorRef = useRef<HTMLDivElement>(null);

  const [gain, setGain] = useAtom(spectrogramGainAtom);
  const [dataHeight, setDataHeight] = useAtom(spectrogramHeightAtom);
  const [showUnselectedLines, setShowUnselectedLines] = useAtom(showUnselectedLinesAtom);
  const [showBeatLines, setShowBeatLines] = useAtom(showBeatLinesAtom);

  const { setTapMode, isSpectrogramTapMode, totalTapCount, triggerTap } = useBpmTapEngine();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isSpectrogramTapMode) {
        setTapMode('off');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSpectrogramTapMode, setTapMode]);

  const { height: uiHeight, resizeHandleProps } = useSpectrogramResize({
    initialHeight: dataHeight,
    onCommit: setDataHeight,
  });
  const palette = useAtomValue(currentPaletteAtom);
  const [visibleTiles, setVisibleTiles] = useState<TileComponentProps[]>([]);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useAtom(spectrogramContainerWidthAtom);

  const { zoom, scrollLeft, isZooming } = useSpectrogramInteraction(
    scrollContainerRef,
    containerWidth,
    pcmDataReady
  );

  const viewStateRef = useRef({ zoom, scrollLeft, containerWidth });

  useLayoutEffect(() => {
    viewStateRef.current = { zoom, scrollLeft, containerWidth };
  }, [zoom, scrollLeft, containerWidth]);

  const syncCursorsToDOM = useCallback((timeInSeconds: number) => {
    const { zoom, scrollLeft, containerWidth } = viewStateRef.current;

    const cursorPosition = timeInSeconds * zoom;
    const handleLeftPosition = cursorPosition - scrollLeft;

    if (playheadCursorRef.current) {
      playheadCursorRef.current.style.left = `${cursorPosition}px`;
    }

    if (auditionCursorRef.current) {
      auditionCursorRef.current.style.left = `${cursorPosition}px`;
    }

    if (playheadScrubHandleRef.current) {
      playheadScrubHandleRef.current.style.left = `${handleLeftPosition}px`;
      playheadScrubHandleRef.current.style.display =
        handleLeftPosition < 0 || handleLeftPosition > containerWidth ? 'none' : 'block';
    }
  }, []);

  useEffect(() => {
    syncCursorsToDOM(audioEngine.musicCurrentTime);
    audioEngine.onTimeUpdate(syncCursorsToDOM);

    return () => audioEngine.offTimeUpdate(syncCursorsToDOM);
  }, [syncCursorsToDOM]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 因为暂停时不发射进度，依赖视口状态作为 Trigger 强制同步游标
  useEffect(() => {
    syncCursorsToDOM(audioEngine.musicCurrentTime);
  }, [zoom, scrollLeft, containerWidth, syncCursorsToDOM]);

  const [isHovering, setIsHovering] = useState(false);
  const hoverPx = useAtomValue(spectrogramHoverPxAtom);
  const setHoverPx = useSetAtom(spectrogramHoverPxAtom);
  const hoverTimeMs = useAtomValue(spectrogramHoverTimeMsAtom);
  const isDragging = useAtomValue(isDraggingAtom);

  const rulerRef = useRef<TimelineRulerHandle>(null);

  const { tileCache, requestTileIfNeeded, lastTileTimestamp } = useSpectrogramWorker(
    pcmDataReady,
    currentDurationMs,
    palette.data
  );

  const {
    handleContainerMouseDown,
    isInvalidEndTime,
    pendingCursorPosition,
    showRangePreview,
    previewStyle,
    editingTimeField,
  } = useTimelineEditing(scrollLeft, zoom);

  const { handleScrubStart } = useScrubbing(scrollContainerRef, scrollLeft, zoom);

  const contextValue = useMemo<ISpectrogramContext>(
    () => ({
      scrollContainerRef,
      zoom,
      scrollLeft,
    }),
    [zoom, scrollLeft]
  );

  const updateVisibleTiles = useCallback(() => {
    if (!pcmDataReady || currentDurationMs <= 0 || !scrollContainerRef.current) return;
    const durationS = currentDurationMs / 1000;
    const pixelsPerSecond = zoom;
    const tileDisplayWidthPx = TILE_DURATION_S * pixelsPerSecond;
    const totalTiles = Math.ceil(durationS / TILE_DURATION_S);

    const viewStart = scrollLeft;
    const viewEnd = viewStart + containerWidth;

    const firstVisibleIndex = Math.floor(viewStart / tileDisplayWidthPx);
    const lastVisibleIndex = Math.ceil(viewEnd / tileDisplayWidthPx);

    const newVisibleTiles: TileComponentProps[] = [];

    const currentPaletteId = palette.id;

    for (let i = firstVisibleIndex - 2; i <= lastVisibleIndex + 2; i++) {
      if (i < 0 || i >= totalTiles) continue;

      const cacheId = `tile-${i}`;
      const targetLodWidth = LOD_WIDTHS.find((w) => w >= tileDisplayWidthPx) ?? MAX_LOD_WIDTH;

      requestTileIfNeeded({
        tileIndex: i,
        startTime: i * TILE_DURATION_S,
        endTime: i * TILE_DURATION_S + TILE_DURATION_S,
        gain: gain,
        height: dataHeight,
        tileWidthPx: targetLodWidth,
        paletteId: currentPaletteId,
      });

      const cacheEntry = tileCache.current.get(cacheId);
      const currentBitmap = cacheEntry?.bitmap;

      newVisibleTiles.push({
        tileId: cacheId,
        left: i * tileDisplayWidthPx,
        width: tileDisplayWidthPx,
        height: dataHeight,
        canvasWidth: currentBitmap?.width || targetLodWidth,
        bitmap: currentBitmap,
      });
    }
    setVisibleTiles(newVisibleTiles);
  }, [
    pcmDataReady,
    currentDurationMs,
    containerWidth,
    gain,
    dataHeight,
    requestTileIfNeeded,
    tileCache,
    palette.id,
    zoom,
    scrollLeft,
  ]);

  const updateVisibleTilesRef = useRef(updateVisibleTiles);
  useLayoutEffect(() => {
    updateVisibleTilesRef.current = updateVisibleTiles;
  }, [updateVisibleTiles]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: lastTileTimestamp 用来重运行这个 effect
  useEffect(() => {
    updateVisibleTiles();
  }, [updateVisibleTiles, lastTileTimestamp]);

  const handleRulerSeek = (timeInSeconds: number) => {
    audioEngine.seekMusic(timeInSeconds);
  };

  useLayoutEffect(() => {
    if (lastTileTimestamp === 0) {
      return;
    }
    rulerRef.current?.draw(scrollLeft);
    updateVisibleTilesRef.current();
  }, [scrollLeft, lastTileTimestamp]);

  useLayoutEffect(() => {
    if (lastTileTimestamp === 0 && !pcmDataReady && !currentDurationMs) {
      return;
    }
    rulerRef.current?.draw(scrollLeft);
    updateVisibleTilesRef.current();
  }, [scrollLeft, lastTileTimestamp, pcmDataReady, currentDurationMs]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!pcmDataReady || !container || !currentDurationMs) return;

    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        setContainerWidth(entries[0].contentRect.width);
      }
    });

    observer.observe(container);
    setContainerWidth(container.clientWidth);

    return () => observer.disconnect();
  }, [setContainerWidth, pcmDataReady, currentDurationMs]);

  const handleMouseEnter = () => setIsHovering(true);
  const handleMouseLeave = () => setIsHovering(false);
  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isHovering) {
      setIsHovering(true);
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    setHoverPx(x);
  };

  const totalWidth = currentDurationMs > 0 ? (currentDurationMs / 1000) * zoom : 0;

  let hoverTimeFormatted = msToTimestamp(hoverTimeMs);
  let tooltipBgColor: string | undefined;
  let hoverLineColor: string | undefined;

  if (isSpectrogramTapMode) {
    const nextBeatIndex = totalTapCount + 1;
    hoverTimeFormatted = `点击校准第 ${nextBeatIndex} 拍: ${hoverTimeFormatted}`;
    tooltipBgColor = 'var(--green-9)';
    hoverLineColor = 'var(--green-9)';
  } else if (isInvalidEndTime) {
    hoverTimeFormatted = '不能选择此结束时间';
    tooltipBgColor = 'var(--red-9)';
    hoverLineColor = 'var(--red-9)';
  } else if (editingTimeField && !editingTimeField.isWord) {
    const fieldName = editingTimeField.field === 'startTime' ? '起始时间' : '结束时间';
    hoverTimeFormatted = `${'点击设置'}${fieldName}: ${hoverTimeFormatted}`;
    tooltipBgColor = 'var(--accent-9)';
  }

  const transformX = isZooming ? scrollLeft : Math.round(scrollLeft);

  const hoverX = scrollLeft + hoverPx;
  const reviewTimingOverlayEnabled = reviewSession !== null && reviewSession.source !== 'update';

  const minGain = 0.5;
  const maxGain = 8;
  const gainPercent = ((gain - minGain) / (maxGain - minGain)) * 100;
  const THUMB_HEIGHT_PX = 13;
  const thumbOffsetPx = (0.5 - gainPercent / 100) * THUMB_HEIGHT_PX;

  const handleSpectrogramMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isSpectrogramTapMode) {
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const clickX = scrollLeft + x;
      const clickTimeSeconds = clickX / zoom;
      triggerTap(clickTimeSeconds);
      return;
    }
    handleContainerMouseDown(event);
  };

  return (
    <div className={styles.spectrogramContainer} style={{ height: `${uiHeight}px` }}>
      <div className={styles.resizeHandle} {...resizeHandleProps} />

      <div className={styles.innerContainer}>
        <div className={`${styles.sidebar} ${styles.leftSidebar}`}>
          <div className="flex h-full w-full flex-col items-center gap-2">
            <div className="flex w-full flex-1 flex-col items-center justify-end py-1">
              <div className={styles.gainSliderContainer} style={{ height: '95%' }}>
                <Slider
                  orientation="vertical"
                  min={minGain}
                  max={maxGain}
                  step={0.5}
                  value={gain}
                  onValueChange={setGain}
                  aria-label="频谱图增益"
                  className="flex-1"
                  style={{ flex: 1, zIndex: 10 }}
                  trackColor="var(--gray-a6)"
                />
                <div
                  className={styles.gainTooltip}
                  style={{
                    bottom: `calc(${gainPercent}% + ${thumbOffsetPx}px)`,
                  }}
                >
                  {gain}x
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.mainContent}>
          {!pcmDataReady ? (
            <div className={styles.emptyState}>
              <div className="flex flex-col items-center gap-3">
                <Music className="size-12 text-ink-3 opacity-50" strokeWidth={1.5} />
                {/**
                 * 审核页不提供「加载本地音频文件」入口 ——
                 * 参考音频来自后端投稿，由 `LyricEditorPage` 注入。
                 */}
                {engineState === 'idle' ? (
                  <span className="text-base text-ink-3">参考音频未就绪，频谱图不可用</span>
                ) : (
                  <span className="text-base text-ink-3">正在解码音频，请稍候...</span>
                )}
              </div>
            </div>
          ) : (
            <>
              <TimelineRuler
                height={30}
                ref={rulerRef}
                zoom={zoom}
                duration={currentDurationMs / 1000}
                containerWidth={containerWidth}
                onSeek={handleRulerSeek}
              />

              {!isDragging && (
                <>
                  <div
                    className={styles.hoverTimeTooltip}
                    style={{
                      left: `${hoverPx}px`,
                      opacity: isHovering ? 1 : 0,
                      backgroundColor: tooltipBgColor,
                    }}
                  >
                    {hoverTimeFormatted}
                  </div>

                  <div
                    className={`${styles.rulerHoverFade} ${styles.rulerHoverFadeLeft}`}
                    style={{
                      width: `${hoverPx}px`,
                      height: `${DEFAULT_RULER_HEIGHT}px`,
                      opacity: isHovering ? 1 : 0,
                    }}
                  />

                  <div
                    className={`${styles.rulerHoverFade} ${styles.rulerHoverFadeRight}`}
                    style={{
                      left: `${hoverPx}px`,
                      height: `${DEFAULT_RULER_HEIGHT}px`,
                      opacity: isHovering ? 1 : 0,
                    }}
                  />
                </>
              )}

              <div
                ref={playheadScrubHandleRef}
                className={styles.playheadScrubHandle}
                style={{
                  display: 'none',
                }}
                onMouseDown={handleScrubStart}
              />

              <div
                ref={scrollContainerRef}
                className={styles.virtualScrollContainer}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                onMouseMove={handleMouseMove}
                onMouseDown={handleSpectrogramMouseDown}
                onContextMenu={(e) => e.preventDefault()}
                role="group"
              >
                <div
                  className={styles.virtualScrollContent}
                  style={{
                    width: `${Math.ceil(totalWidth)}px`,
                    transform: `translate3d(${-transformX}px, 0, 0)`,
                  }}
                >
                  {visibleTiles.map((tile) => (
                    <TileComponent key={tile.tileId} {...tile} />
                  ))}
                  <div ref={playheadCursorRef} className={styles.playheadCursor} />

                  {pendingCursorPosition !== null && (
                    <div
                      className={styles.pendingCursor}
                      style={{
                        left: `${pendingCursorPosition}px`,
                      }}
                    />
                  )}
                  {isAuditioning && (
                    <div ref={auditionCursorRef} className={styles.auditionCursor} />
                  )}
                  {showRangePreview && previewStyle && (
                    <div className={styles.rangePreviewRegion} style={previewStyle} />
                  )}
                  <SpectrogramContext.Provider value={contextValue}>
                    {/* 频谱图恒定深色底（canvas 配色依赖），用 .dark 作用域替代原 <Theme appearance="dark"> */}
                    <div className="dark">
                      {showBeatLines && <BeatLinesOverlay clientWidth={containerWidth} />}
                      {reviewTimingOverlayEnabled ? (
                        <ReviewLyricTimelineOverlay
                          clientWidth={containerWidth}
                          hiddenLineIds={showRangePreview ? selectedLines : null}
                        />
                      ) : (
                        <LyricTimelineOverlay
                          clientWidth={containerWidth}
                          hiddenLineIds={showRangePreview ? selectedLines : null}
                        />
                      )}
                      {!isDragging && (
                        <div
                          className={styles.hoverCursorContainer}
                          style={{
                            left: `${hoverX}px`,
                            opacity: isHovering ? 1 : 0,
                          }}
                        >
                          <div
                            className={styles.hoverCursorLine}
                            style={{ backgroundColor: hoverLineColor }}
                          />
                        </div>
                      )}
                    </div>
                  </SpectrogramContext.Provider>
                </div>
              </div>
            </>
          )}
        </div>

        <div className={`${styles.sidebar} ${styles.rightSidebar}`}>
          <SimpleTooltip label="在频谱图上显示拍子" side="left">
            <Button
              type="button"
              size="icon"
              variant={showBeatLines ? 'default' : 'outline'}
              onClick={() => setShowBeatLines((prev) => !prev)}
            >
              <Timer />
            </Button>
          </SimpleTooltip>
          <SimpleTooltip label="显示未选中行" side="left">
            <Button
              type="button"
              size="icon"
              variant={showUnselectedLines ? 'default' : 'outline'}
              onClick={() => setShowUnselectedLines((prev) => !prev)}
            >
              {showUnselectedLines ? <Eye /> : <EyeOff />}
            </Button>
          </SimpleTooltip>
        </div>
      </div>
    </div>
  );
};

export default AudioSpectrogram;
