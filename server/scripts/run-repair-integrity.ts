import { getDb } from '../src/db/index.js'
import { repairDatabaseReferentialIntegrity } from '../src/services/databaseIntegrityRepair.js'

const stats = repairDatabaseReferentialIntegrity(getDb())
console.log('referential integrity repair:', JSON.stringify(stats, null, 2))
