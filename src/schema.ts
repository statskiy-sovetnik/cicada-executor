import { z } from 'zod'
import type { Hex } from 'viem'

/**
 * Контракт API. Это сторона Executor; у клиента оператора своя копия схем —
 * так и должно быть, это две стороны одного контракта, а не общий модуль.
 */

const hex = z
  .string()
  .regex(/^0x[0-9a-fA-F]*$/, { error: 'ожидается hex-строка с префиксом 0x' })
  .transform((value) => value as Hex)

const nonEmptyHex = z
  .string()
  .regex(/^0x[0-9a-fA-F]+$/, { error: 'ожидается непустая hex-строка с префиксом 0x' })
  .transform((value) => value as Hex)

/** Идентификатор записи — слаг, см. 4.7. */
const slug = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    error: 'ожидается слаг в нижнем регистре, слова через дефис',
  })

/** Шаг действия — элемент параллельных массивов redeemDelegations. */
export const stepSchema = z.object({
  permissionContext: nonEmptyHex,
  mode: hex,
  executionCalldata: nonEmptyHex,
})

/** Тело POST /action, раздел «Формат» 5.6. Порядок шагов значим. */
export const createActionSchema = z.object({
  actionId: slug,
  name: z.string().min(1),
  description: z.string().optional(),
  chainId: z.number().int().positive(),
  steps: z.array(stepSchema).min(1),
})

/**
 * Тело PATCH /action/{actionId}/signature.
 *
 * Подпись на каждый шаг, в том же порядке: у каждого шага своя делегация со
 * своей подписью. Спецификация формат не задавала — зафиксирован здесь.
 */
export const attachSignatureSchema = z.object({
  signatures: z.array(nonEmptyHex).min(1),
})

/**
 * Тело PATCH /action/{actionId}/enabled.
 *
 * Отзыв записи по 7.1 — флагом, с машины оператора. Эндпоинта в 5.1 не было,
 * хотя без него поле `enabled` не на что менять; добавлен здесь.
 */
export const setEnabledSchema = z.object({
  enabled: z.boolean(),
})

/** Тело POST /execute, 5.2. Только идентификаторы — ни calldata, ни адресов. */
export const executeSchema = z.object({
  ids: z.array(slug).min(1),
})

/** Словарь статусов исполнения, 5.4. Нетерминальный только `pending`. */
export const executionStatus = z.enum([
  'validation_failed',
  'simulation_success',
  'simulation_reverted',
  'simulation_insufficient_gas',
  'simulation_failed',
  'estimate_gas_success',
  'estimate_gas_reverted',
  'estimate_gas_insufficient_gas',
  'estimate_gas_failed',
  'pending',
  'rpc_failed',
  'onchain_executed',
  'onchain_reverted',
  'onchain_failed',
])

/** Коды отказа, 5.6. Разбирать следует их, а не статус HTTP. */
export const errorCode = z.enum([
  'action_id_taken',
  'action_executed',
  'validation_failed',
  'unauthorized',
])

export type Step = z.infer<typeof stepSchema>
export type CreateAction = z.infer<typeof createActionSchema>
export type AttachSignature = z.infer<typeof attachSignatureSchema>
export type SetEnabled = z.infer<typeof setEnabledSchema>
export type Execute = z.infer<typeof executeSchema>
export type ExecutionStatus = z.infer<typeof executionStatus>
export type ErrorCode = z.infer<typeof errorCode>
