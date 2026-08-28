/** 用户名展示 */
export function UserDisplayName({
  displayName,
  username,
}: {
  displayName?: string;
  username?: string;
}) {
  const showName = displayName || username || '匿名';
  return (
    <span>
      {showName}
      {displayName && username && displayName !== username && (
        <span className="ml-1 text-xs text-ink-3">@{username}</span>
      )}
    </span>
  );
}
