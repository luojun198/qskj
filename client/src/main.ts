import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import 'element-plus/es/components/loading/style/css'
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'
import './assets/styles.css'
import './styles/common.css'
import './styles/apple-element-override.css'
import { permission } from './directives/permission'
import { colWidth } from './directives/colWidth'
import { registerDynamicIcons } from './config/iconRegistry'
import { setupMessageBoxDefaults } from './plugins/messageBoxDefaults'
import { applyPerformanceMode } from './utils/performanceMode'
import { waitBackendReady } from './utils/waitBackendReady'
import { setupChunkReload, isChunkLoadError, reloadOnceForChunkError } from './utils/chunkReload'

function bootstrap() {
  const app = createApp(App)
  const pinia = createPinia()

  applyPerformanceMode()
  registerDynamicIcons(app)
  app.directive('permission', permission)
  app.directive('col-width', colWidth)
  app.use(pinia)
  app.use(router)
  setupChunkReload(router)
  setupMessageBoxDefaults()
  app.config.errorHandler = (err, instance, info) => {
    // 异步组件（defineAsyncComponent）分块加载失败同样按升级后旧分块处理
    if (isChunkLoadError(err) && reloadOnceForChunkError()) return
    console.error('VUE_GLOBAL_ERROR:', err, info)
  }
  app.mount('#app')
}

waitBackendReady().finally(bootstrap)
