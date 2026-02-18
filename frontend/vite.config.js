import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/rpc': {
        target: 'https://rpc-testnet.gokite.ai',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/rpc/, '')
      },
      '/bundler': {
        target: 'https://bundler-service.staging.gokite.ai',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/bundler/, '')
      },
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false
      }
    }
  }
})
