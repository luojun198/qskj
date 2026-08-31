<template>
  <section v-show="visible" class="param-section param-section--brand">
    <header class="param-section__head">
      <span class="param-section__marker" aria-hidden="true"></span>
      <h4 class="param-section__title">
        品牌展示
        <span class="param-section__sub">侧边栏 LOGO、主标题与副标题（Ctrl+Shift+L 打开/关闭）</span>
      </h4>
    </header>
    <div class="param-section__body">
      <div class="brand-settings">
        <div class="brand-settings__preview">
          <div class="brand-settings__preview-aside">
            <div class="brand-preview-logo">
              <img :src="previewLogoSrc" alt="LOGO 预览" class="brand-preview-logo__img" />
            </div>
            <div class="brand-preview-text">
              <span class="brand-preview-text__title">{{ form.title || '主标题' }}</span>
              <span class="brand-preview-text__sub">{{ form.subtitle || '副标题' }}</span>
            </div>
          </div>
        </div>

        <el-form label-width="88px" size="small" class="brand-settings__form">
          <el-form-item label="LOGO 图标">
            <div class="brand-settings__logo-actions">
              <el-upload
                :show-file-list="false"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                :auto-upload="false"
                :on-change="handleLogoChange"
              >
                <el-button type="primary" plain size="small">选择图片</el-button>
              </el-upload>
              <el-button size="small" @click="handleResetLogo">恢复默认</el-button>
              <span class="brand-settings__hint">建议正方形 PNG，不超过 2MB</span>
            </div>
          </el-form-item>
          <el-form-item label="主标题">
            <el-input v-model="form.title" maxlength="24" show-word-limit style="width: 280px" />
          </el-form-item>
          <el-form-item label="副标题">
            <el-input v-model="form.subtitle" maxlength="48" show-word-limit style="width: 360px" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" size="small" :loading="saving" @click="handleSave">保存品牌设置</el-button>
          </el-form-item>
        </el-form>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { UploadFile } from 'element-plus'
import { useBrandingStore } from '@/stores/branding'
import { showOperationError, showSuccess } from '@/composables/useMessage'
import defaultLogoAsset from '@/assets/logo.png'

const props = defineProps<{
  visible: boolean
}>()

const brandingStore = useBrandingStore()
const saving = ref(false)
const pendingLogoFile = ref<File | null>(null)
const pendingLogoPreview = ref<string | null>(null)

const form = ref({
  title: brandingStore.title,
  subtitle: brandingStore.subtitle,
})

const previewLogoSrc = computed(
  () => pendingLogoPreview.value || brandingStore.logoSrc || defaultLogoAsset
)

watch(
  () => props.visible,
  async visible => {
    if (!visible) return
    await brandingStore.load(true)
    form.value.title = brandingStore.title
    form.value.subtitle = brandingStore.subtitle
    pendingLogoFile.value = null
    pendingLogoPreview.value = null
  },
  { immediate: true }
)

function handleLogoChange(uploadFile: UploadFile) {
  const raw = uploadFile.raw
  if (!raw) return
  if (!/^image\//.test(raw.type)) {
    showOperationError('选择 LOGO', new Error('仅支持图片文件'))
    return
  }
  if (raw.size > 2 * 1024 * 1024) {
    showOperationError('选择 LOGO', new Error('图片不能超过 2MB'))
    return
  }
  pendingLogoFile.value = raw
  if (pendingLogoPreview.value) URL.revokeObjectURL(pendingLogoPreview.value)
  pendingLogoPreview.value = URL.createObjectURL(raw)
}

async function handleResetLogo() {
  try {
    await brandingStore.resetLogo()
    pendingLogoFile.value = null
    if (pendingLogoPreview.value) URL.revokeObjectURL(pendingLogoPreview.value)
    pendingLogoPreview.value = null
    showSuccess('已恢复默认 LOGO')
  } catch (error) {
    showOperationError('恢复默认 LOGO', error)
  }
}

async function handleSave() {
  saving.value = true
  try {
    if (pendingLogoFile.value) {
      await brandingStore.uploadLogo(pendingLogoFile.value)
      pendingLogoFile.value = null
      if (pendingLogoPreview.value) URL.revokeObjectURL(pendingLogoPreview.value)
      pendingLogoPreview.value = null
    }
    await brandingStore.saveText({
      title: form.value.title.trim(),
      subtitle: form.value.subtitle.trim(),
    })
    showSuccess('品牌设置已保存')
  } catch (error) {
    showOperationError('保存品牌设置', error)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.param-section--brand {
  border: 1px dashed rgba(200, 16, 46, 0.25);
  background: linear-gradient(180deg, rgba(200, 16, 46, 0.03) 0%, transparent 100%);
}

.brand-settings {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  align-items: flex-start;
}

.brand-settings__preview {
  flex: 0 0 auto;
}

.brand-settings__preview-aside {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 240px;
  padding: 12px 10px;
  border-radius: 10px;
  background: linear-gradient(180deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
}

.brand-preview-logo {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}

.brand-preview-logo__img {
  width: 90%;
  height: 90%;
  object-fit: contain;
}

.brand-preview-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.brand-preview-text__title {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 2px;
  color: var(--cw-brand-red-on-dark, #f5a0a0);
}

.brand-preview-text__sub {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.72);
  line-height: 1.35;
}

.brand-settings__form {
  flex: 1;
  min-width: 320px;
}

.brand-settings__logo-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.brand-settings__hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
