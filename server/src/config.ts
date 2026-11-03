import path from "path";
import fs from "fs";

/** Все настройки — только из env. Никаких секретов в коде. */
const env = process.env;

function int(key: string, fallback: number): number {
  const raw = env[key];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

const DATA_DIR = env.DATA_DIR || path.join(process.cwd(), "data");

// каталоги создаём заранее — SQLite и скачивания упадут без них
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, "results"), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, "sessions"), { recursive: true });

export const config = {
  port: int("PORT", 3000),
  dataDir: DATA_DIR,
  resultsDir: path.join(DATA_DIR, "results"),
  sessionsDir: path.join(DATA_DIR, "sessions"),
  dbPath: path.join(DATA_DIR, "unigen.sqlite"),

  /** Публичный адрес сервиса — для ссылок на скачивание. */
  baseUrl: (env.BASE_URL || `http://localhost:${int("PORT", 3000)}`).replace(/\/$/, ""),

  /** Сколько генераций крутим одновременно (Playwright жрёт RAM). */
  concurrency: Math.min(Math.max(int("CONCURRENCY", 2), 1), 4),

  logLevel: (env.LOG_LEVEL || "info") as "debug" | "info" | "warn" | "error",

  /** Таймауты генерации (мс). */
  submitTimeoutMs: int("SUBMIT_TIMEOUT_MS", 60_000),
  generateTimeoutMs: int("GENERATE_TIMEOUT_MS", 10 * 60_000),
  pollIntervalMs: int("POLL_INTERVAL_MS", 4_000),

  /** Сколько попыток на генерацию при сбое. */
  retries: int("GENERATION_RETRIES", 2),

  nodeEnv: env.NODE_ENV || "development",
} as const;
