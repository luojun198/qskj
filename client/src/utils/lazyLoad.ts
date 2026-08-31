import { defineAsyncComponent, Component } from 'vue'

/**
 * 懒加载组件配置
 */
export interface LazyComponentOptions {
  loader: () => Promise<Component>
  loadingComponent?: Component
  errorComponent?: Component
  delay?: number
  timeout?: number
}

/**
 * 创建懒加载组件
 * 用于优化首屏加载性能
 *
 * @example
 * const VoucherEntryForm = defineLazyComponent(() => import('@/components/voucher/VoucherEntryForm.vue'))
 */
export function defineLazyComponent(
  loader: () => Promise<Component>,
  options?: Partial<LazyComponentOptions>
) {
  return defineAsyncComponent({
    loader,
    loadingComponent: options?.loadingComponent,
    errorComponent: options?.errorComponent,
    delay: options?.delay ?? 200,
    timeout: options?.timeout ?? 30000,
  })
}

/**
 * 路由懒加载
 * 用于路由配置中的组件懒加载
 *
 * @example
 * {
 *   path: '/voucher/entry',
 *   component: lazyLoadRoute(() => import('@/views/voucher/Entry.vue'))
 * }
 */
export function lazyLoadRoute(loader: () => Promise<any>) {
  return defineAsyncComponent({
    loader,
    delay: 200,
    timeout: 30000,
  })
}

/**
 * 预加载组件
 * 在空闲时预加载组件，提升用户体验
 *
 * @example
 * preloadComponent(() => import('@/components/voucher/VoucherEntryForm.vue'))
 */
export function preloadComponent(loader: () => Promise<Component>) {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(() => {
      loader()
    })
  } else {
    // 降级方案：使用 setTimeout
    setTimeout(() => {
      loader()
    }, 1000)
  }
}

/**
 * 批量预加载组件
 *
 * @example
 * preloadComponents([
 *   () => import('@/components/voucher/VoucherEntryForm.vue'),
 *   () => import('@/components/voucher/VoucherBatchDelete.vue')
 * ])
 */
export function preloadComponents(loaders: Array<() => Promise<Component>>) {
  loaders.forEach((loader, index) => {
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      window.requestIdleCallback(
        () => {
          loader()
        },
        { timeout: 2000 + index * 500 }
      )
    } else {
      setTimeout(() => {
        loader()
      }, 1000 + index * 500)
    }
  })
}

/**
 * 条件懒加载
 * 根据条件决定是否懒加载组件
 *
 * @example
 * const MyComponent = conditionalLazyLoad(
 *   () => import('@/components/Heavy.vue'),
 *   () => import('@/components/Light.vue'),
 *   () => window.innerWidth > 768
 * )
 */
export function conditionalLazyLoad(
  heavyLoader: () => Promise<Component>,
  lightLoader: () => Promise<Component>,
  condition: () => boolean
) {
  return condition() ? defineLazyComponent(heavyLoader) : defineLazyComponent(lightLoader)
}
