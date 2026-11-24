import type { DatabaseSync } from 'node:sqlite'
import type { Hex } from 'viem'

import { publicClientFor } from './chain.ts'
import { setStatus } from './execute.ts'
import type { ExecutionRow } from './types/index.ts'

/**
 * Доведение `pending` до терминального статуса (5.4).
 *
 * Отдельным сканером, а не хвостом запроса: состояние переживает перезапуск, а
 * ответ API возвращается до включения в блок и ждать его некому.
 */
export function startWatcher(db: DatabaseSync, intervalMs = 4000): () => void {
  let stopped = false

  const tick = async () => {
    if (stopped) return
    const rows = db
      .prepare(`SELECT * FROM executions WHERE status = 'pending' AND tx_hash IS NOT NULL`)
      .all() as unknown as ExecutionRow[]

    for (const row of rows) {
      if (!row.chain_id || !row.tx_hash) continue
      try {
        const receipt = await publicClientFor(row.chain_id).getTransactionReceipt({
          hash: row.tx_hash as Hex,
        })
        setStatus(
          db,
          row.id,
          receipt.status === 'success' ? 'onchain_executed' : 'onchain_reverted',
          receipt.status === 'success' ? null : 'транзакция включена и откатилась',
          { block_number: Number(receipt.blockNumber), gas_used: Number(receipt.gasUsed) },
        )
      } catch (error) {
        // Квитанции ещё нет — это нормальное состояние ожидания, а не отказ.
        // Статус меняется только когда транзакция точно не дойдёт.
        const message = error instanceof Error ? error.message : String(error)
        if (!/not be found|not found|could not be found/i.test(message)) {
          setStatus(db, row.id, 'onchain_failed', message)
        }
      }
    }
  }

  const timer = setInterval(() => void tick(), intervalMs)
  timer.unref?.()
  void tick()

  return () => {
    stopped = true
    clearInterval(timer)
  }
}
