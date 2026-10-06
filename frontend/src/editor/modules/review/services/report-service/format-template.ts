import type { ReviewReportBlock } from './types';

export const DEFAULT_REVIEW_REPORT_EMPTY_TEXT = '未检测到差异。';

export type ReviewReportBlockKind = ReviewReportBlock['kind'];

export type ReviewReportBlockFormat = {
  template: string;
  listItem: boolean;
};

export type ReviewReportFormat = {
  version: 1;
  emptyText: string;
  blocks: Record<ReviewReportBlockKind, ReviewReportBlockFormat>;
};

export type ReviewReportFormatVariable = {
  name: string;
  label: string;
  description: string;
};

export type ReviewReportFormatBlockDefinition = {
  kind: ReviewReportBlockKind;
  label: string;
  description: string;
  variables: ReviewReportFormatVariable[];
};

const commonLineVariables: ReviewReportFormatVariable[] = [
  {
    name: 'lineLabel',
    label: '行标签',
    description: '例如：第 3 行、第 3 行（背景）',
  },
  {
    name: 'lineNumber',
    label: '行号',
    description: '当前条目对应的显示行号',
  },
  {
    name: 'isBackground',
    label: '背景行',
    description: '背景歌词为 true，否则为 false',
  },
  {
    name: 'backgroundLabel',
    label: '背景标记',
    description: '背景歌词时输出（背景），否则为空',
  },
];

const wordChangeVariables: ReviewReportFormatVariable[] = [
  { name: 'oldWord', label: '原词', description: '修改前的逐字歌词' },
  { name: 'newWord', label: '新词', description: '修改后的逐字歌词' },
];

const romanChangeVariables: ReviewReportFormatVariable[] = [
  { name: 'oldRoman', label: '原音译', description: '修改前的逐字音译' },
  { name: 'newRoman', label: '新音译', description: '修改后的逐字音译' },
];

const lineTextVariables: ReviewReportFormatVariable[] = [
  { name: 'oldText', label: '原文本', description: '修改前的整行文本' },
  { name: 'newText', label: '新文本', description: '修改后的整行文本' },
];

export const reviewReportFormatBlockDefinitions: ReviewReportFormatBlockDefinition[] = [
  {
    kind: 'wordTextShared',
    label: '跨行原文修正',
    description: '同一原文修正出现在多行时使用',
    variables: [
      {
        name: 'lineLabels',
        label: '行标签列表',
        description: '去重排序后的行标签，例如：第 1 行、第 3 行',
      },
      ...wordChangeVariables,
    ],
  },
  {
    kind: 'wordTextGroup',
    label: '同行多处原文修正',
    description: '同一行存在多个逐字原文修正时使用',
    variables: [
      ...commonLineVariables,
      {
        name: 'oldWords',
        label: '原词列表',
        description: '修改前词语，以顿号连接',
      },
      {
        name: 'newWords',
        label: '新词列表',
        description: '修改后词语，以顿号连接',
      },
      {
        name: 'oldWordsCode',
        label: '原词代码列表',
        description: '每个原词带 Markdown 行内代码标记',
      },
      {
        name: 'newWordsCode',
        label: '新词代码列表',
        description: '每个新词带 Markdown 行内代码标记',
      },
    ],
  },
  {
    kind: 'wordText',
    label: '单个原文修正',
    description: '单个逐字原文修正时使用',
    variables: [...commonLineVariables, ...wordChangeVariables],
  },
  {
    kind: 'wordRoman',
    label: '逐字音译修正',
    description: '仅逐字音译变化时使用',
    variables: [
      ...commonLineVariables,
      { name: 'word', label: '歌词词', description: '当前逐字歌词' },
      ...romanChangeVariables,
    ],
  },
  {
    kind: 'lineTranslation',
    label: '翻译修正',
    description: '整行翻译变化时使用',
    variables: [...commonLineVariables, ...lineTextVariables],
  },
  {
    kind: 'lineRoman',
    label: '整行音译修正',
    description: '整行音译变化时使用',
    variables: [...commonLineVariables, ...lineTextVariables],
  },
  {
    kind: 'wordAndRoman',
    label: '原文与音译修正',
    description: '同一个词的原文和逐字音译都变化时使用',
    variables: [...commonLineVariables, ...wordChangeVariables, ...romanChangeVariables],
  },
  {
    kind: 'wordAdded',
    label: '新增词',
    description: '逐字歌词中新增词语时使用',
    variables: [
      ...commonLineVariables,
      { name: 'word', label: '新增词', description: '新增的逐字歌词' },
    ],
  },
  {
    kind: 'wordRemoved',
    label: '删除词',
    description: '逐字歌词中删除词语时使用',
    variables: [
      ...commonLineVariables,
      { name: 'word', label: '删除词', description: '删除的逐字歌词' },
    ],
  },
  {
    kind: 'lineAdded',
    label: '新增歌词行',
    description: '新增整行歌词时使用',
    variables: [
      ...commonLineVariables,
      { name: 'text', label: '新增文本', description: '新增的整行歌词' },
    ],
  },
  {
    kind: 'lineRemoved',
    label: '删除歌词行',
    description: '删除整行歌词时使用',
    variables: [
      ...commonLineVariables,
      { name: 'text', label: '删除文本', description: '删除的整行歌词' },
    ],
  },
  {
    kind: 'timeShift',
    label: '时轴平移',
    description: '全局或局部歌词时间整体平移时使用',
    variables: [
      {
        name: 'scopeLabel',
        label: '范围标签',
        description: '全部歌词行，或目标行号列表',
      },
      {
        name: 'lineLabels',
        label: '行标签列表',
        description: '目标行标签列表',
      },
      { name: 'offset', label: '偏移量', description: '带符号毫秒偏移量' },
      {
        name: 'absoluteOffset',
        label: '绝对偏移量',
        description: '不带符号的毫秒偏移量',
      },
      {
        name: 'direction',
        label: '方向',
        description: '提前或延后',
      },
      {
        name: 'targetCount',
        label: '目标行数',
        description: '本次平移影响的歌词行数',
      },
      {
        name: 'totalLineCount',
        label: '总行数',
        description: '审阅快照中的歌词总行数',
      },
    ],
  },
  {
    kind: 'timing',
    label: '时轴修正',
    description: '时轴起止时间变化时使用',
    variables: [
      ...commonLineVariables,
      { name: 'word', label: '歌词词', description: '当前逐字歌词' },
      {
        name: 'timingChanges',
        label: '时轴变化描述',
        description: '自动组合后的起始/结束时间变化描述',
      },
      {
        name: 'startTimingChange',
        label: '起始变化描述',
        description: '仅起始时间变化描述，无变化时为空',
      },
      {
        name: 'endTimingChange',
        label: '结束变化描述',
        description: '仅结束时间变化描述，无变化时为空',
      },
      { name: 'oldStart', label: '原起始', description: '原起始时间毫秒值' },
      { name: 'newStart', label: '新起始', description: '新起始时间毫秒值' },
      { name: 'oldEnd', label: '原结束', description: '原结束时间毫秒值' },
      { name: 'newEnd', label: '新结束', description: '新结束时间毫秒值' },
      {
        name: 'startDelta',
        label: '起始差值',
        description: '新起始时间减原起始时间',
      },
      {
        name: 'endDelta',
        label: '结束差值',
        description: '新结束时间减原结束时间',
      },
    ],
  },
  {
    kind: 'lineTiming',
    label: '行时轴修正',
    description: '整行起止时间变化时使用',
    variables: [
      ...commonLineVariables,
      {
        name: 'lineTimingChanges',
        label: '行时轴变化描述',
        description: '自动组合后的行起始/结束时间变化描述',
      },
      {
        name: 'lineStartTimingChange',
        label: '行起始变化描述',
        description: '仅行起始时间变化描述，无变化时为空',
      },
      {
        name: 'lineEndTimingChange',
        label: '行结束变化描述',
        description: '仅行结束时间变化描述，无变化时为空',
      },
      {
        name: 'oldLineStart',
        label: '原行起始',
        description: '原行起始时间毫秒值',
      },
      {
        name: 'newLineStart',
        label: '新行起始',
        description: '新行起始时间毫秒值',
      },
      {
        name: 'oldLineEnd',
        label: '原行结束',
        description: '原行结束时间毫秒值',
      },
      {
        name: 'newLineEnd',
        label: '新行结束',
        description: '新行结束时间毫秒值',
      },
      {
        name: 'lineStartDelta',
        label: '行起始差值',
        description: '新行起始时间减原行起始时间',
      },
      {
        name: 'lineEndDelta',
        label: '行结束差值',
        description: '新行结束时间减原行结束时间',
      },
    ],
  },
  {
    kind: 'manual',
    label: '手写条目',
    description: '用户手动新增的报告条目',
    variables: [{ name: 'content', label: '手写内容', description: '手写条目原文' }],
  },
];

