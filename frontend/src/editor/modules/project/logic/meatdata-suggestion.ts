import { openDB } from 'idb';

type MetaSuggestionGroup = string[];

type MetaSuggestionNode = {
  group: MetaSuggestionGroup;
  children: MetaSuggestionNode[];
  title?: string;
};

type MetaSuggestionEntry =
  | string
  | string[]
  | {
      name?: string | string[];
      members?: MetaSuggestionEntry[];
    };

type MetaSuggestionFile = {
  title: string;
  nodes: MetaSuggestionNode[];
};

export type UserMetaSuggestionFile = {
  fileName: string;
  title: string;
  raw: string;
  nodes: MetaSuggestionNode[];
  updatedAt: number;
};

export type MetaSuggestionResult = {
  values: string[];
  title: string;
  matchedValue?: string;
};

let cachedConfig: MetaSuggestionFile[] | null = null;
let cachedConfigPromise: Promise<MetaSuggestionFile[]> | null = null;
let cachedUserFiles: UserMetaSuggestionFile[] | null = null;

const SETTINGS_DB_NAME = 'amll-settings-db';
const SETTINGS_DB_VERSION = 2;
const META_SUGGESTION_STORE = 'meta-suggestion-cache';
const META_SUGGESTION_KEY = 'metaSuggestionConfig';
const META_SUGGESTION_USER_STORE = 'meta-suggestion-user';
const META_SUGGESTION_USER_KEY = 'metaSuggestionUserFiles';

type MetaSuggestionCacheRecord = {
  key: string;
  cachedAt: number;
  payload: MetaSuggestionFile[];
};

type MetaSuggestionUserRecord = {
  key: string;
  updatedAt: number;
  items: UserMetaSuggestionFile[];
};

const settingsDbPromise = openDB(SETTINGS_DB_NAME, SETTINGS_DB_VERSION, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(META_SUGGESTION_STORE)) {
      db.createObjectStore(META_SUGGESTION_STORE, { keyPath: 'key' });
    }
    if (!db.objectStoreNames.contains(META_SUGGESTION_USER_STORE)) {
      db.createObjectStore(META_SUGGESTION_USER_STORE, { keyPath: 'key' });
    }
  },
});

const normalizeGroup = (items: string[]): MetaSuggestionGroup => {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
};

const parseStringGroup = (input: unknown, onWarning: () => void): string[] | null => {
  if (!Array.isArray(input)) return null;
  if (input.some((item) => Array.isArray(item) || (item !== null && typeof item === 'object'))) {
    return null;
  }
  const invalidItems = input.filter((item) => {
    if (typeof item !== 'string') return true;
    if (item.trim() === '') return true;
    return false;
  });
  const items = normalizeGroup(input.filter((item) => typeof item === 'string'));
  if (invalidItems.length > 0) {
    onWarning?.();
  }
  return items.length > 0 ? items : null;
};

const parseNameField = (input: unknown, onWarning?: () => void): string[] => {
  if (typeof input === 'string') return [input];
  if (Array.isArray(input)) {
    const invalidItems = input.filter((item) => {
      if (item === null || item === undefined) return true;
      if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') {
        return true;
      }
      if (typeof item === 'string' && item.trim() === '') return true;
      return false;
    });
    const items = input
      .filter(
        (item) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
      )
      .map((item) => String(item));
    if (invalidItems.length > 0) {
      onWarning?.();
    }
    return items;
  }
  if (typeof input === 'number' || typeof input === 'boolean') {
    return [String(input)];
  }
  return [];
};

const parseEntryList = (input: unknown, onWarning: () => void): MetaSuggestionNode[] => {
  if (!Array.isArray(input)) return [];
  const nodes: MetaSuggestionNode[] = [];
  for (const entry of input) {
    const node = parseEntry(entry, onWarning);
    if (node) {
      nodes.push(node);
    }
  }
  return nodes;
};

