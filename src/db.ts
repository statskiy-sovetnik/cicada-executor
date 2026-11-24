import { DatabaseSync } from 'node:sqlite'

/**
 * Схема по 4.8 спецификации, перенесённая на SQLite: `jsonb` стал TEXT с JSON,
 * `bytea` и `uuid` — TEXT. Названия колонок и состав сохранены, чтобы переезд
 * на Postgres был переносом типов, а не переписыванием.
 *
 * `version` и `action_version` заведены на вырост и на стадии 1 всегда равны 1:
 * запись неизменяема (4.4), версий у неё нет.
 *
 * Колонки `status` в схеме 4.8 нет, но 5.6 требует различать `draft` и
 * `signed`. Добавлена здесь; правка документа идёт вместе с этим.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS actions (
  id          TEXT PRIMARY KEY,
  name        TEXT    NOT NULL,
  description TEXT,
  chain_id    INTEGER NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  status      TEXT    NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  steps       TEXT    NOT NULL,
  created_at  TEXT    NOT NULL,
  created_by  TEXT,
  updated_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS executions (
  id            TEXT PRIMARY KEY,
  caller        TEXT,
  status        TEXT    NOT NULL,
  status_detail TEXT,
  tx_hash       TEXT,
  operator      TEXT,
  chain_id      INTEGER,
  block_number  INTEGER,
  gas_used      INTEGER,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS execution_actions (
  execution_id   TEXT    NOT NULL,
  action_id      TEXT    NOT NULL,
  action_version INTEGER NOT NULL,
  position       INTEGER NOT NULL,
  PRIMARY KEY (execution_id, action_id)
);

CREATE INDEX IF NOT EXISTS execution_actions_by_action ON execution_actions (action_id);
CREATE INDEX IF NOT EXISTS executions_by_status ON executions (status);
`

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  // Журнал в WAL: сканер статусов читает параллельно с обработкой запроса.
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(SCHEMA)
  return db
}

export const now = (): string => new Date().toISOString()
