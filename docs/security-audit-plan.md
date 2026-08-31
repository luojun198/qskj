# 安全审查计划

## 目标
全面审查系统安全性，消除潜在安全风险

## 安全审查清单

### 1. SQL注入防护（1天）

#### 1.1 审查动态SQL构造

**高风险区域**
- `server/src/routes/base.ts` - 科目查询、核算项目查询
- `server/src/routes/voucher.ts` - 凭证查询、批量操作
- `server/src/routes/ledger.ts` - 账簿查询
- `server/src/routes/report.ts` - 报表查询
- `server/src/routes/system.ts` - 用户查询、日志查询

#### 审查要点
```typescript
// ❌ 危险：字符串拼接
const sql = `SELECT * FROM accounts WHERE code = '${code}'`

// ✅ 安全：参数化查询
const sql = `SELECT * FROM accounts WHERE code = ?`
db.prepare(sql).get(code)

// ❌ 危险：动态表名/列名
const sql = `SELECT * FROM ${tableName} WHERE ${columnName} = ?`

// ✅ 安全：白名单验证
const allowedTables = ['accounts', 'vouchers']
if (!allowedTables.includes(tableName)) {
  throw new Error('Invalid table name')
}
```

#### 审查脚本
```typescript
// scripts/audit-sql-injection.ts
import { readFileSync } from 'fs'
import { glob } from 'glob'

const dangerousPatterns = [
  /\$\{[^}]+\}/g,  // 模板字符串插值
  /\+\s*['"`]/g,   // 字符串拼接
  /\.exec\(/g,     // db.exec() 可能不安全
]

async function auditSqlInjection() {
  const files = await glob('server/src/**/*.ts')
  const issues: Array<{ file: string; line: number; pattern: string }> = []

  for (const file of files) {
    const content = readFileSync(file, 'utf-8')
    const lines = content.split('\n')

    lines.forEach((line, index) => {
      dangerousPatterns.forEach(pattern => {
        if (pattern.test(line) && line.includes('SELECT') || line.includes('INSERT') || line.includes('UPDATE') || line.includes('DELETE')) {
          issues.push({
            file,
            line: index + 1,
            pattern: pattern.toString()
          })
        }
      })
    })
  }

  console.log(`Found ${issues.length} potential SQL injection issues:`)
  issues.forEach(issue => {
    console.log(`  ${issue.file}:${issue.line} - ${issue.pattern}`)
  })
}

auditSqlInjection()
```

#### 修复方案
1. 所有用户输入必须使用参数化查询
2. 动态表名/列名使用白名单验证
3. 避免使用 `db.exec()` 执行用户输入
4. 使用 ORM 或查询构造器（可选）

### 2. XSS防护（0.5天）

#### 2.1 前端输出转义

**高风险区域**
- 凭证摘要显示
- 用户输入的备注/说明
- 科目名称显示
- 报表数据显示

#### 审查要点
```vue
<!-- ❌ 危险：v-html 直接渲染 -->
<div v-html="userInput"></div>

<!-- ✅ 安全：文本插值自动转义 -->
<div>{{ userInput }}</div>

<!-- ✅ 安全：使用 DOMPurify 清理 -->
<div v-html="sanitize(userInput)"></div>
```

#### 修复方案
```typescript
// client/src/utils/sanitize.ts
import DOMPurify from 'dompurify'

export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'br'],
    ALLOWED_ATTR: []
  })
}
```

#### 2.2 后端响应头配置

```typescript
// server/src/index.ts
app.use((req, res, next) => {
  // 防止 XSS
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')

  // CSP 策略
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
  )

  next()
})
```

### 3. CSRF防护（0.5天）

#### 3.1 CSRF Token实现

```typescript
// server/src/middleware/csrf.ts
import { randomBytes } from 'crypto'

const csrfTokens = new Map<string, string>()

export function generateCsrfToken(userId: string): string {
  const token = randomBytes(32).toString('hex')
  csrfTokens.set(userId, token)
  return token
}

export function validateCsrfToken(userId: string, token: string): boolean {
  const storedToken = csrfTokens.get(userId)
  return storedToken === token
}

