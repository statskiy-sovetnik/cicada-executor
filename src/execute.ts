import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { BaseError, ContractFunctionRevertedError, encodeFunctionData, type Hex } from 'viem'

import { networkFor, supportedChainIds } from './config.ts'
import { operatorAccount, publicClientFor, REDEEM_RELAYER_ABI, walletClientFor } from './chain.ts'
import { mustGetAction, spentBy, stepsOf } from './catalog.ts'
import { now, type ActionRow } from './db.ts'
import { ApiError } from './errors.ts'
import type { ExecutionStatus } from './schema.ts'

/**
 * Конвейер исполнения, 5.2.
 *
 * Порядок строгий: валидация → сборка массивов → симуляция → оценка газа →
 * подпись и отправка. Ответ возвращается в момент отправки, до включения в
 * блок; исход доводит watcher.
 *
 * Каждый вызов оставляет ряд в `executions`, включая отказавшие: статус
 * записывает, на какой стадии остановились.
 */

export type ExecuteResult = {
  executionId: string
  txHash: Hex
  status: 'pending'
}

/**
 * На стадии 1 оператор один и вызовы обрабатываются последовательно (5.3).
 * Очередь на один слот: конкурентных отправок не возникает, поэтому нет и
 * коллизий nonce, а замок на оператора не нужен.
 */
let queue: Promise<unknown> = Promise.resolve()

export function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task)
  queue = result.catch(() => undefined)
  return result
}

export async function execute(
  db: DatabaseSync,
  ids: string[],
  caller: string | null,
): Promise<ExecuteResult> {
  const executionId = randomUUID()
  const timestamp = now()
  db.prepare(
    `INSERT INTO executions (id, caller, status, created_at, updated_at) VALUES (?, ?, 'validation_failed', ?, ?)`,
  ).run(executionId, caller, timestamp, timestamp)

  try {
    const actions = validate(db, ids)
    const chainId = actions[0].chain_id

    actions.forEach((action, position) => {
      db.prepare(
        `INSERT INTO execution_actions (execution_id, action_id, action_version, position) VALUES (?, ?, ?, ?)`,
      ).run(executionId, action.id, action.version, position)
    })
    setStatus(db, executionId, 'validation_failed', null, { chain_id: chainId })

    return await send(db, executionId, chainId, actions)
  } catch (error) {
    if (error instanceof ApiError) {
      setStatus(db, executionId, 'validation_failed', error.message)
    }
    throw error
  }
}

/**
 * Проверяется только то, что могло измениться между заведением записи и
 * вызовом (5.2): существование, `enabled`, подписанность, поддержанная сеть,
 * отсутствие дубликатов и одна сеть на запрос. Структурная корректность
 * относится ко времени заведения, ончейн-условия ловит симуляция.
 */
function validate(db: DatabaseSync, ids: string[]): ActionRow[] {
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) {
      // Вторая цепочка гарантированно отревертит на LimitedCalls и в режиме
      // Default утащит всю транзакцию. Проверка локальная и бесплатная.
      throw ApiError.validation(`идентификатор ${id} повторяется в запросе`)
    }
    seen.add(id)
  }

  const actions = ids.map((id) => mustGetAction(db, id))

  for (const action of actions) {
    if (action.enabled !== 1) throw ApiError.validation(`запись ${action.id} выключена`)
    if (action.status !== 'signed') {
      throw ApiError.validation(`запись ${action.id} не подписана, исполнение невозможно`)
    }
    if (!networkFor(action.chain_id)) {
      throw ApiError.validation(
        `сеть ${action.chain_id} записи ${action.id} не поддержана; доступны ${supportedChainIds.join(', ')}`,
      )
    }
    blockIfExecuted(db, action.id)
  }

  const chains = new Set(actions.map((action) => action.chain_id))
  if (chains.size > 1) {
    throw ApiError.validation(
      `в запросе смешаны сети ${[...chains].join(', ')}: вызов порождает одну транзакцию`,
    )
  }

  return actions
}

/** Блокировка по 5.7: израсходованную запись повторно не исполнить. */
function blockIfExecuted(db: DatabaseSync, actionId: string): void {
  const spent = spentBy(db, actionId)
  if (spent) throw ApiError.alreadyExecuted(actionId, spent.executionId, spent.txHash)
}

