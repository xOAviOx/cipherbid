import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'cipherbid-license-notices',
      generateBundle() {
        for (const name of ['THIRD_PARTY_NOTICES.txt', 'LICENSE']) {
          this.emitFile({
            type: 'asset',
            fileName: name,
            source: readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8'),
          })
        }
      },
    },
  ],
  server: {
    port: 5174,
    strictPort: true,
    watch: { ignored: ['**/public/deployment.json'] },
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
  },
  preview: { port: 5174, strictPort: true },
  build: { outDir: '../../dist', emptyOutDir: true },
})
