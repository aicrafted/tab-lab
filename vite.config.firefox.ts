import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import webExtension from 'vite-plugin-web-extension'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    webExtension({
      manifest: './manifest.firefox.json',
      additionalInputs: [
        'src/pages/main/index.html',
        'src/pages/sidepanel/index.html',
        'popup.html',
      ],
      browser: 'firefox',
    }),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/onnxruntime-web/dist/ort-wasm-*.{mjs,wasm}',
          dest: 'assets',
        },
      ],
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  css: {
    postcss: {
      plugins: [tailwindcss, autoprefixer],
    },
  },
  define: {
    __BROWSER__: JSON.stringify('firefox'),
  },
  build: {
    outDir: 'dist-firefox',
    rollupOptions: {
      output: {
        chunkFileNames: 'assets/chunk-[hash].js',
      },
    },
  },
})
