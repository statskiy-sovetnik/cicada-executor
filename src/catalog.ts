import type { DatabaseSync } from 'node:sqlite'
import { decodeDelegations, encodeDelegations, SIGNABLE_DELEGATION_TYPED_DATA } from '@metamask/smart-accounts-kit/utils'
import { getAddress, recoverTypedDataAddress, type Hex } from 'viem'

import { now } from './db.ts'
import { ApiError } from './errors.ts'
import { decodeStep, DecodeError, isSigned } from './decode.ts'
import { networkFor, supportedChainIds } from './config.ts'
import type { AttachSignature, CreateAction, Step } from './schema.ts'
import type {
  ActionRow,
  ActionStatus,
  DecodedAction,
  DecodedStep,
  SpentRef,
} from './types/index.ts'

/** Канонический DelegationManager: один и тот же адрес во всех сетях. */
const DELEGATION_MANAGER = '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3' as const

export function createAction(db: DatabaseSync, body: CreateAction, caller: string | null): ActionRow {
  if (!networkFor(body.chainId)) {
    throw ApiError.validation(
      `сеть ${body.chainId} не поддержана; доступны ${supportedChainIds.join(', ')}`,
    )
  }

  const existing = db.prepare('SELECT id FROM actions WHERE id = ?').get(body.actionId)
  if (existing) throw ApiError.idTaken(body.actionId)

  // Запись приходит неподписанной: подпись собирает UI (5.6). Но если клиент
  // прислал уже подписанные делегации, статус должен это отражать.
  const status: ActionStatus = body.steps.every((step) => stepIsSigned(step)) ? 'signed' : 'draft'

  const timestamp = now()
  db.prepare(
    `INSERT INTO actions (id, name, description, chain_id, enabled, status, version, steps, created_at, created_by, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, 1, ?, ?, ?, ?)`,
  ).run(
    body.actionId,
    body.name,
    body.description ?? null,
    body.chainId,
    status,
    JSON.stringify(body.steps),
    timestamp,
    caller,
    timestamp,
  )

  return mustGetAction(db, body.actionId)
}

export function getAction(db: DatabaseSync, actionId: string): ActionRow | undefined {
  return db.prepare('SELECT * FROM actions WHERE id = ?').get(actionId) as ActionRow | undefined
}

export function mustGetAction(db: DatabaseSync, actionId: string): ActionRow {
  const row = getAction(db, actionId)
  if (!row) throw ApiError.notFound(`запись ${actionId} не найдена`)
  return row
}

export function listActions(db: DatabaseSync): ActionRow[] {
  return db
    .prepare('SELECT * FROM actions ORDER BY created_at DESC, id')
    .all() as unknown as ActionRow[]
}

export function setEnabled(db: DatabaseSync, actionId: string, enabled: boolean): ActionRow {
  mustGetAction(db, actionId)
  db.prepare('UPDATE actions SET enabled = ?, updated_at = ? WHERE id = ?').run(
    enabled ? 1 : 0,
    now(),
    actionId,
  )
  return mustGetAction(db, actionId)
}

/**
 * Исполнение, которое израсходовало запись (5.7), либо undefined.
 *
 * Не денормализуется флагом на `actions`: выводится запросом, чтобы не возникло
 * двух копий одного факта. Нужно и на горячем пути, и на чтении — иначе
 * интерфейс не может показать, что запись израсходована.
 */
export function spentBy(db: DatabaseSync, actionId: string): SpentRef | undefined {
  return db
    .prepare(
      `SELECT e.id AS executionId, e.tx_hash AS txHash, e.block_number AS blockNumber
         FROM execution_actions ea JOIN executions e ON e.id = ea.execution_id
        WHERE ea.action_id = ? AND e.status = 'onchain_executed'
        LIMIT 1`,
    )
    .get(actionId) as SpentRef | undefined
}

