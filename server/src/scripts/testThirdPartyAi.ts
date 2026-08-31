#!/usr/bin/env node
/**
 * 测试第三方 AI 模型连接
 * 使用方法: npm run test:ai
 */

import { getDb } from '../db/index.js'

async function testAi() {
  try {
    const db = getDb()

    // 获取 AI 配置
    const aiConfig = db
      .prepare('SELECT * FROM ai_config WHERE enabled = 1 LIMIT 1')
      .get() as any

    if (!aiConfig) {
      console.log('❌ 未找到启用的 AI 配置')
      process.exit(1)
    }

    console.log('📋 AI 配置信息：')
    console.log(`  提供商: ${aiConfig.provider}`)
    console.log(`  API URL: ${aiConfig.api_url}`)
    console.log(`  模型: ${aiConfig.model}`)
    console.log(`  状态: ${aiConfig.enabled ? '已启用' : '已禁用'}`)
    console.log('\n🔄 正在测试 AI 连接...\n')

    // 测试请求
    const testMessage = '借：银行存款 10000\n贷：财政拨款收入 10000'

    const response = await fetch(aiConfig.api_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aiConfig.api_key}`,
      },
      body: JSON.stringify({
        model: aiConfig.model,
        messages: [
          {
            role: 'system',
            content: '你是一个财务助手，根据凭证分录生成简洁的中文业务摘要（10个字以内）。',
          },
          {
            role: 'user',
            content: `根据以下凭证分录生成摘要：\n${testMessage}`,
          },
        ],
        max_tokens: 50,
        temperature: 0.3,
      }),
    })

    const responseText = await response.text()

    if (!response.ok) {
      console.log(`❌ API 请求失败 (${response.status}):`)
      console.log(responseText)
      process.exit(1)
    }

    console.log('✅ API 连接成功！')
    console.log('\n📝 原始响应：')
    console.log(responseText)

    let data
    try {
      data = JSON.parse(responseText)
      console.log('\n📝 解析后的 JSON：')
      console.log(JSON.stringify(data, null, 2))
    } catch (e) {
      console.log('\n⚠️  响应不是有效的 JSON 格式')
      process.exit(1)
    }

    // 提取摘要
    const summary = data.choices?.[0]?.message?.content
    if (summary) {
      console.log('\n💡 生成的摘要：', summary)
    }

    console.log('\n🎉 测试完成！')
    process.exit(0)
  } catch (error: any) {
    console.error('❌ 测试失败:', error.message)
    process.exit(1)
  }
}

testAi()
