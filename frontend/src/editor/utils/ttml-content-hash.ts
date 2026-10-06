import type { TTMLLyric } from '$/types/ttml';

export type ContentHashQuery<T> = (contentHash: string) => Promise<T[]>;

const normalizeHashInput = (lyrics: TTMLLyric) => ({
  metadata: lyrics.metadata.map(({ key, value }) => ({ key, value })),
  lyricLines: lyrics.lyricLines.map(
    ({ id: _lineId, endTimeLink: _endTimeLink, ignoreSync: _ignoreSync, ...line }) => ({
      ...line,
      words: line.words.map(({ id: _wordId, romanWarning: _romanWarning, ...word }) => word),
    })
  ),
  vocalTags: lyrics.vocalTags,
  agents: lyrics.agents,
});

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)])
  );
};

export const createTtmlContentHash = async (lyrics: TTMLLyric): Promise<string> => {
  const canonicalJson = JSON.stringify(canonicalize(normalizeHashInput(lyrics)));
  const bytes = new TextEncoder().encode(canonicalJson);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  );
  return `sha256:${hex}`;
};

export const queryTtmlByContentHash = async <T>(
  lyrics: TTMLLyric,
  query: ContentHashQuery<T>
): Promise<{ contentHash: string; matches: T[] }> => {
  const contentHash = await createTtmlContentHash(lyrics);
  return { contentHash, matches: await query(contentHash) };
};

export const verifyTtmlContentHash = async (
  lyrics: TTMLLyric,
  expectedHash: string
): Promise<boolean> => (await createTtmlContentHash(lyrics)) === expectedHash.toLowerCase();
