#!/usr/bin/env node
/**
 * 测试不同的模型名称
 */

const apiUrl = 'https://maas-coding-api.cn-huabei-1.xf-yun.com/v2/chat/completions'
const apiKey = '07013cf4c73b470c54583eda66705956:ZmE0ZGY4NmIwOTIzMzFlOGQ5NGI2NTJm'

const modelsToTest = [
  'hermes',
  'hermes-3',
  'hermes-2',
  'gpt-3.5-turbo',
  'gpt-4',
  'spark',
  'spark-3.5',
  'spark-lite',
]

async function testModel(model: string) {
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: '你是一个助手' },
          { role: 'user', content: '你好' },
        ],
        max_tokens: 10,
      }),
    })

    const text = await response.text()

    if (response.ok) {
      console.log(`✅ ${model}: 成功`)
      try {
        const data = JSON.parse(text)
        console.log(`   响应: ${data.choices?.[0]?.message?.content || '无内容'}`)
      } catch (e) {
        console.log(`   响应: ${text.substring(0, 100)}`)
      }
      return true
    } else {
      console.log(`❌ ${model}: 失败 (${response.status})`)
      try {
        const data = JSON.parse(text)
        console.log(`   错误: ${data.error?.message || text.substring(0, 100)}`)
      } catch (e) {
        console.log(`   错误: ${text.substring(0, 100)}`)
      }
      return false
    }
  } catch (error: any) {
    console.log(`❌ ${model}: 异常 - ${error.message}`)
    return false
  }
}

async function main() {
  console.log('🔍 测试可用的模型名称...\n')

  for (const model of modelsToTest) {
    await testModel(model)
    console.log()
  }
}

main()
