/**
 * 生成业务凭证前选择凭证类型（轻量选择器弹窗）。
 * 返回所选凭证类型 id（'' = 按默认设置）；用户取消返回 null。选择按 storageKey 记住，下次默认选中。
 */
import { h, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import VoucherTypeSelect from '@/components/voucher/VoucherTypeSelect.vue'
import { useBaseDataStore } from '@/stores/baseData'

export function readStoredVoucherType(storageKey: string): string {
  try { return localStorage.getItem(storageKey) || '' } catch { return '' }
}

export function storeVoucherType(storageKey: string, id: string) {
  try { localStorage.setItem(storageKey, id) } catch { /* 无痕 / 禁用存储 */ }
}

export async function pickVoucherType(opts: {
  storageKey: string
  title?: string
  /** 弹窗正文第一行，如「为 3 张单据生成凭证」 */
  message?: string
  defaultLabel?: string
}): Promise<string | null> {
  const baseData = useBaseDataStore()
  await baseData.loadVoucherTypes()
  const stored = readStoredVoucherType(opts.storageKey)
  // 记住的类型已被删除：退回按默认
  const value = ref(baseData.voucherTypes.some(t => String(t.id) === stored) ? stored : '')
  try {
    await ElMessageBox({
      title: opts.title || '生成凭证',
      showCancelButton: true,
      confirmButtonText: '立即生成',
      cancelButtonText: '取消',
      message: () => h('div', { style: 'display:flex;flex-direction:column;gap:10px' }, [
        opts.message ? h('div', opts.message) : null,
        h('div', { style: 'display:flex;align-items:center;gap:8px' }, [
          h('span', '凭证类型'),
          h(VoucherTypeSelect, {
            modelValue: value.value,
            defaultLabel: opts.defaultLabel,
            'onUpdate:modelValue': (v: string) => { value.value = v },
          }),
        ]),
      ]),
    })
  } catch {
    return null
  }
  storeVoucherType(opts.storageKey, value.value)
  return value.value
}