async function send(
  db: DatabaseSync,
  executionId: string,
  chainId: number,
  actions: ActionRow[],
): Promise<ExecuteResult> {
  const network = networkFor(chainId)!
  const account = operatorAccount()
  const publicClient = publicClientFor(chainId)

  // Разворачивание действий в триплеты: порядок шагов внутри действия и
  // порядок действий в запросе сохраняются.
  const permissionContexts: Hex[] = []
  const modes: Hex[] = []
  const executionCallDatas: Hex[] = []
  for (const action of actions) {
    for (const step of stepsOf(action)) {
      permissionContexts.push(step.permissionContext as Hex)
      modes.push(step.mode as Hex)
      executionCallDatas.push(step.executionCalldata as Hex)
    }
  }

  const call = {
    address: network.redeemRelayer,
    abi: REDEEM_RELAYER_ABI,
    functionName: 'redeemDelegations',
    args: [permissionContexts, modes, executionCallDatas],
    account,
  } as const

  // 3. Симуляция до отправки: заведомо неисполнимый вызов отваливается
  //    синхронно, с расшифрованной причиной, и не стоит газа.
  try {
    await publicClient.simulateContract(call)
  } catch (error) {
    const { status, detail } = classify(error, 'simulation')
    setStatus(db, executionId, status, detail)
    throw ApiError.validation(`симуляция не прошла: ${detail}`)
  }
  setStatus(db, executionId, 'simulation_success', null)

  let gas: bigint
  try {
    gas = await publicClient.estimateContractGas(call)
  } catch (error) {
    const { status, detail } = classify(error, 'estimate_gas')
    setStatus(db, executionId, status, detail)
    throw ApiError.validation(`оценка газа не прошла: ${detail}`)
  }
  setStatus(db, executionId, 'estimate_gas_success', null)

  // 4. Nonce и комиссии запрашиваются в момент отправки, каждый раз заново (5.3).
  try {
    const [nonce, fees] = await Promise.all([
      publicClient.getTransactionCount({ address: account.address, blockTag: 'pending' }),
      publicClient.estimateFeesPerGas(),
    ])

    const txHash = await walletClientFor(chainId).sendTransaction({
      to: network.redeemRelayer,
      data: encodeFunctionData({
        abi: REDEEM_RELAYER_ABI,
        functionName: 'redeemDelegations',
        args: [permissionContexts, modes, executionCallDatas],
      }),
      gas,
      nonce,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    })

    setStatus(db, executionId, 'pending', null, {
      tx_hash: txHash,
      operator: account.address,
    })
    return { executionId, txHash, status: 'pending' }
  } catch (error) {
    const detail = reason(error)
    setStatus(db, executionId, 'rpc_failed', detail)
    throw new ApiError(502, 'validation_failed', `отправка не удалась: ${detail}`)
  }
}

/**
 * Отказ симуляции и оценки газа различается по исходу: реверт контракта,
 * нехватка газа и прочее — разные статусы (5.4).
 */
function classify(
  error: unknown,
  stage: 'simulation' | 'estimate_gas',
): { status: ExecutionStatus; detail: string } {
  const detail = reason(error)
  if (error instanceof BaseError && error.walk((e) => e instanceof ContractFunctionRevertedError)) {
    return { status: `${stage}_reverted` as ExecutionStatus, detail }
  }
  if (/insufficient funds|gas required exceeds|out of gas|intrinsic gas/i.test(detail)) {
    return { status: `${stage}_insufficient_gas` as ExecutionStatus, detail }
  }
  if (/revert/i.test(detail)) {
    return { status: `${stage}_reverted` as ExecutionStatus, detail }
  }
  return { status: `${stage}_failed` as ExecutionStatus, detail }
}

function reason(error: unknown): string {
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError) {
      return reverted.reason ?? reverted.shortMessage
    }
    return error.shortMessage || error.message
  }
  return error instanceof Error ? error.message : String(error)
}

export function setStatus(
  db: DatabaseSync,
  executionId: string,
  status: ExecutionStatus,
  detail: string | null,
  extra: Partial<{ tx_hash: string; operator: string; chain_id: number; block_number: number; gas_used: number }> = {},
): void {
  const fields = ['status = ?', 'status_detail = ?', 'updated_at = ?']
  const values: (string | number | null)[] = [status, detail, now()]
  for (const [key, value] of Object.entries(extra)) {
    fields.push(`${key} = ?`)
    values.push(value as string | number)
  }
  values.push(executionId)
  db.prepare(`UPDATE executions SET ${fields.join(', ')} WHERE id = ?`).run(...values)
}
