import Database from "better-sqlite3";
import { config } from "./config";

/**
 * SQLite: аккаунты провайдеров + история генераций.
 * Куки/ storage state храним в таблице, файл state — в DATA_DIR/sessions.
 */
export const db = new Database(config.dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    provider      TEXT NOT NULL,
    email         TEXT NOT NULL,
    password      TEXT NOT NULL,
    storage_path  TEXT,
    status        TEXT NOT NULL DEFAULT 'active',   -- active | blocked | pending
    last_used_at  INTEGER,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS generations (
    id           TEXT PRIMARY KEY,
    provider     TEXT NOT NULL,
    model        TEXT NOT NULL,
    kind         TEXT NOT NULL,                     -- video | photo
    prompt       TEXT NOT NULL,
    params_json  TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'queued',    -- queued | running | done | error
    stage        TEXT NOT NULL DEFAULT 'queued',    -- queued|account|auth|submit|processing|done|error
    progress     INTEGER NOT NULL DEFAULT 0,
    error        TEXT,
    result_path  TEXT,
    account_id   INTEGER,
    attempts     INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_accounts_provider ON accounts(provider, status);
  CREATE INDEX IF NOT EXISTS idx_generations_created ON generations(created_at DESC);
`);

export interface AccountRow {
  id: number;
  provider: string;
  email: string;
  password: string;
  storage_path: string | null;
  status: string;
  last_used_at: number | null;
  created_at: number;
}

export interface GenerationRow {
  id: string;
  provider: string;
  model: string;
  kind: string;
  prompt: string;
  params_json: string;
  status: string;
  stage: string;
  progress: number;
  error: string | null;
  result_path: string | null;
  account_id: number | null;
  attempts: number;
  created_at: number;
  updated_at: number;
}

const q = {
  activeAccount: db.prepare<[string]>(
    `SELECT * FROM accounts WHERE provider = ? AND status = 'active'
     ORDER BY COALESCE(last_used_at, 0) DESC LIMIT 1`
  ),
  insertAccount: db.prepare(
    `INSERT INTO accounts (provider, email, password, storage_path, status, created_at)
     VALUES (?, ?, ?, ?, 'active', ?)`
  ),
  touchAccount: db.prepare<[number, number]>(`UPDATE accounts SET last_used_at = ? WHERE id = ?`),
  blockAccount: db.prepare<[number]>(`UPDATE accounts SET status = 'blocked' WHERE id = ?`),
  saveStorage: db.prepare<[string, number]>(`UPDATE accounts SET storage_path = ? WHERE id = ?`),

  insertGeneration: db.prepare(
    `INSERT INTO generations (id, provider, model, kind, prompt, params_json, stage, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`
  ),
  getGeneration: db.prepare<[string]>(`SELECT * FROM generations WHERE id = ?`),
  updateGeneration: db.prepare(
    `UPDATE generations
        SET stage = COALESCE(?, stage),
            status = COALESCE(?, status),
            progress = COALESCE(?, progress),
            error = COALESCE(?, error),
            result_path = COALESCE(?, result_path),
            account_id = COALESCE(?, account_id),
            attempts = COALESCE(?, attempts),
            updated_at = ?
      WHERE id = ?`
  ),
  listGenerations: db.prepare(`SELECT * FROM generations ORDER BY created_at DESC LIMIT 50`),
};

export const store = {
  getActiveAccount(provider: string): AccountRow | null {
    return (q.activeAccount.get(provider) as AccountRow | undefined) ?? null;
  },

  createAccount(provider: string, email: string, password: string, storagePath: string | null): number {
    const res = q.insertAccount.run(provider, email, password, storagePath, Date.now());
    return Number(res.lastInsertRowid);
  },

  touchAccount(id: number): void {
    q.touchAccount.run(Date.now(), id);
  },

  blockAccount(id: number): void {
    q.blockAccount.run(id);
  },

  saveStoragePath(id: number, path: string): void {
    q.saveStorage.run(path, id);
  },

  createGeneration(row: {
    id: string;
    provider: string;
    model: string;
    kind: string;
    prompt: string;
    params: unknown;
  }): void {
    const now = Date.now();
    q.insertGeneration.run(row.id, row.provider, row.model, row.kind, row.prompt, JSON.stringify(row.params), now, now);
  },

  getGeneration(id: string): GenerationRow | undefined {
    return q.getGeneration.get(id) as GenerationRow | undefined;
  },

  updateGeneration(
    id: string,
    patch: Partial<{
      stage: string;
      status: string;
      progress: number;
      error: string | null;
      result_path: string | null;
      account_id: number | null;
      attempts: number;
    }>
  ): void {
    q.updateGeneration.run(
      patch.stage ?? null,
      patch.status ?? null,
      patch.progress ?? null,
      patch.error ?? null,
      patch.result_path ?? null,
      patch.account_id ?? null,
      patch.attempts ?? null,
      Date.now(),
      id
    );
  },

  listGenerations(): GenerationRow[] {
    return q.listGenerations.all() as GenerationRow[];
  },
};
