import { LegalDocument } from '@/components/LegalDocument';
import privacyMarkdown from '@/content/privacy.md?raw';

/** 隐私政策 */
export function Privacy() {
  return (
    <LegalDocument
      title="隐私政策"
      subtitle="生效日期：2026 年 11 月 15 日 · 版本 v2.0"
      markdown={privacyMarkdown}
    />
  );
}
