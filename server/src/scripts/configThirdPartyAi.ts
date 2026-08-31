#!/usr/bin/env node
/**
 * 配置第三方 AI 模型（讯飞星火）
 * 使用方法: npm run config:ai
 */

import { getDb } from '../db/index.js'
import { v4 as uuidv4 } from 'uuid'

const config = {
  provider: 'xunfei', // 讯飞星火
  api_url: 'https://maas-coding-api.cn-huabei-1.xf-yun.com/v1/chat/completions',
  api_key: '07013cf4c73b470c54583eda66705956:ZmE0ZGY4NmIwOTIzMzFlOGQ5NGI2NTJm',
  model: 'gpt-3.5-turbo', // 使用通用模型名
  enabled: 1,
  settings: JSON.stringify({
    temperature: 0.7,
    max_tokens: 2000,
  }),
}

async function configureAi() {
  try {
    const db = getDb()

    // 获取所有账套
    const accountSets = db.prepare('SELECT id, name FROM account_sets').all() as any[]

    if (accountSets.length === 0) {
      console.log('❌ 未找到账套，请先创建账套')
      process.exit(1)
    }

    console.log(`📋 找到 ${accountSets.length} 个账套`)

    // 为每个账套配置 AI
    for (const accountSet of accountSets) {
      const id = uuidv4()

      // 检查是否已有配置
      const existing = db
        .prepare('SELECT id FROM ai_config WHERE account_set_id = ?')
        .get(accountSet.id) as any

      if (existing) {
        // 更新现有配置
        db.prepare(
          `UPDATE ai_config
           SET provider = ?, api_url = ?, api_key = ?, model = ?, enabled = ?, settings = ?, updated_at = datetime('now')
           WHERE account_set_id = ?`
        ).run(
          config.provider,
          config.api_url,
          config.api_key,
          config.model,
          config.enabled,
          config.settings,
          accountSet.id
        )
        console.log(`✅ 已更新账套 "${accountSet.name}" 的 AI 配置`)
      } else {
        // 插入新配置
        db.prepare(
          `INSERT INTO ai_config (id, account_set_id, provider, api_url, api_key, model, enabled, settings)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          id,
          accountSet.id,
          config.provider,
          config.api_url,
          config.api_key,
          config.model,
          config.enabled,
          config.settings
        )
        console.log(`✅ 已为账套 "${accountSet.name}" 创建 AI 配置`)
      }
    }

    console.log('\n🎉 AI 配置完成！')
    console.log('\n配置信息：')
    console.log(`  提供商: ${config.provider}`)
    console.log(`  API URL: ${config.api_url}`)
    console.log(`  模型: ${config.model}`)
    console.log(`  状态: ${config.enabled ? '已启用' : '已禁用'}`)

    process.exit(0)
  } catch (error: any) {
    console.error('❌ 配置失败:', error.message)
    process.exit(1)
  }
}

configureAi()
