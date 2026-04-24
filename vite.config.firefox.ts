import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import webExtension from 'vite-plugin-web-extension'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import path from 'path'

function stubHeavyModules(): Plugin {
  const stubs: Record<string, string> = {
    '@mlc-ai/web-llm': `
      export const CreateMLCEngine = () => { throw new Error('WebLLM not supported in Firefox') }
      export const hasModelInCache = () => Promise.resolve(false)
      export const prebuiltAppConfig = { model_list: [] }
    `,
  }
  return {
    name: 'stub-heavy-modules',
    enforce: 'pre',
    resolveId(id) {
      if (id in stubs) return `\0stub:${id}`
      return null
    },
    load(id) {
      if (id.startsWith('\0stub:')) {
        const original = id.slice('\0stub:'.length)
        return stubs[original]
      }
      return null
    },
  }
}

export default defineConfig({
  plugins: [
    stubHeavyModules(),
    react(),
    webExtension({
      manifest: './manifest.firefox.json',
      additionalInputs: [
        'src/pages/main/index.html',
        'src/pages/sidepanel/index.html',
        'popup.html',
      ],
      browser: 'firefox',
      htmlViteConfig: { plugins: [stubHeavyModules()] },
      scriptViteConfig: { plugins: [stubHeavyModules()] },
    }),
  ],
  resolve: {
    alias: {
      '@/lib/ai/providers/factory': path.resolve(__dirname, './src/lib/ai/providers/factory.firefox.ts'),
      '@/lib/ai/providers/webllm-provider': path.resolve(__dirname, './src/lib/ai/providers/webllm-provider.firefox.ts'),
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
      external: ['@mlc-ai/web-llm'],
      output: {
        chunkFileNames: 'assets/chunk-[hash].js',
      },
    },
  },
})
