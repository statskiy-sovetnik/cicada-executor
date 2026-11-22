import type { DatabaseSync } from 'node:sqlite'

import {
  setEnabled,
  attachSignature,
  createAction,
  decodeAction,
  listActions,
  mustGetAction,
  stepsOf,
} from '../catalog.ts'
import { attachSignatureSchema, createActionSchema, setEnabledSchema } from '../schema.ts'
import { parseBody } from '../http.ts'

export async function postAction(db: DatabaseSync, raw: unknown, caller: string | null) {
  const body = parseBody(createActionSchema, raw)
  const row = createAction(db, body, caller)
  // Ответ плоский, по разделу «Формат» 5.6.
  return { status: 201, body: { actionId: row.id, status: row.status } }
}

export async function patchSignature(db: DatabaseSync, actionId: string, raw: unknown) {
  const body = parseBody(attachSignatureSchema, raw)
  const row = await attachSignature(db, actionId, body)
  return { status: 200, body: { actionId: row.id, status: row.status } }
}

export function getActionDecoded(db: DatabaseSync, actionId: string) {
  return { status: 200, body: decodeAction(mustGetAction(db, actionId)) }
}

/** Сырой вариант — авторитетный (4.8). */
export function getActionRaw(db: DatabaseSync, actionId: string) {
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
      steps: stepsOf(row),
    },
  }
}

export function getActions(db: DatabaseSync) {
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
        createdAt: row.created_at,
      })),
    },
  }
}

/**
 * Отзыв записи флагом `enabled` (7.1). Executor перестаёт её исполнять,
 * подписанная делегация при этом остаётся действительной.
 */
export async function patchEnabled(db: DatabaseSync, actionId: string, raw: unknown) {
  const body = parseBody(setEnabledSchema, raw)
  const row = setEnabled(db, actionId, body.enabled)
  return { status: 200, body: { actionId: row.id, enabled: row.enabled === 1 } }
}
