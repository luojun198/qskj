import { onMounted, ref } from 'vue'
import request from '@/api/request'

export type AppBuildInfoPayload = {
  version: string
  build: string
  mode?: string
  gitCommit?: string | null
  builtAt?: string
  builtAtLocal?: string
  clientIndexHash?: string
}

type HealthVersionPayload = {
  version?: string
  build?: string
  gitCommit?: string | null
  builtAtLocal?: string
  clientIndexHash?: string
}

function formatLabel(info: AppBuildInfoPayload | null): string {
  if (!info?.version) return '版本信息加载中…'
  const parts = [`Ver:${info.version}`]
  if (info.mode === 'development' || info.build === 'dev') {
    parts.push('开发模式')
  } else if (info.build) {
    parts.push(`构建 ${info.build}`)
  }
  if (info.gitCommit) parts.push(info.gitCommit)
  return parts.join(' · ')
}

function isMismatch(front: AppBuildInfoPayload | null, back: HealthVersionPayload | null): boolean {
  if (!front || !back?.build) return false
  if (front.mode === 'development' || front.build === 'dev') return false
  if (back.build && front.build !== back.build) return true
  if (back.gitCommit && front.gitCommit && back.gitCommit !== front.gitCommit) return true
  if (
    back.clientIndexHash &&
    front.clientIndexHash &&
    back.clientIndexHash !== front.clientIndexHash
  ) {
    return true
  }
  return false
}

async function fetchVersionJson(): Promise<AppBuildInfoPayload | null> {
  try {
    const res = await fetch(`/version.json?_=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as AppBuildInfoPayload
  } catch {
    return null
  }
}

async function fetchHealthVersion(): Promise<HealthVersionPayload | null> {
  try {
    const res = (await request.get('/health')) as {
      version?: string
      build?: string
      gitCommit?: string | null
      builtAtLocal?: string
      clientIndexHash?: string
    }
    return res
  } catch {
    return null
  }
}

export function useAppBuildInfo() {
  const version = ref('')
  const label = ref('版本信息加载中…')
  const mismatch = ref(false)
  const loading = ref(true)

  onMounted(async () => {
    loading.value = true
    const [front, back] = await Promise.all([fetchVersionJson(), fetchHealthVersion()])
    version.value = front?.version || ''
    label.value = formatLabel(front)
    mismatch.value = isMismatch(front, back)
    loading.value = false
  })

  return { version, label, mismatch, loading }
}
