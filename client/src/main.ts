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
import { registerDynamicIcons } from './config/iconRegistry'
import { setupMessageBoxDefaults } from './plugins/messageBoxDefaults'
import { applyPerformanceMode } from './utils/performanceMode'

function bootstrap() {
  const app = createApp(App)
  const pinia = createPinia()

  applyPerformanceMode()
  registerDynamicIcons(app)
  app.directive('permission', permission)
  app.use(pinia)
  app.use(router)
  setupMessageBoxDefaults()
  app.config.errorHandler = (err, instance, info) => {
    console.error('VUE_GLOBAL_ERROR:', err, info)
  }
  app.mount('#app')
}

bootstrap()
