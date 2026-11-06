import { createRoot } from 'react-dom/client';
import { App } from './app';
import { LayoutPrototype } from './layout-prototype';
import { VerticalPrototype } from './vertical-prototype';
import { FactoryCanvasPrototype } from './factory-canvas-prototype';
import './style.css';
const root = document.getElementById('root');
if (!root) throw new Error('Factory app root missing');
createRoot(root).render(
  new URLSearchParams(location.search).get('view') === 'operations' ? (
    <App />
  ) : new URLSearchParams(location.search).get('layout') === 'previous' ? (
    <LayoutPrototype />
  ) : new URLSearchParams(location.search).get('layout') === 'vertical' ? (
    <VerticalPrototype />
  ) : (
    <FactoryCanvasPrototype />
  )
);
