import { defineConfig, normalizePath } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const twemoji = fileURLToPath(new URL('./', import.meta.resolve('@ffaubert/twemoji')));
const emojiManifest = 'virtual:twemoji-assets';

export default defineConfig({
  plugins: [
    react(), tailwindcss(),
    {
      name: 'twemoji-assets',
      resolveId(id) {
        if (id === emojiManifest) return `\0${id}`;
      },
      load(id) {
        if (id !== `\0${emojiManifest}`) return;
        const names = readdirSync(`${twemoji}assets/svg`).filter((name) => name.endsWith('.svg')).map((name) => name.slice(0, -4));
        return `export default ${JSON.stringify(names)}`;
      },
    },
    viteStaticCopy({
      targets: [
        { src: normalizePath(`${twemoji}assets/svg/*.svg`), dest: 'twemoji', rename: { stripBase: true } },
        { src: normalizePath(`${twemoji}LICENSE-GRAPHICS`), dest: 'twemoji', rename: { stripBase: true } },
      ],
    }),
  ],
  build: {
    rolldownOptions: {
      output: {
        // Libraries in their own files: they change rarely, so the browser keeps them across our deploys and
        // only the app's own code is downloaded again.
        codeSplitting: {
          groups: [
            { name: 'livekit', test: /node_modules[\\/](livekit-client|@livekit)/ },
            { name: 'heroui', test: /node_modules[\\/](@heroui|react-aria|@react-aria|@react-stately|@internationalized|tailwind-variants)/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'vendor', test: /node_modules/ },
          ],
        },
      },
    },
  },
  server: {
    port: 5190,
    proxy: {
      '/api': 'http://127.0.0.1:8010',
      '/socket.io': { target: 'http://127.0.0.1:8010', ws: true },
    },
  },
});