export const DEFAULT_REVIEW_REPORT_FORMAT: ReviewReportFormat = {
  version: 1,
  emptyText: DEFAULT_REVIEW_REPORT_EMPTY_TEXT,
  blocks: {
    manual: {
      template: '{{content}}',
      listItem: false,
    },
    wordTextShared: {
      template: '{{lineLabels}}：`{{oldWord}}` 存在错误，应为 `{{newWord}}`',
      listItem: true,
    },
    wordTextGroup: {
      template: '{{lineLabel}}：{{oldWordsCode}} 分别存在错误，应为 {{newWordsCode}}',
      listItem: true,
    },
    wordText: {
      template: '{{lineLabel}}：`{{oldWord}}` 存在错误，应为 `{{newWord}}`',
      listItem: true,
    },
    wordRoman: {
      template: '{{lineLabel}}：`{{word}}` 音译 `{{oldRoman}}` 存在错误，应为 `{{newRoman}}`',
      listItem: true,
    },
    lineTranslation: {
      template: '{{lineLabel}}：翻译 `{{oldText}}` 存在错误，应为 `{{newText}}`',
      listItem: true,
    },
    lineRoman: {
      template: '{{lineLabel}}：音译 `{{oldText}}` 存在错误，应为 `{{newText}}`',
      listItem: true,
    },
    wordAndRoman: {
      template:
        '{{lineLabel}}：`{{oldWord}}` 存在错误，应为 `{{newWord}}`，音译 `{{oldRoman}}` 存在错误，应为 `{{newRoman}}`',
      listItem: true,
    },
    wordAdded: {
      template: '{{lineLabel}}：新增 `{{word}}`',
      listItem: true,
    },
    wordRemoved: {
      template: '{{lineLabel}}：删除 `{{word}}`',
      listItem: true,
    },
    lineAdded: {
      template: '{{lineLabel}}：新增歌词 `{{text}}`',
      listItem: true,
    },
    lineRemoved: {
      template: '{{lineLabel}}：删除歌词 `{{text}}`',
      listItem: true,
    },
    timeShift: {
      template: '对{{scopeLabel}}整体{{direction}} {{absoluteOffset}} 毫秒',
      listItem: true,
    },
    timing: {
      template: '{{lineLabel}}：`{{word}}` {{timingChanges}}',
      listItem: true,
    },
    lineTiming: {
      template: '{{lineLabel}}：行时轴修正，{{lineTimingChanges}}',
      listItem: true,
    },
  },
};
