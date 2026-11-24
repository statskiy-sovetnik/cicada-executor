import type { Hex } from 'viem'

/**
 * Расшифрованное представление записи (4.8, 5.5).
 *
 * Повторяет структуру `DelegationManager`: на каждый элемент
 * `permissionContexts` — массив `Delegation[]`, у каждой делегации — `Caveat[]`,
 * у кейвита рядом с адресом энфорсера его название.
 *
 * Авторитетным остаётся сырой вариант; это — удобство чтения и не предназначено
 * для сверки автоматикой.
 */

export type DecodedCaveat = {
  enforcer: Hex
  /** Название энфорсера либо `unknown enforcer 0x…`, если он незнаком. */
  name: string
  terms: Hex
  args: Hex
}

export type DecodedDelegation = {
  delegate: Hex
  delegator: Hex
  authority: Hex
  salt: string
  signed: boolean
  caveats: DecodedCaveat[]
}

export type DecodedStep = {
  mode: Hex
  /** Цепочка передоверия: leaf → root. На стадии 1 всегда из одного элемента. */
  delegations: DecodedDelegation[]
  execution: { target: Hex; value: string; callData: Hex }
}
