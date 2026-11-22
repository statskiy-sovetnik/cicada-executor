/**
 * Достаёт приватный ключ оператора из seed-фразы и кладёт его в .env.
 *
 *   OPERATOR_SEED_PHRASE="…" yarn derive-key --index 2 --expect 0xa65d…
 *
 * Ключ никуда не печатается: в вывод идут только адрес и индекс деривации,
 * чтобы результат можно было сверить глазами. Сама фраза в .env не попадает —
 * она берётся из окружения и остаётся там, где лежала.
 *
 * Это стадия 1: ключ в файле на машине оператора. KMS — открытый вопрос 7.3
 * спецификации.
 */
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { getAddress, toHex, type Address, type Hex } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'

const ENV_PATH = new URL('../.env', import.meta.url).pathname
const KEY_NAME = 'OPERATOR_PRIVATE_KEY'

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const seed = process.env.OPERATOR_SEED_PHRASE?.trim()
if (!seed) {
  console.error('OPERATOR_SEED_PHRASE не задана в окружении')
  console.error('пример: OPERATOR_SEED_PHRASE="$(…)" yarn derive-key --index 2')
  process.exit(1)
}

const index = Number(flag('index') ?? 0)
if (!Number.isInteger(index) || index < 0) {
  console.error(`--index должен быть целым неотрицательным, получено «${flag('index')}»`)
  process.exit(1)
}

const account = mnemonicToAccount(seed, { addressIndex: index })

/**
 * Сверка с ожидаемым адресом обязательна, если он передан: записать ключ не от
 * того аккаунта — ошибка, которая обнаружится только на отправке транзакции.
 */
const expected = flag('expect')
if (expected) {
  let normalized: Address
  try {
    normalized = getAddress(expected)
  } catch {
    console.error(`--expect не похож на адрес: ${expected}`)
    process.exit(1)
  }
  if (normalized !== getAddress(account.address)) {
    console.error(`индекс ${index} даёт ${account.address}, а ожидался ${normalized}`)
    console.error('ключ не записан')
    process.exit(1)
  }
}

const privateKeyBytes = account.getHdKey().privateKey
if (!privateKeyBytes) {
  console.error('не удалось извлечь приватный ключ из HD-ключа')
  process.exit(1)
}
const privateKey: Hex = toHex(privateKeyBytes)

// Строка заменяется на месте, если она уже есть: остальное содержимое .env и
// его порядок сохраняются.
const current = readFileSync(ENV_PATH, 'utf8')
const line = `${KEY_NAME}=${privateKey}`
const pattern = new RegExp(`^${KEY_NAME}=.*$`, 'm')
const updated = pattern.test(current)
  ? current.replace(pattern, line)
  : `${current.replace(/\n*$/, '\n')}${line}\n`

writeFileSync(ENV_PATH, updated, { mode: 0o600 })
chmodSync(ENV_PATH, 0o600)

console.log(`адрес   ${account.address}`)
console.log(`индекс  ${index}`)
console.log(`${KEY_NAME} записан в .env (права 600), значение не печатается`)
