/**
 * 进销存生成凭证被「辅助核算对应不上」拦截时的统一处理：
 * 跳转全页面（views/voucher/ScmAuxUnmatched.vue）表格列出未对应项，给出「自动新建辅助项并重试」与「去设置页手工指定」两个出口。
 */
import { ElMessage } from 'element-plus'
import { scmApi } from '@/api/scm'
import { scmDocumentRoute } from '@/utils/scmDocNavigation'
import { scmVoucherSettingApi, type ScmAuxProblem } from '@/api/scmVoucherSetting'
import { useScmAuxUnmatchedStore } from '@/stores/scmAuxUnmatched'
import { pickVoucherType } from '@/utils/voucherTypePick'

/** 进销存生成凭证时所选凭证类型的记忆键（单据页 / 列表 / 批量共用） */
export const SCM_VOUCHER_TYPE_STORAGE_KEY = 'voucherType:scm'

export const SCM_VOUCHER_SETTING_PATH = '/base/scm-voucher-setting'
export const SCM_AUX_UNMATCHED_PATH = '/voucher/aux-unmatched'
export const SOURCE_LABEL: Record<string, string> = { partner: '往来单位', dept: '部门', person: '业务员' }

/** 从请求错误里取出未对应项；不是这类错误返回 null */
export function getScmAuxProblems(error: any): ScmAuxProblem[] | null {
  const body = error?.response?.data
  if (body?.reason !== 'SCM_AUX_UNMATCHED') return null
  const items = body?.data?.items
  if (!Array.isArray(items)) return []
  // 单张 / 批量失败：错误体带 doc_id、doc_no，补到每个未对应项上，供页面打开单据修正
  const docId = body?.data?.doc_id
  if (!docId) return items
  return items.map((p: ScmAuxProblem) => (p.docs?.length ? p : { ...p, docs: [{ id: docId, doc_no: body.data.doc_no || '' }] }))
}

/** 打开单据（可编辑则进编辑页，否则进查看页），供手工修正 */
export async function openScmDocForFix(id: string): Promise<void> {
  const router = (await import('@/router')).default
  const doc = (await scmApi.getDoc(id)).data
  await router.push(scmDocumentRoute(id, doc.doc_type, doc.status))
}

export function describeAuxProblem(p: ScmAuxProblem): string {
  const acc = `${p.accountCode} ${p.accountName}`
  const src = p.sourceType ? SOURCE_LABEL[p.sourceType] : ''
  if (p.kind === 'no_source') return `科目 ${acc} 的「${p.categoryName}」未设置取值来源`
  if (p.kind === 'empty_source') return `科目 ${acc} 的「${p.categoryName}」要取单据${src}，但单据未填`
  const who = [p.sourceType !== 'person' ? p.sourceCode : '', p.sourceName].filter(Boolean).join(' ')
  const hint = p.suggestions?.length ? `（近似：${p.suggestions[0].code} ${p.suggestions[0].name}）` : ''
  return `${src}「${who}」在「${p.categoryName}」中${p.kind === 'ambiguous' ? '对应到多个项目' : '找不到'}${hint}`
}

export async function gotoScmVoucherSetting(p?: ScmAuxProblem) {
  const router = (await import('@/router')).default
  const query: Record<string, string> = {}
  if (p?.sourceType) {
    query.tab = p.sourceType === 'partner' ? 'partner' : 'staff'
    query.keyword = p.sourceType === 'person' ? p.sourceName : p.sourceCode
  } else {
    query.tab = 'rule'
  }
  await router.push({ path: SCM_VOUCHER_SETTING_PATH, query })
}

/** 可按进销存资料自动新建辅助项的问题 */
export function isCreatableAuxProblem(p: ScmAuxProblem): boolean {
  return p.kind === 'unmatched' && !!p.sourceType && !!p.sourceCode
}

/** 自动新建结果的匹配键（与 createAux 提交的 source_code 口径一致） */
export function auxFailKey(p: Pick<ScmAuxProblem, 'sourceType' | 'sourceCode' | 'sourceName' | 'categoryId'>): string {
  return `${p.sourceType}|${p.sourceType === 'person' ? p.sourceName : p.sourceCode}|${p.categoryId}`
}

