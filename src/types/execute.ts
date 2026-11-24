import type { Hex } from 'viem'

/**
 * Результат запуска исполнения (5.2).
 *
 * Возвращается в момент, когда транзакция отправлена в сеть, — до включения в
 * блок. Поэтому статус здесь всегда `pending`: исход доводится опросом
 * `GET /execution/{id}` (5.4).
 */
export type ExecuteResult = {
  executionId: string
  txHash: Hex
  status: 'pending'
}