const parseObjectEntry = (
  entry: {
    name?: string | string[];
    members?: MetaSuggestionEntry[];
  },
  onWarning: () => void
): MetaSuggestionNode | null => {
  const nameList = parseNameField(entry.name, onWarning);
  const normalizedNames = normalizeGroup(nameList);
  const members = Array.isArray(entry.members) ? entry.members : [];
  const directMembers: string[] = [];
  const children: MetaSuggestionNode[] = [];

  for (const member of members) {
    if (typeof member === 'string') {
      directMembers.push(member);
      continue;
    }
    const stringGroup = parseStringGroup(member, onWarning);
    if (stringGroup) {
      children.push({ group: stringGroup, children: [] });
      continue;
    }
    if (Array.isArray(member)) {
      children.push(...parseEntryList(member, onWarning));
      continue;
    }
    if (member && typeof member === 'object') {
      const node = parseObjectEntry(member, onWarning);
      if (node) {
        children.push(node);
      }
    }
  }

  const childGroups = children.flatMap((child) => child.group);
  const combined = normalizeGroup([...normalizedNames, ...directMembers, ...childGroups]);
  if (combined.length === 0) return null;
  const title = normalizedNames[0] ? normalizedNames[0] : undefined;
  return { group: combined, children, title };
};

const parseEntry = (entry: unknown, onWarning: () => void): MetaSuggestionNode | null => {
  if (Array.isArray(entry)) {
    const stringGroup = parseStringGroup(entry, onWarning);
    if (stringGroup) {
      return { group: stringGroup, children: [], title: stringGroup[0] };
    }
    const nodes = parseEntryList(entry, onWarning);
    if (nodes.length === 1) return nodes[0] ?? null;
    if (nodes.length > 1) {
      const combined = normalizeGroup(nodes.flatMap((node) => node.group));
      if (combined.length === 0) return null;
      return { group: combined, children: nodes };
    }
    return null;
  }
  if (entry && typeof entry === 'object') {
    return parseObjectEntry(
      entry as { name?: string | string[]; members?: MetaSuggestionEntry[] },
      onWarning
    );
  }
  return null;
};

const sanitizeJsonLine = (input: string): string => {
  let output = input;
  output = output.replace(/\[,/g, '[null,');
  output = output.replace(/,\]/g, ',null]');
  while (output.includes(',,')) {
    output = output.replace(/,,/g, ',null,');
  }
  return output;
};

const parseJsonlInternal = (input: string, onWarning: () => void): MetaSuggestionNode[] => {
  const nodes: MetaSuggestionNode[] = [];
  const lines = input.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as unknown;
      const node = parseEntry(entry, onWarning);
      if (node) nodes.push(node);
    } catch {
      try {
        const sanitized = sanitizeJsonLine(trimmed);
        const entry = JSON.parse(sanitized) as unknown;
        const node = parseEntry(entry, onWarning);
        if (node) nodes.push(node);
      } catch {
        onWarning?.();
        continue;
      }
    }
  }
  return nodes;
};

export const parseJsonl = (input: string): MetaSuggestionNode[] =>
  parseJsonlInternal(input, () => {});

export const parseJsonlWithWarnings = (
  input: string
): { nodes: MetaSuggestionNode[]; warnings: number } => {
  let warnings = 0;
  const nodes = parseJsonlInternal(input, () => {
    warnings += 1;
  });
  return { nodes, warnings };
};

export const formatFileTitle = (fileName: string): string => {
  const baseName = fileName.replace(/\.[^.]+$/, '');
  return baseName.replace(/[-_]+/g, ' ').toUpperCase();
};

const loadMetaSuggestionConfigFromFiles = async (): Promise<MetaSuggestionFile[]> => {
  const response = await fetch('/metaSuggestion/index.json', {
    cache: 'no-cache',
  });
  if (!response.ok) {
    return [];
  }
  const raw = (await response.json()) as unknown;
  if (!Array.isArray(raw)) return [];
  const files = raw.filter((item) => typeof item === 'string');
  const configs: MetaSuggestionFile[] = [];
  for (const fileName of files) {
    const fileResponse = await fetch(`/metaSuggestion/${fileName}`, {
      cache: 'no-cache',
    });
    if (!fileResponse.ok) continue;
    const text = await fileResponse.text();
    const nodes = parseJsonl(text);
    if (nodes.length === 0) continue;
    configs.push({
      title: formatFileTitle(fileName),
      nodes,
    });
  }
  return configs;
};

const loadMetaSuggestionConfigFromCache = async (): Promise<MetaSuggestionFile[] | null> => {
  try {
    const db = await settingsDbPromise;
    const cached = (await db.get(META_SUGGESTION_STORE, META_SUGGESTION_KEY)) as
      MetaSuggestionCacheRecord | undefined;
    if (!cached?.payload?.length) return null;
    return cached.payload;
  } catch {
    return null;
  }
};

