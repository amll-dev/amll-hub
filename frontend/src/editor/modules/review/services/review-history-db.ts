import { type DBSchema, type IDBPDatabase, type IDBPObjectStore, openDB } from 'idb';
import type { ReviewSession } from '$/states/main';
import type { StructuredReviewReport } from '$/types/structured-review-report';
import type { TTMLLyric } from '$/types/ttml';
import type { ReviewStructuredSnapshot } from './structured-snapshot';

const DB_NAME = 'amll-review-history-db';
const DB_VERSION = 3;

export type ReviewHistoryRecord = {
  id: string;
  prNumber: number;
  prTitle: string;
  fileName: string;
  source: ReviewSession['source'];
  createdAt: number;
  contentHash: string;
  originalTtml?: string;
  data: TTMLLyric;
  structure: ReviewStructuredSnapshot;
  structuredReport?: StructuredReviewReport;
};

interface ReviewHistoryDBSchema extends DBSchema {
  sessions: {
    key: string;
    value: ReviewHistoryRecord;
    indexes: {
      'by-pr': number;
      'by-pr-date': [number, number];
      'by-created-at': number;
      'by-content-hash': string;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<ReviewHistoryDBSchema>> | null = null;

type LegacySnapshot = {
  contentHash?: string;
  lines?: Array<{ lineIndex?: number; sourceLineId?: string }>;
};

/**
 * 就地把 v2 及更早记录的 structure 收窄到 v3 形状，丢掉 elements/documentId/elementIds。
 * 仅回收空间，不影响任何读取路径；出错即放弃。
 */
const pruneLegacySnapshots = async (
  store: IDBPObjectStore<ReviewHistoryDBSchema, ArrayLike<'sessions'>, 'sessions', 'versionchange'>
) => {
  try {
    for await (const cursor of store.iterate()) {
      const record = cursor.value;
      const legacy = record.structure as LegacySnapshot | undefined;
      await cursor.update({
        ...record,
        structure: {
          schemaVersion: 2,
          contentHash: legacy?.contentHash ?? record.contentHash,
          lines: (legacy?.lines ?? []).map((line, index) => ({
            lineIndex: line.lineIndex ?? index,
            sourceLineId: line.sourceLineId ?? '',
          })),
        },
      });
    }
  } catch {
    // 历史记录保持原样即可，元素图字段只是被忽略。
  }
};

const getDB = () => {
  if (!dbPromise) {
    dbPromise = openDB<ReviewHistoryDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        const store =
          oldVersion < 1
            ? db.createObjectStore('sessions', { keyPath: 'id' })
            : transaction.objectStore('sessions');
        if (oldVersion < 1) {
          store.createIndex('by-pr', 'prNumber');
          store.createIndex('by-pr-date', ['prNumber', 'createdAt']);
          store.createIndex('by-created-at', 'createdAt');
        }
        if (oldVersion < 2) {
          store.createIndex('by-content-hash', 'contentHash');
        }
        if (oldVersion >= 1 && oldVersion < 3) {
          // v3 起 structure 不再持久化元素图（ID 改为按 contentHash + path 按需派生）。
          // 纯粹是回收空间：没有任何读取路径再碰 elements/documentId，
          // 因此这一步失败也不影响功能，不让它拖垮整个 upgrade。
          void pruneLegacySnapshots(store);
        }
      },
    });
  }
  return dbPromise;
};

export const saveReviewHistory = async (record: ReviewHistoryRecord): Promise<void> => {
  const db = await getDB();
  await db.put('sessions', record);
};

export const getReviewHistory = async (): Promise<ReviewHistoryRecord[]> => {
  const db = await getDB();
  const records = await db.getAllFromIndex('sessions', 'by-created-at');
  return records.reverse();
};

export const getReviewHistoryByPr = async (prNumber: number): Promise<ReviewHistoryRecord[]> => {
  const db = await getDB();
  const range = IDBKeyRange.bound([prNumber, 0], [prNumber, Infinity]);
  const records = await db.getAllFromIndex('sessions', 'by-pr-date', range);
  return records.reverse();
};

export const getReviewHistoryByHash = async (
  contentHash: string
): Promise<ReviewHistoryRecord[]> => {
  const db = await getDB();
  const records = await db.getAllFromIndex(
    'sessions',
    'by-content-hash',
    contentHash.toLowerCase()
  );
  return records.sort((a, b) => b.createdAt - a.createdAt);
};

export const deleteReviewHistory = async (id: string): Promise<void> => {
  const db = await getDB();
  await db.delete('sessions', id);
};

export const updateReviewHistoryReport = async (
  historyId: string,
  structuredReport: StructuredReviewReport
): Promise<void> => {
  const db = await getDB();
  const record = await db.get('sessions', historyId);
  if (!record) return;
  await db.put('sessions', { ...record, structuredReport });
};