/** Идентификаторы записей, израсходованных исполнением. Один запрос на список. */
export function spentIds(db: DatabaseSync): Set<string> {
  const rows = db
    .prepare(
      `SELECT DISTINCT ea.action_id AS id
         FROM execution_actions ea JOIN executions e ON e.id = ea.execution_id
        WHERE e.status = 'onchain_executed'`,
    )
    .all() as unknown as { id: string }[]
  return new Set(rows.map((row) => row.id))
}

export const stepsOf = (row: ActionRow): Step[] => JSON.parse(row.steps) as Step[]

/**
 * Приём подписи (5.6).
 *
 * Принимается именно подпись, а не запись целиком: `permissionContext`
 * расшифровывается, подпись подставляется в поле делегации, остальное
 * кодируется обратно без изменений. Иначе доступ к записи стал бы равносилен
 * доступу к исполнению.
 */
export async function attachSignature(
  db: DatabaseSync,
  actionId: string,
  body: AttachSignature,
): Promise<ActionRow> {
  const row = mustGetAction(db, actionId)
  const steps = stepsOf(row)

  if (body.signatures.length !== steps.length) {
    throw ApiError.validation(
      `подписей ${body.signatures.length}, а шагов ${steps.length}: нужна подпись на каждый шаг`,
    )
  }

  const updated: Step[] = []
  for (const [index, step] of steps.entries()) {
    updated.push(await signStep(step, body.signatures[index], row.chain_id, index))
  }

  db.prepare('UPDATE actions SET steps = ?, status = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(updated),
    'signed',
    now(),
    actionId,
  )
  return mustGetAction(db, actionId)
}

async function signStep(step: Step, signature: Hex, chainId: number, index: number): Promise<Step> {
  let delegations
  try {
    delegations = decodeDelegations(step.permissionContext as Hex)
  } catch (error) {
    throw ApiError.validation(`шаг ${index}: permissionContext не разбирается: ${String(error)}`)
  }

  // Передоверия на стадии 1 нет, поэтому цепочка ровно из одной делегации.
  if (delegations.length !== 1) {
    throw ApiError.validation(
      `шаг ${index}: в цепочке ${delegations.length} делегаций, на стадии 1 ожидается одна`,
    )
  }

  const delegation = delegations[0]
  const recovered = await recoverTypedDataAddress({
    domain: {
      name: 'DelegationManager',
      version: '1',
      chainId,
      verifyingContract: DELEGATION_MANAGER,
    },
    types: SIGNABLE_DELEGATION_TYPED_DATA,
    primaryType: 'Delegation',
    message: {
      delegate: delegation.delegate,
      delegator: delegation.delegator,
      authority: delegation.authority,
      // args в подпись не входят — только enforcer и terms.
      caveats: delegation.caveats.map((caveat) => ({
        enforcer: caveat.enforcer,
        terms: caveat.terms,
      })),
      salt: BigInt(delegation.salt ?? '0x00'),
    },
    signature,
  })

  if (getAddress(recovered) !== getAddress(delegation.delegator)) {
    throw ApiError.validation(
      `шаг ${index}: подпись принадлежит ${recovered}, а делегатор ${delegation.delegator}`,
    )
  }

  return {
    ...step,
    permissionContext: encodeDelegations([{ ...delegation, signature }]),
  }
}

function stepIsSigned(step: Step): boolean {
  try {
    const delegations = decodeDelegations(step.permissionContext as Hex)
    return delegations.length > 0 && delegations.every((d) => isSigned(d.signature as Hex | undefined))
  } catch {
    return false
  }
}

/** Расшифрованное представление записи вместе с метаданными (5.5). */
export function decodeAction(row: ActionRow, spent: SpentRef | undefined): DecodedAction {
  let steps: DecodedStep[]
  try {
    steps = stepsOf(row).map((step) => decodeStep(step, row.chain_id))
  } catch (error) {
    if (error instanceof DecodeError) {
      throw ApiError.validation(`запись ${row.id} не расшифровывается: ${error.message}`)
    }
    throw error
  }

  return {
    actionId: row.id,
    name: row.name,
    description: row.description,
    chainId: row.chain_id,
    enabled: row.enabled === 1,
    status: row.status,
    version: row.version,
    spentBy: spent ?? null,
    steps,
  }
}
