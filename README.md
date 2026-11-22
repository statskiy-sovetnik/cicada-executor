# Cicada Executor

Хранит каталог подписанных действий и исполняет их по внешней команде.
Спецификация — `executor-stage-1.md` в репозитории `7702-demo`; здесь реализована
стадия 1 целиком, **кроме аутентификации** (она открытый вопрос 7.2).

## Раскладка

```
src/server.ts      маршрутизация поверх node:http
src/routes/        обработчики
src/catalog.ts     заведение записи, приём подписи, чтение
src/execute.ts     конвейер 5.2: валидация → симуляция → оценка газа → отправка
src/watcher.ts     доведение pending до терминального статуса
src/decode.ts      расшифровка permissionContext для чтения человеком
src/db.ts          схема 4.8 на node:sqlite
```

Фреймворка нет, база встроенная: восемь ручек и три таблицы его не окупают.
Переезд на Postgres — перенос типов (`jsonb`, `bytea`, `uuid`), названия колонок
и состав сохранены.

## API

```
POST   /execute                      { ids: [слаг, …] }        → 202 pending
GET    /execution/{id}               статус и журнал исполнения
GET    /actions                      список записей
GET    /action/{actionId}            расшифрованное представление
GET    /action/{actionId}/raw        байты, авторитетный вариант
POST   /action                       завести черновик          → 201 draft
PATCH  /action/{actionId}/signature  { signatures: ["0x…"] }   → signed
PATCH  /action/{actionId}/enabled    { enabled: false }        отзыв по 7.1
```

Отказ приходит в обёртке `error` с кодом `action_id_taken`, `action_executed`,
`validation_failed` или `unauthorized`. Разбирать следует **код, а не статус
HTTP**: `409` приходит и на занятый идентификатор, и на уже исполненное
действие.

## Запуск

```
cp .env.example .env     # заполнить
yarn install
yarn typecheck
yarn test                # 23 теста, сеть не нужна
yarn dev
```

`OPERATOR_PRIVATE_KEY` требуется только на исполнении: каталог заводится и
читается без него. Адреса `RedeemRelayer` в `src/config.ts` пока нулевые —
`POST /execute` заработает после развёртывания контракта.

## Чего нет

Аутентификации (7.2), ретраев, ключа идемпотентности, разбора причин отказа
отправки, параллельной обработки — всё это стадия 2 или открытые вопросы.
Проверка прав стоит одной функцией `authenticate` в `src/server.ts`: её место
видно, и подставить реализацию можно не трогая обработчики.
