import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { FactoryApp } from './canvas/app';
const root = document.getElementById('root');
if (!root) throw new Error('Factory app root missing');
const Operations = lazy(() => import('./operations'));
createRoot(root).render(
  new URLSearchParams(location.search).get('view') === 'operations' ? (
    <Suspense fallback={<p>Loading operations…</p>}>
      <Operations />
    </Suspense>
  ) : (
    <FactoryApp />
  )
);
