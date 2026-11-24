import type { ActionStatus } from './db.ts'
import type { DecodedStep } from './decode.ts'

/** Представления записи каталога наружу. */

/**
 * Исполнение, израсходовавшее запись (5.7).
 *
 * Выводится запросом к журналу, а не флагом на `actions`: двух копий одного
 * факта быть не должно (4.8).
 */
export type SpentRef = {
  executionId: string
  txHash: string | null
  blockNumber: number | null
}

/** Ответ `GET /action/{actionId}` — расшифрованное представление (5.5). */
export type DecodedAction = {
  actionId: string
  name: string
  description: string | null
  chainId: number
  enabled: boolean
  status: ActionStatus
  version: number
  /** Исполнение, израсходовавшее запись, либо null. Повторно она неисполнима (5.7). */
  spentBy: SpentRef | null
  steps: DecodedStep[]
}
