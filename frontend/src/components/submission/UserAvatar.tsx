import { useState } from 'react';

/** 头像 */
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
  const [failed, setFailed] = useState(false);
  if (avatar && !failed) {
    return (
      <img
        src={avatar}
        alt=""
        style={{ width: size, height: size }}
        className="rounded-full object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      className="inline-flex items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground"
    >
      {initial}
    </span>
  );
}
