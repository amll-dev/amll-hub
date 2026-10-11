import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { AlertCircle, ArrowLeft, Info, RotateCcw, Timer, X } from 'lucide-react';
import { type FC, useCallback, useId, useRef } from 'react';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { KeyBinding } from '$/components/KeyBinding';
import { useBpmControl, useBpmTapEngine } from '$/modules/audio/hooks';
import {
  audioEngineStateAtom,
  bpmStateAtom,
  hasSeenTapWindowTipAtom,
} from '$/modules/audio/states';
import { showBeatLinesAtom } from '$/modules/spectrogram/states';
import { keySyncNextAtom } from '$/states/keybindings';
import { useKeyBindingAtom } from '$/utils/keybindings';

function formatCalculationTime(timeMs: number): string {
  if (timeMs < 1000) {
    return `${Math.round(timeMs)} ms`;
  }
  return `${(timeMs / 1000).toFixed(2)} s`;
}

export const BpmPanel: FC = () => {
  const followRateCheckboxId = useId();
  const showBeatLinesCheckboxId = useId();
  const {
    bpmState,
    currentBpm,
    followPlaybackRate,
    setFollowPlaybackRate,
    isAdjusted,
    halveBpm,
    doubleBpm,
    resetBpm: rawResetBpm,
  } = useBpmControl();

  const {
    setTapMode,
    isKeyTapMode,
    isSpectrogramTapMode,
    tapTimes,
    triggerTap,
    resetTapTimes,
    isHighlighted,
  } = useBpmTapEngine();

  const setBpmState = useSetAtom(bpmStateAtom);
  const engineState = useAtomValue(audioEngineStateAtom);
  const [showBeatLines, setShowBeatLines] = useAtom(showBeatLinesAtom);
  const [hasSeenTapWindowTip, setHasSeenTapWindowTip] = useAtom(hasSeenTapWindowTipAtom);

  const audioLoaded =
    engineState === 'ready' || engineState === 'playing' || engineState === 'paused';

  const initialBpmRef = useRef<typeof bpmState | null>(null);
  if (
    bpmState.status === 'completed' &&
    initialBpmRef.current === null &&
    bpmState.calculationTime > 0
  ) {
    initialBpmRef.current = bpmState;
  }

  const handleResetBpm = useCallback(() => {
    rawResetBpm();
    resetTapTimes();
    if (initialBpmRef.current) {
      setBpmState(initialBpmRef.current);
    }
  }, [rawResetBpm, resetTapTimes, setBpmState]);

  useKeyBindingAtom(
    keySyncNextAtom,
    (evt) => {
      if (!isKeyTapMode) return;
      triggerTap(undefined, evt.downTimeOffset);
    },
    [isKeyTapMode, triggerTap]
  );

  let bpmValueText = '--';
  let durationText = '--';

  if (bpmState.status === 'completed') {
    bpmValueText = `${currentBpm ?? Math.round(bpmState.result.bpm)}`;
    durationText = formatCalculationTime(bpmState.calculationTime);
  } else if (bpmState.status === 'analyzing') {
    bpmValueText = '正在分析';
  }

  const isAnalyzing = bpmState.status === 'analyzing';
  const isCompleted = bpmState.status === 'completed';
  const isModified =
    isAdjusted || tapTimes.length > 0 || (isCompleted && bpmState.calculationTime === 0);

  return (
    <div className="p-4">
      <div className="flex flex-col gap-4">
        <div className="relative flex w-full flex-col items-center gap-1">
          <span className="text-xs font-medium text-ink-3">BPM</span>

          <div className="flex w-full items-center justify-center gap-5">
            <SimpleTooltip label="减半 BPM">
              <Button
                variant="secondary"
                className="h-8 font-mono"
                disabled={!isCompleted}
                onClick={halveBpm}
              >
                ÷2
              </Button>
            </SimpleTooltip>

            <span
              className={`font-mono font-bold tabular-nums ${
                isAnalyzing ? 'text-2xl' : 'text-4xl'
              }`}
            >
              {bpmValueText}
            </span>

            <SimpleTooltip label="加倍 BPM">
              <Button
                variant="secondary"
                className="h-8 font-mono"
                disabled={!isCompleted}
                onClick={doubleBpm}
              >
                ×2
              </Button>
            </SimpleTooltip>
          </div>

          {isCompleted && isModified && (
            <SimpleTooltip label="重置 BPM">
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-0 top-full size-8 -translate-y-1/2"
                onClick={handleResetBpm}
              >
                <RotateCcw className="size-[18px]" />
              </Button>
            </SimpleTooltip>
          )}
        </div>

        <div className="flex items-center justify-center gap-2">
          <Timer className="size-4 text-ink-3" />
          <span className="font-mono text-sm text-ink-3">{durationText}</span>
        </div>

        {bpmState.status === 'error' && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>{bpmState.error}</AlertTitle>
          </Alert>
        )}

        <div className="mt-2 flex items-center gap-2">
          <Checkbox
            id={followRateCheckboxId}
            checked={followPlaybackRate}
            onCheckedChange={(checked) => setFollowPlaybackRate(Boolean(checked))}
          />
          <label htmlFor={followRateCheckboxId} className="cursor-pointer select-none text-sm">
            跟随音频播放倍速
          </label>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id={showBeatLinesCheckboxId}
            checked={showBeatLines}
            onCheckedChange={(checked) => setShowBeatLines(Boolean(checked))}
          />
          <label htmlFor={showBeatLinesCheckboxId} className="cursor-pointer select-none text-sm">
            在频谱图上显示拍子
          </label>
        </div>

        {!hasSeenTapWindowTip && (isKeyTapMode || isSpectrogramTapMode) && (
          <Alert variant="info" className="flex items-center gap-2 px-3 py-2">
            <Info className="size-4 shrink-0" />
            <div className="flex-1 text-xs">只会使用最近 10 次校准数据计算 BPM</div>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0"
              onClick={() => setHasSeenTapWindowTip(true)}
              aria-label="关闭提示"
            >
              <X className="size-3.5" />
            </Button>
          </Alert>
        )}

        {!isKeyTapMode && !isSpectrogramTapMode && (
          <div className="flex flex-col items-start gap-2">
            <Button
              variant="secondary"
              className="h-8 cursor-pointer self-start"
              disabled={!audioLoaded}
              onClick={() => setTapMode('key')}
            >
              手动打拍校准
            </Button>
            <Button
              variant="secondary"
              className="h-8 cursor-pointer self-start"
              disabled={!audioLoaded}
              onClick={() => setTapMode('spectrogram')}
            >
              使用频谱图校准
            </Button>
          </div>
        )}

        {isKeyTapMode && (
          <div className="rounded-lg border border-line bg-card p-3">
            <div className="relative flex flex-col gap-3">
              <div className="flex items-center justify-start">
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute left-0 top-0 size-7 cursor-pointer"
                  onClick={() => {
                    setTapMode('off');
                    resetTapTimes();
                  }}
                  aria-label="返回"
                >
                  <ArrowLeft className="size-4" />
                </Button>

                <div className="flex w-full items-center justify-center px-7">
                  <span
                    className={`cursor-pointer select-none text-center text-sm ${
                      isHighlighted ? 'font-bold text-primary' : 'font-medium'
                    }`}
                    onClick={() => triggerTap()}
                  >
                    根据节拍按下 <KeyBinding kbdAtom={keySyncNextAtom} /> 或点击此处
                  </span>
                </div>
              </div>

              <div className="flex w-full justify-center gap-1">
                {Array.from({ length: 10 }).map((_, index) => (
                  <div
                    key={index}
                    className={`h-1 flex-1 rounded-sm ${
                      index < Math.min(tapTimes.length, 10) ? 'bg-primary' : 'bg-muted'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {isSpectrogramTapMode && (
          <div className="rounded-lg border border-line bg-card p-3">
            <div className="relative flex flex-col gap-3">
              <div className="flex items-center justify-start">
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute left-0 top-0 size-7 cursor-pointer"
                  onClick={() => {
                    setTapMode('off');
                    resetTapTimes();
                  }}
                  aria-label="返回"
                >
                  <ArrowLeft className="size-4" />
                </Button>

                <div className="flex w-full items-center justify-center px-7">
                  <span
                    className={`select-none text-center text-sm ${
                      isHighlighted ? 'font-bold text-primary' : 'font-medium'
                    }`}
                  >
                    在频谱图上点击以校准
                  </span>
                </div>
              </div>

              <div className="flex w-full justify-center gap-1">
                {Array.from({ length: 10 }).map((_, index) => (
                  <div
                    key={index}
                    className={`h-1 flex-1 rounded-sm ${
                      index < Math.min(tapTimes.length, 10) ? 'bg-primary' : 'bg-muted'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BpmPanel;
