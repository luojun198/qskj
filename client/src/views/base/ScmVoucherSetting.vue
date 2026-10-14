<template>
  <div class="page svs-page">
    <!-- 顶部导航 -->
    <div class="svs-header">
      <div class="svs-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="svs-header__sep">/</span>
        <span class="svs-header__title">供应链档案 / 进销存凭证设置</span>
        <el-tag v-if="userStore.accountSetName" size="small" effect="plain" style="margin-left:8px">{{ userStore.accountSetName }}</el-tag>
        <el-tag v-if="pendingTotal > 0" type="danger" size="small" style="margin-left:4px">{{ pendingTotal }} 项辅助核算未对应</el-tag>
        <el-tag v-else-if="setting" type="success" size="small" effect="plain" style="margin-left:4px">辅助核算已全部对应</el-tag>
      </div>
      <div class="svs-header__right">
        <el-tag v-if="dirty" type="warning" effect="plain">有未保存的修改</el-tag>
        <el-button size="small" type="success" plain :loading="presetting" @click="handlePreset">一键自动预设</el-button>
        <el-button v-if="preset" size="small" @click="loadSetting">撤销预设</el-button>
        <el-button size="small" :loading="loading" @click="loadSetting">刷新</el-button>
        <el-button type="primary" size="small" :loading="saving" :disabled="!dirty" @click="handleSave">保存设置</el-button>
      </div>
    </div>

    <div class="svs-main" v-loading="loading">
      <!-- 左侧分步导航 -->
      <aside class="svs-nav">
        <div
          v-for="(step, index) in steps"
          :key="step.key"
          class="svs-nav__item"
          :class="{ 'is-active': activeTab === step.key }"
          @click="switchTab(step.key)"
        >
          <span class="svs-nav__no" :class="`is-${step.state}`">{{ step.state === 'done' ? '✓' : index + 1 }}</span>
          <span class="svs-nav__text">
            <span class="svs-nav__title">{{ step.title }}</span>
            <span class="svs-nav__desc">{{ step.desc }}</span>
          </span>
          <el-badge v-if="step.badge" :value="step.badge" type="danger" class="svs-nav__badge" />
        </div>
        <div class="svs-nav__tip">
          生成凭证时，科目挂了哪些辅助核算，就按单据的往来单位 / 部门 / 业务员到总账辅助项目里<b>严格对应</b>；对不上会拦截，不再生成辅助账为空的凭证。
        </div>
      </aside>

      <section class="svs-content">
        <!-- ① 对方科目 -->
        <template v-if="activeTab === 'account'">
          <div class="svs-hint">
            单据生成凭证用到的对方科目。未填时系统按「默认编码 → 科目名称」自动匹配本账套科目；往来单位档案里配了应收 / 应付科目时优先取单位科目；存货科目取物料档案。
          </div>
          <el-form label-width="170px" size="small" class="svs-acc-form">
            <el-form-item label="默认凭证类型">
              <VoucherTypeSelect v-model="defaultVoucherType" default-label="自动（本期最近使用 / 编码最小）" width="260px" />
              <div class="svs-hint" style="margin:4px 0 0">单据生成凭证时选择框默认带出；生成时仍可临时改选。</div>
            </el-form-item>
            <el-row :gutter="16">
              <el-col v-for="acc in setting?.accounts || []" :key="acc.param_key" :xs="24" :lg="12">
                <el-form-item :label="acc.label">
                  <AccountSelect v-model="accountForm[acc.param_key]" :placeholder="`默认 ${acc.default_code}`" style="width:100%" />
                  <div v-if="presetAccount(acc.param_key)" class="svs-preset-tag">
                    <el-tag size="small" type="success" effect="plain">已预设</el-tag>
                    {{ presetAccount(acc.param_key)!.reason }}：{{ presetAccount(acc.param_key)!.current || '空' }} → {{ presetAccount(acc.param_key)!.proposed }} {{ presetAccount(acc.param_key)!.proposed_name }}
                  </div>
                  <ScmAccountHint :info="acc" :configured="!!accountForm[acc.param_key]" />
                  <div v-if="acc.aux_categories.length" class="svs-acc-aux">
                    辅助核算：
                    <el-tag v-for="c in acc.aux_categories" :key="c.id" size="small" effect="plain" :type="c.source === 'none' ? 'danger' : 'info'">
                      {{ c.name }} ← {{ SOURCE_LABEL[c.source] }}
                    </el-tag>
                  </div>
                </el-form-item>
              </el-col>
            </el-row>
          </el-form>

          <!-- 其他出入库按收发类别取对方科目（第五份反馈：没启用生产时用其他出库做领料、其他入库做成品入库） -->
          <div class="svs-block">
            <div class="svs-block__title">其他入库 / 其他出库：收发类别对方科目</div>
            <div class="svs-hint">
              其他入库、其他出库生成凭证时按单据的「收发类别」取对方科目。没启用生产模块时，领料用其他出库选「生产领用」（借生产成本），
              完工入库用其他入库选「成品入库」（贷生产成本）。未指定的类别按右侧默认科目。
            </div>
            <el-table :data="ioCategoryRows" size="small" border class="svs-io-table">
              <el-table-column label="收发类别" prop="category" width="140" />
              <el-table-column label="用于" width="90" align="center">
                <template #default="{ row }">{{ row.dir === 'in' ? '其他入库' : row.dir === 'out' ? '其他出库' : '出入库' }}</template>
              </el-table-column>
              <el-table-column label="对方科目" min-width="260">
                <template #default="{ row }">
                  <AccountSelect v-model="ioCategoryForm[row.category]" :placeholder="`默认 ${row.default_code} ${row.default_name}`" style="width:100%" />
                </template>
              </el-table-column>
              <el-table-column label="默认规则" min-width="200">
                <template #default="{ row }">{{ row.default_label }}：{{ row.default_code }} {{ row.default_name }}</template>
              </el-table-column>
            </el-table>
          </div>
        </template>

        <!-- ② 辅助核算来源与匹配规则 -->
        <template v-else-if="activeTab === 'rule'">
          <div class="svs-block">
            <div class="svs-block__title">匹配规则</div>
            <el-radio-group v-model="matchMode" class="svs-mode">
              <el-radio v-for="m in MATCH_MODES" :key="m.value" :value="m.value">
                <b>{{ m.label }}</b><span class="svs-mode__desc">{{ m.desc }}</span>
              </el-radio>
            </el-radio-group>
            <div class="svs-hint" style="margin-top:6px">
              只认<b>完全一致</b>（忽略首尾空格）。对不上时会列出最接近的候选，需在预览里<b>确认采纳</b>才生效；也可以手工指定或自动新建。手工指定 / 已确认的对应永远优先。
            </div>
          </div>
          <div class="svs-block">
            <div class="svs-block__title">辅助核算取值来源</div>
            <div class="svs-hint">每个辅助核算类别从单据的哪个字段取值。只有科目挂了该类别时才会填写；「涉及科目」为空的类别当前不会用到。</div>
            <el-table :data="setting?.categories || []" size="small" border>
              <el-table-column label="辅助核算类别" min-width="160">
                <template #default="{ row }">{{ row.name }} <span class="svs-muted">{{ row.code }}</span></template>
              </el-table-column>
              <el-table-column label="涉及科目" min-width="200">
                <template #default="{ row }">
                  <span v-if="!row.used_by.length" class="svs-muted">—</span>
                  <el-tag v-for="c in row.used_by" :key="c" size="small" effect="plain" style="margin-right:4px">{{ accountLabel(c) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="取值来源" width="200">
                <template #default="{ row }">
                  <el-select v-model="sourceMap[row.id]" size="small" style="width:100%">
                    <el-option v-for="s in SOURCE_OPTIONS" :key="s.value" :label="s.label" :value="s.value" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="说明" min-width="200">
                <template #default="{ row }">
                  <span v-if="row.used_by.length && sourceMap[row.id] === 'none'" class="svs-danger">科目要求该辅助核算但来源为「不填」，生成凭证会被拦截</span>
                  <span v-else class="svs-muted">{{ SOURCE_DESC[sourceMap[row.id]] }}</span>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </template>

        <!-- ③ ④ 匹配预览 -->
        <template v-else-if="activeTab === 'partner' || activeTab === 'staff'">
          <div class="svs-toolbar">
            <el-radio-group v-if="activeTab === 'staff'" v-model="staffType" size="small" @change="reloadPreview">
              <el-radio-button value="dept">部门</el-radio-button>
              <el-radio-button value="person">业务员</el-radio-button>
            </el-radio-group>
            <el-radio-group v-model="statusFilter" size="small" @change="reloadPreview">
              <el-radio-button value="">全部 {{ preview?.counts.all ?? '' }}</el-radio-button>
              <el-radio-button value="unmatched">未匹配 {{ preview?.counts.unmatched ?? '' }}</el-radio-button>
              <el-radio-button value="suggested">有近似建议 {{ preview?.counts.suggested ?? '' }}</el-radio-button>
              <el-radio-button value="matched">已对应 {{ preview?.counts.matched ?? '' }}</el-radio-button>
            </el-radio-group>
            <el-input v-model="keyword" size="small" clearable placeholder="编号 / 名称" style="width:180px" @keyup.enter="reloadPreview" @clear="reloadPreview" />
            <el-button size="small" @click="reloadPreview">查询</el-button>
            <span class="svs-toolbar__spacer" />
            <el-button size="small" type="warning" plain :disabled="!preview?.counts.suggested" :loading="batching" @click="batchConfirmSuggestions">批量采纳近似建议</el-button>
            <el-button size="small" type="primary" plain :disabled="!preview?.counts.unmatched" :loading="batching" @click="batchCreate">为未匹配项批量新建辅助项</el-button>
          </div>
          <div class="svs-hint">
            当前规则：<b>{{ modeLabel(preview?.match_mode) }}</b>。预览按<b>已保存</b>的设置计算<span v-if="dirty" class="svs-danger">（有未保存修改，保存后再看预览）</span>。
            <span v-if="preview?.not_required">另有 {{ preview.not_required }} 个{{ activeTab === 'partner' ? '往来单位' : '值' }}所用科目未挂辅助核算，无需对应。</span>
          </div>
          <el-table :data="preview?.rows || []" size="small" border stripe height="100%" class="svs-table" v-loading="previewLoading">
            <el-table-column type="index" label="序号" width="54" align="center" />
            <el-table-column v-if="currentSourceType !== 'person'" label="编号" prop="source_code" width="110" show-overflow-tooltip />
            <el-table-column :label="currentSourceType === 'person' ? '业务员' : '名称'" prop="source_name" min-width="140" show-overflow-tooltip />
            <el-table-column v-if="currentSourceType === 'partner'" label="类型" width="64" align="center">
              <template #default="{ row }">{{ PARTNER_TYPE[row.partner_type || 'both'] }}</template>
            </el-table-column>
            <el-table-column label="涉及科目" width="120" show-overflow-tooltip>
              <template #default="{ row }">{{ row.accounts.map(accountLabel).join('、') }}</template>
            </el-table-column>
            <el-table-column label="辅助类别" prop="category_name" width="100" show-overflow-tooltip />
            <el-table-column label="对应的总账辅助项目" min-width="220">
              <template #default="{ row }">
                <template v-if="row.status === 'matched'">
                  <span>{{ row.item_code }} {{ row.item_name }}</span>
                  <el-tag size="small" :type="howTag(row.how).type" effect="plain" style="margin-left:6px">{{ howTag(row.how).label }}</el-tag>
                </template>
                <template v-else-if="row.suggestions.length">
                  <span class="svs-muted">近似：</span>
                  <el-tooltip v-for="s in row.suggestions" :key="s.id" :content="`相似度 ${Math.round(s.score * 100)}%，点击采纳`">
                    <el-tag size="small" type="warning" effect="plain" class="svs-sugg" @click="confirmSuggestion(row, s)">
                      {{ s.code }} {{ s.name }}
                    </el-tag>
                  </el-tooltip>
                </template>
                <span v-else class="svs-danger">{{ row.ambiguous ? '对应到多个同名 / 同编号项目' : '找不到对应项目' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="90" align="center">
              <template #default="{ row }">
                <el-tag size="small" :type="row.status === 'matched' ? 'success' : row.status === 'suggested' ? 'warning' : 'danger'">
                  {{ row.status === 'matched' ? '已对应' : row.status === 'suggested' ? '待确认' : '未匹配' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="210" align="center">
              <template #default="{ row }">
                <el-button v-if="row.suggestions.length" link type="warning" size="small" @click="confirmSuggestion(row, row.suggestions[0])">采纳建议</el-button>
                <el-button link type="primary" size="small" @click="openPicker(row)">手工指定</el-button>
                <el-button v-if="row.status !== 'matched'" link type="success" size="small" @click="createOne(row)">新建辅助项</el-button>
                <el-button v-if="row.map_id" link type="danger" size="small" @click="clearMap(row)">清除指定</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="svs-pager">
            <el-pagination
              v-model:current-page="page"
              v-model:page-size="pageSize"
              :total="preview?.total || 0"
              :page-sizes="[50, 100, 200, 500]"
              size="small"
              layout="total, sizes, prev, pager, next"
              @current-change="loadPreview"
              @size-change="reloadPreview"
            />
          </div>
        </template>

        <!-- 一键预设结果 -->
        <template v-else-if="activeTab === 'preset' && preset">
          <div class="svs-hint">
            以下是一键自动预设的建议，<b>全部为最底层末级科目</b>。已配置且是末级的保持不动；未配置、配成上级或科目不存在的才预设。
            核对无误后点右上角<b>「保存设置」</b>才会写入；不想要可点「撤销预设」。物料 / 往来单位可取消勾选个别行。
          </div>
          <div class="svs-block">
            <div class="svs-block__title">对方科目（{{ preset.accounts.length }}）<span class="svs-muted">　另：匹配规则恢复「名称完全一致」，辅助核算来源恢复自动识别</span></div>
            <el-table :data="preset.accounts" size="small" border>
              <el-table-column label="科目" prop="label" width="190" />
              <el-table-column label="原值" min-width="180"><template #default="{ row }">{{ presetText(row.current, row.current_name) }}</template></el-table-column>
              <el-table-column label="预设为（末级）" min-width="200">
                <template #default="{ row }">
                  <span v-if="row.proposed">{{ row.proposed }} {{ row.proposed_name }}</span>
                  <span v-else class="svs-danger">本账套找不到，请先在会计科目中补建</span>
                </template>
              </el-table-column>
              <el-table-column label="原因" prop="reason" width="150" />
              <template #empty>对方科目都已是末级，无需预设</template>
            </el-table>
          </div>
          <div class="svs-block">
            <div class="svs-block__title">物料存货科目（已选 {{ presetItemSel.length }} / {{ preset.items.length }}）</div>
            <el-table ref="itemTableRef" :data="preset.items" size="small" border max-height="320" row-key="code" @selection-change="onItemSel">
              <el-table-column type="selection" width="40" :selectable="hasProposal" reserve-selection />
              <el-table-column label="物料编号" prop="code" width="120" show-overflow-tooltip />
              <el-table-column label="物料名称" prop="name" min-width="150" show-overflow-tooltip />
              <el-table-column label="类型" width="80"><template #default="{ row }">{{ ITEM_TYPES[row.item_type || ''] || row.item_type || '-' }}</template></el-table-column>
              <el-table-column label="原值" min-width="160"><template #default="{ row }">{{ presetText(row.current, row.current_name) }}</template></el-table-column>
              <el-table-column label="预设为（末级）" min-width="180">
                <template #default="{ row }">
                  <span v-if="row.proposed">{{ row.proposed }} {{ row.proposed_name }}</span>
                  <span v-else class="svs-danger">找不到存货类科目</span>
                </template>
              </el-table-column>
              <el-table-column label="原因" prop="reason" width="120" />
              <template #empty>物料存货科目都已是末级</template>
            </el-table>
          </div>
          <div class="svs-block">
            <div class="svs-block__title">往来单位应收 / 应付科目（已选 {{ presetPartnerSel.length }} / {{ preset.partners.length }}）</div>
            <el-table ref="partnerTableRef" :data="preset.partners" size="small" border max-height="320" :row-key="partnerRowKey" @selection-change="onPartnerSel">
              <el-table-column type="selection" width="40" :selectable="hasProposal" reserve-selection />
              <el-table-column label="编号" prop="code" width="110" show-overflow-tooltip />
              <el-table-column label="名称" prop="name" min-width="150" show-overflow-tooltip />
              <el-table-column label="科目" width="80"><template #default="{ row }">{{ row.field === 'ar_account' ? '应收' : '应付' }}</template></el-table-column>
              <el-table-column label="原值" min-width="160"><template #default="{ row }">{{ presetText(row.current, row.current_name) }}</template></el-table-column>
              <el-table-column label="预设为（末级）" min-width="180">
                <template #default="{ row }">
                  <span v-if="row.proposed">{{ row.proposed }} {{ row.proposed_name }}</span>
                  <span v-else class="svs-danger">找不到同类科目</span>
                </template>
              </el-table-column>
              <el-table-column label="原因" prop="reason" width="120" />
              <template #empty>往来单位科目都已是末级</template>
            </el-table>
          </div>
        </template>

        <!-- ⑤ 凭证摘要 -->
        <template v-else-if="activeTab === 'summary'">
          <div class="svs-hint">
            生成凭证时每条分录的摘要，按「单据类型 × 科目」套用下面的模板。可点占位符追加到当前编辑的模板；改过的会标「已自定义」，可单行恢复默认。
            优先级：<b>按科目的规则</b> &gt; 单据类型的科目角色模板 &gt; 内置默认。只影响<b>之后新生成</b>的凭证。
          </div>
          <div class="svs-toolbar">
            <el-select v-model="summaryDocType" size="small" style="width:220px">
              <el-option v-for="t in summaryInfo?.doc_types || []" :key="t.code" :label="`${t.name}（${t.code}）`" :value="t.code" />
            </el-select>
            <el-button size="small" :disabled="!summaryCustomCount" @click="resetAllSummary">全部恢复默认</el-button>
            <span class="svs-muted">已自定义 {{ summaryCustomCount }} 项</span>
          </div>
          <div class="svs-sum-chips">
            占位符：
            <el-tag
              v-for="ph in summaryInfo?.placeholders || []" :key="ph.key" size="small" effect="plain"
              class="svs-sugg" :title="ph.desc" @click="insertPlaceholder(ph.key)"
            >{{ '{' + ph.key + '}' }}</el-tag>
          </div>

          <div class="svs-block">
            <div class="svs-block__title">{{ summaryDocName }}：按科目角色</div>
            <el-table :data="summaryRoleRows" size="small" border>
              <el-table-column label="科目角色" width="140" prop="label" />
              <el-table-column label="摘要模板" min-width="320">
                <template #default="{ row }">
                  <el-input
                    v-model="summaryDraft[summaryDocType][row.key]" size="small" clearable maxlength="200"
                    :placeholder="summaryDefault(summaryDocType, row.key)"
                    @focus="summaryFocus = { kind: 'role', key: row.key }"
                  />
                </template>
              </el-table-column>
              <el-table-column label="预览" min-width="260">
                <template #default="{ row }">
                  <span class="svs-sum-preview">{{ summaryPreviewMap[`role:${summaryDocType}:${row.key}`] || '' }}</span>
                </template>
              </el-table-column>
              <el-table-column label="" width="150" align="center">
                <template #default="{ row }">
                  <template v-if="isRoleCustom(row.key)">
                    <el-tag size="small" type="warning" effect="plain">已自定义</el-tag>
                    <el-button link size="small" @click="resetRole(row.key)">恢复默认</el-button>
                  </template>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <div class="svs-block">
            <div class="svs-block__title">按科目的规则（优先级最高，可限定单据类型）</div>
            <el-table :data="summaryAccountRules" size="small" border>
              <el-table-column label="单据类型" width="170">
                <template #default="{ row }">
                  <el-select v-model="row.doc_type" size="small" style="width:100%">
                    <el-option label="所有类型" value="" />
                    <el-option v-for="t in summaryInfo?.doc_types || []" :key="t.code" :label="t.name" :value="t.code" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="科目" width="240">
                <template #default="{ row }"><AccountSelect v-model="row.account" style="width:100%" /></template>
              </el-table-column>
              <el-table-column label="摘要模板" min-width="280">
                <template #default="{ row, $index }">
                  <el-input v-model="row.template" size="small" maxlength="200" placeholder="如 销售{物料汇总}（{往来单位}）" @focus="summaryFocus = { kind: 'account', key: String($index) }" />
                </template>
              </el-table-column>
              <el-table-column label="预览" min-width="240">
                <template #default="{ $index }"><span class="svs-sum-preview">{{ summaryPreviewMap[`acc:${$index}`] || '' }}</span></template>
              </el-table-column>
              <el-table-column label="" width="70" align="center">
                <template #default="{ $index }"><el-button link type="danger" size="small" @click="summaryAccountRules.splice($index, 1)">删除</el-button></template>
              </el-table-column>
              <template #empty>暂无按科目的规则</template>
            </el-table>
            <el-button size="small" style="margin-top:8px" @click="addAccountRule">新增科目规则</el-button>
          </div>
        </template>

        <!-- ⑥ 结算账户检查 -->
        <template v-else-if="activeTab === 'settle'">
          <div class="svs-hint">收付款单的结算账户直接就是总账现金 / 银行科目（录单时从出纳账户选择），这里检查已用到的科目是否仍然可用。</div>
          <el-table :data="setting?.settle_accounts || []" size="small" border>
            <el-table-column label="科目编码" prop="code" width="140" />
            <el-table-column label="科目名称" prop="name" min-width="200" />
            <el-table-column label="使用单据数" prop="doc_count" width="100" align="right" />
            <el-table-column label="辅助核算" min-width="160">
              <template #default="{ row }">
                <span v-if="!row.aux_categories.length" class="svs-muted">—</span>
                <el-tag v-for="c in row.aux_categories" :key="c.id" size="small" effect="plain" style="margin-right:4px">{{ c.name }} ← {{ sourceLabel(c.source) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="检查结果" min-width="200">
              <template #default="{ row }">
                <el-tag v-if="!row.issues.length" type="success" size="small">正常</el-tag>
                <el-tag v-for="i in row.issues" :key="i" type="danger" size="small" style="margin-right:4px">{{ i }}</el-tag>
              </template>
            </el-table-column>
            <template #empty>还没有收付款单使用结算账户</template>
          </el-table>
        </template>
      </section>
    </div>

    <!-- 手工指定：轻量选择器 -->
    <el-dialog v-model="picker.visible" title="手工指定辅助项目" width="460px" append-to-body>
      <div class="svs-picker-info">
        {{ sourceLabel(picker.row?.source_type) }}：<b>{{ picker.row?.source_type === 'person' ? '' : picker.row?.source_code }} {{ picker.row?.source_name }}</b>
        → 「{{ picker.row?.category_name }}」
      </div>
      <el-select
        v-model="picker.itemId"
        filterable
        remote
        :remote-method="searchItems"
        :loading="picker.loading"
        placeholder="输入编码或名称搜索"
        style="width:100%"
      >
        <el-option v-for="it in picker.options" :key="it.id" :label="`${it.code} ${it.name}`" :value="it.id" />
      </el-select>
      <template #footer>
        <el-button size="small" @click="picker.visible = false">取消</el-button>
        <el-button size="small" type="primary" :disabled="!picker.itemId" @click="savePicker">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import VoucherTypeSelect from '@/components/voucher/VoucherTypeSelect.vue'
import AccountSelect from '@/components/base/AccountSelect.vue'
import ScmAccountHint from '@/components/system/ScmAccountHint.vue'
import { useUserStore } from '@/stores/user'
import { useBaseDataStore } from '@/stores/baseData'
import {
  scmVoucherSettingApi,
  type AuxPreviewResult,
  type AuxPreviewRow,
  type AuxSuggestion,
  type ScmAuxMatchHow,
  type ScmAuxMatchMode,
  type ScmAuxSource,
  type ScmAuxSourceType,
  type ScmVoucherSetting,
  type ScmSummarySetting,
  type SummaryAccountRule,
  type ScmPreset,
  type PresetItem,
  type PresetPartner,
} from '@/api/scmVoucherSetting'
import { ITEM_TYPES } from '@/api/scm'

type TabKey = 'preset' | 'account' | 'rule' | 'partner' | 'staff' | 'summary' | 'settle'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const baseDataStore = useBaseDataStore()

const SOURCE_LABEL: Record<ScmAuxSource, string> = { partner: '往来单位', dept: '部门', person: '业务员', none: '不填' }
const SOURCE_OPTIONS = (Object.keys(SOURCE_LABEL) as ScmAuxSource[]).map(value => ({ value, label: SOURCE_LABEL[value] }))
const SOURCE_DESC: Record<ScmAuxSource, string> = {
  partner: '取单据的往来单位（客户 / 供应商）',
  dept: '取单据的部门',
  person: '取单据的业务员',
  none: '不填写该辅助核算',
}
const MATCH_MODES: Array<{ value: ScmAuxMatchMode; label: string; desc: string }> = [
  { value: 'name', label: '名称完全一致', desc: '默认。往来单位名称与辅助项目名称一字不差' },
  { value: 'code', label: '编号完全一致', desc: '往来单位编号与辅助项目编码相同' },
  { value: 'code_name', label: '编号优先，名称兜底', desc: '先比编号，编号对不上再比名称' },
  { value: 'name_code', label: '名称优先，编号兜底', desc: '先比名称，名称对不上再比编号' },
]
const PARTNER_TYPE: Record<string, string> = { customer: '客户', supplier: '供应商', both: '客商' }
const HOW_TAG: Record<ScmAuxMatchHow, { label: string; type: 'primary' | 'success' | 'info' | 'warning' }> = {
  manual: { label: '手工指定', type: 'primary' },
  confirmed: { label: '已确认', type: 'warning' },
  created: { label: '自动新建', type: 'success' },
  code: { label: '编号一致', type: 'info' },
  name: { label: '名称一致', type: 'info' },
}

const loading = ref(false)
const saving = ref(false)
const setting = ref<ScmVoucherSetting | null>(null)
const accountForm = reactive<Record<string, string>>({})
const matchMode = ref<ScmAuxMatchMode>('name')
/** 进销存生成凭证的默认凭证类型（'' = 自动） */
const defaultVoucherType = ref('')
const sourceMap = reactive<Record<string, ScmAuxSource>>({})
const ioCategoryForm = reactive<Record<string, string>>({})
const ioCategoryRows = computed(() => setting.value?.io_category_accounts || [])
const savedSnapshot = ref('')

const activeTab = ref<TabKey>('account')
const staffType = ref<'dept' | 'person'>('dept')
const statusFilter = ref('')
const keyword = ref('')
const page = ref(1)
const pageSize = ref(50)
const preview = ref<AuxPreviewResult | null>(null)
const previewLoading = ref(false)
const batching = ref(false)

const currentSourceType = computed<ScmAuxSourceType>(() => (activeTab.value === 'partner' ? 'partner' : staffType.value))
const snapshot = () => JSON.stringify({ a: accountForm, vt: defaultVoucherType.value, m: matchMode.value, s: sourceMap, t: summaryCustomPayload(), r: summaryAccountRules.value, io: ioCategoryForm })

// ── 凭证摘要 ──
const summaryInfo = computed<ScmSummarySetting | undefined>(() => setting.value?.summary)
const summaryDocType = ref('SO')
const summaryDraft = reactive<Record<string, Record<string, string>>>({})   // 单据类型 → 角色 → 当前模板（默认或自定义）
const summaryAccountRules = ref<SummaryAccountRule[]>([])
const summaryPreviewMap = reactive<Record<string, string>>({})
const summaryFocus = ref<{ kind: 'role' | 'account'; key: string } | null>(null)
const summaryDocName = computed(() => summaryInfo.value?.doc_types.find(t => t.code === summaryDocType.value)?.name || '')
const summaryRoleRows = computed(() => {
  const info = summaryInfo.value
  if (!info) return []
  const def = info.defaults[summaryDocType.value] || {}
  return info.roles.filter(r => def[r.key] !== undefined)
})
function summaryDefault(docType: string, role: string) { return summaryInfo.value?.defaults[docType]?.[role] ?? '' }
function isRoleCustomOf(docType: string, role: string) {
  const v = (summaryDraft[docType]?.[role] ?? '').trim()
  return !!v && v !== summaryDefault(docType, role)
}
const isRoleCustom = (role: string) => isRoleCustomOf(summaryDocType.value, role)
function summaryCustomPayload() {
  const roles: Record<string, Record<string, string>> = {}
  for (const [dt, m] of Object.entries(summaryDraft)) {
    for (const role of Object.keys(m)) {
      if (isRoleCustomOf(dt, role)) (roles[dt] ||= {})[role] = m[role].trim()
    }
  }
  return roles
}
const summaryCustomCount = computed(() => {
  let n = summaryAccountRules.value.filter(r => r.account && r.template.trim()).length
  for (const m of Object.values(summaryCustomPayload())) n += Object.keys(m).length
  return n
})
function initSummary(info: ScmSummarySetting) {
  for (const k of Object.keys(summaryDraft)) delete summaryDraft[k]
  for (const [dt, roles] of Object.entries(info.defaults)) {
    summaryDraft[dt] = { ...roles } as Record<string, string>
    for (const [role, tpl] of Object.entries(info.custom.roles[dt] || {})) summaryDraft[dt][role] = tpl
  }
  summaryAccountRules.value = info.custom.accounts.map(r => ({ ...r }))
  if (!info.doc_types.some(t => t.code === summaryDocType.value)) summaryDocType.value = info.doc_types[0]?.code || 'SO'
}
function resetRole(role: string) { summaryDraft[summaryDocType.value][role] = summaryDefault(summaryDocType.value, role) }
function resetAllSummary() {
  const info = summaryInfo.value
  if (!info) return
  for (const [dt, roles] of Object.entries(info.defaults)) summaryDraft[dt] = { ...roles } as Record<string, string>
  summaryAccountRules.value = []
}
function addAccountRule() { summaryAccountRules.value.push({ doc_type: summaryDocType.value, account: '', template: '' }) }
function insertPlaceholder(key: string) {
  const f = summaryFocus.value
  const ph = `{${key}}`
  if (!f) { ElMessage.info('请先点一个模板输入框'); return }
  if (f.kind === 'role') {
    const m = summaryDraft[summaryDocType.value]
    m[f.key] = (m[f.key] || '') + ph
  } else {
    const r = summaryAccountRules.value[Number(f.key)]
    if (r) r.template += ph
  }
}
let summaryPreviewTimer: ReturnType<typeof setTimeout> | null = null
async function refreshSummaryPreview() {
  if (activeTab.value !== 'summary' || !summaryInfo.value) return
  const dt = summaryDocType.value
  const items: Array<{ key: string; doc_type: string; template: string; account_name?: string }> = []
  for (const r of summaryRoleRows.value) {
    items.push({ key: `role:${dt}:${r.key}`, doc_type: dt, template: summaryDraft[dt]?.[r.key] || summaryDefault(dt, r.key), account_name: r.label })
  }
  summaryAccountRules.value.forEach((r, i) => {
    items.push({ key: `acc:${i}`, doc_type: r.doc_type || dt, template: r.template, account_name: baseDataStore.accounts.find(a => a.code === r.account)?.name || '' })
  })
  try {
    const res = await scmVoucherSettingApi.summaryPreview(items)
    for (const x of res.data) summaryPreviewMap[x.key] = x.text
  } catch { /* 预览失败不影响编辑 */ }
}
watch([activeTab, summaryDocType, summaryDraft, summaryAccountRules], () => {
  if (summaryPreviewTimer) clearTimeout(summaryPreviewTimer)
  summaryPreviewTimer = setTimeout(() => { void refreshSummaryPreview() }, 300)
}, { deep: true })
// 一键预设：建议填到页面，物料 / 往来改动随保存提交
const preset = ref<ScmPreset | null>(null)
const presetting = ref(false)
const presetItemSel = ref<PresetItem[]>([])
const presetPartnerSel = ref<PresetPartner[]>([])
const itemTableRef = ref<{ toggleRowSelection: (row: unknown, selected: boolean) => void } | null>(null)
const partnerTableRef = ref<{ toggleRowSelection: (row: unknown, selected: boolean) => void } | null>(null)
const dirty = computed(() =>
  !!setting.value && (snapshot() !== savedSnapshot.value || presetItemSel.value.length > 0 || presetPartnerSel.value.length > 0))
const pendingTotal = computed(() => {
  const p = setting.value?.pending
  return p ? p.partner + p.dept + p.person : 0
})

const steps = computed(() => {
  const s = setting.value
  const accMissing = s ? s.accounts.filter(a => !a.resolved_code && !accountForm[a.param_key]).length : 0
  const ruleIssue = s ? s.categories.filter(c => c.used_by.length && sourceMap[c.id] === 'none').length : 0
  const settleIssue = s ? s.settle_accounts.filter(a => a.issues.length).length : 0
  const staffPending = s ? s.pending.dept + s.pending.person : 0
  const state = (bad: number) => (!s ? 'todo' : bad ? 'warn' : 'done')
  const presetStep = preset.value
    ? [{ key: 'preset' as TabKey, title: '预设结果', desc: '核对后保存才生效', badge: 0, state: 'warn' }]
    : []
  return [
    ...presetStep,
    { key: 'account' as TabKey, title: '对方科目', desc: '单据生成凭证用的科目', badge: accMissing, state: state(accMissing) },
    { key: 'rule' as TabKey, title: '来源与匹配规则', desc: '辅助核算取值与匹配方式', badge: ruleIssue, state: state(ruleIssue) },
    { key: 'partner' as TabKey, title: '往来单位对应', desc: '客户 / 供应商 ↔ 辅助项目', badge: s?.pending.partner || 0, state: state(s?.pending.partner || 0) },
    { key: 'staff' as TabKey, title: '部门 / 业务员对应', desc: '单据部门、业务员 ↔ 辅助项目', badge: staffPending, state: state(staffPending) },
    { key: 'summary' as TabKey, title: '凭证摘要', desc: '按单据类型 / 科目的摘要预设', badge: 0, state: 'done' },
    { key: 'settle' as TabKey, title: '结算账户检查', desc: '收付款用的现金 / 银行科目', badge: settleIssue, state: state(settleIssue) },
  ]
})

function accountLabel(code: string) {
  const acc = baseDataStore.accounts.find(a => a.code === code)
  return acc ? `${code} ${acc.name}` : code
}
function howTag(how: string | null) {
  return HOW_TAG[(how || 'name') as ScmAuxMatchHow] || HOW_TAG.name
}
function sourceLabel(source?: string | null) {
  return SOURCE_LABEL[(source || 'partner') as ScmAuxSource] || ''
}
function modeLabel(mode?: ScmAuxMatchMode) {
  return MATCH_MODES.find(m => m.value === mode)?.label || '名称完全一致'
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/')
}

function presetAccount(key: string) {
  return preset.value?.accounts.find(a => a.param_key === key && a.proposed)
}
function presetText(code: string, name: string) {
  return code ? `${code} ${name || '（不存在）'}` : '（空）'
}
const hasProposal = (row: { proposed: string }) => !!row.proposed
const partnerRowKey = (row: PresetPartner) => row.code + '|' + row.field
const onItemSel = (rows: PresetItem[]) => { presetItemSel.value = rows }
const onPartnerSel = (rows: PresetPartner[]) => { presetPartnerSel.value = rows }

async function handlePreset() {
  try {
    await ElMessageBox.confirm(
      '按本账套科目表自动预设，全部预设到最底层末级科目：\n' +
      '· 对方科目：已配置且是末级的不动，未配置 / 配成上级 / 科目不存在的重新预设\n' +
      '· 匹配规则恢复「名称完全一致」，辅助核算来源恢复自动识别\n' +
      '· 物料存货科目、往来单位应收 / 应付：为空或非末级的预设\n' +
      '结果先填到页面，核对后点「保存设置」才写入。',
      '一键自动预设',
      { type: 'info', confirmButtonText: '开始预设', customClass: 'svs-pre-msg' },
    )
  } catch { return }
  presetting.value = true
  try {
    const r = await scmVoucherSettingApi.preset()
    preset.value = r.data
    for (const a of r.data.accounts) if (a.proposed) accountForm[a.param_key] = a.proposed
    matchMode.value = r.data.match_mode
    for (const [k, v] of Object.entries(r.data.source_map)) sourceMap[k] = v
    activeTab.value = 'preset'
    await nextTick()
    // 默认全选有建议的行
    for (const row of r.data.items) if (row.proposed) itemTableRef.value?.toggleRowSelection(row, true)
    for (const row of r.data.partners) if (row.proposed) partnerTableRef.value?.toggleRowSelection(row, true)
    const all = [...r.data.accounts, ...r.data.items, ...r.data.partners]
    const missing = all.filter(x => !x.proposed).length
    if (!all.length) ElMessage.success('科目都已是末级，无需预设（匹配规则与辅助来源已恢复默认）')
    else if (missing) ElMessage.warning(`已预设 ${all.length - missing} 项，${missing} 项本账套找不到合适科目；核对后请点「保存设置」`)
    else ElMessage.success(`已预设 ${all.length} 项，核对后请点「保存设置」`)
  } finally {
    presetting.value = false
  }
}

async function loadSetting() {
  loading.value = true
  preset.value = null
  presetItemSel.value = []
  presetPartnerSel.value = []
  if (activeTab.value === 'preset') activeTab.value = 'account'
  try {
    const r = await scmVoucherSettingApi.get()
    setting.value = r.data
    for (const acc of r.data.accounts) accountForm[acc.param_key] = acc.value || ''
    defaultVoucherType.value = r.data.default_voucher_type_id || ''
    matchMode.value = r.data.match_mode
    for (const key of Object.keys(sourceMap)) delete sourceMap[key]
    for (const c of r.data.categories) sourceMap[c.id] = c.source
    for (const key of Object.keys(ioCategoryForm)) delete ioCategoryForm[key]
    for (const row of r.data.io_category_accounts || []) ioCategoryForm[row.category] = row.account || ''
    initSummary(r.data.summary)
    savedSnapshot.value = snapshot()
  } finally {
    loading.value = false
  }
}

async function handleSave() {
  saving.value = true
  try {
    const partnerMap = new Map<string, { code: string; ar_account?: string; ap_account?: string }>()
    for (const row of presetPartnerSel.value) {
      const item = partnerMap.get(row.code) || { code: row.code }
      item[row.field] = row.proposed
      partnerMap.set(row.code, item)
    }
    const r = await scmVoucherSettingApi.save({
      accounts: { ...accountForm },
      default_voucher_type_id: defaultVoucherType.value,
      match_mode: matchMode.value,
      source_map: { ...sourceMap },
      io_category_accounts: Object.fromEntries(Object.entries(ioCategoryForm).filter(([, code]) => !!code)),
      item_accounts: presetItemSel.value.map(x => ({ code: x.code, inv_account: x.proposed })),
      partner_accounts: [...partnerMap.values()],
      summary_templates: {
        roles: summaryCustomPayload(),
        accounts: summaryAccountRules.value.filter(r => r.account && r.template.trim()).map(r => ({ ...r, template: r.template.trim() })),
      },
    })
    const extra = r.data && (r.data.items || r.data.partners) ? `（物料 ${r.data.items} 个、往来单位 ${r.data.partners} 项科目已更新）` : ''
    ElMessage.success(`已保存${extra}`)
    await loadSetting()
    if (activeTab.value === 'partner' || activeTab.value === 'staff') await loadPreview()
  } finally {
    saving.value = false
  }
}

async function loadPreview() {
  previewLoading.value = true
  try {
    const r = await scmVoucherSettingApi.preview({
      source_type: currentSourceType.value,
      status: statusFilter.value || undefined,
      keyword: keyword.value.trim() || undefined,
      page: page.value,
      page_size: pageSize.value,
    })
    preview.value = r.data
  } finally {
    previewLoading.value = false
  }
}
function reloadPreview() {
  page.value = 1
  return loadPreview()
}
/** 对应关系变了：刷新预览与导航徽标 */
async function refreshAfterChange() {
  await Promise.all([loadPreview(), refreshPending()])
}
async function refreshPending() {
  const r = await scmVoucherSettingApi.get()
  if (setting.value) setting.value.pending = r.data.pending
}

function switchTab(key: TabKey) {
  activeTab.value = key
  router.replace({ query: { ...route.query, tab: key } })
}

watch(activeTab, tab => {
  if (tab === 'partner' || tab === 'staff') {
    preview.value = null
    void reloadPreview()
  }
})

// ── 对应维护 ──────────────────────────────────────────────

async function confirmSuggestion(row: AuxPreviewRow, s: AuxSuggestion) {
  try {
    await ElMessageBox.confirm(
      `「${row.source_name}」≈「${s.code} ${s.name}」（相似度 ${Math.round(s.score * 100)}%）\n确认把它们对应起来？之后生成凭证将记到该辅助项目。`,
      '采纳近似建议',
      { type: 'warning', confirmButtonText: '确认对应' },
    )
  } catch { return }
  await scmVoucherSettingApi.saveMap([{ source_type: row.source_type, source_code: row.source_code, category_id: row.category_id, aux_item_id: s.id, match_source: 'confirmed' }])
  ElMessage.success('已对应')
  await refreshAfterChange()
}

async function fetchAll(status: string) {
  const r = await scmVoucherSettingApi.preview({ source_type: currentSourceType.value, status, keyword: keyword.value.trim() || undefined, page: 1, page_size: 500 })
  return r.data.rows
}

async function batchConfirmSuggestions() {
  batching.value = true
  try {
    const rows = (await fetchAll('suggested')).filter(r => r.suggestions.length)
    if (!rows.length) return
    const lines = rows.slice(0, 15).map(r => `${r.source_name} ≈ ${r.suggestions[0].code} ${r.suggestions[0].name}（${Math.round(r.suggestions[0].score * 100)}%）`)
    if (rows.length > 15) lines.push(`…… 共 ${rows.length} 项`)
    try {
      await ElMessageBox.confirm(`按每行最接近的候选对应以下 ${rows.length} 项，请逐条核对：\n${lines.join('\n')}`, '批量采纳近似建议', {
        type: 'warning', confirmButtonText: '确认全部对应', customClass: 'svs-pre-msg',
      })
    } catch { return }
    await scmVoucherSettingApi.saveMap(rows.map(r => ({
      source_type: r.source_type, source_code: r.source_code, category_id: r.category_id, aux_item_id: r.suggestions[0].id, match_source: 'confirmed' as const,
    })))
    ElMessage.success(`已对应 ${rows.length} 项`)
    await refreshAfterChange()
  } finally {
    batching.value = false
  }
}

async function runCreate(rows: AuxPreviewRow[]) {
  const r = await scmVoucherSettingApi.createAux(rows.map(x => ({ source_type: x.source_type, source_code: x.source_code, category_id: x.category_id })))
  const failed = r.data.results.filter(x => !x.ok)
  if (failed.length) {
    await ElMessageBox.alert(
      `已新建 ${r.data.ok} 项，${failed.length} 项未新建：\n${failed.slice(0, 15).map(f => `· ${f.message}`).join('\n')}${failed.length > 15 ? `\n…… 共 ${failed.length} 项` : ''}`,
      '新建结果',
      { type: 'warning', customClass: 'svs-pre-msg' },
    ).catch(() => {})
  } else {
    ElMessage.success(`已新建 ${r.data.ok} 个辅助项目`)
  }
  await refreshAfterChange()
}

async function createOne(row: AuxPreviewRow) {
  const name = row.source_type === 'person' ? row.source_name : `${row.source_code} ${row.source_name}`
  try {
    await ElMessageBox.confirm(`在「${row.category_name}」中新建辅助项目「${name}」并对应？`, '新建辅助项', { type: 'info' })
  } catch { return }
  await runCreate([row])
}

async function batchCreate() {
  batching.value = true
  try {
    const rows = (await fetchAll('unmatched')).filter(r => !r.ambiguous)
    if (!rows.length) { ElMessage.info('没有可新建的项（对应到多个项目的需手工指定）'); return }
    try {
      await ElMessageBox.confirm(`按进销存资料的编号与名称，在总账辅助项目中新建 ${rows.length} 项并对应？\n已有近似项目的不在此列，请先在「有近似建议」里核对。`, '批量新建辅助项', {
        type: 'warning', confirmButtonText: '新建', customClass: 'svs-pre-msg',
      })
    } catch { return }
    await runCreate(rows)
  } finally {
    batching.value = false
  }
}

async function clearMap(row: AuxPreviewRow) {
  if (!row.map_id) return
  try {
    await ElMessageBox.confirm(`清除「${row.source_name}」的${HOW_TAG[row.how!].label}对应，恢复按规则自动匹配？`, '清除指定', { type: 'warning' })
  } catch { return }
  await scmVoucherSettingApi.deleteMap(row.map_id)
  ElMessage.success('已清除')
  await refreshAfterChange()
}

const picker = reactive({
  visible: false,
  row: null as AuxPreviewRow | null,
  itemId: '',
  loading: false,
  options: [] as Array<{ id: string; code: string; name: string }>,
})
async function searchItems(query: string) {
  if (!picker.row) return
  picker.loading = true
  try {
    picker.options = (await scmVoucherSettingApi.auxItems(picker.row.category_id, query)).data
  } finally {
    picker.loading = false
  }
}
async function openPicker(row: AuxPreviewRow) {
  picker.row = row
  picker.itemId = row.item_id || ''
  picker.options = []
  picker.visible = true
  await searchItems(row.source_name || '')
  if (!picker.options.length) await searchItems('')
}
async function savePicker() {
  const row = picker.row
  if (!row || !picker.itemId) return
  await scmVoucherSettingApi.saveMap([{ source_type: row.source_type, source_code: row.source_code, category_id: row.category_id, aux_item_id: picker.itemId, match_source: 'manual' }])
  picker.visible = false
  ElMessage.success('已指定')
  await refreshAfterChange()
}

onMounted(async () => {
  void baseDataStore.loadAccounts()
  // 生成凭证被拦截时会带 ?tab=partner&keyword=xxx 直达
  const tab = String(route.query.tab || '') as TabKey
  if (route.query.keyword) keyword.value = String(route.query.keyword)
  await loadSetting()
  if (['account', 'rule', 'partner', 'staff', 'settle'].includes(tab)) activeTab.value = tab
})
</script>

<style scoped>
.svs-page { display: flex; flex-direction: column; height: 100%; padding: 0; }
.svs-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-lighter); flex-wrap: wrap; gap: 8px;
}
.svs-header__left { display: flex; align-items: center; flex-wrap: wrap; }
.svs-header__sep { margin: 0 8px; color: var(--el-text-color-placeholder); }
.svs-header__title { font-size: var(--cw-text-lg); font-weight: 600; }
.svs-header__right { display: flex; align-items: center; gap: 8px; }

.svs-main { flex: 1; min-height: 0; display: flex; }
.svs-nav {
  width: 230px; flex-shrink: 0; padding: 12px 8px; border-right: 1px solid var(--el-border-color-lighter);
  overflow-y: auto; display: flex; flex-direction: column; gap: 4px;
}
.svs-nav__item {
  position: relative; display: flex; align-items: flex-start; gap: 10px; padding: 8px 10px;
  border-radius: 6px; cursor: pointer;
}
.svs-nav__item:hover { background: var(--el-fill-color-light); }
.svs-nav__item.is-active { background: var(--el-color-primary-light-9); }
.svs-nav__item.is-active .svs-nav__title { color: var(--el-color-primary); }
.svs-nav__no {
  flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  font-size: 12px; background: var(--el-fill-color); color: var(--el-text-color-secondary);
}
.svs-nav__no.is-done { background: var(--el-color-success-light-8); color: var(--el-color-success); }
.svs-nav__no.is-warn { background: var(--el-color-danger-light-8); color: var(--el-color-danger); }
.svs-nav__text { display: flex; flex-direction: column; min-width: 0; }
.svs-nav__title { font-weight: 600; font-size: var(--cw-text-base); }
.svs-nav__desc { font-size: 12px; color: var(--el-text-color-secondary); }
.svs-nav__badge { position: absolute; right: 8px; top: 6px; }
.svs-nav__tip {
  margin-top: auto; padding: 10px; font-size: 12px; line-height: 1.6; color: var(--el-text-color-secondary);
  background: var(--el-fill-color-lighter); border-radius: 6px;
}

.svs-content { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 12px 16px; overflow: auto; }
.svs-hint { font-size: var(--cw-text-base); color: var(--el-text-color-secondary); margin-bottom: 10px; line-height: 1.6; }
.svs-muted { color: var(--el-text-color-secondary); font-size: 12px; }
.svs-danger { color: var(--el-color-danger); }
.svs-acc-form { max-width: 1200px; }
.svs-preset-tag { width: 100%; font-size: 12px; color: var(--el-color-success); display: flex; gap: 6px; align-items: center; margin-top: 2px; }
.svs-acc-aux { width: 100%; font-size: 12px; color: var(--el-text-color-secondary); display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-top: 2px; }
.svs-block { margin-bottom: 18px; }
.svs-block__title { font-weight: 600; margin-bottom: 8px; }
.svs-mode { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.svs-mode__desc { margin-left: 8px; color: var(--el-text-color-secondary); font-size: 12px; }
.svs-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.svs-toolbar__spacer { flex: 1; }
.svs-table { flex: 1; min-height: 240px; }
.svs-sugg { cursor: pointer; margin-right: 4px; }
.svs-pager { display: flex; justify-content: flex-end; padding-top: 8px; }
.svs-sum-chips { margin-bottom: 10px; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; font-size: 12px; color: var(--el-text-color-secondary); }
.svs-sum-preview { color: var(--el-text-color-regular); font-size: 12px; }
.svs-picker-info { margin-bottom: 10px; color: var(--el-text-color-regular); }
</style>

<style>
/* 批量确认框保留换行 */
.svs-pre-msg .el-message-box__message { white-space: pre-line; max-height: 50vh; overflow: auto; }
</style>
