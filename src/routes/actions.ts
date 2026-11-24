import type { DatabaseSync } from 'node:sqlite'

import {
  setEnabled,
  spentBy,
  spentIds,
  attachSignature,
  createAction,
  decodeAction,
  listActions,
  mustGetAction,
  stepsOf,
} from '../catalog.ts'
import { attachSignatureSchema, createActionSchema, setEnabledSchema } from '../schema.ts'
import { parseBody } from '../http.ts'
import type { Result } from '../types/index.ts'

export async function postAction(
  db: DatabaseSync,
  raw: unknown,
  caller: string | null,
): Promise<Result> {
  const body = parseBody(createActionSchema, raw)
  const row = createAction(db, body, caller)
  // Ответ плоский, по разделу «Формат» 5.6.
  return { status: 201, body: { actionId: row.id, status: row.status } }
}

export async function patchSignature(
  db: DatabaseSync,
  actionId: string,
  raw: unknown,
): Promise<Result> {
  const body = parseBody(attachSignatureSchema, raw)
  const row = await attachSignature(db, actionId, body)
  return { status: 200, body: { actionId: row.id, status: row.status } }
}

export function getActionDecoded(db: DatabaseSync, actionId: string): Result {
  const row = mustGetAction(db, actionId)
  return { status: 200, body: decodeAction(row, spentBy(db, row.id)) }
}

/** Сырой вариант — авторитетный (4.8). */
export function getActionRaw(db: DatabaseSync, actionId: string): Result {
  const row = mustGetAction(db, actionId)
  return {
    status: 200,
    body: {
      actionId: row.id,
      name: row.name,
      description: row.description,
      chainId: row.chain_id,
      enabled: row.enabled === 1,
      status: row.status,
      version: row.version,
      spentBy: spentBy(db, row.id) ?? null,
      steps: stepsOf(row),
    },
  }
}

export function getActions(db: DatabaseSync): Result {
  // Один запрос на весь список, а не по запросу на запись.
  const spent = spentIds(db)
  return {
    status: 200,
    body: {
      actions: listActions(db).map((row) => ({
        actionId: row.id,
        name: row.name,
        chainId: row.chain_id,
        enabled: row.enabled === 1,
        status: row.status,
        version: row.version,
        /** Израсходована исполнением — повторно неисполнима (5.7). */
        spent: spent.has(row.id),
        createdAt: row.created_at,
      })),
    },
  }
}

/**
 * Отзыв записи флагом `enabled` (7.1). Executor перестаёт её исполнять,
 * подписанная делегация при этом остаётся действительной.
 */
export async function patchEnabled(
  db: DatabaseSync,
  actionId: string,
  raw: unknown,
): Promise<Result> {
  const body = parseBody(setEnabledSchema, raw)
  const row = setEnabled(db, actionId, body.enabled)
  return { status: 200, body: { actionId: row.id, enabled: row.enabled === 1 } }
}
