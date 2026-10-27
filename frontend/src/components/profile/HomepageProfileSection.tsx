import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAtom } from 'jotai';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { IdCard, Image as ImageIcon, Loader2, Save, Upload } from 'lucide-react';
import { z } from 'zod';
import { bannerMsgAtom, localProfileMsgAtom } from '@/atoms/profileForm';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { cn } from '@/lib/utils';
import { compressBanner } from '@/lib/image';
import { buttonTap } from '@/lib/motion';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/DatePicker';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { SectionCard } from '@/components/profile/SectionCard';
import type { Gender, PublicUserProfile } from '@/lib/types';

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'unknown', label: '保密' },
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
  { value: 'other', label: '其他' },
];

const BIO_MAX = 200;

const localProfileSchema = z.object({
  bio: z.string().trim().max(BIO_MAX, `签名最多 ${BIO_MAX} 字`),
  birthday: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
    .or(z.literal('')),
  gender: z.enum(['male', 'female', 'other', 'unknown']),
});
type LocalProfileValues = z.infer<typeof localProfileSchema>;

/**
 * 个人中心「主页资料 + 主页背景图」两块。
 *
 * 资料存在本站的 user_profiles 表，读取复用公开主页的聚合接口。
 */
export function HomepageProfileSection() {
  const { user } = useAuth();
  const username = user?.name ?? '';

  const profileQuery = useQuery({
    queryKey: queryKeys.userProfile(username),
    queryFn: () => api.getUserProfile(username),
    enabled: username !== '',
    staleTime: 60_000,
  });

  if (profileQuery.isPending) {
    return (
      <div className="space-y-6">
        <SectionCard icon={<IdCard />} title="主页资料">
          <Skeleton className="h-44 w-full" />
        </SectionCard>
        <SectionCard icon={<ImageIcon />} title="主页背景图">
          <Skeleton className="h-28 w-full" />
        </SectionCard>
      </div>
    );
  }

  if (profileQuery.error || !profileQuery.data) {
    return (
      <SectionCard icon={<IdCard />} title="主页资料" description="这些字段展示在 /user/你的用户名">
        <p className="text-sm text-error">
          {profileQuery.error instanceof Error
            ? profileQuery.error.message
            : '加载失败，请稍后重试'}
        </p>
      </SectionCard>
    );
  }

  // 数据就绪后才挂载表单，避免 useForm 的 defaultValues 拿到空值
  return (
    <div className="space-y-6">
      <LocalProfileForm username={username} profile={profileQuery.data} />
      <BannerSection username={username} profile={profileQuery.data} />
    </div>
  );
}

function LocalProfileForm({ username, profile }: { username: string; profile: PublicUserProfile }) {
  const queryClient = useQueryClient();
  const [msg, setMsg] = useAtom(localProfileMsgAtom);

  const form = useForm<LocalProfileValues>({
    resolver: zodResolver(localProfileSchema),
    defaultValues: {
      bio: profile.bio,
      birthday: profile.birthday ?? '',
      gender: profile.gender,
    },
  });

  const mutation = useMutation({
    mutationFn: (v: LocalProfileValues) =>
      api.updateMyProfile({
        bio: v.bio,
        birthday: v.birthday === '' ? null : v.birthday,
        gender: v.gender,
      }),
    onMutate: () => setMsg(null),
    onSuccess: (fields) => {
      queryClient.setQueryData<PublicUserProfile>(queryKeys.userProfile(username), (prev) =>
        prev ? { ...prev, ...fields } : prev
      );
      setMsg({ ok: true, text: '主页资料已保存' });
    },
    onError: (err: Error) => setMsg({ ok: false, text: err.message || '保存失败' }),
  });

  // 用本地时区拼日期：toISOString 是 UTC，东八区早上 8 点前会算成昨天
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  return (
    <SectionCard icon={<IdCard />} title="主页资料" description="展示在个人主页 ">
      <Form {...form}>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
          <FormField
            control={form.control}
            name="bio"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-medium text-ink-2">个性签名</FormLabel>
                <FormControl>
                  <Textarea
                    rows={3}
                    placeholder="一句话介绍自己"
                    className="resize-none"
                    maxLength={BIO_MAX}
                    {...field}
                  />
                </FormControl>
                <div className="flex items-center justify-between">
                  <FormMessage />
                  <span className="text-xs text-ink-3">
                    {field.value.length}/{BIO_MAX}
                  </span>
                </div>
              </FormItem>
            )}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="birthday"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium text-ink-2">生日</FormLabel>
                  <FormControl>
                    <DatePicker value={field.value} onChange={field.onChange} max={today} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="gender"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium text-ink-2">性别</FormLabel>
                  <div role="radiogroup" aria-label="性别" className="flex h-11 items-center gap-2">
                    {GENDER_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={field.value === o.value}
                        onClick={() => field.onChange(o.value)}
                        className={cn(
                          'h-9 rounded-md border px-3 text-sm transition-colors',
                          field.value === o.value
                            ? 'border-primary bg-primary-soft font-medium text-primary'
                            : 'border-input bg-card text-ink-2 hover:border-primary/50 hover:text-foreground'
                        )}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" disabled={mutation.isPending} {...buttonTap}>
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {mutation.isPending ? '保存中…' : '保存'}
            </Button>
            {msg && (
              <p className={`text-sm ${msg.ok ? 'text-success' : 'text-error'}`}>{msg.text}</p>
            )}
          </div>
        </form>
      </Form>
    </SectionCard>
  );
}

function BannerSection({ username, profile }: { username: string; profile: PublicUserProfile }) {
  const queryClient = useQueryClient();
  const [msg, setMsg] = useAtom(bannerMsgAtom);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (file: File) => {
      const compressed = await compressBanner(file);
      return api.uploadBanner(compressed);
    },
    onMutate: () => setMsg(null),
    onSuccess: (bannerKey) => {
      queryClient.setQueryData<PublicUserProfile>(queryKeys.userProfile(username), (prev) =>
        prev ? { ...prev, bannerKey } : prev
      );
      setMsg({ ok: true, text: '背景图已更新' });
    },
    onError: (err: Error) => setMsg({ ok: false, text: err.message || '上传失败' }),
    onSettled: () => {
      setPreview(null);
      if (inputRef.current) inputRef.current.value = '';
    },
  });

  // 本地预览的 objectURL 用完即回收
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const bannerUrl = preview ?? (profile.bannerKey ? api.uploadFileUrl(profile.bannerKey) : '');

  return (
    <SectionCard
      icon={<ImageIcon />}
      title="主页背景图"
      description="建议横图（3:1），上传后自动居中裁切并压缩为 WebP"
    >
      <div className="relative aspect-[3/1] w-full overflow-hidden rounded-md border border-line bg-surface-2">
        {bannerUrl ? (
          <img src={bannerUrl} alt="" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-ink-3">
            还没有设置背景图
          </div>
        )}
        {mutation.isPending && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setPreview(URL.createObjectURL(file));
            mutation.mutate(file);
          }}
        />
        <Button
          type="button"
          variant="secondary"
          {...buttonTap}
          disabled={mutation.isPending}
          onClick={() => inputRef.current?.click()}
        >
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          {mutation.isPending ? '上传中…' : profile.bannerKey ? '更换背景图' : '上传背景图'}
        </Button>
        {msg && <p className={`text-sm ${msg.ok ? 'text-success' : 'text-error'}`}>{msg.text}</p>}
      </div>
    </SectionCard>
  );
}
