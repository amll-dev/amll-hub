import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { onCLS, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';
import { router } from './router';
import { queryClient } from './lib/query';
import { GlobalErrorBoundary } from './components/ErrorBoundary';
import { PlayerBoot } from '@/boot/PlayerBoot';
import './index.css';

// Web Vitals 采集：DEV 打到控制台；PROD 仅在显式开启 VITE_ENABLE_VITALS 时上报。
const vitalsEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_VITALS === 'true';

function reportVitals(metric: Metric) {
  if (import.meta.env.DEV) {
    console.debug(`[web-vitals] ${metric.name}: ${metric.value.toFixed(2)} (${metric.rating})`);
    return;
  }
  navigator.sendBeacon?.('/api/v1/web-vitals', JSON.stringify(metric));
}

if (vitalsEnabled) {
  onCLS(reportVitals);
  onINP(reportVitals);
  onLCP(reportVitals);
  onTTFB(reportVitals);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GlobalErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <PlayerBoot />
        <RouterProvider router={router} />
      </QueryClientProvider>
    </GlobalErrorBoundary>
  </StrictMode>
);
