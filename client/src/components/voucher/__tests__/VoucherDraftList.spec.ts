import { mount } from '@vue/test-utils'
import { describe, expect, it, beforeEach } from 'vitest'
import VoucherDraftList from '../VoucherDraftList.vue'

/** el-table-v2 桩：把列定义渲染成 <th>，便于断言表头 */
const tableV2Stub = {
  props: ['columns', 'data'],
  template:
    '<table class="el-table-v2"><tr><th v-for="c in columns" :key="c.key" :data-label="c.title" :data-prop="c.key" :data-resizable="!!c.headerCellRenderer">{{ c.title }}</th></tr></table>',
}
const autoResizerStub = {
  template: '<div class="el-auto-resizer"><slot :height="400" :width="1200" /></div>',
}
const loadingDirective = { mounted() {}, updated() {}, unmounted() {} }

describe('VoucherDraftList 凭证列表组件', () => {
  beforeEach(() => {
    const store: Record<string, string> = {}
    globalThis.localStorage = {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => { store[key] = value },
      removeItem: (key: string) => { delete store[key] },
      clear: () => {},
      key: () => null,
      length: 0,
    }
  })
  const mockVouchers = [
    {
      id: 'v-1',
      voucher_no: '记-0001',
      voucher_date: '2026-09-06',
      voucher_type_name: '记账凭证',
      maker_name: '张三',
      auditor_name: '李四',
      poster_name: '王五',
      attachments_count: 2,
      entries: [
        {
          id: 'e-1',
          summary: '提现备用',
          account_code: '1001',
          account_name: '库存现金',
          amount: 500,
          direction: 'debit',
          project_name: '研发项目',
          dept_name: '财务部',
          person_name: '张三',
        },
        {
          id: 'e-2',
          summary: '提现备用',
          account_code: '1002',
          account_name: '银行存款',
          amount: 500,
          direction: 'credit',
        },
      ],
    },
  ]

  it('次级操作搜索栏包含新增凭证、仅未记账凭证提示、搜索条件、快速搜索及恢复凭证排列', () => {
    const wrapper = mount(VoucherDraftList, {
      props: { vouchers: mockVouchers },
      global: {
        directives: { loading: loadingDirective },
        stubs: {
          'el-card': { template: '<div class="el-card"><div class="el-card__header"><slot name="header" /></div><div class="el-card__body"><slot /></div></div>' },
          'el-button': { template: '<button class="el-button" @click="$emit(\x27click\x27)"><slot /></button>' },
          'el-input': { props: ['modelValue'], template: '<input class="el-input" :value="modelValue" />' },
          'el-checkbox': { props: ['modelValue'], template: '<label class="el-checkbox"><input type="checkbox" :checked="modelValue" /><slot /></label>' },
          'el-table-v2': tableV2Stub,
          'el-auto-resizer': autoResizerStub,
          'el-select': { template: '<select><slot /></select>' },
          'el-option': { template: '<option><slot /></option>' },
          'el-icon': { template: '<i><slot /></i>' },
        },
      },
    })

    // 1. 次级操作搜索栏结构
    expect(wrapper.find('.gl-sub-bar').exists()).toBe(true)
    expect(wrapper.find('.gl-sub-bar__add-btn').text()).toContain('新增凭证')
    expect(wrapper.find('.gl-search-label').text()).toBe('搜索条件')
    expect(wrapper.find('.gl-search-btn').text()).toContain('快速搜索')
    // 录入页固定只列未记账凭证：勾选框已改为固定提示，不再可切换
    expect(wrapper.find('.gl-sub-checkbox').exists()).toBe(false)
    expect(wrapper.find('.gl-sub-scope').text()).toContain('仅未记账凭证')
    expect(wrapper.find('.gl-reset-btn').text()).toContain('恢复凭证排列')

    // 2. 表头检查（辅助列根据数据动态显示：数据中有项目/部门/人员，无客供）
    const ths = wrapper.findAll('th')
    const labels = ths.map(th => th.attributes('data-label'))
    expect(labels).toEqual([
      '年',
      '月',
      '类型',
      '编号',
      '分录摘要',
      '科目编码',
      '科目名称',
      '借方金额',
      '贷方金额',
      '凭证日期',
      '附单数',
      '制单人',
      '审核人',
      '记账人',
      '项目',
      '部门',
      '人员',
    ])

    // 3. 每个表头都带列宽拖动手把
    expect(ths.every(th => th.attributes('data-resizable') === 'true')).toBe(true)
  })

  it('辅助列根据 aux_data 中实际使用的辅助项目动态显示', () => {
    const auxVouchers = [
      {
        id: 'v-2',
        voucher_no: '记-0002',
        voucher_date: '2026-09-06',
        voucher_type_name: '记账凭证',
        entries: [
          {
            id: 'e-1',
            summary: '采购材料',
            account_code: '1403',
            account_name: '原材料',
            amount: 1000,
            direction: 'debit',
            aux_data: {
              supplier: { id: 's1', name: '供应商A' },
              dept: { id: 'd1', name: '采购部' },
              custom_type: { id: 'c1', name: '自定义项' },
            },
          },
          {
            id: 'e-2',
            summary: '采购材料',
            account_code: '1002',
            account_name: '银行存款',
            amount: 1000,
            direction: 'credit',
          },
        ],
      },
    ]
    const wrapper = mount(VoucherDraftList, {
      props: { vouchers: auxVouchers, auxCategories: [{ code: 'custom_type', name: '自定义类别' }] },
      global: {
        directives: { loading: loadingDirective },
        stubs: {
          'el-card': { template: '<div class="el-card"><div class="el-card__header"><slot name="header" /></div><div class="el-card__body"><slot /></div></div>' },
          'el-button': { template: '<button class="el-button" @click="$emit(\x27click\x27)"><slot /></button>' },
          'el-input': true,
          'el-checkbox': true,
          'el-table-v2': tableV2Stub,
          'el-auto-resizer': autoResizerStub,
          'el-select': true,
          'el-option': true,
          'el-icon': true,
        },
      },
    })

    const labels = wrapper.findAll('th').map(th => th.attributes('data-label'))
    // aux_data 中有 supplier/dept/custom_type，没有 project/person → 不显示项目和人员列
    expect(labels).toEqual([
      '年',
      '月',
      '类型',
      '编号',
      '分录摘要',
      '科目编码',
      '科目名称',
      '借方金额',
      '贷方金额',
      '凭证日期',
      '附单数',
      '制单人',
      '审核人',
      '记账人',
      '客供',
      '部门',
      '自定义类别',
    ])
  })

  it('点击新增凭证和恢复凭证排列可正常触发事件', async () => {
    const wrapper = mount(VoucherDraftList, {
      props: { vouchers: [] },
      global: {
        directives: { loading: loadingDirective },
        stubs: {
          'el-card': { template: '<div class="el-card"><div class="el-card__header"><slot name="header" /></div><div class="el-card__body"><slot /></div></div>' },
          'el-button': { template: '<button class="el-button" @click="$emit(\x27click\x27)"><slot /></button>' },
          'el-input': true,
          'el-checkbox': true,
          'el-table-v2': true,
          'el-auto-resizer': true,
          'el-select': true,
          'el-option': true,
          'el-icon': true,
        },
      },
    })

    await wrapper.find('.gl-sub-bar__add-btn').trigger('click')
    expect(wrapper.emitted('add-voucher')).toBeTruthy()

    await wrapper.find('.gl-reset-btn').trigger('click')
    expect(wrapper.emitted('reset-order')).toBeTruthy()
  })
})
