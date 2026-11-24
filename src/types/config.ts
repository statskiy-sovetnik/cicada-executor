import type { Address, Chain } from 'viem'

export type NetworkConfig = {
  chain: Chain
  /**
   * Геттер, а не значение: каталог читается без ключа провайдера, и его
   * отсутствие не должно мешать этому. Ключ требуется только на исполнении.
   */
  readonly rpcUrl: string
  /** Делегат всех записей каталога; через него уходит redeemDelegations. */
  redeemRelayer: Address
}
