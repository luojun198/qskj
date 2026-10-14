<template>
  <div class="print-template-page print-template-designer-page">
    <HiprintDesigner
      :key="designerSessionKey"
      :template-id="templateId"
      :preset="preset"
      :default-type="defaultType"
      :default-key="defaultKey"
      @save="handleSave"
      @cancel="goBack"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import HiprintDesigner from '@/components/print/HiprintDesigner.vue'
import { isPrintTemplateDesignerPath } from '@/utils/viewKey'

const route = useRoute()
const router = useRouter()

const templateId = computed(() => {
  const id = route.params.id
  return typeof id === 'string' && id ? id : undefined
})

const preset = computed(() => String(route.query.preset || 'standard'))
// 业务单据模板：?preset=scm&key=scm:SOa（从打印模板列表或单据打印页「设计模板」进入）
const defaultType = computed(() => (route.query.preset === 'scm' ? 'scm_doc' : 'voucher') as any)
const defaultKey = computed(() => (typeof route.query.key === 'string' ? route.query.key : undefined))

/** 本次打开的设计会话。新建保存后 URL 会带上 id，但不能换 key，否则 hiprint 画布被拆掉，只能返回重进。 */
const designerSessionKey = ref(templateId.value || `new:${preset.value}`)

watch(
  () => [templateId.value, preset.value] as const,
  ([id, nextPreset], [prevId]) => {
    if (!prevId && id) return
    const nextKey = id || `new:${nextPreset}`
    if (nextKey !== designerSessionKey.value) designerSessionKey.value = nextKey
  }
)

function goBack() {
  router.push('/base/print-template')
}

function handleSave(id: string) {
  // 保存是异步的：用户若在保存返回前就点了「返回」，这里再 replace 会把人拽回设计页
  if (!isPrintTemplateDesignerPath(route.path)) return
  if (!templateId.value && id) {
    router.replace({ path: `/base/print-template/design/${id}` })
  }
}
</script>

<style scoped>
.print-template-designer-page {
  padding: 0;
  overflow: hidden;
}
</style>
