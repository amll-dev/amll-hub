import { RotateCcw, Bold, Italic, Heading1, Heading2, Heading3, AlignJustify } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  DEFAULT_REVIEW_REPORT_FORMAT,
  resetReviewReportBlockFormat,
  reviewReportFormatBlockDefinitions,
  updateReviewReportBlockFormat,
  type ReviewReportBlockKind,
  type ReviewReportFormat,
} from '$/modules/review/services/report-service/format-service';
import type { ReviewReport } from '$/modules/review/services/report-service/types';
import { renderReviewReport } from '$/modules/review/services/report-service/render-service';

export type ReportFormatEditorProps = {
  /** 当前格式（受控）。 */
  value: ReviewReportFormat;
  onChange: (v: ReviewReportFormat) => void;
  /** 用于实时预览的报告。 */
  report: ReviewReport;
};

export const ReportFormatEditor = ({ value, onChange, report }: ReportFormatEditorProps) => {
  const templateInputRef = useRef<HTMLTextAreaElement>(null);
  const [selectedKind, setSelectedKind] = useState<ReviewReportBlockKind>('wordText');
  const changedKinds = useMemo(
    () =>
      new Set(
        reviewReportFormatBlockDefinitions
          .filter(
            (d) =>
              value.blocks[d.kind].template !==
                DEFAULT_REVIEW_REPORT_FORMAT.blocks[d.kind].template ||
              value.blocks[d.kind].listItem !== DEFAULT_REVIEW_REPORT_FORMAT.blocks[d.kind].listItem
          )
          .map((d) => d.kind)
      ),
    [value]
  );

  // 定义表是代码内固定常量，至少有一项；空数组只可能来自外部数据异常。
  const selectedDefinition =
    reviewReportFormatBlockDefinitions.find((d) => d.kind === selectedKind) ??
    reviewReportFormatBlockDefinitions[0]!;
  const selectedFormat = value.blocks[selectedDefinition.kind];

  const renderedPreview = useMemo(() => renderReviewReport(report, value), [report, value]);

  const updateSelectedFormat = (patch: Partial<(typeof value.blocks)[ReviewReportBlockKind]>) => {
    onChange(updateReviewReportBlockFormat(value, selectedDefinition.kind, patch));
  };

  /** 读出模板编辑框当前的选区，工具栏按钮都基于它工作。 */
  const getTemplateSelection = () => {
    const input = templateInputRef.current;
    const template = selectedFormat.template;
    const start = input?.selectionStart ?? template.length;
    const end = input?.selectionEnd ?? start;
    return { template, start, end };
  };

  const replaceTemplateRange = (
    nextTemplate: string,
    selectionStart: number,
    selectionEnd = selectionStart,
    patch: Partial<(typeof value.blocks)[ReviewReportBlockKind]> = {}
  ) => {
    updateSelectedFormat({ ...patch, template: nextTemplate });
    window.requestAnimationFrame(() => {
      templateInputRef.current?.focus();
      templateInputRef.current?.setSelectionRange(selectionStart, selectionEnd);
    });
  };

  const insertTemplateText = (text: string) => {
    const { template, start, end } = getTemplateSelection();
    replaceTemplateRange(
      `${template.slice(0, start)}${text}${template.slice(end)}`,
      start + text.length
    );
  };

  /** 给选区套上前后缀（加粗 `**`、倾斜 `_`）。 */
  const wrapTemplateSelection = (prefix: string, suffix: string) => {
    const { template, start, end } = getTemplateSelection();
    const selectedText = template.slice(start, end);
    const nextTemplate = `${template.slice(0, start)}${prefix}${selectedText}${suffix}${template.slice(end)}`;
    const nextStart = start + prefix.length;
    replaceTemplateRange(nextTemplate, nextStart, nextStart + selectedText.length);
  };

  /**
   * 施加大纲级别。
   *
   * 没有选区时作用于**当前行**（从行首到行尾），有选区时作用于所选行。
   * 顺带把已有的 `#` 前缀剥掉，避免出现 `## # 标题` 这种叠加。
   * 同时强制关掉 `listItem` —— 标题和列表项语义冲突。
   */
  const applyHeadingLevel = (level: 1 | 2 | 3) => {
    const { template, start, end } = getTemplateSelection();
    const prefix = `${'#'.repeat(level)} `;
    const lineStart = template.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const currentLineEnd = template.indexOf('\n', start);
    const rangeEnd = end > start ? end : currentLineEnd === -1 ? template.length : currentLineEnd;
    const nextLines = template
      .slice(lineStart, rangeEnd)
      .split('\n')
      .map((line) => `${prefix}${line.replace(/^#{1,6}\s*/, '')}`)
      .join('\n');
    replaceTemplateRange(
      `${template.slice(0, lineStart)}${nextLines}${template.slice(rangeEnd)}`,
      lineStart + prefix.length,
      lineStart + nextLines.length,
      { listItem: false }
    );
  };

  const insertVariable = (name: string) => insertTemplateText(`{{${name}}}`);

  return (
    <div className="flex w-full max-w-full min-h-0 flex-1 flex-col gap-3">
      {/* 区块列表 + 恢复默认 */}
      <div className="flex shrink-0 items-center justify-between gap-2">
        <span className="text-xs text-ink-3">选择要编辑的区块，模板里用 {'{{变量}}'} 引用内容</span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onChange(DEFAULT_REVIEW_REPORT_FORMAT)}
        >
          <RotateCcw />
          恢复默认
        </Button>
      </div>

      <div className="flex w-full max-w-full min-h-0 flex-1 items-stretch gap-3 overflow-hidden">
        {/* 左：区块列表（独立滚动） */}
        <div className="flex min-h-0 max-h-full max-w-[200px] min-w-0 shrink-0 grow-0 basis-[clamp(140px,22%,200px)] flex-col gap-2 self-stretch overflow-x-hidden overflow-y-auto pr-0.5">
          {reviewReportFormatBlockDefinitions.map((definition) => {
            const selected = selectedDefinition.kind === definition.kind;
            const changed = changedKinds.has(definition.kind);
            return (
              <button
                key={definition.kind}
                type="button"
                onClick={() => setSelectedKind(definition.kind)}
                className={`flex w-full min-w-0 cursor-pointer flex-col items-start gap-1 rounded-md border px-2.5 py-2 text-left text-inherit transition-colors ${
                  selected
                    ? 'border-primary bg-primary-soft'
                    : changed
                      ? 'border-line bg-muted'
                      : 'border-line bg-card hover:bg-surface-2'
                }`}
              >
                <span className="flex max-w-full items-center gap-1.5 text-[13px] font-semibold">
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                    {definition.label}
                  </span>
                  {/*
                   * 「已修改」用显式徽标，而不是在 label 后面加个 `*`。
                   * 星号太弱，用户会以为是标点符号而不是状态。
                   */}
                  {changed && (
                    <span className="shrink-0 rounded-full bg-primary px-1.5 text-[10px] leading-[1.4] font-medium text-primary-foreground">
                      已改
                    </span>
                  )}
                </span>
                <span className="line-clamp-2 max-w-full text-[11px] leading-[1.4] text-muted-foreground">
                  {definition.description}
                </span>
              </button>
            );
          })}
        </div>

        {/* 右：模板编辑区（独立滚动，宽度不撑破卡片） */}
        <div className="flex min-h-0 max-h-full max-w-full min-w-0 flex-1 flex-col gap-3 self-stretch overflow-x-hidden overflow-y-auto pr-0.5">
          <div className="flex shrink-0 items-center justify-between gap-2">
            <span className="text-sm font-bold text-foreground">{selectedDefinition.label}</span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onChange(resetReviewReportBlockFormat(value, selectedDefinition.kind))}
            >
              <RotateCcw />
              重置此项
            </Button>
          </div>

          <Textarea
            ref={templateInputRef}
            value={selectedFormat.template}
            onChange={(e) => updateSelectedFormat({ template: e.currentTarget.value })}
            placeholder="报告条目模板"
            className="min-h-[88px] font-mono"
          />

          {/* 工具栏：加粗 / 倾斜 / 大纲 / 换行 */}
          <div className="flex flex-wrap items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              title="加粗"
              aria-label="加粗"
              onClick={() => wrapTemplateSelection('**', '**')}
            >
              <Bold />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              title="倾斜"
              aria-label="倾斜"
              onClick={() => wrapTemplateSelection('_', '_')}
            >
              <Italic />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              title="一级大纲"
              aria-label="一级大纲"
              onClick={() => applyHeadingLevel(1)}
            >
              <Heading1 />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              title="二级大纲"
              aria-label="二级大纲"
              onClick={() => applyHeadingLevel(2)}
            >
              <Heading2 />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              title="三级大纲"
              aria-label="三级大纲"
              onClick={() => applyHeadingLevel(3)}
            >
              <Heading3 />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              title="插入换行符"
              aria-label="插入换行符"
              onClick={() => insertTemplateText('\n')}
            >
              <AlignJustify />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={selectedFormat.listItem}
              onCheckedChange={(checked) => updateSelectedFormat({ listItem: checked })}
            />
            <span className="text-sm text-foreground">作为 Markdown 列表项输出</span>
          </div>

          {/* 可用变量：点击插入到光标处 */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-foreground">可用变量</span>
            <div className="grid w-full max-w-full grid-cols-[repeat(auto-fill,minmax(min(170px,100%),1fr))] gap-1.5 overflow-hidden">
              {selectedDefinition.variables.map((variable) => (
                <button
                  key={variable.name}
                  type="button"
                  onClick={() => insertVariable(variable.name)}
                  title={`插入 {{${variable.name}}}`}
                  className="flex max-w-full min-w-0 cursor-pointer flex-col gap-0.5 overflow-hidden rounded border border-line bg-card px-2 py-1 text-left transition-colors hover:bg-surface-2"
                >
                  {/*
                   * 变量名/ 标题（label） / 说明（description）分三层显示。
                   *
                   * 之前把 label 和 description 用「：」拼成一行，
                   * 两者都是灰字、长度又接近，扫一眼分不出
                   * 哪个是变量含义、哪个是示例 —— 用户反馈
                   *「变量没有分清标题和介绍」。
                   */}
                  <code className="overflow-hidden text-xs font-bold text-ellipsis whitespace-nowrap text-primary">
                    {'{{'}
                    {variable.name}
                    {'}}'}
                  </code>
                  <span className="overflow-hidden text-xs font-semibold text-ellipsis whitespace-nowrap text-foreground">
                    {variable.label}
                  </span>
                  <span className="line-clamp-2 text-[11px] leading-[1.4] text-muted-foreground">
                    {variable.description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 空报告文本 */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-foreground">空报告文本</span>
            <Textarea
              value={value.emptyText}
              onChange={(e) => onChange({ ...value, emptyText: e.currentTarget.value })}
              className="min-h-12"
            />
          </div>

          {/* 实时预览 */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-foreground">当前报告预览</span>
            <Textarea readOnly value={renderedPreview} className="min-h-[120px] font-mono" />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReportFormatEditor;
