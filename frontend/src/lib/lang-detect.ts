/** 歌词语言推断 */
import type { LyricLine } from '@/lib/ttml-processor';

/** 后端投稿语言枚举 model.SubmissionLanguage */
export type LangCode = 'zh' | 'en' | 'ja' | 'ko' | 'others';

export interface LanguageHit {
  code: LangCode;
  /** 命中行数（含背景人声行） */
  lines: number;
  /** 占全部有效歌词行的比例，0~1 */
  share: number;
}

/** 次要语言入选门槛：达到该占比才自动勾选 */
const SECONDARY_MIN_SHARE = 0.15;

/** 拉丁文本被判为「其他语言」所需的外文虚词最低占比 */
const FOREIGN_MIN_RATIO = 0.25;

/** 英文高频词（含缩写还原后的词干），用于识别英语 */
const EN_WORDS = new Set(
  (
    'i you your yours me my mine we us our ours he him his she her hers it its ' +
    'they them their theirs the an and or but so if because then than that this these those ' +
    'there here to of in on at for with without from by about into over under through again ' +
    'is am are was were be been being do does did done can could would should will shall may might must ' +
    'have has had having got get gonna wanna gotta not never yeah oh ooh ah hey ' +
    'what when where who whom whose why how all any some every each both more most much many ' +
    'very too just only still even ever always sometimes tonight today ' +
    'love heart baby need want know feel take make give say said tell come go going gone stay leave hold keep let put see look think right wrong good bad time'
  ).split(' ')
);

/**
 * 其它拉丁语系的高频虚词（NFD 去重音后的形式）。
 * 与英语重合的词（on / son / do / as / die / will / war / was / hat / bin / come / per / la）
 * 一律不收录，避免英语歌词被误判。
 */
const FOREIGN_WORDS = new Set(
  // 法语
  (
    'je tu il elle nous vous ils elles le les des du de et est sont suis es sommes etes pas ' +
    'que qui quoi dont pour dans sur sous avec sans mon ma mes ton ta tes sa ses notre votre leur leurs ' +
    'ce cet cette ces mais ou tout tous toute tres etre avoir fait faire moi toi lui aussi comme quand ' +
    'encore jamais toujours rien oui non ' +
    // 西班牙语
    'el los las una uno unos unas y soy eres somos esta estan estoy estas por para con sin mi mis tus su sus ' +
    'nuestro nuestra pero cuando donde mas todo toda todos nada siempre nunca corazon amor quiero quieres ' +
    'tengo tienes vas voy muy porque sobre entre hasta desde hay ser estar fue ' +
    // 德语
    'der das den dem des und ich du er sie wir ihr nicht kein keine ein eine einen einem einer ist sind ' +
    'waren bist seid mit fur auf aus bei nach von zu dich mich mir dir uns euch mein meine dein deine ' +
    'seine aber oder wenn wie wer wo sehr noch nur schon immer hab habe hast haben kann muss ' +
    // 葡萄牙语
    'nao voce eu ele ela nos eles elas um uma uns umas os da dos das com sem se meu minha seu sua ' +
    'muito mais onde coracao quero sao foi ter tem tenho ' +
    // 意大利语
    'lo gli le che di del della dei non sono sei siamo siete io noi voi ma piu tutti amore dove anche ' +
    'ancora mai niente cosa questo questa quello mia mio tua tuo stai sto'
  ).split(' ')
);

/** 假名：平假名 / 片假名 / 半角片假名 */
function isKana(cp: number): boolean {
  return (
    (cp >= 0x3040 && cp <= 0x30ff) ||
    (cp >= 0x31f0 && cp <= 0x31ff) ||
    (cp >= 0xff66 && cp <= 0xff9f)
  );
}

/** 谚文：音节 / 字母 / 兼容字母 */
function isHangul(cp: number): boolean {
  return (
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0x1100 && cp <= 0x11ff) ||
    (cp >= 0x3130 && cp <= 0x318f)
  );
}

/** 汉字（含扩展区） */
function isHan(cp: number): boolean {
  return (
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x20000 && cp <= 0x2fa1f)
  );
}

