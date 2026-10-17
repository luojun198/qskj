/**
 * 标准记账凭证默认模板（hiprint panel JSON 快照）。
 *
 * 由客户端 client/src/utils/printTemplateDefaultsHiprint.ts 的 buildDefaultVoucherPanel() 生成，
 * 服务端新建账套与模板升级迁移都用这一份，保证和前端内置默认排版完全一致。
 * 客户端测试 voucherStandardPanelSync.spec.ts 会比对两边；改了前端排版请重新生成本文件。
 */
/* eslint-disable */
export const VOUCHER_STANDARD_PANEL = {
  "panels": [
    {
      "index": 0,
      "paperType": "other",
      "width": 220,
      "height": 140,
      "paperHeader": 23,
      "paperFooter": 315,
      "cwLayoutVersion": 2,
      "printElements": [
        {
          "options": {
            "left": 221,
            "top": 34,
            "height": 26,
            "width": 181,
            "field": "doc_title",
            "testData": "记 账 凭 证",
            "title": "记 账 凭 证",
            "fontSize": 18,
            "hideTitle": true,
            "fixed": true,
            "fontWeight": "bold",
            "textAlign": "center",
            "letterSpacing": 1
          },
          "printElementType": {
            "type": "text"
          }
        },
        {
          "options": {
            "left": 221,
            "top": 60,
            "width": 181,
            "height": 9,
            "fixed": true
          },
          "printElementType": {
            "type": "hline"
          }
        },
        {
          "options": {
            "left": 71,
            "top": 64,
            "height": 14,
            "width": 244,
            "field": "unit_text",
            "testData": "单位名称：示例账套",
            "title": "单位名称：示例账套",
            "fontSize": 10,
            "hideTitle": true,
            "fixed": true
          },
          "printElementType": {
            "type": "text"
          }
        },
        {
          "options": {
            "left": 241,
            "top": 72,
            "height": 14,
            "width": 142,
            "field": "date_cn_text",
            "testData": "2026年09月07日",
            "title": "2026年09月07日",
            "fontSize": 10,
            "hideTitle": true,
            "fixed": true,
            "textAlign": "center"
          },
          "printElementType": {
            "type": "text"
          }
        },
        {
          "options": {
            "left": 417,
            "top": 72,
            "height": 14,
            "width": 142,
            "field": "voucher_word_text",
            "testData": "[记] 字第 1 号",
            "title": "[记] 字第 1 号",
            "fontSize": 10,
            "hideTitle": true,
            "fixed": true,
            "textAlign": "right"
          },
          "printElementType": {
            "type": "text"
          }
        },
        {
          "options": {
            "left": 71,
            "top": 88,
            "width": 488,
            "height": 227,
            "field": "entries",
            "tableHeaderRepeat": "first",
            "tableFooterRepeat": "last",
            "autoCompletion": true,
            "fontSize": 9.5,
            "tableHeaderFontSize": 10.5,
            "tableHeaderFontWeight": "normal",
            "columns": [
              [
                {
                  "title": "摘　　要",
                  "field": "summary",
                  "width": 137,
                  "align": "left",
                  "halign": "center",
                  "columnId": "summary",
                  "colspan": 1,
                  "checked": true,
                  "tableSummary": "text",
                  "tableSummaryText": "合计",
                  "tableSummaryColspan": 2,
                  "tableSummaryAlign": "center"
                },
                {
                  "title": "科目编码",
                  "field": "account_code",
                  "width": 56,
                  "align": "left",
                  "halign": "center",
                  "columnId": "account_code",
                  "colspan": 1,
                  "checked": false
                },
                {
                  "title": "会计科目",
                  "field": "account_name",
                  "width": 90,
                  "align": "left",
                  "halign": "center",
                  "columnId": "account_name",
                  "colspan": 1,
                  "checked": false
                },
                {
                  "title": "会 计 科 目",
                  "field": "account_full_text",
                  "width": 186,
                  "align": "left",
                  "halign": "center",
                  "columnId": "account_full_text",
                  "colspan": 1,
                  "checked": true,
                  "tableSummaryColspan": 0
                },
                {
                  "title": "借方金额",
                  "field": "debit",
                  "width": 82,
                  "align": "right",
                  "halign": "center",
                  "columnId": "debit",
                  "colspan": 1,
                  "checked": true,
                  "tableSummary": "sum",
                  "tableSummaryAlign": "right",
                  "tableSummaryNumFormat": 2,
                  "tableSummaryText": " "
                },
                {
                  "title": "贷方金额",
                  "field": "credit",
                  "width": 82,
                  "align": "right",
                  "halign": "center",
                  "columnId": "credit",
                  "colspan": 1,
                  "checked": true,
                  "tableSummary": "sum",
                  "tableSummaryAlign": "right",
                  "tableSummaryNumFormat": 2,
                  "tableSummaryText": " "
                },
                {
                  "title": "数量",
                  "field": "quantity",
                  "width": 40,
                  "align": "right",
                  "halign": "center",
                  "columnId": "quantity",
                  "colspan": 1,
                  "checked": false
                },
                {
                  "title": "单价",
                  "field": "unit_price",
                  "width": 45,
                  "align": "right",
                  "halign": "center",
                  "columnId": "unit_price",
                  "colspan": 1,
                  "checked": false
                },
                {
                  "title": "单位",
                  "field": "unit",
                  "width": 30,
                  "align": "center",
                  "halign": "center",
                  "columnId": "unit",
                  "colspan": 1,
                  "checked": false
                },
                {
                  "title": "币种",
                  "field": "currency_code",
                  "width": 30,
                  "align": "center",
                  "halign": "center",
                  "columnId": "currency_code",
                  "colspan": 1,
                  "checked": false
                },
                {
                  "title": "汇率",
                  "field": "exchange_rate",
                  "width": 40,
                  "align": "right",
                  "halign": "center",
                  "columnId": "exchange_rate",
                  "colspan": 1,
                  "checked": false
                },
                {
                  "title": "外币金额",
                  "field": "foreign_amount",
                  "width": 56,
                  "align": "right",
                  "halign": "center",
                  "columnId": "foreign_amount",
                  "colspan": 1,
                  "checked": false
                },
                {
                  "title": "外币金额（含币种）",
                  "field": "fx_cell",
                  "width": 60,
                  "align": "left",
                  "halign": "center",
                  "columnId": "fx_cell",
                  "colspan": 1,
                  "checked": false
                },
                {
                  "title": "现金流量",
                  "field": "cash_flow_name",
                  "width": 70,
                  "align": "left",
                  "halign": "center",
                  "columnId": "cash_flow_name",
                  "colspan": 1,
                  "checked": false
                }
              ]
            ],
            "maxRows": 6,
            "tableBodyRowHeight": 28,
            "tableHeaderRowHeight": 28
          },
          "printElementType": {
            "type": "table",
            "title": "分录表",
            "columns": [
              [
                {
                  "title": "摘　　要",
                  "field": "summary",
                  "width": 137,
                  "align": "left",
                  "halign": "center",
                  "columnId": "summary",
                  "colspan": 1,
                  "checked": true,
                  "tableSummary": "text",
                  "tableSummaryText": "合计",
                  "tableSummaryColspan": 2,
                  "tableSummaryAlign": "center"
                },
                {
                  "title": "科目编码",
                  "field": "account_code",
                  "width": 56,
                  "align": "left",
                  "halign": "center",
                  "columnId": "account_code",
                  "colspan": 1,
                  "checked": false
                },
                {
                  "title": "会计科目",
                  "field": "account_name",
                  "width": 90,
                  "align": "left",
                  "halign": "center",
                  "columnId": "account_name",
                  "colspan": 1,
                  "checked": false
                },
                {
                  "title": "会 计 科 目",
                  "field": "account_full_text",
                  "width": 186,
                  "align": "left",
                  "halign": "center",
                  "columnId": "account_full_text",
                  "colspan": 1,
                  "checked": true,
                  "tableSummaryColspan": 0
                },
                {
                  "title": "借方金额",
                  "field": "debit",
                  "width": 82,
                  "align": "right",
                  "halign": "center",
                  "columnId": "debit",
                  "colspan": 1,
                  "checked": true,
                  "tableSummary": "sum",
                  "tableSummaryAlign": "right",
                  "tableSummaryNumFormat": 2,
                  "tableSummaryText": " "
                },
                {
                  "title": "贷方金额",
                  "field": "credit",
                  "width": 82,
                  "align": "right",
                  "halign": "center",
                  "columnId": "credit",
                  "colspan": 1,
                  "checked": true,
                  "tableSummary": "sum",
                  "tableSummaryAlign": "right",
                  "tableSummaryNumFormat": 2,
                  "tableSummaryText": " "
                },
                {
                  "title": "数量",
                  "field": "quantity",
                  "width": 40,
                  "align": "right",
                  "halign": "center",
                  "columnId": "quantity",
                  "colspan": 1,
                  "checked": false
                },
                {
                  "title": "单价",
                  "field": "unit_price",
                  "width": 45,
                  "align": "right",
                  "halign": "center",
                  "columnId": "unit_price",
                  "colspan": 1,
                  "checked": false
                },
                {
                  "title": "单位",
                  "field": "unit",
                  "width": 30,
                  "align": "center",
                  "halign": "center",
                  "columnId": "unit",
                  "colspan": 1,
                  "checked": false
                },
                {
                  "title": "币种",
                  "field": "currency_code",
                  "width": 30,
                  "align": "center",
                  "halign": "center",
                  "columnId": "currency_code",
                  "colspan": 1,
                  "checked": false
                },
                {
                  "title": "汇率",
                  "field": "exchange_rate",
                  "width": 40,
                  "align": "right",
                  "halign": "center",
                  "columnId": "exchange_rate",
                  "colspan": 1,
                  "checked": false
                },
                {
                  "title": "外币金额",
                  "field": "foreign_amount",
                  "width": 56,
                  "align": "right",
                  "halign": "center",
                  "columnId": "foreign_amount",
                  "colspan": 1,
                  "checked": false
                },
                {
                  "title": "外币金额（含币种）",
                  "field": "fx_cell",
                  "width": 60,
                  "align": "left",
                  "halign": "center",
                  "columnId": "fx_cell",
                  "colspan": 1,
                  "checked": false
                },
                {
                  "title": "现金流量",
                  "field": "cash_flow_name",
                  "width": 70,
                  "align": "left",
                  "halign": "center",
                  "columnId": "cash_flow_name",
                  "colspan": 1,
                  "checked": false
                }
              ]
            ]
          }
        },
        {
          "options": {
            "left": 55,
            "top": 111,
            "height": 136,
            "width": 11,
            "field": "brand_text",
            "testData": "润衡财经软件",
            "title": "润衡财经软件",
            "fontSize": 8,
            "hideTitle": true,
            "fixed": true,
            "textAlign": "center",
            "color": "#666"
          },
          "printElementType": {
            "type": "text"
          }
        },
        {
          "options": {
            "left": 563,
            "top": 111,
            "height": 136,
            "width": 13,
            "field": "attachments_side_text",
            "testData": "附单据2张",
            "title": "附单据2张",
            "fontSize": 10,
            "hideTitle": true,
            "fixed": true,
            "textAlign": "center"
          },
          "printElementType": {
            "type": "text"
          }
        },
        {
          "options": {
            "left": 71,
            "top": 322,
            "height": 20,
            "width": 98,
            "field": "supervisor_text",
            "testData": "会计主管：赵六",
            "title": "会计主管：赵六",
            "fontSize": 10,
            "hideTitle": true,
            "fixed": true
          },
          "printElementType": {
            "type": "text"
          }
        },
        {
          "options": {
            "left": 168,
            "top": 322,
            "height": 20,
            "width": 98,
            "field": "auditor_text",
            "testData": "审核：李四",
            "title": "审核：李四",
            "fontSize": 10,
            "hideTitle": true,
            "fixed": true
          },
          "printElementType": {
            "type": "text"
          }
        },
        {
          "options": {
            "left": 266,
            "top": 322,
            "height": 20,
            "width": 98,
            "field": "poster_text",
            "testData": "记账：王五",
            "title": "记账：王五",
            "fontSize": 10,
            "hideTitle": true,
            "fixed": true
          },
          "printElementType": {
            "type": "text"
          }
        },
        {
          "options": {
            "left": 363,
            "top": 322,
            "height": 20,
            "width": 98,
            "field": "cashier_text",
            "testData": "出纳：",
            "title": "出纳：",
            "fontSize": 10,
            "hideTitle": true,
            "fixed": true
          },
          "printElementType": {
            "type": "text"
          }
        },
        {
          "options": {
            "left": 461,
            "top": 322,
            "height": 20,
            "width": 98,
            "field": "maker_text",
            "testData": "制单：张三",
            "title": "制单：张三",
            "fontSize": 10,
            "hideTitle": true,
            "fixed": true
          },
          "printElementType": {
            "type": "text"
          }
        }
      ]
    }
  ]
} as const
