import { LegalDocument } from '@/components/LegalDocument';
import termsMarkdown from '@/content/terms.md?raw';

/** 用户协议 */
export function Terms() {
  return (
    <LegalDocument
      title="用户协议"
      subtitle="生效日期：2026 年 11 月 15 日 · 版本 v2.0"
      markdown={termsMarkdown}
    />
  );
}
