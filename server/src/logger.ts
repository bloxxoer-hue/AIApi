import { config } from "./config";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

/** Короткий таймстамп + уровень. Ошибки пишем с контекстом. */
function write(level: Level, args: unknown[]): void {
  if (LEVELS[level] < threshold) return;
  const ts = new Date().toISOString().slice(11, 19);
  const text = args
    .map((a) => (typeof a === "string" ? a : a instanceof Error ? `${a.name}: ${a.message}\n${a.stack ?? ""}` : JSON.stringify(a)))
    .join(" ");
  const line = `[${ts}] ${level.toUpperCase().padEnd(5)} ${text}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (...args: unknown[]) => write("debug", args),
  info: (...args: unknown[]) => write("info", args),
  warn: (...args: unknown[]) => write("warn", args),
  error: (...args: unknown[]) => write("error", args),
};
