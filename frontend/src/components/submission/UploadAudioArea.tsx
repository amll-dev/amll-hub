import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Loader2, Music, X } from 'lucide-react';
import { parseBlob } from 'music-metadata';
import { api } from '@/lib/api';
import { buttonTap } from '@/lib/motion';

/** 解析音频文件的 ID3/原子容器元数据 */
async function parseAudioMeta(file: File): Promise<{
  title?: string;
  artist?: string;
  album?: string;
  cover?: File;
}> {
  const out: { title?: string; artist?: string; album?: string; cover?: File } = {};
  try {
    const metadata = await parseBlob(file);
    const common = metadata.common;
    if (common.title?.trim()) out.title = common.title.trim();
    if (common.artist?.trim()) out.artist = common.artist.trim();
    if (common.album?.trim()) out.album = common.album.trim();
    const pic = common.picture?.[0];
    if (pic && pic.data && pic.data.length > 0 && pic.format) {
      try {
        const ext = pic.format.includes('png')
          ? 'png'
          : pic.format.includes('webp')
            ? 'webp'
            : 'jpg';
        const blob = new Blob([pic.data as unknown as BlobPart], { type: pic.format });
        out.cover = new File([blob], `cover.${ext}`, { type: pic.format });
      } catch {
        // 封面解析失败忽略
      }
    }
  } catch (err) {
    console.error('[parseAudioMeta] 解析音频元数据失败:', err);
  }
  return out;
}

export interface UploadAudioAreaProps {
  submissionId: number;
  onClose: () => void;
  onSuccess: () => void;
}

/** 上传音频区 */
export function UploadAudioArea({ submissionId, onClose, onSuccess }: UploadAudioAreaProps) {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string>('');
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [platform, setPlatform] = useState('');
  const [platformId, setPlatformId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  // 封面预览：coverFile 变化时生成 / 清理 ObjectURL
  useEffect(() => {
    if (coverFile) {
      const url = URL.createObjectURL(coverFile);
      setCoverPreview(url);
      return () => URL.revokeObjectURL(url);
    }
    setCoverPreview('');
    return;
  }, [coverFile]);

  // 选择音频文件后立即解析元数据，自动填入表单
  const handleAudioSelect = async (f: File) => {
    setAudioFile(f);
    setParsing(true);
    try {
      const meta = await parseAudioMeta(f);
      if (meta.title && !title) setTitle(meta.title);
      if (meta.artist && !artist) setArtist(meta.artist);
      if (meta.album && !album) setAlbum(meta.album);
      // 内嵌封面：仅当用户未手动选封面时填入
      if (meta.cover && !coverFile) setCoverFile(meta.cover);
      const filled = [meta.title, meta.artist, meta.album, meta.cover].filter(Boolean).length;
      if (filled === 0) {
        setMsg({
          type: 'error',
          text: '未能从音频文件解析到元数据（可能无 ID3 标签），请手动填写',
        });
      } else {
        setMsg(null);
      }
    } catch (err) {
      setMsg({
        type: 'error',
        text: `音频元数据解析失败：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setParsing(false);
    }
  };

  const submit = async () => {
    if (!audioFile) {
      setMsg({ type: 'error', text: '请选择音频文件' });
      return;
    }
    setUploading(true);
    setMsg(null);
    try {
      // title/artist/album 留空时后端会自动从音频 ID3 元数据解析回填
      await api.uploadAudio(submissionId, audioFile, coverFile ?? undefined, {
        title: title || undefined,
        artist: artist || undefined,
        album: album || undefined,
        platform: platform || undefined,
        platformId: platformId || undefined,
      });

      setMsg({ type: 'success', text: '音频已上传，可继续上传或关闭' });
      // 刷新详情但保持表单打开，允许继续上传
      onSuccess();
      // 重置表单以便上传下一个
      setAudioFile(null);
      setCoverFile(null);
      setTitle('');
      setArtist('');
      setAlbum('');
      setPlatform('');
      setPlatformId('');
      if (audioInputRef.current) audioInputRef.current.value = '';
      if (coverInputRef.current) coverInputRef.current.value = '';
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : '上传失败' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="rounded-lg border border-line bg-surface-2 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">上传音频文件</h4>
        <button type="button" onClick={onClose} className="text-ink-3 hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4">
        {/* 音频文件 */}
        <div
          onClick={() => audioInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) handleAudioSelect(f);
          }}
          className="cursor-pointer rounded-md border-2 border-dashed border-line bg-background py-6 text-center transition-colors hover:border-primary/50"
        >
          <Music className="mx-auto h-7 w-7 text-ink-3" />
          <p className="mt-2 text-sm text-ink-2">
            {audioFile ? audioFile.name : '点击或拖拽音频文件（MP3/M4A/FLAC/WAV）'}
          </p>
          {parsing && (
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-primary">
              <Loader2 className="h-3 w-3 animate-spin" />
              正在解析音频元数据…
            </p>
          )}
        </div>
        <input
          ref={audioInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleAudioSelect(f);
          }}
        />

        {/* 表单 */}
        <p className="text-xs text-ink-3">选择音频文件后自动解析元数据并填入下方表单，可手动修改</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-ink-3">歌曲名称</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="留空自动解析"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-ink-3">艺术家</label>
            <input
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              placeholder="留空自动解析"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-ink-3">专辑</label>
            <input
              value={album}
              onChange={(e) => setAlbum(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-ink-3">来源平台</label>
            <input
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              list="platform-list"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"
            />
            <datalist id="platform-list">
              <option value="网易云音乐" />
              <option value="QQ音乐" />
              <option value="Spotify" />
              <option value="Apple Music" />
              <option value="YouTube Music" />
            </datalist>
          </div>
          <div>
            <label className="mb-1 block text-xs text-ink-3">平台 ID/链接</label>
            <input
              value={platformId}
              onChange={(e) => setPlatformId(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-ink-3">封面</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                className="inline-flex h-9 items-center rounded-md border border-input bg-background px-3 text-xs text-ink-2 hover:bg-surface-2"
              >
                {coverFile ? '更换封面' : '选择封面'}
              </button>
              {coverFile && (
                <button
                  type="button"
                  onClick={() => setCoverFile(null)}
                  className="text-xs text-red-600 hover:underline"
                >
                  移除
                </button>
              )}
              {coverPreview && (
                <img
                  src={coverPreview}
                  alt="封面预览"
                  className="h-9 w-9 rounded border border-line object-cover"
                />
              )}
            </div>
            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setCoverFile(f);
              }}
            />
          </div>
        </div>

        {msg && (
          <div
            className={`rounded-md px-4 py-2 text-sm ${
              msg.type === 'success' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
            }`}
          >
            {msg.text}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-input bg-card px-4 py-2 text-sm text-ink-2 hover:bg-surface-2"
          >
            取消
          </button>
          <motion.button
            type="button"
            onClick={submit}
            disabled={uploading}
            {...buttonTap}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            确认上传
          </motion.button>
        </div>
      </div>
    </div>
  );
}
