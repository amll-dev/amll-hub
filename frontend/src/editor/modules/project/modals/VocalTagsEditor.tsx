import { useAtom } from 'jotai';
import { useImmerAtom } from 'jotai-immer';
import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { vocalTagsEditorDialogAtom } from '$/states/dialogs.ts';
import { lyricLinesAtom } from '$/states/main.ts';
import type { TTMLLyric } from '$/types/ttml';
import styles from './VocalTagsEditor.module.css';

const parseLineVocalIds = (value?: string | string[]) => {
  if (!value) return [];
  const parts = Array.isArray(value) ? value : value.split(/[\s,]+/);
  return parts.map((v) => v.trim()).filter(Boolean);
};
const getNextVocalId = (ids: string[]) => {
  let maxId = 0;
  for (const id of ids) {
    if (!/^[0-9]+$/.test(id)) continue;
    const parsed = Number.parseInt(id, 10);
    if (Number.isFinite(parsed)) maxId = Math.max(maxId, parsed);
  }
  const nextId = maxId > 0 ? maxId + 1 : ids.length + 1;
  return `${nextId}`;
};
const hasDuplicateTag = (tags: Array<{ value: string }>, value: string, excludeIndex?: number) => {
  const normalized = value.trim();
  return tags.some((tag, index) => {
    if (excludeIndex === index) return false;
    return tag.value.trim() === normalized;
  });
};
const reassignVocalIds = (draft: TTMLLyric) => {
  if (!draft.vocalTags || draft.vocalTags.length === 0) {
    draft.lyricLines.forEach((line) => {
      line.vocal = [];
    });
    return;
  }
  const idMap = new Map<string, string>();
  draft.vocalTags.forEach((tag, index) => {
    const nextId = `${index + 1}`;
    idMap.set(tag.key, nextId);
    tag.key = nextId;
  });
  draft.lyricLines.forEach((line) => {
    const ids = parseLineVocalIds(line.vocal);
    const mapped = ids.map((id) => idMap.get(id)).filter((value): value is string => !!value);
    line.vocal = mapped;
  });
};

export const VocalTagsEditor = () => {
  const [open, setOpen] = useAtom(vocalTagsEditorDialogAtom);
  const [lyricLines, setLyricLines] = useImmerAtom(lyricLinesAtom);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [newTagValue, setNewTagValue] = useState('');

  const vocalTags = lyricLines.vocalTags ?? [];
  const artistNames = useMemo(() => {
    const artists = lyricLines.metadata.find((meta) => meta.key === 'artists');
    if (!artists) return [];
    return artists.value.map((value) => value.trim()).filter((value) => value.length > 0);
  }, [lyricLines.metadata]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className={styles.dialogContent}>
        <div className={styles.dialogHeader}>
          <DialogTitle style={{ margin: 0 }}>演唱者标签</DialogTitle>
        </div>
        <div className={styles.dialogBody}>
          <section>
            <div className={styles.sectionHeader}>
              <div className="flex items-center justify-between">
                <span className="text-base font-medium">演唱者标签</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    disabled={artistNames.length === 0}
                    onClick={() => {
                      if (artistNames.length === 0) return;
                      setLyricLines((draft) => {
                        draft.vocalTags ??= [];
                        for (const name of artistNames) {
                          if (hasDuplicateTag(draft.vocalTags, name)) continue;
                          const nextId = getNextVocalId(draft.vocalTags.map((tag) => tag.key));
                          draft.vocalTags.push({ key: nextId, value: name });
                        }
                      });
                    }}
                  >
                    从 artists 导入
                  </Button>
                  <Button
                    variant="secondary"
                    className="text-error"
                    onClick={() => {
                      setLyricLines((draft) => {
                        draft.lyricLines.forEach((line) => {
                          line.vocal = [];
                        });
                      });
                    }}
                  >
                    清空分配
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setLyricLines((draft) => {
                        draft.vocalTags = [];
                        draft.lyricLines.forEach((line) => {
                          line.vocal = [];
                        });
                      });
                    }}
                  >
                    <Trash2 className="size-4" />
                    清空
                  </Button>
                </div>
              </div>
            </div>
            {vocalTags.length === 0 && <span className="text-sm text-ink-3">暂无演唱者标签。</span>}
            <div className={styles.tagList}>
              {vocalTags.map((tag, index) =>
                editingIndex === index ? (
                  <Input
                    key={`vocal-tag-edit-${tag.key}`}
                    className={styles.tagControl}
                    autoFocus
                    value={editingValue}
                    placeholder="显示名称"
                    onChange={(e) => setEditingValue(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      const trimmed = editingValue.trim();
                      setLyricLines((draft) => {
                        if (!draft.vocalTags) return;
                        if (!trimmed) {
                          draft.vocalTags.splice(index, 1);
                          reassignVocalIds(draft);
                          return;
                        }
                        if (hasDuplicateTag(draft.vocalTags, trimmed, index)) return;
                        const target = draft.vocalTags[index];
                        if (target) target.value = trimmed;
                      });
                      setEditingIndex(null);
                    }}
                    onBlur={() => setEditingIndex(null)}
                  />
                ) : (
                  <Button
                    key={`vocal-tag-${tag.key}`}
                    className={styles.tagControl}
                    variant="secondary"
                    onClick={() => {
                      setEditingIndex(index);
                      setEditingValue(tag.value ?? '');
                    }}
                  >
                    {tag.value?.trim() ? `${tag.key}: ${tag.value}` : `${tag.key}: ${'(未命名)'}`}
                  </Button>
                )
              )}
              {isAdding ? (
                <Input
                  className={styles.tagControl}
                  autoFocus
                  value={newTagValue}
                  placeholder="显示名称"
                  onChange={(e) => setNewTagValue(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    const trimmed = newTagValue.trim();
                    if (!trimmed) {
                      setIsAdding(false);
                      return;
                    }
                    setLyricLines((draft) => {
                      draft.vocalTags ??= [];
                      if (hasDuplicateTag(draft.vocalTags, trimmed)) return;
                      const nextId = getNextVocalId(draft.vocalTags.map((tag) => tag.key));
                      draft.vocalTags.push({ key: nextId, value: trimmed });
                    });
                    setIsAdding(false);
                    setNewTagValue('');
                  }}
                  onBlur={() => setIsAdding(false)}
                />
              ) : (
                <Button
                  className={styles.tagControl}
                  variant="secondary"
                  onClick={() => {
                    setIsAdding(true);
                    setNewTagValue('');
                  }}
                >
                  <span className="flex items-center gap-2">
                    <Plus className="size-4" />
                    添加演唱者标签
                  </span>
                </Button>
              )}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
};
