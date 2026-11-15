import { memo, useEffect, useRef } from 'react';
import { spectrogramLogger } from '../logger';
import styles from './AudioSpectrogram.module.css';

export interface TileComponentProps {
  tileId: string;
  left: number;
  width: number;
  height: number;
  canvasWidth: number;
  bitmap?: ImageBitmap;
}

export const TileComponent = memo(
  ({ tileId, left, width, height, canvasWidth, bitmap }: TileComponentProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
      if (bitmap && canvasRef.current) {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        try {
          if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
          if (canvas.height !== bitmap.height) canvas.height = bitmap.height;

          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(bitmap, 0, 0);
        } catch (e) {
          if ((e as Error).name === 'InvalidStateError') {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
          } else {
            spectrogramLogger.error(`绘制瓦片 ${tileId} 失败:`, e);
          }
        }
      }
      // React 重设 canvas 的 width/height 属性会让浏览器立刻清空画布，
      // 所以尺寸变化也必须重跑绘制，否则瓦片会一直空白到下一张 bitmap 送达。
    }, [bitmap, tileId, canvasWidth, height]);

    return (
      <canvas
        ref={canvasRef}
        id={tileId}
        width={canvasWidth > 0 ? canvasWidth : 1}
        height={height}
        className={styles.tileCanvas}
        style={{
          left: `${left}px`,
          width: `${width}px`,
          backgroundColor: bitmap ? 'transparent' : 'var(--gray-3)',
        }}
      />
    );
  }
);
