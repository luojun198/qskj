import { Router } from 'express'
import { authMiddleware } from '../middleware/index.js'

const router = Router()
router.use(authMiddleware)

// 基础设置路由已拆分到以下文件：
// - baseAccount.ts - 会计科目管理
// - baseVoucherType.ts - 凭证类型管理
// - baseProject.ts - 辅助核算类别和项目管理
// - baseInitBalance.ts - 期初余额管理

export default router
