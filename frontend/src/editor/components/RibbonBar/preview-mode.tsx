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

import { useAtom } from 'jotai';
import { forwardRef, useEffect, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  hideObsceneWordsAtom,
  lyricWordFadeWidthAtom,
  showRomanLinesAtom,
  showTranslationLinesAtom,
} from '$/modules/settings/states/preview';
import { RibbonFrame, RibbonSection } from './common';

export const PreviewModeRibbonBar = forwardRef<HTMLDivElement>((_props, ref) => {
  const [showTranslationLine, setShowTranslationLine] = useAtom(showTranslationLinesAtom);
  const [showRomanLine, setShowRomanLine] = useAtom(showRomanLinesAtom);
  const [hideObsceneWords, setHideObsceneWords] = useAtom(hideObsceneWordsAtom);
  const [lyricWordFadeWidth, setLyricWordFadeWidth] = useAtom(lyricWordFadeWidthAtom);
  // 输入框保持本地草稿：外部切预设/重置时同步，输入过程中不被 atom 立即回写打断
  const [fadeInput, setFadeInput] = useState(String(lyricWordFadeWidth));

  useEffect(() => {
    setFadeInput(String(lyricWordFadeWidth));
  }, [lyricWordFadeWidth]);

  return (
    <RibbonFrame ref={ref}>
      <RibbonSection label="歌词">
        <div className="grid flex-1 grid-cols-[auto_auto] items-center gap-x-2 gap-y-1">
          <span className="whitespace-nowrap text-xs">显示翻译</span>
          <Checkbox
            checked={showTranslationLine}
            onCheckedChange={(v) => setShowTranslationLine(!!v)}
          />
          <span className="whitespace-nowrap text-xs">显示音译</span>
          <Checkbox checked={showRomanLine} onCheckedChange={(v) => setShowRomanLine(!!v)} />
          <span className="whitespace-nowrap text-xs">屏蔽不雅用语</span>
          <Checkbox checked={hideObsceneWords} onCheckedChange={(v) => setHideObsceneWords(!!v)} />
        </div>
      </RibbonSection>
      <RibbonSection label="单词">
        <div className="grid flex-1 grid-cols-[auto_auto] items-center gap-x-2 gap-y-1">
          <span className="whitespace-nowrap text-xs">过渡宽度</span>
          <Input
            className="h-7 w-[4em] px-2 text-xs"
            value={fadeInput}
            onChange={(e) => setFadeInput(e.target.value)}
            onBlur={(e) => {
              const value = Number.parseFloat(e.target.value);
              if (Number.isFinite(value)) {
                setLyricWordFadeWidth(value);
              } else {
                setFadeInput(String(lyricWordFadeWidth));
              }
            }}
          />
        </div>
      </RibbonSection>
    </RibbonFrame>
  );
});

export default PreviewModeRibbonBar;
