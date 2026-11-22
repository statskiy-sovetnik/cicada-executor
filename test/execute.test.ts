import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { base, mainnet } from 'viem/chains'

import { buildDelegation, buildStep, draftBody, signDelegation, start, type Harness } from './helpers.ts'

/**
 * Ветки отказа POST /execute до симуляции (5.2). Сеть для них не нужна:
 * валидация отрабатывает раньше, чем конвейер идёт в RPC.
 */
describe('валидация запуска', () => {
  let h: Harness
  before(async () => {
    h = await start()

    // Подписанная запись на Base.
    const delegation = buildDelegation()
    await h.call('POST', '/action', draftBody({ actionId: 'signed-base' }))
    await h.call('PATCH', '/action/signed-base/signature', {
      signatures: [await signDelegation(delegation)],
    })

    // Подписанная запись в другой сети.
    await h.call('POST', '/action', draftBody({ actionId: 'signed-mainnet', chainId: mainnet.id }))
    await h.call('PATCH', '/action/signed-mainnet/signature', {
      signatures: [await signDelegation(delegation, undefined, mainnet.id)],
    })

    // Неподписанный черновик и выключенная запись.
    await h.call('POST', '/action', draftBody({ actionId: 'still-draft' }))
    await h.call('POST', '/action', draftBody({ actionId: 'turned-off' }))
    await h.call('PATCH', '/action/turned-off/signature', {
      signatures: [await signDelegation(delegation)],
    })
    await h.call('PATCH', '/action/turned-off/enabled', { enabled: false })
  })
  after(async () => h.close())

  it('отклоняет несуществующий идентификатор', async () => {
    const result = await h.call('POST', '/execute', { ids: ['no-such-action'] })
    assert.equal(result.status, 404)
    assert.match(result.body.error.message, /не найдена/)
  })

  it('отклоняет выключенную запись', async () => {
    const result = await h.call('POST', '/execute', { ids: ['turned-off'] })
    assert.equal(result.status, 400)
    assert.match(result.body.error.message, /выключена/)
  })

  it('отклоняет неподписанный черновик', async () => {
    const result = await h.call('POST', '/execute', { ids: ['still-draft'] })
    assert.equal(result.status, 400)
    assert.match(result.body.error.message, /не подписана/)
  })

  it('отклоняет повтор идентификатора в запросе', async () => {
    const result = await h.call('POST', '/execute', { ids: ['signed-base', 'signed-base'] })
    assert.equal(result.status, 400)
    assert.match(result.body.error.message, /повторяется/)
  })

  it('отклоняет смешение сетей в одном запросе', async () => {
    const result = await h.call('POST', '/execute', { ids: ['signed-base', 'signed-mainnet'] })
    assert.equal(result.status, 400)
    assert.match(result.body.error.message, /смешаны сети/)
  })

  it('отклоняет пустой список идентификаторов', async () => {
    const result = await h.call('POST', '/execute', { ids: [] })
    assert.equal(result.status, 400)
    assert.equal(result.body.error.code, 'validation_failed')
  })

  it('каждый вызов оставляет ряд в журнале исполнений', async () => {
    const before = h.db.prepare('SELECT COUNT(*) AS n FROM executions').get() as { n: number }
    await h.call('POST', '/execute', { ids: ['still-draft'] })
    const after = h.db.prepare('SELECT COUNT(*) AS n FROM executions').get() as { n: number }
    assert.equal(after.n, before.n + 1)

    const last = h.db
      .prepare('SELECT status, status_detail FROM executions ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get() as { status: string; status_detail: string }
    assert.equal(last.status, 'validation_failed')
    assert.match(last.status_detail, /не подписана/)
  })

  it('блокирует действие, уже достигшее onchain_executed', async () => {
    h.db
      .prepare(
        `INSERT INTO executions (id, status, tx_hash, created_at, updated_at)
         VALUES ('exec-1', 'onchain_executed', '0xabc', '2026-01-01', '2026-01-01')`,
      )
      .run()
    h.db
      .prepare(
        `INSERT INTO execution_actions (execution_id, action_id, action_version, position)
         VALUES ('exec-1', 'signed-base', 1, 0)`,
      )
      .run()

    const result = await h.call('POST', '/execute', { ids: ['signed-base'] })
    assert.equal(result.status, 409)
    assert.equal(result.body.error.code, 'action_executed')
    // Ссылка на исполнение лежит внутри обёртки error — она одна на все отказы.
    assert.equal(result.body.error.executionId, 'exec-1')
    assert.equal(result.body.error.txHash, '0xabc')
  })

  it('реверт не блокирует действие', async () => {
    h.db
      .prepare(
        `INSERT INTO executions (id, status, created_at, updated_at)
         VALUES ('exec-2', 'onchain_reverted', '2026-01-01', '2026-01-01')`,
      )
      .run()
    h.db
      .prepare(
        `INSERT INTO execution_actions (execution_id, action_id, action_version, position)
         VALUES ('exec-2', 'signed-mainnet', 1, 0)`,
      )
      .run()

    // Запись не блокируется: отказ будет уже от сети, а не от блокировки.
    const result = await h.call('POST', '/execute', { ids: ['signed-mainnet'] })
    assert.notEqual(result.body?.error?.code, 'action_executed')
  })

  it('отдаёт журнал исполнения по идентификатору', async () => {
    const result = await h.call('GET', '/execution/exec-1')
    assert.equal(result.status, 200)
    assert.equal(result.body.status, 'onchain_executed')
    assert.deepEqual(result.body.actions, [
      { actionId: 'signed-base', version: 1, position: 0 },
    ])
  })
})
