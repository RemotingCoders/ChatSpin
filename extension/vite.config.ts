import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
export default defineConfig(({ mode }) => {
  const root = resolve('extension'),
    env = loadEnv(mode, resolve('.'), 'VITE_');
  const backend = process.env.VITE_EXTENSION_API_ORIGIN || env.VITE_EXTENSION_API_ORIGIN;
  if (!backend)
    throw Error(
      'Set VITE_EXTENSION_API_ORIGIN to your public HTTPS backend before building the extension.',
    );
  const url = new URL(backend);
  if (
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
  )
    throw Error(
      'Extension backend must be an HTTPS origin (HTTP localhost is allowed for local development).',
    );
  return {
    root,
    envDir: resolve('.'),
    base: './',
    build: {
      minify: false,
      outDir: resolve('extension/dist'),
      emptyOutDir: true,
      rollupOptions: {
        input: Object.fromEntries(
          ['viewer', 'mobile', 'overlay', 'config', 'live'].map((view) => [
            view,
            resolve(root, view + '.html'),
          ]),
        ),
      },
    },
  };
});
