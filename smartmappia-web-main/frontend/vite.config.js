import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    // '@' alias for shadcn/Watermelon UI components (they import from '@/lib/utils' etc).
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Don't ship source maps in the production bundle (avoid leaking source).
  build: {
    sourcemap: false,
  },
})