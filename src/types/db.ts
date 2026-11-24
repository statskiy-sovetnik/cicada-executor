/**
 * Ряды таблиц. Имена полей — как в схеме 4.8, в snake_case: это то, что
 * возвращает SQLite, и переименовывать на границе значило бы держать две
 * раскладки одного ряда.
 */

export type ActionStatus = 'draft' | 'signed'

export type ActionRow = {
  id: string
  name: string
  description: string | null
  chain_id: number
  /** SQLite не знает boolean: 0 или 1. */
  enabled: number
  status: ActionStatus
  version: number
  /** JSON с массивом триплетов; разбирается `stepsOf`. */
  steps: string
  created_at: string
  created_by: string | null
  updated_at: string
}

export type ExecutionRow = {
  id: string
  caller: string | null
  /** Словарь 5.4; хранится строкой, схемой не ограничен на уровне базы. */
  status: string
  status_detail: string | null
  tx_hash: string | null
  operator: string | null
  chain_id: number | null
  block_number: number | null
  gas_used: number | null
  created_at: string
  updated_at: string
}

export type ExecutionActionRow = {
  execution_id: string
  action_id: string
  action_version: number
  position: number
}