export function csrfMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    const token = req.headers['x-csrf-token'] as string
    if (!validateCsrfToken(req.userId, token)) {
      return res.status(403).json({ code: 403, message: 'Invalid CSRF token' })
    }
  }
  next()
}
```

#### 3.2 前端集成

```typescript
// client/src/api/request.ts
instance.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  const csrfToken = localStorage.getItem('csrfToken')

  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }

  if (csrfToken && ['post', 'put', 'delete'].includes(config.method || '')) {
    config.headers['X-CSRF-Token'] = csrfToken
  }

  return config
})
```

### 4. 敏感数据加密（1天）

#### 4.1 数据库字段加密

**需要加密的字段**
- 用户密码（已加密 bcrypt）
- AI API密钥
- 备份文件路径
- 敏感系统参数

#### 加密工具
```typescript
// server/src/utils/encryption.ts
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY = scryptSync(process.env.ENCRYPTION_KEY || 'default-key', 'salt', 32)

export function encrypt(text: string): string {
  const iv = randomBytes(16)
  const cipher = createCipheriv(ALGORITHM, KEY, iv)

  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

export function decrypt(encryptedText: string): string {
  const [ivHex, authTagHex, encrypted] = encryptedText.split(':')

  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')

  const decipher = createDecipheriv(ALGORITHM, KEY, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}
```

#### 应用加密
```typescript
// 保存AI配置时加密API密钥
router.put('/ai/config', (req: AuthRequest, res) => {
  const { api_key, ...rest } = req.body

  const encryptedKey = encrypt(api_key)

  db.prepare(`
    UPDATE ai_config SET api_key = ?, ... WHERE account_set_id = ?
  `).run(encryptedKey, ...)
})

// 读取时解密
router.get('/ai/config', (req: AuthRequest, res) => {
  const config = db.prepare('SELECT * FROM ai_config WHERE ...').get()

  if (config.api_key) {
    config.api_key = decrypt(config.api_key)
  }

  res.json({ code: 0, data: config })
})
```

### 5. 认证与授权加固（1天）

#### 5.1 JWT安全配置

```typescript
// server/src/middleware/auth.ts
import jwt from 'jsonwebtoken'

// ✅ 使用强密钥
const JWT_SECRET = process.env.JWT_SECRET || randomBytes(64).toString('hex')

// ✅ 设置合理的过期时间
const JWT_EXPIRES_IN = '8h'

// ✅ 添加刷新令牌机制
export function generateTokens(userId: string) {
  const accessToken = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '15m' })
  const refreshToken = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' })

  return { accessToken, refreshToken }
}

// ✅ 令牌黑名单（登出时）
const tokenBlacklist = new Set<string>()

export function revokeToken(token: string) {
  tokenBlacklist.add(token)
}

export function isTokenRevoked(token: string): boolean {
  return tokenBlacklist.has(token)
}
```

#### 5.2 密码策略加强

```typescript
// server/src/utils/password.ts
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) {
    return '密码长度至少8位'
  }

  if (!/[A-Z]/.test(password)) {
    return '密码必须包含大写字母'
  }

  if (!/[a-z]/.test(password)) {
    return '密码必须包含小写字母'
  }

  if (!/[0-9]/.test(password)) {
    return '密码必须包含数字'
  }

  if (!/[!@#$%^&*]/.test(password)) {
    return '密码必须包含特殊字符'
  }

  return null
}

// 密码历史记录（防止重复使用）
export function checkPasswordHistory(userId: string, newPassword: string): boolean {
  const history = db.prepare(`
    SELECT password FROM password_history
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 5
  `).all(userId)

  for (const record of history) {
    if (bcrypt.compareSync(newPassword, record.password)) {
      return false // 密码已使用过
    }
  }

  return true
}
```

#### 5.3 登录保护

```typescript
// 登录失败次数限制
const loginAttempts = new Map<string, { count: number; lockUntil: Date }>()

export function checkLoginAttempts(username: string): boolean {
  const attempts = loginAttempts.get(username)

  if (!attempts) return true

  if (attempts.lockUntil > new Date()) {
    return false // 账户已锁定
  }

  if (attempts.count >= 5) {
    attempts.lockUntil = new Date(Date.now() + 30 * 60 * 1000) // 锁定30分钟
    return false
  }

  return true
}

export function recordLoginFailure(username: string) {
  const attempts = loginAttempts.get(username) || { count: 0, lockUntil: new Date() }
  attempts.count++
  loginAttempts.set(username, attempts)
}

export function resetLoginAttempts(username: string) {
  loginAttempts.delete(username)
}
```

### 6. 文件上传安全（0.5天）

#### 6.1 文件类型验证

```typescript
// server/src/middleware/upload.ts
import multer from 'multer'
import path from 'path'

const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.db', '.sql']
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/')
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    const name = `${Date.now()}-${Math.random().toString(36).substring(7)}${ext}`
    cb(null, name)
  }
})

