import { buildAuxItemId } from '../server/src/utils/auxItemId.js'
const cats = ['dept','project','customer','person']
for (const c of cats) {
  const fixed: Record<string,string> = { dept:'dept_id', project:'project_id', customer:'supplier_id', person:'person_id' }
  const e: Record<string, unknown> = { [fixed[c]]: 'AAA' }
  e.aux_data = { [c]: { id: 'AAA' } }
  console.log(c, '=>', buildAuxItemId(e))
}
