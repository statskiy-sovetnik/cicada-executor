import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { ROOT_AUTHORITY } from '@metamask/smart-accounts-kit'
import { encodeDelegations, SIGNABLE_DELEGATION_TYPED_DATA } from '@metamask/smart-accounts-kit/utils'
import { encodePacked, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base } from 'viem/chains'

import { openDb } from '../src/db.ts'
import { createApp } from '../src/server.ts'

export const DELEGATION_MANAGER = '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3' as const

/** Ключи фиксированы: тесты должны быть воспроизводимы. */
export const delegatorKey = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex
export const strangerKey = '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba' as Hex

export const delegator = privateKeyToAccount(delegatorKey)
export const stranger = privateKeyToAccount(strangerKey)

/** Адрес, которого нет в справочнике энфорсеров — для проверки «unknown enforcer». */
export const UNKNOWN_ENFORCER = '0x00000000000000000000000000000000000fFFFf' as Address

export function buildDelegation(options: {
  delegate?: Address
  enforcer?: Address
  signature?: Hex
} = {}) {
  return {
    delegate: options.delegate ?? ('0x00000000000000000000000000000000000000AA' as Address),
    delegator: delegator.address,
    authority: ROOT_AUTHORITY,
    caveats: [
      { enforcer: options.enforcer ?? UNKNOWN_ENFORCER, terms: '0xc0ffee' as Hex, args: '0x' as Hex },
    ],
    salt: '0x00' as Hex,
    signature: options.signature ?? ('0x' as Hex),
  }
}

export function buildStep(delegation = buildDelegation()) {
  return {
    permissionContext: encodeDelegations([delegation]),
    mode: `0x${'00'.repeat(32)}` as Hex,
    executionCalldata: encodePacked(
      ['address', 'uint256', 'bytes'],
      ['0x00000000000000000000000000000000000000bb', 0n, '0xdeadbeef'],
    ),
  }
}

/** Подпись делегации тем же способом, каким её поставит кошелёк в UI. */
export async function signDelegation(
  delegation: ReturnType<typeof buildDelegation>,
  key: Hex = delegatorKey,
  chainId: number = base.id,
): Promise<Hex> {
  return privateKeyToAccount(key).signTypedData({
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
      caveats: delegation.caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms })),
      salt: BigInt(delegation.salt),
    },
  })
}

export type Harness = {
  url: string
  db: ReturnType<typeof openDb>
  close: () => Promise<void>
  call: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>
}

export async function start(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'executor-test-'))
  const db = openDb(join(dir, 'test.sqlite'))
  const app = createApp(db)
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve))
  const { port } = app.address() as AddressInfo
  const url = `http://127.0.0.1:${port}`

  return {
    url,
    db,
    close: async () => {
      await new Promise<void>((resolve) => app.close(() => resolve()))
      db.close()
      rmSync(dir, { recursive: true, force: true })
    },
    call: async (method, path, body) => {
      const response = await fetch(`${url}${path}`, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return { status: response.status, body: await response.json() }
    },
  }
}

export const draftBody = (overrides: Record<string, unknown> = {}) => ({
  actionId: 'aerodrome-weth-vvv-exit',
  name: 'Exit WETH/VVV LP',
  chainId: base.id,
  steps: [buildStep()],
  ...overrides,
})
