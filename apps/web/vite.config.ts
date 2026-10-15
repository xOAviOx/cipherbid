import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  root: fileURLToPath(new URL('.',import.meta.url)),
  plugins:[react(),tailwindcss()],
  server:{port:5174,strictPort:true,fs:{allow:[fileURLToPath(new URL('../..',import.meta.url))]}},
  preview:{port:5174,strictPort:true},
  build:{outDir:'../../dist',emptyOutDir:true},
})
