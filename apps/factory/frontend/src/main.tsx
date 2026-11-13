import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { FactoryApp } from './canvas/app';
const root = document.getElementById('root');
if (!root) throw new Error('Factory app root missing');
const ActivityPrototype = lazy(() => import('./canvas/activity-prototype'));
const Operations = lazy(() => import('./operations'));
createRoot(root).render(
  import.meta.env.DEV &&
    (import.meta.env.MODE === 'activity-prototype' ||
      new URLSearchParams(location.search).has('prototype')) ? (
    <Suspense fallback={<p>Loading prototype…</p>}>
      <ActivityPrototype />
    </Suspense>
  ) : new URLSearchParams(location.search).get('view') === 'operations' ? (
    <Suspense fallback={<p>Loading operations…</p>}>
      <Operations />
    </Suspense>
  ) : (
    <FactoryApp />
  )
);
