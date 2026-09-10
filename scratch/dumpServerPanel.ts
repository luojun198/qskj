import { writeFileSync } from 'node:fs'
import { buildDefaultVoucherHiprintPanel } from '../server/src/services/printTemplateHiprintDefaults.js'

writeFileSync('scratch/server-panel.json', JSON.stringify(buildDefaultVoucherHiprintPanel()))
console.log('ok')
