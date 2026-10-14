<template>
  <el-button ref="btnRef" :size="size" plain :loading="saving" :disabled="disabled" @click="onClick">
    <el-icon v-if="!saving"><Download /></el-icon>另存
  </el-button>
</template>

<script setup lang="ts">
/**
 * 「另存」按钮：所有账簿 / 报表 / 列表统一叫法（第五份反馈：所有帐册均要支持另存）。
 * - 传 table：按 el-table 当前显示内容导出（exportElTable，所见即所得）；
 * - 传 handler：页面自行取数导出（如分页列表要导全部数据）；
 * - 都不传：自动找本页（最近的 .page 容器）里当前可见、行数最多的 el-table。
 * - doc：单据编辑 / 查看页，导出整张单据（表头字段 + 全部明细表 + 合计），见 exportDocPage。
 */
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Download } from '@element-plus/icons-vue'
import { exportElTable, exportDateStamp } from '@/utils/exportElTable'
import { exportDocPage } from '@/utils/exportDocPage'

const props = withDefaults(
  defineProps<{
    table?: any
    handler?: () => Promise<unknown> | unknown
    fileName?: string
    title?: string
    subtitle?: string
    size?: 'small' | 'default' | 'large'
    disabled?: boolean
    /** 单据模式：导出整张单据（表头字段 + 明细） */
    doc?: boolean
    /** 单据模式的表尾说明，如「制单：张三　审核：李四」 */
    footer?: string
  }>(),
  { size: 'small', disabled: false, fileName: '', title: '', subtitle: '', table: undefined, handler: undefined, doc: false, footer: '' }
)

const saving = ref(false)
const btnRef = ref<any>(null)

function pageScope(): HTMLElement {
  const btnEl: HTMLElement | null = btnRef.value?.$el || null
  return (btnEl?.closest('.page, [class$="-page"], .el-tab-pane') as HTMLElement | null) || document.body
}

function findVisibleTable(): HTMLElement | null {
  const btnEl: HTMLElement | null = btnRef.value?.$el || null
  const scope = (btnEl?.closest('.page, .el-tab-pane, [class$="-page"]') as HTMLElement | null) || document.body
  const tables = Array.from(scope.querySelectorAll<HTMLElement>('.el-table')).filter(
    el => el.offsetParent !== null && !el.closest('.el-dialog, .el-drawer, .el-popper')
  )
  if (tables.length === 0) return null
  const rowCount = (el: HTMLElement) => el.querySelectorAll('.el-table__body-wrapper tbody > tr').length
  return tables.reduce((best, el) => (rowCount(el) > rowCount(best) ? el : best), tables[0])
}

async function onClick() {
  saving.value = true
  try {
    if (props.handler) {
      await props.handler()
      return
    }
    const name = props.fileName || props.title || '导出'
    if (props.doc) {
      const ok = await exportDocPage(pageScope(), { title: props.title || name, fileName: `${name}.xlsx`, footer: props.footer || undefined })
      if (!ok) ElMessage.warning('当前没有可另存的内容')
      return
    }
    const table = (Array.isArray(props.table) ? props.table[0] : props.table) || findVisibleTable()
    const ok = await exportElTable(table, {
      fileName: `${name}_${exportDateStamp()}.xlsx`,
      title: props.title || name,
      subtitle: props.subtitle,
    })
    if (!ok) ElMessage.warning('当前没有可另存的数据')
  } catch (error: any) {
    ElMessage.error(error?.message || '另存失败')
  } finally {
    saving.value = false
  }
}
</script>
