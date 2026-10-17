import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
