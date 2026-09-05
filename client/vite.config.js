import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import { resolve } from 'path';
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
        // 开发服务器启动后在后台先把重头视图转换好，避免第一次点进这些模块时
        // 才现场编译（最大的 DocForm.vue 有 3300 多行）。只列最大/最常用的几个，
        // 全量预热 120 个视图会把 npm run dev 的启动拖慢，其余交给菜单悬停预取。
        warmup: {
            clientFiles: [
                './src/views/Layout.vue',
                './src/views/Dashboard.vue',
                './src/views/scm/DocForm.vue',
                './src/views/scm/DocList.vue',
                './src/views/report/DynamicReport.vue',
                './src/views/base/InitBalance.vue',
                './src/views/base/Account.vue',
                './src/views/voucher/Entry.vue',
                './src/views/ledger/*.vue',
            ],
        },
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
});
