import type { DatabaseSync } from 'node:sqlite'

import { enqueue, execute } from '../execute.ts'
import { executeSchema } from '../schema.ts'
import { parseBody } from '../http.ts'
import { ApiError } from '../errors.ts'
import type { ExecutionRow } from '../db.ts'

export async function postExecute(db: DatabaseSync, raw: unknown, caller: string | null) {
  const body = parseBody(executeSchema, raw)
  // Последовательно: один оператор, конкурентных отправок не бывает (5.3).
  const result = await enqueue(() => execute(db, body.ids, caller))
  // 202: транзакция отправлена, но в блок ещё не включена (5.2).
  return { status: 202, body: result }
}

export function getExecution(db: DatabaseSync, executionId: string) {
  const row = db.prepare('SELECT * FROM executions WHERE id = ?').get(executionId) as
    | ExecutionRow
    | undefined
  if (!row) throw ApiError.notFound(`исполнение ${executionId} не найдено`)

  const actions = db
    .prepare(
      'SELECT action_id, action_version, position FROM execution_actions WHERE execution_id = ? ORDER BY position',
    )
    .all(executionId) as unknown as { action_id: string; action_version: number; position: number }[]

  return {
    status: 200,
    body: {
      executionId: row.id,
      status: row.status,
      statusDetail: row.status_detail,
      txHash: row.tx_hash,
      operator: row.operator,
      chainId: row.chain_id,
      blockNumber: row.block_number,
      gasUsed: row.gas_used,
      caller: row.caller,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      actions: actions.map((a) => ({
        actionId: a.action_id,
        version: a.action_version,
        position: a.position,
      })),
    },
  }
}
