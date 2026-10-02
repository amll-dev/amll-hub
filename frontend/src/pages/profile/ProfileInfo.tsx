import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useAtom } from 'jotai';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Camera, Loader2, Save } from 'lucide-react';
import { z } from 'zod';
import { avatarMsgAtom, profileMsgAtom } from '@/atoms/profileForm';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { compressAvatar } from '@/lib/image';
import { buttonTap } from '@/lib/motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { SectionCard } from '@/components/profile/SectionCard';
import { AvatarUploadDialog } from '@/components/profile/AvatarUploadDialog';
import { fieldClass, useResetProfileForm } from './shared';

const profileSchema = z.object({
  displayName: z.string().trim().min(1, '昵称不能为空'),
});
type ProfileValues = z.infer<typeof profileSchema>;

/** 我的信息 */
export function ProfileInfo() {
  const { user, refreshUser } = useAuth();
  useResetProfileForm();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [avatarMsg, setAvatarMsg] = useAtom(avatarMsgAtom);
  const [profileMsg, setProfileMsg] = useAtom(profileMsgAtom);
  /** 选好但还没确认上传的头像原图 */
  const [avatarFile, setAvatarFile] = useState<File | null>(null);

  const profileForm = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { displayName: user?.displayName ?? '' },
  });

  const avatarMutation = useMutation({
    // 本地先裁成居中正方形并压缩
    mutationFn: async (vars: { file: File; zoom: number }) => {
      const compressed = await compressAvatar(vars.file, vars.zoom);
      return api.uploadAvatar(compressed);
    },
    onMutate: () => setAvatarMsg(null),
    onSuccess: async () => {
      await refreshUser();
      setAvatarMsg({ ok: true, text: '头像更新成功' });
    },
    onError: (err: Error) => setAvatarMsg({ ok: false, text: err.message || '头像更新失败' }),
    onSettled: () => {
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
  });

  const closeAvatarDialog = () => {
    setAvatarFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const profileMutation = useMutation({
    mutationFn: (vars: ProfileValues) => api.updateProfile({ displayName: vars.displayName }),
    onMutate: () => setProfileMsg(null),
    onSuccess: async () => {
      await refreshUser();
      setProfileMsg({ ok: true, text: '资料保存成功' });
    },
    onError: (err: Error) => setProfileMsg({ ok: false, text: err.message || '保存失败' }),
  });
  const profileSaving = profileMutation.isPending;

  if (!user) return null;
  const initial = (user.displayName || user.name || '?').charAt(0).toUpperCase();

  return (
    <div className="space-y-6">
      {/* 头像 */}
      <SectionCard icon={<Camera />} title="头像" description="支持 JPG / PNG / WebP，最大 50MB">
        <div className="flex flex-wrap items-center gap-5">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-2xl font-semibold text-primary-foreground">
            {user.avatar ? (
              <img
                src={user.avatar}
                alt={user.displayName || user.name}
                decoding="async"
                className="h-20 w-20 rounded-full object-cover"
              />
            ) : (
              initial
            )}
          </div>
          <div className="min-w-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                // 先弹预览框确认构图，确认后才压缩上传
                if (file) setAvatarFile(file);
              }}
              className="hidden"
            />
            <Button
              type="button"
              variant="secondary"
              {...buttonTap}
              disabled={avatarMutation.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              {avatarMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Camera className="h-4 w-4" />
              )}
              {avatarMutation.isPending ? '上传中…' : '更换头像'}
            </Button>
            {avatarMsg && (
              <p className={`mt-2 text-sm ${avatarMsg.ok ? 'text-success' : 'text-error'}`}>
                {avatarMsg.text}
              </p>
            )}
          </div>
        </div>
      </SectionCard>

      <AvatarUploadDialog
        open={avatarFile !== null}
        file={avatarFile}
        pending={avatarMutation.isPending}
        onCancel={closeAvatarDialog}
        onConfirm={(zoom) => {
          if (!avatarFile) return;
          avatarMutation.mutate({ file: avatarFile, zoom }, { onSettled: closeAvatarDialog });
        }}
      />

      {/* 昵称 + 用户名 */}
      <SectionCard icon={<Save />} title="基本资料" description="用户名注册后不可修改">
        <Form {...profileForm}>
          <form
            onSubmit={profileForm.handleSubmit((v) => profileMutation.mutate(v))}
            className="space-y-4"
          >
            <FormField
              control={profileForm.control}
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium text-ink-2">昵称</FormLabel>
                  <FormControl>
                    <Input type="text" placeholder="输入昵称" className={fieldClass} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-2">用户名</label>
              <Input
                type="text"
                value={user.name}
                readOnly
                className={`${fieldClass} cursor-not-allowed opacity-70`}
              />
            </div>
            <div className="flex items-center gap-3 pt-1">
              <Button type="submit" disabled={profileSaving} {...buttonTap}>
                {profileSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {profileSaving ? '保存中…' : '保存'}
              </Button>
              {profileMsg && (
                <p className={`text-sm ${profileMsg.ok ? 'text-success' : 'text-error'}`}>
                  {profileMsg.text}
                </p>
              )}
            </div>
          </form>
        </Form>
      </SectionCard>
    </div>
  );
}
