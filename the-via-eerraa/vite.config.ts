import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {splitVendorChunkPlugin} from 'vite';
import {createHtmlPlugin} from 'vite-plugin-html';
import fs from 'fs';
import {
  FIRMWARE_SHARE_PAGE,
  getMakerSharePage,
  toFirmwareSharePage,
  toFirmwareShareRedirects,
} from './scripts/firmware-share-page';

const hash = fs.readFileSync('public/definitions/hash.json', 'utf8');

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    createHtmlPlugin({
      inject: {
        data: {
          hash,
        },
      },
    }),
    splitVendorChunkPlugin(),
    {
      // The /firmware routes are rewritten to this copy of the shell, which
      // carries the firmware title and description for chat link previews.
      name: 'firmware-share-page',
      apply: 'build',
      closeBundle() {
        const index = fs.readFileSync(path.join('dist', 'index.html'), 'utf8');
        fs.writeFileSync(
          path.join('dist', FIRMWARE_SHARE_PAGE),
          toFirmwareSharePage(index),
        );
        const {makers} = JSON.parse(fs.readFileSync('config/firmware-catalog.json', 'utf8'));
        for (const maker of makers) {
          fs.writeFileSync(
            path.join('dist', getMakerSharePage(maker.id)),
            toFirmwareSharePage(index, maker.name),
          );
        }
        fs.writeFileSync(
          path.join('dist', '_redirects'),
          toFirmwareShareRedirects(fs.readFileSync('public/_redirects', 'utf8'), makers),
        );
      },
    },
  ],
  assetsInclude: ['**/*.glb'],
  envDir: '.',
  server: {open: true},
  resolve: {
    alias: {
      src: path.resolve(__dirname, './src'),
      assets: path.resolve(__dirname, './src/assets'),
    },
  },
  optimizeDeps: {
    include: ['@the-via/reader'],
    esbuildOptions: {
      // Node.js global to browser globalThis
      define: {
        global: 'globalThis',
      },
      // Enable esbuild polyfill plugins
      plugins: [],
    },
  },
});
