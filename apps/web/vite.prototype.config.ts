// Throwaway #258 server. Uses the app's Vite pipeline and serves the prototype
// entry at the existing browse, detail and Profile paths. Never used by builds.
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

export default mergeConfig(
  base,
  defineConfig({
    plugins: [
      {
        name: 'rendition-prototype-entry',
        configureServer(server) {
          server.middlewares.use((request, _response, next) => {
            const url = new URL(request.url || '/', 'http://localhost');
            if (
              url.pathname === '/' ||
              /^\/(wallpapers|profiles)\//.test(url.pathname) ||
              url.pathname === '/upload'
            ) {
              request.url = `/prototypes/ui.prototype.html${url.search}`;
            }
            next();
          });
        },
      },
    ],
    server: { port: 8259, strictPort: true },
  })
);
