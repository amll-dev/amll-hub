/*
 * Copyright 2023-2025 Steve Xiao (stevexmh@qq.com) and contributors.
 *
 * 本源代码文件是属于 AMLL TTML Tool 项目的一部分。
 * This source code file is a part of AMLL TTML Tool project.
 * 本项目的源代码的使用受到 GNU GENERAL PUBLIC LICENSE version 3 许可证的约束，具体可以参阅以下链接。
 * Use of this source code is governed by the GNU GPLv3 license that can be found through the following link.
 *
 * https://github.com/amll-dev/amll-ttml-tool/blob/main/LICENSE
 */

import { useCurrentLocation } from '$/modules/lyric-editor/utils/lyric-states.ts';
import {
  displayRomanizationInSyncAtom,
  highlightActiveWordAtom,
  highlightErrorsAtom,
  showTimestampsAtom,
  showWordRomanizationInputAtom,
} from '$/modules/settings/states/index.ts';
import {
  currentEmptyBeatAtom,
  showTouchSyncPanelAtom,
  syncNextDualModeAtom,
  syncTimeOffsetAtom,
  visualizeTimestampUpdateAtom,
} from '$/modules/settings/states/sync.ts';
import {
  keySyncEndAtom,
  keySyncNextAltAtom,
  keySyncNextAtom,
  keySyncStartAtom,
} from '$/states/keybindings.ts';
import { bgLyricIgnoreSyncAtom, lyricLinesAtom } from '$/states/main.ts';
import { useAtom, useAtomValue } from 'jotai';
import { useSetImmerAtom } from 'jotai-immer';
import { type FC, forwardRef } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Slider } from '@/components/ui/slider';
import { formatKeyBindings } from '$/utils/keybindings.ts';
import { KeyBinding } from '../KeyBinding/index.tsx';
import { RibbonFrame, RibbonSection } from './common';

const EmptyBeatField = () => {
  const [currentEmptyBeat, setCurrentEmptyBeat] = useAtom(currentEmptyBeatAtom);
  const currentWordEmptyBeat = useCurrentLocation()?.word.emptyBeat || 0;

  return (
    <>
      <span className="whitespace-nowrap text-xs">当前空拍</span>
      <Slider
        value={currentEmptyBeat}
        onValueChange={setCurrentEmptyBeat}
        min={0}
        max={currentWordEmptyBeat}
        step={1}
        disabled={currentWordEmptyBeat === 0}
      />
      <div />
      <span className="whitespace-nowrap text-center text-xs">
        {currentEmptyBeat} / {currentWordEmptyBeat}
      </span>
    </>
  );
};

export const SyncModeRibbonBar: FC = forwardRef<HTMLDivElement>((_props, ref) => {
  const [visualizeTimestampUpdate, setVisualizeTimestampUpdate] = useAtom(
    visualizeTimestampUpdateAtom
  );
  const [showTouchSyncPanel, setShowTouchSyncPanel] = useAtom(showTouchSyncPanelAtom);
  const [showTimestamps, setShowTimestamps] = useAtom(showTimestampsAtom);
  const [highlightErrors, setHighlightErrors] = useAtom(highlightErrorsAtom);
  const [highlightActiveWord, setHighlightActiveWord] = useAtom(highlightActiveWordAtom);
  const [displayRomanizationInSync, setdisplayRomanizationInSync] = useAtom(
    displayRomanizationInSyncAtom
  );
  const [bgLyricIgnoreSync, setBgLyricIgnoreSync] = useAtom(bgLyricIgnoreSyncAtom);
  const editLyricLines = useSetImmerAtom(lyricLinesAtom);
  const showWordRomanizationInput = useAtomValue(showWordRomanizationInputAtom);
  const [syncTimeOffset, setSyncTimeOffset] = useAtom(syncTimeOffsetAtom);
  const syncNextDualMode = useAtomValue(syncNextDualModeAtom);
  const syncNextAltKeys = useAtomValue(keySyncNextAltAtom);

  return (
    <RibbonFrame ref={ref}>
      <RibbonSection label="打轴调整">
        <div className="grid flex-1 grid-cols-[auto_auto] items-center gap-x-4 gap-y-1">
          <span className="whitespace-nowrap text-xs">时间戳位移</span>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              step={1}
              className="h-7 w-[8em] px-2 text-xs"
              value={syncTimeOffset}
              onChange={(e) => setSyncTimeOffset(e.target.valueAsNumber)}
            />
            <span className="text-xs text-ink-3">ms</span>
          </div>
          <EmptyBeatField />
        </div>
      </RibbonSection>
      <RibbonSection label="辅助设置">
        <div className="grid flex-1 grid-cols-[auto_auto] items-center gap-x-2 gap-y-1">
          <span className="whitespace-nowrap text-xs">呈现时间戳更新</span>
          <Checkbox
            checked={visualizeTimestampUpdate}
            onCheckedChange={(v) => setVisualizeTimestampUpdate(!!v)}
          />
          <span className="whitespace-nowrap text-xs">触控打轴辅助面板</span>
          <Checkbox
            checked={showTouchSyncPanel}
            onCheckedChange={(v) => setShowTouchSyncPanel(!!v)}
          />
          <span className="whitespace-nowrap text-xs">背景歌词忽略打轴</span>
          <Checkbox
            checked={bgLyricIgnoreSync}
            onCheckedChange={(v) => {
              const next = !!v;
              setBgLyricIgnoreSync(next);
              editLyricLines((state) => {
                for (const line of state.lyricLines) {
                  if (line.isBG) {
                    line.ignoreSync = next;
                  }
                }
                return state;
              });
            }}
          />
        </div>
      </RibbonSection>
      <RibbonSection label="显示选项">
        <div className="grid flex-1 grid-cols-[auto_auto] items-center gap-x-2 gap-y-1">
          <span className="whitespace-nowrap text-xs">显示时间戳</span>
          <Checkbox checked={showTimestamps} onCheckedChange={(v) => setShowTimestamps(!!v)} />
          <span className="whitespace-nowrap text-xs">高亮当前音节</span>
          <Checkbox
            checked={highlightActiveWord}
            onCheckedChange={(v) => setHighlightActiveWord(!!v)}
          />
          <span className="whitespace-nowrap text-xs">高亮错误</span>
          <Checkbox checked={highlightErrors} onCheckedChange={(v) => setHighlightErrors(!!v)} />
          {showWordRomanizationInput && (
            <>
              <span className="whitespace-nowrap text-xs">显示逐字音译</span>
              <Checkbox
                checked={displayRomanizationInSync}
                onCheckedChange={(v) => setdisplayRomanizationInSync(!!v)}
              />
            </>
          )}
        </div>
      </RibbonSection>
      <RibbonSection label="打轴键位速查">
        <div className="flex gap-4">
          <div className="grid flex-1 grid-cols-[auto_auto] items-center justify-center gap-x-4 gap-y-1">
            <span className="whitespace-nowrap text-xs">起始轴</span>
            <KeyBinding kbdAtom={keySyncStartAtom} />
            <span className="whitespace-nowrap text-xs">连续轴</span>
            <div className="flex items-center gap-2">
              <KeyBinding kbdAtom={keySyncNextAtom} />
              {syncNextDualMode ? <Kbd>{formatKeyBindings(syncNextAltKeys)}</Kbd> : null}
            </div>
            <span className="whitespace-nowrap text-xs">结束轴</span>
            <KeyBinding kbdAtom={keySyncEndAtom} />
          </div>
        </div>
      </RibbonSection>
    </RibbonFrame>
  );
});

export default SyncModeRibbonBar;
