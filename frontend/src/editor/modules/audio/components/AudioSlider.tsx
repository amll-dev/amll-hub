import { Card } from '@radix-ui/themes';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { audioEngine } from '$/modules/audio/audio-engine';
import { audioEngineStateAtom, currentDurationAtom } from '$/modules/audio/states';
import { lyricLinesAtom, selectedLinesAtom } from '$/states/main';
import { useHoverGuide } from '../hooks';
import { useWaveformAnalyzer } from '../hooks/useWaveformAnalyzer';
import { AudioRegion } from './AudioRegion';
import styles from './AudioSlider.module.css';
import { HoverGuide } from './HoverGuide';

export const AudioSlider = () => {
  const currentDuration = useAtomValue(currentDurationAtom);
  const engineState = useAtomValue(audioEngineStateAtom);
  const lyricLines = useAtomValue(lyricLinesAtom);
  const selectedLines = useAtomValue(selectedLinesAtom);

  const wsContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const maskRef = useRef<HTMLDivElement>(null);

  const isScrubbingRef = useRef(false);
  const scrubProgressRef = useRef(0);
  const [sliderWidthPx, setSliderWidthPx] = useState(0);

  const { hoverState, handleContainerMouseMove, handleContainerMouseLeave, isDraggingRef } =
    useHoverGuide(sliderWidthPx);

  useWaveformAnalyzer({
    wsContainerRef,
    canvasRef,
    sliderWidthPx,
    engineState,
  });

  useEffect(() => {
    const container = wsContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        setSliderWidthPx(entries[0].contentRect.width);
      }
    });
    observer.observe(container);
    setSliderWidthPx(container.clientWidth);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let rafId: number;
    const renderCursor = () => {
      if (currentDuration > 0 && cursorRef.current && sliderWidthPx > 0) {
        // 两个分支都会赋值，初值 0 永远读不到（no-useless-assignment）
        let progress: number;

        if (isScrubbingRef.current) {
          progress = scrubProgressRef.current;
        } else {
          progress = audioEngine.musicCurrentTime / (currentDuration / 1000);
        }

        const xPos = progress * sliderWidthPx;
        cursorRef.current.style.transform = `translateX(${xPos}px)`;

        if (maskRef.current) {
          maskRef.current.style.transform = `scaleX(${progress})`;
        }
      }
      rafId = requestAnimationFrame(renderCursor);
    };
    rafId = requestAnimationFrame(renderCursor);
    return () => cancelAnimationFrame(rafId);
  }, [currentDuration, sliderWidthPx]);

  const selectedRegions = useMemo(() => {
    if (currentDuration <= 0 || sliderWidthPx <= 0) return [];

    const pixelsPerMs = sliderWidthPx / currentDuration;
    const regions: { id: string; left: number; width: number }[] = [];

    for (const line of lyricLines.lyricLines) {
      if (selectedLines.has(line.id)) {
        const left = line.startTime * pixelsPerMs;
        const width = (line.endTime - line.startTime) * pixelsPerMs;
        regions.push({ id: line.id, left, width });
      }
    }
    return regions;
  }, [lyricLines.lyricLines, selectedLines, currentDuration, sliderWidthPx]);

  const handleTimelineMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (currentDuration <= 0 || sliderWidthPx <= 0) return;
      if (isDraggingRef.current) return;

      const rect = e.currentTarget.getBoundingClientRect();

      const calculateProgress = (clientX: number) => {
        const x = clientX - rect.left;
        return Math.max(0, Math.min(x / rect.width, 1));
      };

      isScrubbingRef.current = true;
      scrubProgressRef.current = calculateProgress(e.clientX);

      const handleScrubMove = (moveEvent: MouseEvent) => {
        scrubProgressRef.current = calculateProgress(moveEvent.clientX);
      };

      const handleScrubUp = (upEvent: MouseEvent) => {
        isScrubbingRef.current = false;
        const finalProgress = calculateProgress(upEvent.clientX);
        audioEngine.seekMusic((finalProgress * currentDuration) / 1000);

        window.removeEventListener('mousemove', handleScrubMove);
        window.removeEventListener('mouseup', handleScrubUp);
      };

      window.addEventListener('mousemove', handleScrubMove);
      window.addEventListener('mouseup', handleScrubUp);
    },
    [currentDuration, sliderWidthPx, isDraggingRef]
  );

  return (
    <Card
      style={{
        alignSelf: 'center',
        width: '100%',
        height: '2.5em',
        padding: '0',
      }}
    >
      <section
        className={styles.waveformContainer}
        aria-label="Audio Waveform"
        ref={wsContainerRef}
        onMouseMove={handleContainerMouseMove}
        onMouseLeave={handleContainerMouseLeave}
        onMouseDown={handleTimelineMouseDown}
      >
        <canvas ref={canvasRef} className={styles.waveformCanvas} />

        <HoverGuide hoverState={hoverState} />

        {selectedRegions.map((region) => (
          <div
            key={region.id}
            className={styles.selectedLyricRegion}
            style={{
              left: `${region.left}px`,
              width: `${region.width}px`,
            }}
          />
        ))}

        {currentDuration > 0 && (
          <>
            <div ref={maskRef} className={styles.playbackMask} />
            <div ref={cursorRef} className={styles.playbackCursor} />
          </>
        )}

        <AudioRegion
          sliderWidthPx={sliderWidthPx}
          containerRef={wsContainerRef}
          isDraggingRef={isDraggingRef}
        />
      </section>
    </Card>
  );
};
