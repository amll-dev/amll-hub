import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { buttonTap, fadeUp, staggerContainer } from '@/lib/motion';
import { MusicSearchPanel, type PickedSong } from '@/components/shared/MusicSearchPanel';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { platforms } from './shared';
import type { LyricRequestPayload, MusicPlatform } from '@/lib/types';

const emptyPayload: LyricRequestPayload = {
  songName: '',
  artist: '',
  album: '',
  ncmId: '',
  qqId: '',
  spotifyId: '',
  appleMusicId: '',
  hasAppleTtml: false,
  note: '',
};

/** 输入框统一样式 */
const fieldClass =
  'h-11 w-full rounded-md border border-input bg-background px-4 text-sm outline-none transition-colors duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20';

/** 从入参里归一化 ID：空 → '0' */
function normalizeId(v: string) {
  const t = v.trim();
  return t === '' ? '0' : t;
}

function validate(form: LyricRequestPayload): string | null {
  if (!form.songName.trim()) return '请填写歌曲名称';
  if (!form.artist.trim()) return '请填写歌手';
  if (!form.album.trim()) return '请填写专辑';

  const ids = {
    网易云音乐: normalizeId(form.ncmId),
    'QQ 音乐': normalizeId(form.qqId),
    Spotify: normalizeId(form.spotifyId),
    'Apple Music': normalizeId(form.appleMusicId),
  };
  for (const [label, id] of Object.entries(ids)) {
    if (id !== '0' && !/^[A-Za-z0-9_-]+$/.test(id)) {
      return `${label} ID 只能包含字母、数字、- 和 _`;
    }
  }
  if (ids['网易云音乐'] !== '0' && !/^\d+$/.test(ids['网易云音乐'])) {
    return '网易云音乐 ID 应为纯数字，找不到请填 0';
  }
  if (ids['QQ 音乐'] !== '0' && !/^\d+$/.test(ids['QQ 音乐'])) {
    return 'QQ 音乐 ID 应为纯数字，找不到请填 0';
  }
  if (Object.values(ids).every((id) => id === '0')) {
    return '请至少填写一个平台的歌曲 ID，否则无法定位歌曲';
  }
  return null;
}

