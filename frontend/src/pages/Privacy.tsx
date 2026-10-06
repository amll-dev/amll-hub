import { LegalDocument } from '@/components/LegalDocument';
import privacyMarkdown from '@/content/privacy.md?raw';

/** 隐私政策 */
export function Privacy() {
  return (
    <LegalDocument
      title="隐私政策"
      subtitle="生效日期：2026 年 10 月 4 日 · 版本 v1.0"
      markdown={privacyMarkdown}
    />
  );
}
