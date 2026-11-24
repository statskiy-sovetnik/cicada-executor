import { getSmartAccountsEnvironment } from '@metamask/smart-accounts-kit'
import { decodeDelegations } from '@metamask/smart-accounts-kit/utils'
import { getAddress, size, slice, type Hex } from 'viem'

import type { Step } from './schema.ts'
import type { DecodedStep } from './types/index.ts'

/**
 * Расшифровка записи для человека (4.8, 5.5).
 *
 * Авторитетным остаётся сырой вариант; это — удобство чтения и не предназначено
 * для сверки автоматикой. Знание о Delegation Framework живёт только здесь и на
 * приёме подписи; путь исполнения остаётся транспортом поверх байтов.
 */

/**
 * Справочник названий энфорсеров не хранится: он разворачивается из окружения
 * кита при первом обращении, из отображения «имя → адрес» в обратное. Так он
 * всегда соответствует версии фреймворка.
 */
const registries = new Map<number, Map<string, string>>()

function enforcerNames(chainId: number): Map<string, string> {
  let registry = registries.get(chainId)
  if (!registry) {
    const environment = getSmartAccountsEnvironment(chainId)
    registry = new Map(
      Object.entries(environment.caveatEnforcers).map(([name, address]) => [
        getAddress(address).toLowerCase(),
        name,
      ]),
    )
    registries.set(chainId, registry)
  }
  return registry
}

export class DecodeError extends Error {}

/** executionCalldata одиночного вызова: target(20) + value(32) + callData. */
function decodeExecution(executionCalldata: Hex) {
  if (size(executionCalldata) < 52) {
    throw new DecodeError(
      `executionCalldata короче 52 байт (${size(executionCalldata)}), разобрать нельзя`,
    )
  }
  return {
    target: getAddress(slice(executionCalldata, 0, 20)) as Hex,
    value: BigInt(slice(executionCalldata, 20, 52)).toString(),
    callData: (size(executionCalldata) > 52 ? slice(executionCalldata, 52) : '0x') as Hex,
  }
}

export function decodeStep(step: Step, chainId: number): DecodedStep {
  const registry = enforcerNames(chainId)

  let delegations
  try {
    delegations = decodeDelegations(step.permissionContext)
  } catch (error) {
    // Молчаливый пропуск недопустим: пустой массив кейвитов читается как
    // «ограничений нет», и перепутать эти случаи нельзя.
    throw new DecodeError(`permissionContext не разбирается: ${String(error)}`)
  }

  return {
    mode: step.mode as Hex,
    // Адреса приводятся к контрольной сумме: это представление для человека,
    // а ABI-декодер отдаёт их в нижнем регистре.
    delegations: delegations.map((delegation) => ({
      delegate: getAddress(delegation.delegate) as Hex,
      delegator: getAddress(delegation.delegator) as Hex,
      authority: delegation.authority as Hex,
      salt: BigInt(delegation.salt ?? '0x00').toString(),
      signed: isSigned(delegation.signature as Hex | undefined),
      caveats: delegation.caveats.map((caveat) => ({
        enforcer: getAddress(caveat.enforcer) as Hex,
        name:
          registry.get(getAddress(caveat.enforcer).toLowerCase()) ??
          `unknown enforcer ${getAddress(caveat.enforcer)}`,
        terms: caveat.terms as Hex,
        args: (caveat.args ?? '0x') as Hex,
      })),
    })),
    execution: decodeExecution(step.executionCalldata as Hex),
  }
}

export const isSigned = (signature: Hex | undefined): boolean =>
  signature !== undefined && signature !== '0x' && size(signature) > 0
