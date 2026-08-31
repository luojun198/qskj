import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import request from '@/api/request'
import defaultLogoAsset from '@/assets/logo.png'

export type BrandingData = {
  title: string
  subtitle: string
  logoUrl: string | null
}

const DEFAULT_TITLE = '盛于智'
const DEFAULT_SUBTITLE = '行政事业单位财务专业版'

function resolveLogoSrc(logoUrl: string | null | undefined, version = 0): string {
  if (!logoUrl) return defaultLogoAsset
  if (logoUrl.startsWith('http://') || logoUrl.startsWith('https://') || logoUrl.startsWith('data:')) {
    return logoUrl
  }
  const path = logoUrl.startsWith('/') ? logoUrl : `/${logoUrl}`
  return version > 0 ? `${path}?v=${version}` : path
}

export const useBrandingStore = defineStore('branding', () => {
  const loaded = ref(false)
  const title = ref(DEFAULT_TITLE)
  const subtitle = ref(DEFAULT_SUBTITLE)
  const logoPath = ref<string | null>(null)
  const logoVersion = ref(0)

  const logoSrc = computed(() => resolveLogoSrc(logoPath.value, logoVersion.value))

  const fullTitle = computed(() => `${title.value}${subtitle.value ? '' : ''}`.trim() || DEFAULT_TITLE)

  function apply(data: BrandingData) {
    title.value = data.title?.trim() || DEFAULT_TITLE
    subtitle.value = data.subtitle?.trim() || DEFAULT_SUBTITLE
    logoPath.value = data.logoUrl?.trim() || null
    logoVersion.value += 1
    loaded.value = true
    document.title = subtitle.value ? `${title.value} · ${subtitle.value}` : title.value
  }

  async function load(force = false) {
    if (loaded.value && !force) return
    try {
      const res = await request.get<BrandingData>('/system/branding')
      apply(res.data || { title: DEFAULT_TITLE, subtitle: DEFAULT_SUBTITLE, logoUrl: null })
    } catch {
      if (!loaded.value) {
        title.value = DEFAULT_TITLE
        subtitle.value = DEFAULT_SUBTITLE
        logoPath.value = null
        loaded.value = true
      }
    }
  }

  async function saveText(payload: { title: string; subtitle: string }) {
    const res = await request.put<BrandingData>('/system/branding', payload)
    apply(res.data || { title: payload.title, subtitle: payload.subtitle, logoUrl: logoPath.value })
  }

  async function uploadLogo(file: File) {
    const formData = new FormData()
    formData.append('file', file)
    const res = await request.post<BrandingData>('/system/branding/logo', formData)
    apply(res.data || { title: title.value, subtitle: subtitle.value, logoUrl: logoPath.value })
  }

  async function resetLogo() {
    const res = await request.delete<BrandingData>('/system/branding/logo')
    apply(res.data || { title: title.value, subtitle: subtitle.value, logoUrl: null })
  }

  return {
    loaded,
    title,
    subtitle,
    logoPath,
    logoSrc,
    fullTitle,
    load,
    saveText,
    uploadLogo,
    resetLogo,
    apply,
  }
})
