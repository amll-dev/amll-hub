import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';

export const DEFAULT_RULER_HEIGHT = 30;

export interface TimelineRulerHandle {
  draw: (scrollLeft: number) => void;
}

const TICK_INTERVALS = [0.05, 0.1, 0.2, 0.5, 1, 2, 4, 8, 15, 30, 60, 120, 240, 480, 900, 1800];

interface TimelineRulerProps {
  zoom: number;
  duration: number;
  containerWidth: number;
  height?: number;
  onSeek: (timeInSeconds: number) => void;
}

function getTickInterval(zoom: number) {
  const minPxPerTick = 65;
  const minSecondsPerTick = minPxPerTick / zoom;
  const majorInterval =
    TICK_INTERVALS.find((i) => i >= minSecondsPerTick) || TICK_INTERVALS[TICK_INTERVALS.length - 1];
  return {
    major: majorInterval,
    minor: majorInterval / (majorInterval > 2 ? 5 : 2),
  };
}

/*
 * 刻度尺专用的**短格式**时间标签（`5.000` / `05.000` / `1:05.000`）。
 *
 * 故意不复用 `@/lib/format` 的 `msToTimestamp`：那个在不足 1 分钟时
 * 固定输出 `00:05.000`（补零），而刻度尺要的是尽量短、且不补零，
 * 否则密集刻度上的标签会互相挤占。
 *
 * 两者对 >= 1 小时的输出格式一致（`h:mm:ss.SSS`）。
 */
function msToTimestamp(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms));
  const milliseconds = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  const msStr = String(milliseconds).padStart(3, '0');

  if (hours > 0) {
    const mStr = String(minutes).padStart(2, '0');
    const sStr = String(seconds).padStart(2, '0');
    return `${hours}:${mStr}:${sStr}.${msStr}`;
  }

  if (minutes > 0) {
    const sStr = String(seconds).padStart(2, '0');
    return `${minutes}:${sStr}.${msStr}`;
  }

  return `${seconds}.${msStr}`;
}

export const TimelineRuler = forwardRef<TimelineRulerHandle, TimelineRulerProps>(
  ({ zoom, duration, containerWidth, height = DEFAULT_RULER_HEIGHT, onSeek }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const lastScrollLeft = useRef(0);

    const drawRuler = useCallback(
      (scrollLeft: number) => {
        lastScrollLeft.current = scrollLeft;
        const canvas = canvasRef.current;
        if (!canvas || containerWidth === 0) return;

        const dpr = window.devicePixelRatio || 1;
        const canvasWidth = containerWidth * dpr;
        const canvasHeight = height * dpr;

        if (canvas.width !== canvasWidth) canvas.width = canvasWidth;
        if (canvas.height !== canvasHeight) canvas.height = canvasHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, containerWidth, height);

        const styles = getComputedStyle(canvas);
        const textColor = styles.getPropertyValue('--gray-11').trim();
        const lineColor = styles.getPropertyValue('--gray-9').trim();
        const fontFamily =
          styles.getPropertyValue('--default-font-family-mono').trim() || 'monospace';

        ctx.fillStyle = textColor;
        ctx.strokeStyle = lineColor;
        ctx.textAlign = 'center';
        ctx.font = `12px ${fontFamily}`;

        const { major, minor } = getTickInterval(zoom);

        const startTime = scrollLeft / zoom;
        const endTime = (scrollLeft + containerWidth) / zoom;
        const firstMajorTick = Math.ceil(startTime / major) * major;

        ctx.beginPath();
        const firstMinorTick = Math.ceil(startTime / minor) * minor;
        for (let time = firstMinorTick; time <= endTime; time += minor) {
          const x = time * zoom - scrollLeft;
          ctx.moveTo(x, height - 5);
          ctx.lineTo(x, height);
        }
        ctx.stroke();

        ctx.beginPath();
        for (let time = firstMajorTick; time <= endTime; time += major) {
          if (time < 0 || time > duration) continue;
          const x = time * zoom - scrollLeft;

          ctx.moveTo(x, height - 10);
          ctx.lineTo(x, height);

          const label = msToTimestamp(time * 1000);
          ctx.fillText(label, x, height - 12);
        }
        ctx.stroke();
      },
      [containerWidth, duration, height, zoom]
    );

    useImperativeHandle(
      ref,
      () => ({
        draw(scrollLeft: number) {
          drawRuler(scrollLeft);
        },
      }),
      [drawRuler]
    );

    useEffect(() => {
      drawRuler(lastScrollLeft.current);
    }, [drawRuler]);

    const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const scrollLeft = lastScrollLeft.current;

      const timeInSeconds = (scrollLeft + clickX) / zoom;

      if (timeInSeconds >= 0 && timeInSeconds <= duration) {
        onSeek(timeInSeconds);
      }
    };

    return (
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: `${height}px`,
          backgroundColor: 'var(--white-3)',
        }}
        onClick={handleClick}
        onContextMenu={(e) => e.preventDefault()}
      />
    );
  }
);
