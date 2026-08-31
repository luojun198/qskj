# 第三方 AI 模型配置说明

## 当前配置状态

已为系统配置第三方 AI 模型（讯飞星火），配置信息已保存到数据库。

### 配置信息

- **提供商**: xunfei
- **API URL**: https://maas-coding-api.cn-huabei-1.xf-yun.com/v1/chat/completions
- **API Key**: 07013cf4c73b470c54583eda66705956:ZmE0ZGY4NmIwOTIzMzFlOGQ5NGI2NTJm
- **模型**: gpt-3.5-turbo
- **状态**: 已启用

## 使用的脚本

### 1. 配置脚本
```bash
npm run config:ai
```
位置: `server/src/scripts/configThirdPartyAi.ts`

### 2. 测试脚本
```bash
npm run test:ai
```
位置: `server/src/scripts/testThirdPartyAi.ts`

## 当前问题

API 认证方式需要确认。根据测试结果，该 API 可能需要：
1. HMAC 签名认证
2. 特殊的 API key 格式
3. 或者其他认证方式

建议：
1. 查看讯飞星火官方文档确认正确的 API 调用方式
2. 联系 API 提供方确认认证方法
3. 确认 API URL 和模型名称是否正确

## 如何更新配置

如果需要更新 API URL、模型名称或其他配置，可以：

1. 修改 `server/src/scripts/configThirdPartyAi.ts` 中的配置
2. 重新运行 `npm run config:ai`

或者直接在前端界面中修改（报表管理 -> AI 配置）。

## 数据库表结构

配置保存在 `ai_config` 表中：
- `provider`: 提供商名称
- `api_url`: API 端点 URL
- `api_key`: API 密钥
- `model`: 模型名称
- `enabled`: 是否启用（1=启用，0=禁用）
- `settings`: JSON 格式的额外设置

## 代码集成点

AI 功能在以下位置被调用：

1. **智能摘要**: `server/src/routes/voucherAi.ts`
   - 接口: `POST /api/vouchers/ai/summary`
   - 用于根据凭证分录生成业务摘要

2. **异常检测**: `server/src/routes/reportAi.ts`
   - 接口: `POST /api/report/ai/anomaly-check`
   - 用于检测凭证分录是否异常

3. **AI 配置管理**: `server/src/routes/reportAi.ts`
   - 接口: `GET /api/report/ai/config` - 查询配置
   - 接口: `PUT /api/report/ai/config` - 更新配置

## 下一步

1. 确认正确的 API 调用方式
2. 如果需要修改请求格式，更新以下文件：
   - `server/src/routes/voucherAi.ts`
   - `server/src/routes/reportAi.ts`
   - `server/src/services/voucherEntry.ts`
