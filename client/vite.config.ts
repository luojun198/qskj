import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      resolvers: [ElementPlusResolver()],
      imports: ['vue', 'vue-router', 'pinia'],
      dts: 'src/auto-imports.d.ts',
    }),
    Components({
      resolvers: [ElementPlusResolver()],
      dts: 'src/components.d.ts',
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    // 当前分支(cw0523)独立端口 5275，与原项目 cw(5175)可同时运行
    port: 5275,
    proxy: {
      '/api': {
        target: 'http://localhost:3105',
        changeOrigin: true,
        xfwd: true,
      },
      '/uploads': {
        target: 'http://localhost:3105',
        changeOrigin: true,
        xfwd: true,
      },
    },
  },
})
