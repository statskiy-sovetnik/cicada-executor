import { createPublicClient, createWalletClient, http, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import { networkFor, operatorKey } from './config.ts'

/** Единственный метод, который Executor зовёт ончейн. */
export const REDEEM_RELAYER_ABI = parseAbi([
  'function redeemDelegations(bytes[] permissionContexts, bytes32[] modes, bytes[] executionCallDatas)',
])

export function publicClientFor(chainId: number) {
  const network = networkFor(chainId)
  if (!network) throw new Error(`сеть ${chainId} не настроена`)
  return createPublicClient({ chain: network.chain, transport: http(network.rpcUrl) })
}

export function walletClientFor(chainId: number) {
  const network = networkFor(chainId)
  if (!network) throw new Error(`сеть ${chainId} не настроена`)
  return createWalletClient({
    account: privateKeyToAccount(operatorKey()),
    chain: network.chain,
    transport: http(network.rpcUrl),
  })
}

export const operatorAccount = () => privateKeyToAccount(operatorKey())
