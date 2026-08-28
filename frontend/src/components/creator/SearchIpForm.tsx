import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  ChevronDown,
  CloudUpload,
  FileText,
  ImagePlus,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { buttonTap } from '@/lib/motion';
import { primaryBtnClass } from '@/components/ui';

type SearchIpSubTab = 'manual' | 'json';

// JSON 数据结构
interface Member {
  authors: string[];
  pictures: string;
  pictures_big: string;
  color: string;
}
interface Group {
  aliases: string[];
  album: string;
  pictures: string;
  pictures_big: string;
  color: string;
  members: Member[];
}
interface SearchIpData {
  groups: Record<string, Group>;
}

// 解析后的节点
interface MindNode {
  name: string;
  color: string;
  picture: string;
  aliases?: string[];
  children?: MindNode[];
}

/** 搜索IP显示投稿表单 */
export function SearchIpForm() {
  const [searchIpSubTab, setSearchIpSubTab] = useState<SearchIpSubTab>('json');
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<SearchIpData | null>(null);
  const [parseError, setParseError] = useState('');
  // 用户上传的图片：文件名 -> { 文件, objectURL, tempKey, progress, uploading, error }
  const [uploadedImages, setUploadedImages] = useState<
    Record<
      string,
      {
        file: File;
        url: string;
        tempKey: string;
        progress: number; // 0-100
        uploading: boolean;
        error: string;
      }
    >
  >({});
  // 上传列表折叠状态
  const [uploadListCollapsed, setUploadListCollapsed] = useState(false);
  // 单张图片更换目标：记录要替换的图片文件名
  const [replaceTarget, setReplaceTarget] = useState<string | null>(null);
  // 搜索IP投稿标题
  const [ipTitle, setIpTitle] = useState('');
  // 投稿提交状态
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // 处理用户上传的图片文件
  // 上传单张图片到临时区，并更新状态
  const uploadOne = (f: File, targetName?: string) => {
    const key = targetName ?? f.name;
    const url = URL.createObjectURL(f);
    // 初始化为上传中
    setUploadedImages((prev) => {
      const next = { ...prev };
      if (next[key]) URL.revokeObjectURL(next[key].url);
      next[key] = { file: f, url, tempKey: '', progress: 0, uploading: true, error: '' };
      return next;
    });
    api
      .uploadTempImage(f, (percent) => {
        setUploadedImages((prev) => {
          const cur = prev[key];
          if (!cur) return prev;
          return { ...prev, [key]: { ...cur, progress: percent } };
        });
      })
      .then(({ tempKey }) => {
        setUploadedImages((prev) => {
          const cur = prev[key];
          if (!cur) return prev;
          return { ...prev, [key]: { ...cur, tempKey, uploading: false, progress: 100 } };
        });
      })
      .catch((e) => {
        setUploadedImages((prev) => {
          const cur = prev[key];
          if (!cur) return prev;
          return {
            ...prev,
            [key]: {
              ...cur,
              uploading: false,
              error: e instanceof Error ? e.message : '上传失败',
            },
          };
        });
      });
  };

  const handleImageUpload = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (list.length === 0) return;

    if (replaceTarget) {
      // 单张替换模式
      const first = list[0];
      if (first) uploadOne(first, replaceTarget);
    } else {
      // 批量添加模式
      for (const f of list) uploadOne(f);
    }
    setReplaceTarget(null);
  };

  // 移除单张图片
  const removeImage = (name: string) => {
    setUploadedImages((prev) => {
      const next = { ...prev };
      if (next[name]) {
        URL.revokeObjectURL(next[name].url);
        delete next[name];
      }
      return next;
    });
  };

  // 清理 objectURL
  const clearUploadedImages = () => {
    setUploadedImages((prev) => {
      Object.values(prev).forEach((item) => URL.revokeObjectURL(item.url));
      return {};
    });
  };

  // 提交搜索IP投稿
  const handleSubmit = async () => {
    if (!parsedData || submitting) return;

    if (!ipTitle.trim()) {
      setSubmitMsg({ type: 'error', text: '请填写标题' });
      return;
    }

    // 检查所有图片是否上传完成
    const uploading = Object.values(uploadedImages).filter((v) => v.uploading);
    if (uploading.length > 0) {
      setSubmitMsg({ type: 'error', text: '还有图片正在上传，请稍候' });
      return;
    }
    const failed = Object.values(uploadedImages).filter((v) => v.error);
    if (failed.length > 0) {
      setSubmitMsg({ type: 'error', text: `${failed.length} 张图片上传失败，请重试` });
      return;
    }

    // 构建 tempKeys 映射
    const tempKeys: Record<string, string> = {};
    for (const [fileName, item] of Object.entries(uploadedImages)) {
      if (item.tempKey) tempKeys[fileName] = item.tempKey;
    }

    setSubmitting(true);
    setSubmitMsg(null);
    try {
      const result = await api.createSearchIpSubmission({
        title: ipTitle.trim(),
        jsonData: parsedData,
        tempKeys,
      });
      setSubmitMsg({
        type: 'success',
        text: `投稿成功！共上传 ${result.imageCount} 张图片`,
      });
      // 投稿成功后重置状态
      clearUploadedImages();
      setSelectedFile(null);
      setParsedData(null);
      setParseError('');
      setIpTitle('');
      const input = document.getElementById('search-ip-json-input') as HTMLInputElement | null;
      if (input) input.value = '';
    } catch (err) {
      setSubmitMsg({
        type: 'error',
        text: err instanceof Error ? err.message : '投稿失败',
      });
    } finally {
      setSubmitting(false);
    }
  };

  // 解析 JSON 文件
  const parseFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string) as SearchIpData;
        if (!data.groups) throw new Error('缺少 groups 字段');
        setParsedData(data);
        setParseError('');
      } catch (err) {
        setParseError(err instanceof Error ? `JSON 解析失败：${err.message}` : 'JSON 解析失败');
        setParsedData(null);
      }
    };
    reader.readAsText(file);
  };

  // 将 parsedData 转为思维导图节点树
  const buildMindNodes = (data: SearchIpData): MindNode[] => {
    return Object.entries(data.groups).map(([name, group]) => ({
      name,
      color: group.color || '#e0303f',
      picture: group.pictures,
      aliases: group.aliases,
      children: group.members.map((m) => ({
        name: m.authors[0] || '未知',
        color: m.color || group.color || '#e0303f',
        picture: m.pictures,
        aliases: m.authors.slice(1),
      })),
    }));
  };
  return (
    <div>
      {/* 子 Tab：手动添加 / JSON上传 */}
      <div className="mb-6 flex gap-6 border-b border-line">
        {(
          [
            { key: 'manual', label: '手动添加' },
            { key: 'json', label: 'JSON 上传' },
          ] as { key: SearchIpSubTab; label: string }[]
        ).map((st) => (
          <button
            key={st.key}
            type="button"
            onClick={() => setSearchIpSubTab(st.key)}
            className={`relative pb-2 text-sm font-medium transition-colors ${
              searchIpSubTab === st.key ? 'text-primary' : 'text-ink-2 hover:text-foreground'
            }`}
          >
            {st.label}
            {searchIpSubTab === st.key && (
              <motion.span
                layoutId="searchip-subtab-indicator"
                className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
          </button>
        ))}
      </div>

      {/* 投稿方式内容（切换动画） */}
      <AnimatePresence mode="wait">
        {/* 手动添加 */}
        {searchIpSubTab === 'manual' && (
          <motion.div
            key="manual"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            <div className="rounded-md border border-dashed border-line bg-surface-2 p-12 text-center">
              <p className="text-sm text-ink-3">手动添加功能开发中，敬请期待</p>
            </div>
          </motion.div>
        )}

        {/* JSON 上传 */}
        {searchIpSubTab === 'json' && (
          <motion.div
            key="json"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            <div>
              {/* 隐藏的文件输入 */}
              <input
                id="search-ip-json-input"
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    clearUploadedImages();
                    setSelectedFile(f);
                    parseFile(f);
                  }
                  e.target.value = '';
                }}
              />
              <input
                id="search-ip-images-input"
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  handleImageUpload(e.target.files);
                  e.target.value = '';
                }}
              />
              {/* 上传区域 */}
              {!selectedFile && (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f) {
                      setSelectedFile(f);
                      parseFile(f);
                    }
                  }}
                  className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-16 transition-colors ${
                    dragOver ? 'border-primary bg-primary-soft' : 'border-line bg-surface-2'
                  }`}
                >
                  <CloudUpload className="h-16 w-16 text-ink-3" />
                  <p className="mt-4 text-sm text-ink-2">点击上传或将文件拖拽到此区域</p>
                  <p className="mt-1 text-xs text-ink-3">支持 .json 格式文件</p>
                  <motion.button
                    type="button"
                    {...buttonTap}
                    onClick={() => document.getElementById('search-ip-json-input')?.click()}
                    className={`mt-6 ${primaryBtnClass}`}
                  >
                    选择文件
                  </motion.button>
                </div>
              )}

              {/* 解析错误提示 */}
              {parseError && (
                <div className="mt-4 rounded-md border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">
                  {parseError}
                </div>
              )}

              {/* 已选文件 - 管理区 */}
              {selectedFile && (
                <div className="mt-6 space-y-6">
                  {/* 标题输入 */}
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-ink-2">
                      标题 <span className="text-error">*</span>
                    </label>
                    <input
                      type="text"
                      value={ipTitle}
                      onChange={(e) => setIpTitle(e.target.value)}
                      maxLength={200}
                      placeholder="请输入投稿标题"
                      className="h-11 w-full rounded-md border border-input bg-background px-4 text-sm outline-none transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                  </div>

                  {/* 文件卡片列表 */}
                  <div className="flex flex-wrap gap-4">
                    {/* JSON 文件卡片 */}
                    <div className="relative flex h-28 w-44 flex-col justify-between overflow-hidden rounded-lg bg-primary p-3 text-white">
                      <div className="flex items-start justify-between">
                        <FileText className="h-6 w-6" />
                        <span className="flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-medium">
                          <Check className="h-3 w-3" />
                          上传完成
                        </span>
                      </div>
                      <div>
                        <p className="truncate text-xs font-semibold">{selectedFile.name}</p>
                        <p className="mt-0.5 text-[10px] opacity-80">
                          {(selectedFile.size / 1024).toFixed(1)} KB · JSON
                        </p>
                      </div>
                    </div>

                    {/* 添加图片文件区域 */}
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.add(
                          'border-primary',
                          'text-primary',
                          'bg-primary-soft'
                        );
                      }}
                      onDragLeave={(e) => {
                        e.currentTarget.classList.remove(
                          'border-primary',
                          'text-primary',
                          'bg-primary-soft'
                        );
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.remove(
                          'border-primary',
                          'text-primary',
                          'bg-primary-soft'
                        );
                        const files = e.dataTransfer.files;
                        if (files && files.length > 0) {
                          // 只处理图片文件
                          const imageFiles = Array.from(files).filter((f) =>
                            f.type.startsWith('image/')
                          );
                          if (imageFiles.length > 0) {
                            const dt = new DataTransfer();
                            imageFiles.forEach((f) => dt.items.add(f));
                            handleImageUpload(dt.files);
                          }
                        }
                      }}
                      onClick={() => document.getElementById('search-ip-images-input')?.click()}
                      className="flex h-28 w-44 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line bg-surface-2 text-ink-3 transition-colors hover:border-primary hover:text-primary"
                    >
                      <ImagePlus className="h-8 w-8" />
                      <span className="text-sm">
                        {Object.keys(uploadedImages).length > 0
                          ? `已上传 ${Object.keys(uploadedImages).length} 张`
                          : '添加图片'}
                      </span>
                      <span className="text-[10px] text-ink-3">点击或拖拽导入</span>
                    </div>
                  </div>

                  {/* 文件上传列表 */}
                  <div className="rounded-md border border-line bg-card">
                    <button
                      type="button"
                      onClick={() => setUploadListCollapsed((v) => !v)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-surface-2"
                    >
                      <div className="flex items-center gap-2">
                        <motion.span
                          animate={{ rotate: uploadListCollapsed ? 0 : 180 }}
                          transition={{ duration: 0.2 }}
                          className="text-ink-3"
                        >
                          <ChevronDown className="h-4 w-4" />
                        </motion.span>
                        <span className="text-xs font-medium text-ink-2">
                          上传列表（{1 + Object.keys(uploadedImages).length} 个文件）
                        </span>
                        {!uploadListCollapsed && (
                          <span className="flex items-center gap-1 text-[10px] text-success">
                            <Check className="h-3 w-3" />
                            全部上传完成
                          </span>
                        )}
                      </div>
                    </button>
                    {/* 内容区 */}
                    <AnimatePresence initial={false}>
                      {!uploadListCollapsed && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2, ease: 'easeOut' }}
                          className="overflow-hidden"
                        >
                          <div className="space-y-3 border-t border-line px-4 py-3">
                            {/* JSON 文件项 */}
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary text-white">
                                <FileText className="h-5 w-5" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="truncate text-sm font-medium text-foreground">
                                    {selectedFile.name}
                                  </span>
                                  <span className="shrink-0 text-[10px] text-ink-3">
                                    {(selectedFile.size / 1024).toFixed(1)} KB
                                  </span>
                                  <span className="flex shrink-0 items-center gap-1 text-xs text-success">
                                    <Check className="h-3 w-3" />
                                    上传完成
                                  </span>
                                </div>
                                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                                  <div className="h-full w-full rounded-full bg-success" />
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  document.getElementById('search-ip-json-input')?.click()
                                }
                                className="flex shrink-0 items-center gap-1 text-xs text-primary transition-colors hover:underline"
                                aria-label="更换 JSON 文件"
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                                更换
                              </button>
                            </div>
                            {/* 图片文件项 */}
                            {Object.entries(uploadedImages).map(([name, item]) => (
                              <div key={name} className="flex items-center gap-3">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-2">
                                  <img
                                    src={item.url}
                                    alt={name}
                                    className="h-full w-full object-cover"
                                  />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="truncate text-sm font-medium text-foreground">
                                      {name}
                                    </span>
                                    <span className="shrink-0 text-[10px] text-ink-3">
                                      {(item.file.size / 1024).toFixed(1)} KB
                                    </span>
                                    {item.uploading ? (
                                      <span className="shrink-0 text-xs text-ink-3">
                                        {item.progress}%
                                      </span>
                                    ) : item.error ? (
                                      <span className="shrink-0 text-xs text-error">失败</span>
                                    ) : (
                                      <span className="flex shrink-0 items-center gap-1 text-xs text-success">
                                        <Check className="h-3 w-3" />
                                        上传完成
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                                    <div
                                      className={`h-full rounded-full transition-all ${
                                        item.error ? 'bg-error' : 'bg-success'
                                      }`}
                                      style={{ width: `${item.progress}%` }}
                                    />
                                  </div>
                                  {item.error && (
                                    <p className="mt-1 text-[10px] text-error">{item.error}</p>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setReplaceTarget(name);
                                    document.getElementById('search-ip-images-input')?.click();
                                  }}
                                  className="flex shrink-0 items-center gap-1 text-xs text-primary transition-colors hover:underline"
                                  aria-label="更换图片"
                                >
                                  <RefreshCw className="h-3.5 w-3.5" />
                                  更换
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeImage(name)}
                                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-error/5 hover:text-error"
                                  aria-label="移除图片"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* 文件指向显示区 */}
                  {parsedData && (
                    <div className="rounded-md border border-line bg-card p-6">
                      <h3 className="mb-4 text-sm font-semibold text-foreground">文件指向显示</h3>
                      <div className="space-y-6">
                        {buildMindNodes(parsedData).map((group) => (
                          <div key={group.name}>
                            {/* 根节点 */}
                            <div className="flex items-center gap-3">
                              <div
                                className="h-10 w-10 shrink-0 rounded-full"
                                style={{ backgroundColor: group.color }}
                                title={group.name}
                              />
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-foreground">
                                  {group.name}
                                </p>
                                {group.aliases && group.aliases.length > 0 && (
                                  <p className="truncate text-xs text-ink-3">
                                    {group.aliases.join(' / ')}
                                  </p>
                                )}
                              </div>
                              <div className="ml-auto flex items-center gap-2 rounded-md bg-surface-2 px-2.5 py-1">
                                {group.picture && uploadedImages[group.picture]?.url ? (
                                  <img
                                    src={uploadedImages[group.picture]?.url}
                                    alt={group.name}
                                    className="h-10 max-w-[120px] w-auto rounded object-contain"
                                    onError={(e) => {
                                      (e.target as HTMLImageElement).style.display = 'none';
                                    }}
                                  />
                                ) : group.picture ? (
                                  <>
                                    <ImagePlus className="h-3.5 w-3.5 text-ink-3" />
                                    <span className="text-xs text-ink-3">
                                      {group.picture}（未上传）
                                    </span>
                                  </>
                                ) : (
                                  <span className="text-xs text-ink-3">无图片</span>
                                )}
                              </div>
                            </div>
                            {/* 连接线 */}
                            {group.children && group.children.length > 0 && (
                              <div className="ml-5 mt-2 space-y-2 border-l-2 border-line pl-5">
                                {group.children.map((member) => (
                                  <div key={member.name} className="flex items-center gap-3">
                                    <div
                                      className="h-3 w-3 shrink-0 rounded-full"
                                      style={{ backgroundColor: member.color }}
                                    />
                                    <div className="min-w-0 flex-1">
                                      <p className="text-sm text-foreground">{member.name}</p>
                                      {member.aliases && member.aliases.length > 0 && (
                                        <p className="truncate text-xs text-ink-3">
                                          {member.aliases.join(' / ')}
                                        </p>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 rounded-md bg-surface-2 px-2.5 py-1">
                                      {member.picture && uploadedImages[member.picture]?.url ? (
                                        <img
                                          src={uploadedImages[member.picture]?.url}
                                          alt={member.name}
                                          className="h-10 max-w-[120px] w-auto rounded object-contain"
                                          onError={(e) => {
                                            (e.target as HTMLImageElement).style.display = 'none';
                                          }}
                                        />
                                      ) : member.picture ? (
                                        <>
                                          <ImagePlus className="h-3.5 w-3.5 text-ink-3" />
                                          <span className="text-xs text-ink-3">
                                            {member.picture}（未上传）
                                          </span>
                                        </>
                                      ) : (
                                        <span className="text-xs text-ink-3">无图片</span>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 协议声明 */}
              <p className="mt-6 text-center text-xs text-ink-3">
                上传即表示同意
                <button type="button" className="text-primary hover:underline">
                  《AMLL Hub使用协议》
                </button>
                与
                <button type="button" className="text-primary hover:underline">
                  《社区公约》
                </button>
              </p>

              {/* 提交提示消息 */}
              {submitMsg && (
                <div
                  className={`mt-4 rounded-md px-4 py-3 text-sm ${
                    submitMsg.type === 'success'
                      ? 'border border-success/30 bg-success/5 text-success'
                      : 'border border-error/30 bg-error/5 text-error'
                  }`}
                >
                  {submitMsg.text}
                </div>
              )}

              {/* 底部操作按钮 */}
              <div className="mt-6 flex items-center justify-start gap-3 border-t border-line pt-6">
                <motion.button
                  type="button"
                  {...buttonTap}
                  disabled={!selectedFile || submitting}
                  className="inline-flex h-11 items-center justify-center rounded-md border border-line bg-card px-6 text-sm font-semibold text-ink-2 transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  存草稿
                </motion.button>
                <motion.button
                  type="button"
                  {...buttonTap}
                  onClick={handleSubmit}
                  disabled={!selectedFile || submitting}
                  className={primaryBtnClass}
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {submitting ? '提交中...' : '立即投稿'}
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
