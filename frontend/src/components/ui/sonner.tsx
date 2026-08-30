import { useAtomValue } from 'jotai';
import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { resolvedThemeAtom } from '@/atoms/theme';

/** 全局 toast 容器（sonner），配色走项目设计 token（深浅色随 CSS 变量自动切换） */
function Toaster(props: ToasterProps) {
  const resolved = useAtomValue(resolvedThemeAtom);
  return (
    <Sonner
      theme={resolved}
      position="top-center"
      style={
        {
          '--normal-bg': 'var(--amll-card)',
          '--normal-text': 'var(--amll-ink)',
          '--normal-border': 'var(--amll-line)',
          '--success-bg': 'var(--amll-card)',
          '--success-text': 'var(--amll-state-success)',
          '--success-border': 'var(--amll-line)',
          '--error-bg': 'var(--amll-card)',
          '--error-text': 'var(--amll-state-error)',
          '--error-border': 'var(--amll-line)',
        } as ToasterProps['style']
      }
      {...props}
    />
  );
}

export { Toaster };
