import { Box, Button, Flex, Switch, Text, TextArea } from '@radix-ui/themes';
import { useMemo, useRef, useState } from 'react';
import {
  ArrowReset20Regular,
  TextBold20Regular,
  TextHeader120Regular,
  TextHeader220Regular,
  TextHeader320Regular,
  TextItalic20Regular,
  TextLineSpacing20Regular,
} from '@fluentui/react-icons';
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
    <Flex
      direction="column"
      gap="3"
      style={{ flex: '1 1 auto', minHeight: 0, width: '100%', maxWidth: '100%' }}
    >
      {/* 区块列表 + 恢复默认 */}
      <Flex align="center" justify="between" gap="2" style={{ flexShrink: 0 }}>
        <Text size="1" color="gray">
          选择要编辑的区块，模板里用 {'{{变量}}'} 引用内容
        </Text>
        <Button
          size="1"
          variant="soft"
          color="gray"
          onClick={() => onChange(DEFAULT_REVIEW_REPORT_FORMAT)}
        >
          <ArrowReset20Regular />
          恢复默认
        </Button>
      </Flex>

      <Box
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'stretch',
          flex: '1 1 auto',
          minHeight: 0,
          width: '100%',
          maxWidth: '100%',
          overflow: 'hidden',
        }}
      >
        {/* 左：区块列表（独立滚动） */}
        <Flex
          direction="column"
          gap="2"
          style={{
            flex: '0 0 clamp(140px, 22%, 200px)',
            minWidth: 0,
            maxWidth: 200,
            alignSelf: 'stretch',
            overflowY: 'auto',
            overflowX: 'hidden',
            minHeight: 0,
            maxHeight: '100%',
            paddingRight: 2,
          }}
        >
          {reviewReportFormatBlockDefinitions.map((definition) => {
            const selected = selectedDefinition.kind === definition.kind;
            const changed = changedKinds.has(definition.kind);
            return (
              <button
                key={definition.kind}
                type="button"
                onClick={() => setSelectedKind(definition.kind)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 4,
                  width: '100%',
                  minWidth: 0,
                  padding: '8px 10px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  borderRadius: 6,
                  border: `1px solid ${selected ? 'var(--amll-primary)' : 'var(--amll-border)'}`,
                  background: selected
                    ? 'var(--amll-primary-soft)'
                    : changed
                      ? 'var(--amll-muted)'
                      : 'var(--amll-card)',
                  color: 'inherit',
                }}
              >
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    maxWidth: '100%',
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {definition.label}
                  </span>
                  {/*
                   * 「已修改」用显式徽标，而不是在 label 后面加个 `*`。
                   * 星号太弱，用户会以为是标点符号而不是状态。
                   */}
                  {changed && (
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 10,
                        lineHeight: 1.4,
                        fontWeight: 500,
                        padding: '0 5px',
                        borderRadius: 999,
                        background: 'var(--amll-primary)',
                        color: 'var(--amll-primary-foreground)',
                      }}
                    >
                      已改
                    </span>
                  )}
                </span>
                <span
                  style={{
                    maxWidth: '100%',
                    fontSize: 11,
                    lineHeight: 1.4,
                    color: 'var(--amll-muted-foreground)',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {definition.description}
                </span>
              </button>
            );
          })}
        </Flex>

        {/* 右：模板编辑区（独立滚动，宽度不撑破卡片） */}
        <Flex
          direction="column"
          gap="3"
          style={{
            flex: '1 1 auto',
            minWidth: 0,
            maxWidth: '100%',
            alignSelf: 'stretch',
            overflowY: 'auto',
            overflowX: 'hidden',
            minHeight: 0,
            maxHeight: '100%',
            paddingRight: 2,
          }}
        >
          <Flex align="center" justify="between" gap="2" style={{ flexShrink: 0 }}>
            <Text size="2" weight="bold">
              {selectedDefinition.label}
            </Text>
            <Button
              size="1"
              variant="soft"
              color="gray"
              onClick={() => onChange(resetReviewReportBlockFormat(value, selectedDefinition.kind))}
            >
              <ArrowReset20Regular />
              重置此项
            </Button>
          </Flex>

          <TextArea
            ref={templateInputRef}
            value={selectedFormat.template}
            onChange={(e) => updateSelectedFormat({ template: e.currentTarget.value })}
            placeholder="报告条目模板"
            style={{ minHeight: 88, fontFamily: 'monospace' }}
          />

          {/* 工具栏：加粗 / 倾斜 / 大纲 / 换行 */}
          <Flex align="center" gap="1" wrap="wrap">
            <Button
              size="1"
              variant="soft"
              title="加粗"
              aria-label="加粗"
              onClick={() => wrapTemplateSelection('**', '**')}
            >
              <TextBold20Regular />
            </Button>
            <Button
              size="1"
              variant="soft"
              title="倾斜"
              aria-label="倾斜"
              onClick={() => wrapTemplateSelection('_', '_')}
            >
              <TextItalic20Regular />
            </Button>
            <Button
              size="1"
              variant="soft"
              title="一级大纲"
              aria-label="一级大纲"
              onClick={() => applyHeadingLevel(1)}
            >
              <TextHeader120Regular />
            </Button>
            <Button
              size="1"
              variant="soft"
              title="二级大纲"
              aria-label="二级大纲"
              onClick={() => applyHeadingLevel(2)}
            >
              <TextHeader220Regular />
            </Button>
            <Button
              size="1"
              variant="soft"
              title="三级大纲"
              aria-label="三级大纲"
              onClick={() => applyHeadingLevel(3)}
            >
              <TextHeader320Regular />
            </Button>
            <Button
              size="1"
              variant="soft"
              title="插入换行符"
              aria-label="插入换行符"
              onClick={() => insertTemplateText('\n')}
            >
              <TextLineSpacing20Regular />
            </Button>
          </Flex>

          <Flex align="center" gap="2">
            <Switch
              checked={selectedFormat.listItem}
              onCheckedChange={(checked) => updateSelectedFormat({ listItem: checked })}
            />
            <Text size="2">作为 Markdown 列表项输出</Text>
          </Flex>

          {/* 可用变量：点击插入到光标处 */}
          <Flex direction="column" gap="2">
            <Text size="2" weight="medium">
              可用变量
            </Text>
            <Box
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(min(170px, 100%), 1fr))',
                width: '100%',
                maxWidth: '100%',
                overflow: 'hidden',
                gap: 6,
              }}
            >
              {selectedDefinition.variables.map((variable) => (
                <button
                  key={variable.name}
                  type="button"
                  onClick={() => insertVariable(variable.name)}
                  title={`插入 {{${variable.name}}}`}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    minWidth: 0,
                    maxWidth: '100%',
                    overflow: 'hidden',
                    textAlign: 'left',
                    padding: '4px 8px',
                    borderRadius: 4,
                    border: '1px solid var(--amll-border)',
                    background: 'var(--amll-card)',
                    cursor: 'pointer',
                  }}
                >
                  {/*
                   * 变量名/ 标题（label） / 说明（description）分三层显示。
                   *
                   * 之前把 label 和 description 用「：」拼成一行，
                   * 两者都是灰字、长度又接近，扫一眼分不出
                   * 哪个是变量含义、哪个是示例 —— 用户反馈
                   *「变量没有分清标题和介绍」。
                   */}
                  <code
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: 'var(--accent-11)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {'{{'}
                    {variable.name}
                    {'}}'}
                  </code>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--amll-foreground)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {variable.label}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      lineHeight: 1.4,
                      color: 'var(--amll-muted-foreground)',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {variable.description}
                  </span>
                </button>
              ))}
            </Box>
          </Flex>

          {/* 空报告文本 */}
          <Flex direction="column" gap="2">
            <Text size="2" weight="medium">
              空报告文本
            </Text>
            <TextArea
              value={value.emptyText}
              onChange={(e) => onChange({ ...value, emptyText: e.currentTarget.value })}
              style={{ minHeight: 48 }}
            />
          </Flex>

          {/* 实时预览 */}
          <Flex direction="column" gap="2">
            <Text size="2" weight="medium">
              当前报告预览
            </Text>
            <TextArea
              readOnly
              value={renderedPreview}
              style={{ minHeight: 120, fontFamily: 'monospace' }}
            />
          </Flex>
        </Flex>
      </Box>
    </Flex>
  );
};

export default ReportFormatEditor;
