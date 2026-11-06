import { createRoot } from 'react-dom/client';
import { App } from './app';
import { FactoryCanvasPrototype } from './factory-canvas-prototype';
import './style.css';
const root = document.getElementById('root');
if (!root) throw new Error('Factory app root missing');
createRoot(root).render(
  new URLSearchParams(location.search).get('view') === 'operations' ? (
    <App />
  ) : (
    <FactoryCanvasPrototype />
  )
);
