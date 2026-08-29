import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

/** 头像（Radix Avatar：图片加载失败自动回退首字母） */
export function UserAvatar({
  avatar,
  name,
  size = 32,
}: {
  avatar?: string;
  name?: string;
  size?: number;
}) {
  const initial = (name || '?').charAt(0).toUpperCase();
  return (
    <Avatar style={{ width: size, height: size }}>
      {avatar && <AvatarImage src={avatar} alt="" />}
      <AvatarFallback style={{ fontSize: size * 0.4 }}>{initial}</AvatarFallback>
    </Avatar>
  );
}