/** 发起 / 编辑请愿表单 */
export function RequestForm({
  initial,
  submitLabel = '提交请愿',
  submitting = false,
  onSubmit,
}: {
  initial?: Partial<LyricRequestPayload>;
  submitLabel?: string;
  submitting?: boolean;
  onSubmit: (payload: LyricRequestPayload) => void;
}) {
  const [form, setForm] = useState<LyricRequestPayload>({ ...emptyPayload, ...initial });
  const [error, setError] = useState<string | null>(null);
  const [flashKey, setFlashKey] = useState(0);

  // 选中搜索结果：回填歌名 / 歌手 / 专辑 / 对应平台 ID
  const pickSong = (song: PickedSong, platform: MusicPlatform) => {
    setForm((prev) => ({
      ...prev,
      songName: song.name,
      artist: song.artists,
      album: song.album,
      ...(platform === 'qq' ? { qqId: song.id } : { ncmId: song.id }),
    }));
    setError(null);
    setFlashKey((k) => k + 1);
  };

  const setField = <K extends keyof LyricRequestPayload>(key: K, value: LyricRequestPayload[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (error) setError(null);
  };

  const canSubmit = !!form.songName.trim() && !!form.artist.trim() && !!form.album.trim();

  const handleSubmit = () => {
    const msg = validate(form);
    if (msg) {
      setError(msg);
      return;
    }
    onSubmit({
      songName: form.songName.trim(),
      artist: form.artist.trim(),
      album: form.album.trim(),
      ncmId: normalizeId(form.ncmId),
      qqId: normalizeId(form.qqId),
      spotifyId: normalizeId(form.spotifyId),
      appleMusicId: normalizeId(form.appleMusicId),
      hasAppleTtml: form.hasAppleTtml,
      note: form.note.trim(),
    });
  };

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-6">
      {/* 从音乐平台搜索填表 */}
      <motion.div variants={fadeUp}>
        <MusicSearchPanel onPick={pickSong} />
      </motion.div>

      {/* 歌曲名称 */}
      <motion.div variants={fadeUp}>
        <label className="mb-1.5 block text-sm font-medium text-ink-2">
          歌曲名称 <span className="text-error">*</span>
        </label>
        <motion.input
          key={`songName-${flashKey}`}
          type="text"
          value={form.songName}
          onChange={(e) => setField('songName', e.target.value)}
          maxLength={255}
          placeholder="请输入歌曲名称"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className={fieldClass}
        />
      </motion.div>

      {/* 歌手 */}
      <motion.div variants={fadeUp}>
        <label className="mb-1.5 block text-sm font-medium text-ink-2">
          歌手 <span className="text-error">*</span>
        </label>
        <motion.input
          key={`artist-${flashKey}`}
          type="text"
          value={form.artist}
          onChange={(e) => setField('artist', e.target.value)}
          maxLength={255}
          placeholder="请输入歌手"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className={fieldClass}
        />
      </motion.div>

      {/* 专辑 */}
      <motion.div variants={fadeUp}>
        <label className="mb-1.5 block text-sm font-medium text-ink-2">
          专辑 <span className="text-error">*</span>
        </label>
        <motion.input
          key={`album-${flashKey}`}
          type="text"
          value={form.album}
          onChange={(e) => setField('album', e.target.value)}
          maxLength={255}
          placeholder="请输入专辑"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className={fieldClass}
        />
      </motion.div>

      {platforms.map((p) => (
        <motion.div key={p.key} variants={fadeUp}>
          <label className="mb-1.5 block text-sm font-medium text-ink-2">
            {p.fieldLabel} <span className="text-error">*</span>
          </label>
          <p className="mb-2 text-xs text-ink-3">
            具体获取方式请在
            <Link to="/docs" className="text-primary hover:underline">
              这里
            </Link>
            查看。如果找不到或者没有请写“0”。
          </p>
          <motion.input
            key={`${p.key}-${flashKey}`}
            type="text"
            value={form[p.key]}
            onChange={(e) => setField(p.key, e.target.value)}
            maxLength={100}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className={`${fieldClass} font-mono`}
          />
        </motion.div>
      ))}

      {/* 其他备注 */}
      <motion.div variants={fadeUp}>
        <label className="mb-1.5 block text-sm font-medium text-ink-2">其他备注</label>
        <p className="mb-2 text-xs text-ink-3">如果可以确认其他信息的话也会对歌词制作有所帮助哦</p>
        <Textarea
          value={form.note}
          onChange={(e) => setField('note', e.target.value)}
          maxLength={1000}
          rows={4}
          placeholder="还有什么需要补充说明的吗？"
          className="w-full bg-background px-4 py-3"
        />
        <p className="mt-1 text-right text-xs text-ink-3">{form.note.length} / 1000</p>
      </motion.div>

      {/* Apple Music 逐词歌词 */}
      <motion.div variants={fadeUp}>
        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-line bg-card p-4">
          <Checkbox
            checked={form.hasAppleTtml}
            onCheckedChange={(v) => setField('hasAppleTtml', v)}
            className="mt-0.5"
          />
          <span className="text-sm font-medium text-ink-2">
            这个歌曲在 Apple Music 上有逐词歌词
          </span>
        </label>
      </motion.div>

      {/* 校验提示 */}
      {error && (
        <motion.div variants={fadeUp}>
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </motion.div>
      )}

      {/* 底部操作 */}
      <motion.div
        variants={fadeUp}
        className="flex items-center justify-start gap-3 border-t border-line pt-6"
      >
        <motion.button
          type="button"
          {...buttonTap}
          onClick={handleSubmit}
          disabled={submitting || !canSubmit}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitting ? '提交中...' : submitLabel}
        </motion.button>
      </motion.div>
    </motion.div>
  );
}
