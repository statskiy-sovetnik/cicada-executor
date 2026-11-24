import 'dotenv/config'
import { base, mainnet } from 'viem/chains'
import type { Hex } from 'viem'

import type { NetworkConfig } from './types/index.ts'

/**
 * Конфигурация Executor.
 *
 * Адреса контрактов и тела URL живут здесь, а не в окружении: это часть
 * конфигурации развёртывания, а не секреты. В окружении остаются ключ
 * провайдера, ключ оператора и параметры запуска.
 */

function env(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`переменная окружения ${name} не задана`)
  return value
}

function optional(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback
}

/** Ключ Alchemy один на все сети, различаются только поддомены. */
const alchemy = (subdomain: string) =>
  `https://${subdomain}.g.alchemy.com/v2/${env('ALCHEMY_API_KEY')}`

/**
 * Поддержанные сети (2.4 спецификации). Запись исполнима, только если её
 * chainId есть здесь: это проверяется на валидации POST /execute.
 */
export const networks: Record<number, NetworkConfig> = {
  [mainnet.id]: {
    chain: mainnet,
    get rpcUrl() {
      return alchemy('eth-mainnet')
    },
    redeemRelayer: '0x0000000000000000000000000000000000000000',
  },
  [base.id]: {
    chain: base,
    get rpcUrl() {
      return alchemy('base-mainnet')
    },
    redeemRelayer: '0xCBEB404704A47EC0F34faAE1840B5382B3Af9176',
  },
}

export function networkFor(chainId: number): NetworkConfig | undefined {
  return networks[chainId]
}

export const supportedChainIds = Object.keys(networks).map(Number)

/**
 * Ключ оператора. Геттер, а не значение: каталог читается и заводится без него,
 * и отсутствие ключа не должно мешать этому. Требуется только на исполнении.
 */
export function operatorKey(): Hex {
  const raw = env('OPERATOR_PRIVATE_KEY')
  return (raw.startsWith('0x') ? raw : `0x${raw}`) as Hex
}

/**
 * Источник, которому разрешены запросы из браузера. По умолчанию все: на этой
 * стадии аутентификации нет, ограничивать нечего. См. 7.2.
 */
export const corsOrigin = optional('CORS_ORIGIN', '*')

export const port = Number(optional('PORT', '8787'))
export const dbPath = optional('DB_PATH', './executor.sqlite')
