import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { DatabaseSync } from 'node:sqlite'

import { readJson, sendError, sendJson } from './http.ts'
import { ApiError } from './errors.ts'
import {
  getActionDecoded,
  getActionRaw,
  getActions,
  patchEnabled,
  patchSignature,
  postAction,
} from './routes/actions.ts'
import { getExecution, postExecute } from './routes/executions.ts'

/**
 * Поверхность API — 5.1 и 5.5 спецификации:
 *
 *   POST   /execute                      запуск
 *   GET    /execution/{id}               опрос результата
 *   GET    /actions                      список
 *   GET    /action/{actionId}            расшифрованное представление
 *   GET    /action/{actionId}/raw        байты
 *   POST   /action                       завести черновик
 *   PATCH  /action/{actionId}/signature  приложить подпись
 *   PATCH  /action/{actionId}/enabled    отзыв записи флагом (7.1)
 */

/**
 * Аутентификация — открытый вопрос 7.2. На этой стадии её нет: проверка стоит
 * здесь одной функцией, чтобы её место было видно и не пришлось искать.
 *
 * Возвращает идентификатор вызывающего для журнала (`caller`, `created_by`).
 */
function authenticate(request: IncomingMessage): string | null {
  return request.headers['x-caller']?.toString() ?? null
}

export function createApp(db: DatabaseSync): Server {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      const path = url.pathname.replace(/\/+$/, '') || '/'
      const method = request.method ?? 'GET'
      const caller = authenticate(request)

      const result = await route(db, method, path, request, caller)
      if (!result) throw ApiError.notFound(`нет обработчика для ${method} ${path}`)
      sendJson(response, result.status, result.body)
    } catch (error) {
      sendError(response, error)
    }
  })
}

type Result = { status: number; body: unknown }

async function route(
  db: DatabaseSync,
  method: string,
  path: string,
  request: IncomingMessage,
  caller: string | null,
): Promise<Result | undefined> {
  if (method === 'GET' && path === '/health') {
    return { status: 200, body: { ok: true } }
  }

  if (method === 'POST' && path === '/execute') {
    return postExecute(db, await readJson(request), caller)
  }

  if (method === 'GET' && path === '/actions') {
    return getActions(db)
  }

  if (method === 'POST' && path === '/action') {
    return postAction(db, await readJson(request), caller)
  }

  const execution = /^\/execution\/([^/]+)$/.exec(path)
  if (method === 'GET' && execution) {
    return getExecution(db, decodeURIComponent(execution[1]))
  }

  const signature = /^\/action\/([^/]+)\/signature$/.exec(path)
  if (method === 'PATCH' && signature) {
    return patchSignature(db, decodeURIComponent(signature[1]), await readJson(request))
  }

  const enabled = /^\/action\/([^/]+)\/enabled$/.exec(path)
  if (method === 'PATCH' && enabled) {
    return patchEnabled(db, decodeURIComponent(enabled[1]), await readJson(request))
  }

  const raw = /^\/action\/([^/]+)\/raw$/.exec(path)
  if (method === 'GET' && raw) {
    return getActionRaw(db, decodeURIComponent(raw[1]))
  }

  const action = /^\/action\/([^/]+)$/.exec(path)
  if (method === 'GET' && action) {
    return getActionDecoded(db, decodeURIComponent(action[1]))
  }

  return undefined
}
