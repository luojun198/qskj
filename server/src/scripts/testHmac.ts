#!/usr/bin/env node
/**
 * 测试讯飞 HMAC 签名认证
 */

import crypto from 'crypto'

const apiKey = '07013cf4c73b470c54583eda66705956'
const apiSecret = 'fa4df86b092331e8d94b652f' // 从 base64 解码得到
const apiUrl = 'https://maas-coding-api.cn-huabei-1.xf-yun.com/v2/chat/completions'

function generateHmacSignature(method: string, path: string, timestamp: string) {
  const signatureString = `${method}\n${path}\n${timestamp}`
  const hmac = crypto.createHmac('sha256', apiSecret)
  hmac.update(signatureString)
  return hmac.digest('base64')
}

async function testWithHmac() {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const method = 'POST'
  const path = '/v2/chat/completions'

  const signature = generateHmacSignature(method, path, timestamp)

  console.log('🔐 HMAC 签名信息：')
  console.log(`  API Key: ${apiKey}`)
  console.log(`  Timestamp: ${timestamp}`)
  console.log(`  Signature: ${signature}`)
  console.log()

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
        'X-Timestamp': timestamp,
        'X-Signature': signature,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'user', content: '你好' },
        ],
        max_tokens: 10,
      }),
    })

    const text = await response.text()
    console.log(`📡 响应状态: ${response.status}`)
    console.log(`📝 响应内容:`)
    console.log(text)
  } catch (error: any) {
    console.error('❌ 请求失败:', error.message)
  }
}

testWithHmac()
