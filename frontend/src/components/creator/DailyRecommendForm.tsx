import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ImagePlus, Loader2, Music, Search } from 'lucide-react';
import { DatePicker } from '@/components/DatePicker';
import { api } from '@/lib/api';
import { insertMarkup, MARKUP_BUTTONS, parseMarkupText } from '@/lib/markup';
import { buttonTap, fadeUp, staggerContainer } from '@/lib/motion';
import type { NcmSong } from '@/lib/types';

/** 格式化日期为 YYYY-MM-DD */
function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 每日推荐投稿表单 */
export function DailyRecommendForm({ onSuccess }: { onSuccess?: (date: string) => void }) {
  const today = useMemo(() => new Date(), []);
  const todayKey = formatDateKey(today);

  // 表单字段
  const [date, setDate] = useState(todayKey);
  const [songName, setSongName] = useState('');
  const [artist, setArtist] = useState('');
  const [ncmId, setNcmId] = useState('');
  const [comment, setComment] = useState('');
  // 搜索结果选中后，递增 key 触发输入框文字淡入动画
  const [flashKey, setFlashKey] = useState(0);

  // 网易云搜索
  const [ncmQuery, setNcmQuery] = useState('');
  const [ncmResults, setNcmResults] = useState<NcmSong[]>([]);
  const [ncmSearching, setNcmSearching] = useState(false);
  const [ncmError, setNcmError] = useState('');

  // 封面上传
  const [cover, setCover] = useState<{
    file?: File;
    url: string;
    tempKey: string;
    progress: number;
    uploading: boolean;
    error: string;
  } | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [coverDragOver, setCoverDragOver] = useState(false);
  // 封面预览图加载状态
  const [coverImgLoaded, setCoverImgLoaded] = useState(false);
  useEffect(() => {
    setCoverImgLoaded(false);
  }, [cover?.url]);

  // 日期查重
  const [dateStatus, setDateStatus] = useState<{
    checked: boolean;
    available: boolean;
    checking: boolean;
  }>({ checked: false, available: true, checking: false });

  // 提交状态
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 网易云搜索
  const doNcmSearch = async () => {
    const q = ncmQuery.trim();
    if (!q) return;
    setNcmSearching(true);
    setNcmError('');
    try {
      const res = await api.searchNcm(q, 8);
      setNcmResults(res.data ?? []);
      if (!res.data || res.data.length === 0) {
        setNcmError('没有找到相关歌曲');
      }
    } catch (e) {
      setNcmError(e instanceof Error ? e.message : '搜索失败');
      setNcmResults([]);
    } finally {
      setNcmSearching(false);
    }
  };

  // 从搜索结果中选中一首，回填表单
  const pickNcmSong = (song: NcmSong) => {
    setSongName(song.name);
    setArtist(song.artists.map((a) => a.name).join(' / '));
    setNcmId(String(song.id));
    setNcmResults([]);
    setNcmQuery('');
    setNcmError('');
    setSubmitMsg(null);
    setFlashKey((k) => k + 1);
    // 自动下载并上传封面
    if (song.picUrl) {
      fetchCoverFromUrl(song.picUrl);
    }
  };

  // 从输入中提取网易云音乐ID
  const parseNcmId = (input: string): string | null => {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const m = trimmed.match(/[?&]id=(\d+)/) || trimmed.match(/^(\d+)$/);
    return m?.[1] ?? null;
  };

  const fetchCoverFromUrl = async (url: string) => {
    if (cover) URL.revokeObjectURL(cover.url);
    // 用远程 URL 作为预览，后端只负责上传到临时区
    setCover({
      url,
      tempKey: '',
      progress: 5,
      uploading: true,
      error: '',
    });
    // 后端下载图片前端拿不到真实进度，按时间比例模拟进度爬升
    const startTime = Date.now();
    const minDuration = 900;
    const progressTimer = setInterval(() => {
      setCover((prev) => {
        if (!prev || !prev.uploading) return prev;
        const elapsed = Date.now() - startTime;
        const target = Math.min((elapsed / minDuration) * 85, 90);
        const next = Math.max(prev.progress, target);
        return next === prev.progress ? prev : { ...prev, progress: next };
      });
    }, 50);
    try {
      const { tempKey } = await api.uploadDailyCoverFromUrl(url);
      const elapsed = Date.now() - startTime;
      if (elapsed < minDuration) {
        await new Promise((r) => setTimeout(r, minDuration - elapsed));
      }
      clearInterval(progressTimer);
      setCover((prev) => (prev ? { ...prev, tempKey, uploading: false, progress: 100 } : prev));
    } catch (e) {
      clearInterval(progressTimer);
      setCover((prev) =>
        prev
          ? {
              ...prev,
              uploading: false,
              error: e instanceof Error ? e.message : '上传失败',
            }
          : prev
      );
      setSubmitMsg({
        type: 'error',
        text: `封面自动载入失败：${e instanceof Error ? e.message : '未知错误'}，请手动上传`,
      });
    }
  };

  // 通过 ID 获取歌曲详情并回填
  const fetchNcmById = async () => {
    const id = parseNcmId(ncmId);
    if (!id) {
      setNcmError('请输入有效的网易云ID或歌曲链接');
      return;
    }
    setNcmSearching(true);
    setNcmError('');
    try {
      const info = await api.parseNcmMusic(id, 'standard');
      if (info.name) setSongName(info.name);
      if (info.artists) setArtist(info.artists);
      setNcmId(id);
      setSubmitMsg(null);
      // 自动下载并上传封面
      if (info.cover) {
        fetchCoverFromUrl(info.cover);
      }
    } catch (e) {
      setNcmError(e instanceof Error ? e.message : '解析失败');
    } finally {
      setNcmSearching(false);
    }
  };

  // 封面上传到临时区
  const uploadCover = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setSubmitMsg({ type: 'error', text: '请上传图片文件' });
      return;
    }
    // 清理旧 objectURL
    if (cover) URL.revokeObjectURL(cover.url);
    const url = URL.createObjectURL(file);
    setCover({ file, url, tempKey: '', progress: 0, uploading: true, error: '' });
    api
      .uploadDailyCover(file, (percent) => {
        setCover((prev) => (prev ? { ...prev, progress: percent } : prev));
      })
      .then(({ tempKey }) => {
        setCover((prev) => (prev ? { ...prev, tempKey, uploading: false, progress: 100 } : prev));
      })
      .catch((e) => {
        setCover((prev) =>
          prev
            ? {
                ...prev,
                uploading: false,
                error: e instanceof Error ? e.message : '上传失败',
              }
            : prev
        );
      });
  };

  const handleCoverInputChange = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    uploadCover(file);
  };

  const removeCover = () => {
    if (cover) URL.revokeObjectURL(cover.url);
    setCover(null);
    if (coverInputRef.current) coverInputRef.current.value = '';
  };

  // 日期变化时查重
  useEffect(() => {
    if (!date) {
      setDateStatus({ checked: false, available: true, checking: false });
      return;
    }
    let cancelled = false;
    setDateStatus({ checked: false, available: true, checking: true });
    api
      .checkDailyDate(date)
      .then((res) => {
        if (cancelled) return;
        setDateStatus({ checked: true, available: res.available, checking: false });
      })
      .catch(() => {
        if (cancelled) return;
        setDateStatus({ checked: false, available: true, checking: false });
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  // 卸载时清理 objectURL
  const coverRef = useRef(cover);
  coverRef.current = cover;
  useEffect(() => {
    return () => {
      if (coverRef.current) URL.revokeObjectURL(coverRef.current.url);
    };
  }, []);

  // 实时预览
  const previewHtml = useMemo(() => parseMarkupText(comment), [comment]);

  const canSubmit =
    !!date &&
    !!songName.trim() &&
    !!artist.trim() &&
    !!comment.trim() &&
    !!cover &&
    !cover.uploading &&
    !cover.error &&
    !!cover.tempKey &&
    dateStatus.available &&
    !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !cover) return;
    setSubmitting(true);
    setSubmitMsg(null);
    try {
      await api.createDailyRecommendation({
        songName: songName.trim(),
        artist: artist.trim(),
        coverTempKey: cover.tempKey,
        date,
        comment,
        ncmId: ncmId.trim() || undefined,
      });
      setSubmitMsg({ type: 'success', text: '投稿成功！' });
      const submittedDate = date;
      // 重置
      setDate(todayKey);
      setSongName('');
      setArtist('');
      setNcmId('');
      setComment('');
      removeCover();
      // 0.5s 后跳转到每日推荐页面对应日期
      setTimeout(() => {
        setSubmitMsg(null);
        onSuccess?.(submittedDate);
      }, 500);
    } catch (err) {
      setSubmitMsg({
        type: 'error',
        text: err instanceof Error ? err.message : '投稿失败',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-6">
      {/* 填写方式 + 网易云搜索 */}
      <motion.div variants={fadeUp} className="rounded-md border border-line bg-card p-5">
        <label className="mb-2 block text-sm font-medium text-ink-2">从网易云搜索填表</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={ncmQuery}
            onChange={(e) => setNcmQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                doNcmSearch();
              }
            }}
            placeholder="输入歌名 / 歌手搜索"
            className="h-11 flex-1 rounded-md border border-input bg-background px-4 text-sm outline-none transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <motion.button
            type="button"
            {...buttonTap}
            onClick={doNcmSearch}
            disabled={ncmSearching || !ncmQuery.trim()}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {ncmSearching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            搜索
          </motion.button>
        </div>

        <AnimatePresence>
          {ncmError && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className="mt-2 text-xs text-error"
            >
              {ncmError}
            </motion.p>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {ncmResults.length > 0 && (
            <motion.ul
              key="ncm-results"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, transition: { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] } }}
              transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
              className="mt-3 max-h-72 divide-y divide-line overflow-y-auto rounded-md border border-line bg-background"
            >
              {ncmResults.map((song) => (
                <li
                  key={song.id}
                  onClick={() => pickNcmSong(song)}
                  className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-surface-2"
                >
                  {song.picUrl ? (
                    <img
                      src={`${song.picUrl}?param=80y80`}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-10 w-10 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-surface-2">
                      <Music className="h-4 w-4 text-ink-3" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-foreground">{song.name}</p>
                    <p className="truncate text-xs text-ink-3">
                      {song.artists.map((a) => a.name).join(' / ')}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-ink-3">{song.duration}</span>
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </motion.div>

      {/* 网易云ID 解析 */}
      <motion.div variants={fadeUp}>
        <label className="mb-1.5 block text-sm font-medium text-ink-2">
          网易云ID <span className="text-xs text-ink-3">（可选）</span>
        </label>
        <div className="flex gap-2">
          <motion.input
            key={`ncmid-${flashKey}`}
            type="text"
            value={ncmId}
            onChange={(e) => setNcmId(e.target.value)}
            placeholder="歌曲ID 或歌曲链接"
            maxLength={50}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="h-11 flex-1 rounded-md border border-input bg-background px-4 text-sm outline-none transition-colors duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <motion.button
            type="button"
            {...buttonTap}
            onClick={fetchNcmById}
            disabled={ncmSearching || !ncmId.trim()}
            className="inline-flex h-11 items-center justify-center rounded-md border border-line bg-card px-4 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            解析
          </motion.button>
        </div>
      </motion.div>

      {/* 音乐名称 */}
      <motion.div variants={fadeUp}>
        <label className="mb-1.5 block text-sm font-medium text-ink-2">
          音乐名称 <span className="text-error">*</span>
        </label>
        <motion.input
          key={`name-${flashKey}`}
          type="text"
          value={songName}
          onChange={(e) => setSongName(e.target.value)}
          maxLength={100}
          placeholder="请输入音乐名称"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="h-11 w-full rounded-md border border-input bg-background px-4 text-sm outline-none transition-colors duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
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
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          maxLength={100}
          placeholder="请输入歌手"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="h-11 w-full rounded-md border border-input bg-background px-4 text-sm outline-none transition-colors duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </motion.div>

      {/* 封面 */}
      <motion.div variants={fadeUp}>
        <label className="mb-1.5 block text-sm font-medium text-ink-2">
          封面 <span className="text-error">*</span>
        </label>
        <input
          ref={coverInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleCoverInputChange(e.target.files)}
        />
        {!cover ? (
          <div
            onClick={() => coverInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setCoverDragOver(true);
            }}
            onDragLeave={() => setCoverDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setCoverDragOver(false);
              handleCoverInputChange(e.dataTransfer.files);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed px-6 py-10 text-center transition-colors ${
              coverDragOver
                ? 'border-primary bg-primary/5'
                : 'border-line bg-background hover:bg-surface-2'
            }`}
          >
            <ImagePlus className="mb-2 h-8 w-8 text-ink-3" />
            <p className="text-sm text-ink-2">点击或拖拽上传封面图</p>
            <p className="mt-1 text-xs text-ink-3">支持 JPG/PNG/WebP，建议正方形</p>
          </div>
        ) : (
          <div className="rounded-md border border-line bg-background p-4">
            <div className="flex items-start gap-4">
              <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-md border border-line">
                {!coverImgLoaded && <div className="absolute inset-0 animate-pulse bg-surface-2" />}
                <img
                  src={cover.url}
                  alt="封面预览"
                  crossOrigin="anonymous"
                  onLoad={() => setCoverImgLoaded(true)}
                  onError={() => setCoverImgLoaded(true)}
                  className={`h-full w-full object-cover transition-opacity duration-300 ${
                    coverImgLoaded ? 'opacity-100' : 'opacity-0'
                  }`}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{cover.file?.name ?? '封面图片'}</p>
                {cover.file && (
                  <p className="mt-1 text-xs text-ink-3">{Math.round(cover.file.size / 1024)} KB</p>
                )}
                <AnimatePresence mode="wait">
                  {cover.uploading ? (
                    <motion.div
                      key="uploading"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.2 }}
                    >
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                        <div
                          className="h-full bg-success transition-all"
                          style={{ width: `${cover.progress}%` }}
                        />
                      </div>
                      <p className="mt-1 text-xs text-ink-3">
                        {cover.file ? `上传中 ${cover.progress}%` : '上传中…'}
                      </p>
                    </motion.div>
                  ) : cover.error ? (
                    <motion.p
                      key="error"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.2 }}
                      className="mt-1 text-xs text-error"
                    >
                      {cover.error}
                    </motion.p>
                  ) : cover.tempKey ? (
                    <motion.p
                      key="done"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.2 }}
                      className="mt-1 inline-flex items-center gap-1 text-xs text-success"
                    >
                      <Check className="h-3 w-3" />
                      上传完成
                    </motion.p>
                  ) : null}
                </AnimatePresence>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => coverInputRef.current?.click()}
                    className="inline-flex h-8 items-center rounded-md border border-line bg-card px-3 text-xs text-ink-2 hover:bg-surface-2"
                  >
                    更换
                  </button>
                  <button
                    type="button"
                    onClick={removeCover}
                    className="inline-flex h-8 items-center rounded-md border border-line bg-card px-3 text-xs text-error hover:bg-error/5"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </motion.div>

      {/* 选择日期 */}
      <motion.div variants={fadeUp}>
        <label className="mb-1.5 block text-sm font-medium text-ink-2">
          选择日期 <span className="text-error">*</span>
        </label>
        <DatePicker value={date} onChange={setDate} placeholder="选择日期" />
        <AnimatePresence>
          {dateStatus.checking && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="mt-1 text-xs text-ink-3"
            >
              正在检查日期可用性...
            </motion.p>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {dateStatus.checked && !dateStatus.available && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="mt-1 text-xs text-error"
            >
              该日期已被占用，请选择其他日期
            </motion.p>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {dateStatus.checked && dateStatus.available && date && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="mt-1 text-xs text-success"
            >
              该日期可用
            </motion.p>
          )}
        </AnimatePresence>
      </motion.div>

      {/* 推荐语 + 标记工具栏 */}
      <motion.div variants={fadeUp}>
        <label className="mb-1.5 block text-sm font-medium text-ink-2">
          推荐语 <span className="text-error">*</span>
        </label>
        <div className="mb-2 flex flex-wrap gap-2">
          {MARKUP_BUTTONS.map((btn) => (
            <button
              key={btn.label}
              type="button"
              title={btn.title}
              onClick={() => {
                if (textareaRef.current) {
                  setComment(insertMarkup(textareaRef.current, btn.markup));
                }
              }}
              className="inline-flex h-8 items-center rounded-md border border-line bg-card px-3 text-xs text-ink-2 transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              {btn.label}
            </button>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={7000}
          rows={8}
          placeholder="输入推荐语，可使用上方标记按钮排版"
          className="w-full rounded-md border border-input bg-background px-4 py-3 text-sm outline-none transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        <p className="mt-1 text-right text-xs text-ink-3">{comment.length} / 7000</p>

        {/* 实时预览 */}
        {comment.trim() && (
          <div className="mt-3">
            <p className="mb-2 text-xs font-medium text-ink-3">实时预览：</p>
            <div
              className="rounded-md border border-line bg-background p-4 text-sm leading-relaxed text-ink-2"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        )}
      </motion.div>

      {/* 协议声明 */}
      <motion.p variants={fadeUp} className="text-center text-xs text-ink-3">
        上传即表示同意
        <button type="button" className="text-primary hover:underline">
          《AMLLHub使用协议》
        </button>
        与
        <button type="button" className="text-primary hover:underline">
          《社区公约》
        </button>
      </motion.p>

      {/* 提交提示 */}
      {submitMsg && (
        <motion.div
          variants={fadeUp}
          className={`rounded-md px-4 py-3 text-sm ${
            submitMsg.type === 'success'
              ? 'border border-success/30 bg-success/5 text-success'
              : 'border border-error/30 bg-error/5 text-error'
          }`}
        >
          {submitMsg.text}
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
          disabled={!canSubmit}
          className="inline-flex h-11 items-center justify-center rounded-md border border-line bg-card px-6 text-sm font-semibold text-ink-2 transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          存草稿
        </motion.button>
        <motion.button
          type="button"
          {...buttonTap}
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitting ? '提交中...' : '立即投稿'}
        </motion.button>
      </motion.div>
    </motion.div>
  );
}