const loadUserMetaSuggestionFiles = async (): Promise<UserMetaSuggestionFile[]> => {
  if (cachedUserFiles) return cachedUserFiles;
  try {
    const db = await settingsDbPromise;
    const record = (await db.get(META_SUGGESTION_USER_STORE, META_SUGGESTION_USER_KEY)) as
      MetaSuggestionUserRecord | undefined;
    const items = record?.items ?? [];
    cachedUserFiles = items;
    return items;
  } catch {
    return [];
  }
};

const writeUserMetaSuggestionFiles = async (files: UserMetaSuggestionFile[]) => {
  try {
    const db = await settingsDbPromise;
    await db.put(META_SUGGESTION_USER_STORE, {
      key: META_SUGGESTION_USER_KEY,
      updatedAt: Date.now(),
      items: files,
    } satisfies MetaSuggestionUserRecord);
    cachedUserFiles = files;
    cachedConfig = null;
    cachedConfigPromise = null;
  } catch {
    return;
  }
};

export const getUserMetaSuggestionFiles = async () => loadUserMetaSuggestionFiles();

export const setUserMetaSuggestionFiles = async (files: UserMetaSuggestionFile[]) =>
  writeUserMetaSuggestionFiles(files);

const writeMetaSuggestionCache = async (payload: MetaSuggestionFile[]) => {
  try {
    const db = await settingsDbPromise;
    await db.put(META_SUGGESTION_STORE, {
      key: META_SUGGESTION_KEY,
      cachedAt: Date.now(),
      payload,
    } satisfies MetaSuggestionCacheRecord);
  } catch {
    return;
  }
};

const loadMetaSuggestionConfig = async (): Promise<MetaSuggestionFile[]> => {
  if (cachedConfig) return cachedConfig;
  if (cachedConfigPromise) return cachedConfigPromise;
  cachedConfigPromise = (async () => {
    try {
      const cached = await loadMetaSuggestionConfigFromCache();
      const builtInConfigs = cached ?? (await loadMetaSuggestionConfigFromFiles());
      if (!cached) {
        await writeMetaSuggestionCache(builtInConfigs);
      }
      const userFiles = await loadUserMetaSuggestionFiles();
      const merged = [
        ...builtInConfigs,
        ...userFiles.map((file) => ({
          title: file.title,
          nodes: file.nodes,
        })),
      ];
      cachedConfig = merged;
      return merged;
    } catch {
      return [];
    } finally {
      cachedConfigPromise = null;
    }
  })();
  return cachedConfigPromise;
};

const resolveNodeTitle = (node: MetaSuggestionNode): string | null => {
  if (node.title) return node.title;
  if (node.children.length === 0) {
    return node.group[0] ?? null;
  }
  return null;
};

type MetaSuggestionMatch = {
  values: string[];
  titlePath: string[];
  matchedValue: string;
};

const matchNode = (
  node: MetaSuggestionNode,
  normalized: string,
  path: string[]
): MetaSuggestionMatch[] => {
  const nodeTitle = resolveNodeTitle(node);
  const nextPath = nodeTitle ? [...path, nodeTitle] : path;
  const matches: MetaSuggestionMatch[] = [];
  for (const child of node.children) {
    matches.push(...matchNode(child, normalized, nextPath));
  }
  for (const item of node.group) {
    if (item.toLowerCase() === normalized) {
      matches.push({
        values: node.group,
        titlePath: nextPath,
        matchedValue: item,
      });
    }
  }
  return matches;
};

export const getMeatdataSuggestion = async (value: string): Promise<MetaSuggestionResult[]> => {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const normalized = trimmed.toLowerCase();
  const files = await loadMetaSuggestionConfig();
  const results: MetaSuggestionResult[] = [];
  for (const file of files) {
    for (const node of file.nodes) {
      const matches = matchNode(node, normalized, [file.title]);
      for (const match of matches) {
        const titleParts = match.titlePath.filter(Boolean);
        const filteredTitleParts = titleParts[0] === 'ARTISTS' ? titleParts.slice(1) : titleParts;
        const valuesText = match.values.join(' / ');
        const title = filteredTitleParts.length
          ? `${filteredTitleParts.join(' > ')} > ${valuesText}`
          : valuesText;
        results.push({
          values: match.values,
          title,
          matchedValue: match.matchedValue,
        });
      }
    }
  }
  return results;
};
