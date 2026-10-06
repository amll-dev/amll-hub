import type { ReactNode } from 'react';
import { Provider } from 'jotai';
import { AuthBoot } from '@/boot/AuthBoot';
import { ThemeBoot } from '@/boot/ThemeBoot';
import { OfflineBanner } from '@/components/OfflineBanner';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { globalStore } from '@/editor/states/store';

export function LyricEditorShell({ children }: { children: ReactNode }) {
  return (
    <Provider store={globalStore}>
      <TooltipProvider delayDuration={300}>
        <ThemeBoot />
        <AuthBoot />
        <OfflineBanner />
        {children}
        <Toaster />
      </TooltipProvider>
    </Provider>
  );
}
