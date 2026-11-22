import type { ErrorCode } from './schema.ts'

/**
 * Отказ, который уходит клиенту в обёртке `error` (5.6).
 *
 * Код и статус HTTP разведены намеренно: `409` приходит и на занятый
 * идентификатор, и на попытку исполнить уже исполненное действие, поэтому
 * различать случаи следует по `code`.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    /** Дополнительные поля тела: например executionId и txHash при блокировке. */
    readonly extra?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  static validation(message: string, extra?: Record<string, unknown>): ApiError {
    return new ApiError(400, 'validation_failed', message, extra)
  }

  static notFound(message: string): ApiError {
    // Промах по идентификатору — тоже отказ валидации: отдельного кода словарь
    // 5.6 не вводит, а 404 отличает «нет такой записи» от «запись не годится».
    return new ApiError(404, 'validation_failed', message)
  }

  static idTaken(actionId: string): ApiError {
    return new ApiError(409, 'action_id_taken', `идентификатор ${actionId} уже занят`)
  }

  static alreadyExecuted(
    actionId: string,
    executionId: string,
    txHash: string | null,
  ): ApiError {
    return new ApiError(
      409,
      'action_executed',
      `действие ${actionId} уже исполнено`,
      { executionId, txHash },
    )
  }
}
