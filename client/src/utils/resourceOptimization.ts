/**
 * 图片懒加载指令
 * 用于优化图片加载性能
 *
 * @example
 * <img v-lazy="imageUrl" alt="description" />
 */
export const lazyLoadDirective = {
  mounted(el: HTMLImageElement, binding: any) {
    const imageUrl = binding.value

    if (!imageUrl) return

    // 创建 IntersectionObserver
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            // 图片进入视口
            el.src = imageUrl
            el.classList.add('loaded')
            observer.unobserve(el)
          }
        })
      },
      {
        rootMargin: '50px', // 提前 50px 开始加载
      }
    )

    // 开始观察
    observer.observe(el)

    // 保存 observer 以便清理
    ;(el as any)._lazyLoadObserver = observer
  },
  unmounted(el: HTMLImageElement) {
    const observer = (el as any)._lazyLoadObserver
    if (observer) {
      observer.disconnect()
    }
  },
}

/**
 * 图片压缩
 * 在上传前压缩图片
 *
 * @example
 * const compressed = await compressImage(file, { maxWidth: 1920, quality: 0.8 })
 */
export async function compressImage(
  file: File,
  options: {
    maxWidth?: number
    maxHeight?: number
    quality?: number
  } = {}
): Promise<Blob> {
  const { maxWidth = 1920, maxHeight = 1080, quality = 0.8 } = options

  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e: ProgressEvent<FileReader>) => {
      const img = new Image()

      img.onload = () => {
        const canvas = document.createElement('canvas')
        let width = img.width
        let height = img.height

        // 计算缩放比例
        if (width > maxWidth) {
          height = (height * maxWidth) / width
          width = maxWidth
        }

        if (height > maxHeight) {
          width = (width * maxHeight) / height
          height = maxHeight
        }

        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Failed to get canvas context'))
          return
        }

        ctx.drawImage(img, 0, 0, width, height)

        canvas.toBlob(
          blob => {
            if (blob) {
              resolve(blob)
            } else {
              reject(new Error('Failed to compress image'))
            }
          },
          file.type,
          quality
        )
      }

      img.onerror = () => {
        reject(new Error('Failed to load image'))
      }

      img.src = e.target?.result as string
    }

    reader.onerror = () => {
      reject(new Error('Failed to read file'))
    }

    reader.readAsDataURL(file)
  })
}

/**
 * 预加载图片
 * 提前加载图片到缓存
 *
 * @example
 * await preloadImage('/assets/logo.png')
 */
export function preloadImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve()
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`))
    img.src = url
  })
}

/**
 * 批量预加载图片
 *
 * @example
 * await preloadImages(['/img1.png', '/img2.png'])
 */
export async function preloadImages(urls: string[]): Promise<void> {
  await Promise.all(urls.map(url => preloadImage(url)))
}

/**
 * 获取图片尺寸
 *
 * @example
 * const { width, height } = await getImageSize(file)
 */
export function getImageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e: ProgressEvent<FileReader>) => {
      const img = new Image()

      img.onload = () => {
        resolve({ width: img.width, height: img.height })
      }

      img.onerror = () => {
        reject(new Error('Failed to load image'))
      }

      img.src = e.target?.result as string
    }

    reader.onerror = () => {
      reject(new Error('Failed to read file'))
    }

    reader.readAsDataURL(file)
  })
}

/**
 * 资源预加载
 * 使用 link rel="preload" 预加载资源
 *
 * @example
 * preloadResource('/assets/font.woff2', 'font')
 */
export function preloadResource(url: string, type: 'script' | 'style' | 'font' | 'image') {
  const link = document.createElement('link')
  link.rel = 'preload'
  link.href = url
  link.as = type

  if (type === 'font') {
    link.crossOrigin = 'anonymous'
  }

  document.head.appendChild(link)
}

/**
 * 资源预连接
 * 提前建立连接，减少请求延迟
 *
 * @example
 * preconnect('https://api.example.com')
 */
export function preconnect(url: string) {
  const link = document.createElement('link')
  link.rel = 'preconnect'
  link.href = url
  document.head.appendChild(link)
}
