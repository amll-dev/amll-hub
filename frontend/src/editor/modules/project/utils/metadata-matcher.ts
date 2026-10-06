type MatchRule = {
  pattern: string;
  key: string;
  wildcard: boolean;
};

const rawRules = [
  '"版权" > Copyright',
  '"贝斯" > Bass',
  '"编曲" > Arrangement',
  '"策划" > Planner',
  '"出品*" > Presenter',
  '"出品人" > Publisher',
  '"大提琴" > Cello',
  '"第二小提琴" > Second Violin',
  '"第一小提琴" > First Violin',
  '"发行*" > Distribution',
  '"钢琴*" > Piano',
  '"工作室" > Studio',
  '"鼓" > Drums',
  '"弦乐录音师" > String Recorder',
  '"弦乐录音室" > String Recording Studio ',
  '"项目统筹" > Project Coordinator',
  '"宣传*" > Publicity',
  '"艺术指导" > Art Director',
  '"音乐项目总监" > Project Executive',
  '"音乐制作" > Music Production',
  '"营销*" > Marketing',
  '"制作*" > Production',
  '"制作公司" > Produce Company',
  '"制作人" > Producer',
  '"制作统筹" > Executive Producer',
  '"中提琴" > Viola',
  '"总策划" > Chief Planner',
  '"总监制" Chief Executive Producer',
  '"AdditionalVocalby" > Additional Vocal',
  '"ArrangedBy" > Arranged',
  '"Arrangement" > Arrangement',
  '"Arranger" > Arranger',
  '"ArtDirector" > Art Director',
  '"BackgroundVocalsby" > Background Vocals',
  '"BackingVocal*" > Backing Vocal',
  '"BackingVocalArrangement" > Backing Vocal Arrangement',
  '"BackingVocalsDesign" > Backing Vocals Design',
  '"Bass" > Bass',
  '"Cello" > Cello',
  '"ChiefProducer" > Chief Producer',
  '"ChrefPlanner" > Chref Planner',
  '"Co-producedby" > Co-produced',
  '"Co-Producer" > Co-produced',
  '"Co-production" > Co-produced',
  '"Composedby" > Composer',
  '"Composer" > Composer',
  '"Copywriting" > Copywriting',
  '"CoverDesign" > Cover Design',
  '"Design" > Design',
  '"Distributedby" > Distribution',
  '"Distribution" > Distribution',
  '"Drums" > Drums',
  '"ExecutiveProducer" > Executive Producer',
  '"FirstViolin" > First Violin',
  '"Guitar" > Guitar',
  '"Guitars" > Guitar',
  '"Lyricist" > songwriter',
  '"Lyrics" > songwriter',
  '"Lyricsby" > songwriter',
  '"MarketingPromotion" > Marketing Promotion',
  '"MarketingStrategy" > Marketing Strategy',
  '"Masteredby" > Mastered',
  '"MasteringEngineer" > Mastering Engineer',
  '"MixingEngineer" > Mixing Engineer',
  '"MusicandLyricsProvidedby" > songwriter',
  '"MusicProduction" > Production',
  '"OP" > OP',
  '"Planner" > Planner',
  '"Plannerandcoordinator" > Planner',
  '"Presentedby" > Presenter',
  '"Presenter" > Presenter',
  '"ProduceCompany" > Produce Company',
  '"Producedby" > Producer',
  '"Producer" > Producer',
  '"ProductionCompany" > Produce Company',
  '"ProductionTeam" > Production Team',
  '"PromotionPlanning" > Promotion Planning',
  '"PromotionStrategy" > Promotion Strategy',
  '"Propaganda" > Propaganda',
  '"Publishedby" > Publisher',
  '"Publisher" > Publisher',
  '"RecordProducer" > Record Producer',
  '"Recordedat" > Recording Studio',
  '"RecordingEngineer" > Recording Engineer',
  '"RecordingStudio" > RecordingStudio',
  '"Release" > Release',
  '"Releasedby" > Release',
  '"RepertoireOwner" > Repertoire Owner',
  '"SecondViolin" > Second Violin',
  '"SongsTitle" > musicName',
  '"SP" > Supervised Production',
  '"Strings" > Strings',
  '"StringsArrangement" > Strings Arrangement',
  '"Supervisedproduction" > Supervised Production',
  '"Viola" > Viola',
  '"VocalEngineer" > Vocal Engineer',
  '"VocalProducer" > Vocal Producer',
  '"Vocalsby" > artists',
  '"VocalsProducedby" > artists',
  '"Writtenby" > songwriter',
];

const parseRule = (line: string): MatchRule | null => {
  const match = line.match(/"([^"]+)"\s*>\s*(.+)$/) ?? line.match(/"([^"]+)"\s+(.+)$/);
  if (!match) return null;
  const pattern = match[1]?.trim();
  const key = match[2]?.trim();
  if (!pattern || !key) return null;
  return {
    pattern,
    key,
    wildcard: pattern.includes('*'),
  };
};

const rules = rawRules.map(parseRule).filter((rule): rule is MatchRule => rule !== null);

const exactRules = rules.filter((rule) => !rule.wildcard);
const wildcardRules = rules.filter((rule) => rule.wildcard);

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findRuleKey = (label: string): string | null => {
  const normalized = label.trim();
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  for (const rule of exactRules) {
    if (rule.pattern.toLowerCase() === lower) return rule.key;
  }
  for (const rule of wildcardRules) {
    const pattern = escapeRegex(rule.pattern).replace(/\\\*/g, '.*');
    const regex = new RegExp(pattern, 'i');
    if (regex.test(normalized)) return rule.key;
  }
  return null;
};

const songwriterLabels = new Set(['作词', '作曲', '编曲']);

const extractLinePairs = (line: string): { label: string; value: string } | null => {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const colonIndex = trimmed.indexOf(':');
  const fullWidthIndex = trimmed.indexOf('：');
  const index =
    colonIndex === -1
      ? fullWidthIndex
      : fullWidthIndex === -1
        ? colonIndex
        : Math.min(colonIndex, fullWidthIndex);
  if (index === -1) return null;
  const label = trimmed.slice(0, index).trim();
  const value = trimmed.slice(index + 1).trim();
  if (!label || !value) return null;
  return { label, value };
};

const buildLineTextFromTx = (line: string): string | null => {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as { c?: { tx?: string }[] };
    if (!Array.isArray(parsed.c)) return null;
    const parts = parsed.c
      .map((item) => (typeof item?.tx === 'string' ? item.tx : ''))
      .filter((item) => item !== '');
    if (parts.length === 0) return null;
    return parts.join('').trim();
  } catch {
    return null;
  }
};

export const extractLyricMetadata = (lyric: string): Record<string, string[]> => {
  const result: Record<string, string[]> = {};
  if (!lyric) return result;
  const lines = lyric.split(/\r?\n/);
  for (const line of lines) {
    const text = buildLineTextFromTx(line);
    if (!text) continue;
    const pair = extractLinePairs(text);
    if (!pair) continue;
    const { label, value } = pair;
    const targetKey = songwriterLabels.has(label) ? 'songwriter' : findRuleKey(label);
    if (!targetKey) continue;
    if (!result[targetKey]) {
      result[targetKey] = [];
    }
    result[targetKey].push(value);
  }
  return result;
};