/** 拉丁字母（含带重音的扩展拉丁） */
function isLatin(cp: number): boolean {
  return (
    (cp >= 0x41 && cp <= 0x5a) ||
    (cp >= 0x61 && cp <= 0x7a) ||
    (cp >= 0x00c0 && cp <= 0x024f) ||
    (cp >= 0x1e00 && cp <= 0x1eff)
  );
}

/** 其它有语种含义的文字（西里尔、希腊、阿拉伯、希伯来、泰、天城文等） */
function isOtherScript(cp: number): boolean {
  return (
    (cp >= 0x0370 && cp <= 0x03ff) ||
    (cp >= 0x0400 && cp <= 0x04ff) ||
    (cp >= 0x0530 && cp <= 0x058f) ||
    (cp >= 0x0590 && cp <= 0x05ff) ||
    (cp >= 0x0600 && cp <= 0x06ff) ||
    (cp >= 0x0900 && cp <= 0x097f) ||
    (cp >= 0x0e00 && cp <= 0x0e7f)
  );
}

/**
 * 归一化词形：小写、去重音、还原缩写（i'm→i、don't→do），只留字母。
 * 去重音后西语/葡语词才能命中 FOREIGN_WORDS 里的 ASCII 形式。
 */
function normalizeToken(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/’/g, "'")
    .replace(/'s$|'re$|'ll$|'ve$|'d$|'m$/, '')
    .replace(/n't$/, '')
    .replace(/[^a-z]/g, '');
}

/** 拉丁字母文本：外文虚词占比达到门槛且不少于英文虚词时判为「其他」，否则算英语 */
function classifyLatin(text: string): LangCode {
  let en = 0;
  let foreign = 0;
  let total = 0;
  for (const raw of text.split(/[^\p{L}']+/u)) {
    const token = normalizeToken(raw);
    if (!token) continue;
    total++;
    if (EN_WORDS.has(token)) en++;
    else if (FOREIGN_WORDS.has(token)) foreign++;
  }
  if (total === 0) return 'en';
  // 部分虚词（me / se 等）英语与罗曼语系共用，打平时按外文处理更保险
  return foreign / total >= FOREIGN_MIN_RATIO && foreign >= en ? 'others' : 'en';
}

/** 单行语言判定；纯符号 / 纯数字（间奏标记等）返回 null 不参与统计 */
function classifyLine(text: string): LangCode | null {
  let kana = 0;
  let hangul = 0;
  let han = 0;
  let latin = 0;
  let other = 0;

  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isKana(cp)) kana++;
    else if (isHangul(cp)) hangul++;
    else if (isHan(cp)) han++;
    else if (isLatin(cp)) latin++;
    else if (isOtherScript(cp)) other++;
  }

  // 假名 / 谚文是排他信号，优先于汉字（日文、韩文都会夹汉字）
  if (kana > 0) return 'ja';
  if (hangul > 0) return 'ko';
  if (han > 0) return 'zh';
  if (latin > 0) return classifyLatin(text);
  if (other > 0) return 'others';
  return null;
}

/**
 * 推断歌词语言，返回按占比降序排列的结果。
 * 第一个是主语言，其余为占比达到 SECONDARY_MIN_SHARE 的次要语言。
 */
export function detectLanguages(
  lines: ReadonlyArray<Pick<LyricLine, 'text' | 'backgroundVocal'>>
): LanguageHit[] {
  const counts = new Map<LangCode, number>();
  let total = 0;

  for (const line of lines) {
    // 背景人声与原唱同语种，一并计入；翻译 / 音译是另一种语言，不参与判定
    for (const text of [line.text, line.backgroundVocal?.text]) {
      if (!text) continue;
      const code = classifyLine(text);
      if (!code) continue;
      total++;
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }

  if (total === 0) return [];

  const hits: LanguageHit[] = Array.from(counts, ([code, n]) => ({
    code,
    lines: n,
    share: n / total,
  }));
  const primary = hits.reduce((a, b) => (b.lines > a.lines ? b : a));
  const secondary = hits
    .filter((hit) => hit !== primary && hit.share >= SECONDARY_MIN_SHARE)
    .sort((a, b) => b.lines - a.lines);

  return [primary, ...secondary];
}
