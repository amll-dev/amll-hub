import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { onCLS, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';
import { router } from './router';
import { queryClient } from './lib/query';
import { GlobalErrorBoundary } from './components/ErrorBoundary';
import './index.css';

// Web Vitals 采集：DEV 打到控制台；PROD sendBeacon 上报（后端端点接入前静默失败，无害）
function reportVitals(metric: Metric) {
  if (import.meta.env.DEV) {
    console.debug(`[web-vitals] ${metric.name}: ${metric.value.toFixed(2)} (${metric.rating})`);
    return;
  }
  navigator.sendBeacon?.('/api/v1/web-vitals', JSON.stringify(metric));
}

onCLS(reportVitals);
onINP(reportVitals);
onLCP(reportVitals);
onTTFB(reportVitals);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GlobalErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </GlobalErrorBoundary>
  </StrictMode>
);
