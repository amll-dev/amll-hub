export function usernameOf(raw?: string | null): string {
  const value = raw?.trim() ?? '';
  if (!value) return '';
  const idx = value.lastIndexOf('/');
  return idx === -1 ? value : value.slice(idx + 1);
}
