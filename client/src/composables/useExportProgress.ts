import { computed, reactive, ref } from 'vue'

export type ExportProgressPhase = 'fetch' | 'prepare' | 'generate' | 'download'

const PHASE_RANGE: Record<ExportProgressPhase, [number, number]> = {
  fetch: [0, 55],
  prepare: [55, 72],
  generate: [72, 92],
  download: [92, 100],
}

function mapPhasePercent(phase: ExportProgressPhase, innerPercent: number) {
  const [start, end] = PHASE_RANGE[phase]
  const ratio = Math.min(100, Math.max(0, innerPercent)) / 100
  return Math.min(100, Math.round(start + ratio * (end - start)))
}

/** 大数据 Excel 导出：全屏锁定 + 分阶段进度 */
export function useExportProgress(defaultTitle = '正在导出 Excel') {
  const visible = ref(false)
  const title = ref(defaultTitle)
  const message = ref('')
  const percent = ref(0)

  const percentDisplay = computed(() => Math.min(100, Math.max(0, percent.value)))

  function start(nextTitle?: string) {
    visible.value = true
    title.value = nextTitle || defaultTitle
    message.value = '准备中…'
    percent.value = 0
  }

  function setFetchProgress(loaded: number, total: number, detail?: string) {
    const inner = total > 0 ? Math.round((loaded / total) * 100) : 0
    percent.value = mapPhasePercent('fetch', inner)
    message.value =
      detail ||
      (total > 0
        ? `正在读取数据 ${loaded.toLocaleString()} / ${total.toLocaleString()} 行…`
        : '正在读取数据…')
  }

  function report(info: { phase: ExportProgressPhase; percent: number; message: string }) {
    percent.value = mapPhasePercent(info.phase, info.percent)
    message.value = info.message
  }

  function finish() {
    visible.value = false
    message.value = ''
    percent.value = 0
  }

  // 包一层 reactive，模板中 exportProgress.visible 等嵌套 ref 才会自动解包
  return reactive({
    visible,
    title,
    message,
    percent,
    percentDisplay,
    start,
    setFetchProgress,
    report,
    finish,
  })
}
