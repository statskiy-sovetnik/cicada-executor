import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ZodType } from 'zod'

import { ApiError } from './errors.ts'

/** Тела здесь крошечные: запись каталога — несколько килобайт хекса. */
const MAX_BODY = 1_000_000

export async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY) throw ApiError.validation('тело запроса слишком большое')
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw ApiError.validation('тело запроса не разбирается как JSON')
  }
}

/** Ошибки схемы приводятся к коду `validation_failed`, как требует 5.6. */
export function parseBody<T>(schema: ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw)
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'тело'}: ${issue.message}`)
      .join('; ')
    throw ApiError.validation(detail)
  }
  return result.data
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  )
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(payload)
}

export function sendError(response: ServerResponse, error: unknown): void {
  if (error instanceof ApiError) {
    sendJson(response, error.status, {
      error: { code: error.code, message: error.message, ...(error.extra ?? {}) },
    })
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  sendJson(response, 500, { error: { code: 'validation_failed', message } })
}