/**
 * 处理生成凭证的错误。是辅助核算拦截就跳转到「辅助核算对应不上」全页面（表格展示全部未对应项）并返回 true
 * （调用方不要再提示错误）；否则返回 false。
 * @param retry 自动新建 / 手工指定后重新生成凭证
 * @param onDone 重试成功后刷新来源页
 */
export async function handleScmAuxUnmatched(error: any, retry: () => Promise<unknown>, onDone?: () => unknown): Promise<boolean> {
  const problems = getScmAuxProblems(error)
  if (!problems) return false
  useScmAuxUnmatchedStore().open(problems, retry, onDone)
  const router = (await import('@/router')).default
  await router.push({ path: SCM_AUX_UNMATCHED_PATH })
  return true
}

/**
 * 页面「自动新建辅助项并重试」：按进销存资料新建总账辅助项目，再重新生成凭证。
 * 返回 'done'（已生成，可返回）/ 'stay'（仍有问题，留在本页）
 */
export async function runAutoCreateAndRetry(): Promise<'done' | 'stay'> {
  const store = useScmAuxUnmatchedStore()
  const creatable = store.problems.filter(isCreatableAuxProblem)
  if (!creatable.length) return 'stay'

  const r = await scmVoucherSettingApi.createAux(creatable.map(p => ({
    source_type: p.sourceType!,
    source_code: p.sourceType === 'person' ? p.sourceName : p.sourceCode,
    category_id: p.categoryId,
  })))
  const failures: Record<string, string> = {}
  for (const x of r.data.results) {
    if (!x.ok) failures[`${x.sourceType}|${x.sourceCode}|${x.categoryId}`] = x.message
  }
  store.failures = failures
  if (Object.keys(failures).length) {
    ElMessage.warning(`已新建 ${r.data.ok} 项，${Object.keys(failures).length} 项未能新建，请看表格「新建结果」列`)
    return 'stay'
  }
  ElMessage.success(`已新建 ${r.data.ok} 个辅助项目，正在重新生成凭证`)
  return retryGenerate()
}

/** 重新生成凭证（不新建）。成功 'done'；仍有未对应项 / 失败 'stay'（表格已按最新结果刷新） */
export async function retryGenerate(): Promise<'done' | 'stay'> {
  const store = useScmAuxUnmatchedStore()
  if (!store.retry) return 'stay'
  const version = store.version
  try {
    await store.retry()
  } catch (e: any) {
    const next = getScmAuxProblems(e)
    if (next) {
      store.problems = next
      store.failures = {}
      return 'stay'
    }
    ElMessage.error(e?.response?.data?.message || e?.message || '生成凭证失败')
    return 'stay'
  }
  // 回调内部（批量生成）又发现未对应项并重新 open：仍留在本页
  if (store.version !== version) return 'stay'
  const done = store.onDone
  store.clear()
  try { await done?.() } catch { /* 刷新失败不影响已生成 */ }
  return 'done'
}

/** 单张生成凭证（带辅助核算拦截处理）。成功返回凭证号，未生成返回 null */
export async function genScmVoucher(id: string, onDone?: () => unknown): Promise<string | null> {
  // 先选凭证类型（记住上次选择；空 = 进销存凭证设置的默认类型）
  const voucherTypeId = await pickVoucherType({ storageKey: SCM_VOUCHER_TYPE_STORAGE_KEY, defaultLabel: '按进销存凭证设置默认' })
  if (voucherTypeId === null) return null
  let voucherNo: string | null = null
  const run = async () => {
    const r = await scmApi.genVoucher(id, { skipErrorToast: true }, voucherTypeId)
    voucherNo = r.data?.voucher_no || ''
    ElMessage.success(`已生成凭证 ${voucherNo}`)
  }
  try {
    await run()
  } catch (e: any) {
    if (!(await handleScmAuxUnmatched(e, run, onDone))) ElMessage.error(e?.response?.data?.message || e?.message || '生成凭证失败')
  }
  return voucherNo
}
