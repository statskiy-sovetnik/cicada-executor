import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mainnet } from 'viem/chains'

import {
  buildDelegation,
  buildStep,
  delegator,
  draftBody,
  signDelegation,
  start,
  strangerKey,
  UNKNOWN_ENFORCER,
  type Harness,
} from './helpers.ts'

describe('каталог записей', () => {
  let h: Harness
  before(async () => {
    h = await start()
  })
  after(async () => h.close())

  it('заводит черновик и возвращает статус draft', async () => {
    const created = await h.call('POST', '/action', draftBody())
    assert.equal(created.status, 201)
    assert.deepEqual(created.body, { actionId: 'aerodrome-weth-vvv-exit', status: 'draft' })
  })

  it('отклоняет занятый идентификатор кодом action_id_taken', async () => {
    const again = await h.call('POST', '/action', draftBody())
    assert.equal(again.status, 409)
    assert.equal(again.body.error.code, 'action_id_taken')
  })

  it('отклоняет неподдержанную сеть', async () => {
    const bad = await h.call('POST', '/action', draftBody({ actionId: 'other', chainId: 999 }))
    assert.equal(bad.status, 400)
    assert.equal(bad.body.error.code, 'validation_failed')
    assert.match(bad.body.error.message, /не поддержана/)
  })

  it('отклоняет идентификатор не в формате слага', async () => {
    const bad = await h.call('POST', '/action', draftBody({ actionId: 'Not_A_Slug' }))
    assert.equal(bad.status, 400)
    assert.match(bad.body.error.message, /слаг/)
  })

  it('отдаёт незнакомый энфорсер как unknown, а не молча пропускает', async () => {
    const decoded = await h.call('GET', '/action/aerodrome-weth-vvv-exit')
    assert.equal(decoded.status, 200)
    const caveat = decoded.body.steps[0].delegations[0].caveats[0]
    assert.equal(caveat.name, `unknown enforcer ${UNKNOWN_ENFORCER}`)
    assert.equal(decoded.body.steps[0].delegations[0].signed, false)
    assert.equal(decoded.body.enabled, true)
    assert.equal(decoded.body.version, 1)
  })

  it('называет знакомый энфорсер по имени', async () => {
    const limitedCalls = '0x04658B29F6b82ed55274221a06Fc97D318E25416'
    await h.call('POST', '/action', draftBody({
      actionId: 'known-enforcer',
      steps: [buildStep(buildDelegation({ enforcer: limitedCalls }))],
    }))
    const decoded = await h.call('GET', '/action/known-enforcer')
    assert.equal(decoded.body.steps[0].delegations[0].caveats[0].name, 'LimitedCallsEnforcer')
  })

  it('сырое представление отдаёт те же байты, что пришли', async () => {
    const raw = await h.call('GET', '/action/aerodrome-weth-vvv-exit/raw')
    assert.equal(raw.status, 200)
    assert.deepEqual(raw.body.steps, draftBody().steps)
  })

  it('отклоняет подпись чужого адреса', async () => {
    const signature = await signDelegation(buildDelegation(), strangerKey)
    const patched = await h.call('PATCH', '/action/aerodrome-weth-vvv-exit/signature', {
      signatures: [signature],
    })
    assert.equal(patched.status, 400)
    assert.equal(patched.body.error.code, 'validation_failed')
    assert.match(patched.body.error.message, /подпись принадлежит/)
  })

  it('отклоняет несовпадение числа подписей и шагов', async () => {
    const signature = await signDelegation(buildDelegation())
    const patched = await h.call('PATCH', '/action/aerodrome-weth-vvv-exit/signature', {
      signatures: [signature, signature],
    })
    assert.equal(patched.status, 400)
    assert.match(patched.body.error.message, /подпись на каждый шаг/)
  })

  it('принимает верную подпись и переводит запись в signed', async () => {
    const delegation = buildDelegation()
    const signature = await signDelegation(delegation)
    const patched = await h.call('PATCH', '/action/aerodrome-weth-vvv-exit/signature', {
      signatures: [signature],
    })
    assert.equal(patched.status, 200)
    assert.equal(patched.body.status, 'signed')

    const decoded = await h.call('GET', '/action/aerodrome-weth-vvv-exit')
    assert.equal(decoded.body.status, 'signed')
    assert.equal(decoded.body.steps[0].delegations[0].signed, true)
    // Подпись подставлена, остальное не тронуто.
    assert.equal(decoded.body.steps[0].delegations[0].delegator, delegator.address)
    assert.equal(decoded.body.steps[0].delegations[0].caveats[0].terms, '0xc0ffee')
    assert.equal(decoded.body.steps[0].execution.callData, '0xdeadbeef')
  })

  it('список показывает все записи с их статусами', async () => {
    const list = await h.call('GET', '/actions')
    assert.equal(list.status, 200)
    const ids = list.body.actions.map((a: { actionId: string }) => a.actionId).sort()
    assert.deepEqual(ids, ['aerodrome-weth-vvv-exit', 'known-enforcer'])
  })

  it('отзывает запись флагом enabled', async () => {
    const off = await h.call('PATCH', '/action/known-enforcer/enabled', { enabled: false })
    assert.equal(off.status, 200)
    assert.equal(off.body.enabled, false)
    const decoded = await h.call('GET', '/action/known-enforcer')
    assert.equal(decoded.body.enabled, false)
  })

  it('отвечает 404 на несуществующую запись', async () => {
    const missing = await h.call('GET', '/action/nope')
    assert.equal(missing.status, 404)
    assert.equal(missing.body.error.code, 'validation_failed')
  })
})