const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const ext = path.extname(file.originalname).toLowerCase()

  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(new Error('不支持的文件类型'))
  }

  cb(null, true)
}

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE }
})
```

#### 6.2 文件内容验证

```typescript
// 验证Excel文件
import * as XLSX from 'xlsx'

export function validateExcelFile(filePath: string): boolean {
  try {
    const workbook = XLSX.readFile(filePath)
    // 验证文件结构
    return true
  } catch (error) {
    return false
  }
}

// 验证数据库备份文件
export function validateDbBackup(filePath: string): boolean {
  try {
    const db = new Database(filePath, { readonly: true })
    // 验证表结构
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
    db.close()
    return tables.length > 0
  } catch (error) {
    return false
  }
}
```

### 7. 日志与审计（0.5天）

#### 7.1 安全事件日志

```typescript
// server/src/utils/securityLog.ts
export enum SecurityEventType {
  LOGIN_SUCCESS = 'LOGIN_SUCCESS',
  LOGIN_FAILURE = 'LOGIN_FAILURE',
  LOGOUT = 'LOGOUT',
  PASSWORD_CHANGE = 'PASSWORD_CHANGE',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY',
}

export function logSecurityEvent(
  eventType: SecurityEventType,
  userId: string,
  details: Record<string, any>,
  ipAddress: string
) {
  db.prepare(`
    INSERT INTO security_logs (id, event_type, user_id, details, ip_address, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(uuidv4(), eventType, userId, JSON.stringify(details), ipAddress)
}
```

#### 7.2 敏感操作审计

```typescript
// 记录敏感操作
const SENSITIVE_OPERATIONS = [
  'DELETE_VOUCHER',
  'MODIFY_ACCOUNT',
  'CLOSE_PERIOD',
  'BACKUP_DATABASE',
  'RESTORE_DATABASE',
]

export function auditSensitiveOperation(
  operation: string,
  userId: string,
  details: Record<string, any>
) {
  if (SENSITIVE_OPERATIONS.includes(operation)) {
    db.prepare(`
      INSERT INTO audit_logs (id, operation, user_id, details, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(uuidv4(), operation, userId, JSON.stringify(details))
  }
}
```

### 8. 依赖安全审计（0.5天）

#### 8.1 npm audit

```bash
# 检查依赖漏洞
npm audit

# 自动修复
npm audit fix

# 查看详细报告
npm audit --json > audit-report.json
```

#### 8.2 定期更新依赖

```json
// package.json
{
  "scripts": {
    "audit": "npm audit",
    "audit:fix": "npm audit fix",
    "outdated": "npm outdated",
    "update:deps": "npm update"
  }
}
```

#### 8.3 使用 Snyk 扫描

```bash
npm install -g snyk
snyk auth
snyk test
snyk monitor
```

## 安全检查清单

### 后端安全
- [ ] 所有SQL查询使用参数化
- [ ] 动态表名/列名使用白名单
- [ ] JWT密钥足够强
- [ ] 密码使用bcrypt加密
- [ ] 敏感数据加密存储
- [ ] 实现CSRF防护
- [ ] 文件上传类型验证
- [ ] 文件大小限制
- [ ] 登录失败次数限制
- [ ] 密码强度验证
- [ ] 操作日志完整
- [ ] 安全事件记录

### 前端安全
- [ ] 避免使用v-html
- [ ] 用户输入转义
- [ ] CSRF Token发送
- [ ] 敏感数据不存localStorage
- [ ] HTTPS强制使用
- [ ] 安全响应头配置

### 部署安全
- [ ] 环境变量管理
- [ ] 数据库文件权限
- [ ] 日志文件权限
- [ ] 备份文件加密
- [ ] 定期安全扫描

## 实施时间表

| 任务 | 时间 | 优先级 |
|------|------|--------|
| SQL注入审查 | 1天 | 🔴 高 |
| XSS防护 | 0.5天 | 🔴 高 |
| CSRF防护 | 0.5天 | 🔴 高 |
| 敏感数据加密 | 1天 | 🟡 中 |
| 认证授权加固 | 1天 | 🟡 中 |
| 文件上传安全 | 0.5天 | 🟡 中 |
| 日志审计 | 0.5天 | 🟡 中 |
| 依赖安全审计 | 0.5天 | 🟢 低 |

**总计：5.5天**

## 预期收益
- 消除SQL注入风险
- 防止XSS攻击
- 防止CSRF攻击
- 敏感数据保护
- 完善的审计日志
- 通过安全扫描
