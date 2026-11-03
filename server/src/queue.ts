import { log } from "./logger";

type Task = () => Promise<void>;

/**
 * Простая in-process очередь с лимитом параллельности.
 * Никакой внешней зависимости — Render-сервису хватает.
 */
export class Queue {
  private tasks: Task[] = [];
  private active = 0;
  private seq = 0;

  constructor(private readonly limit: number) {}

  get size(): number {
    return this.tasks.length;
  }

  get running(): number {
    return this.active;
  }

  /** Ставит задачу в очередь. Возвращает промис её завершения. */
  push(task: Task): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.tasks.push(async () => {
        try {
          await task();
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      this.pump();
    });
  }

  private pump(): void {
    while (this.active < this.limit && this.tasks.length > 0) {
      const task = this.tasks.shift()!;
      this.active += 1;
      const n = ++this.seq;
      log.debug(`queue: start #${n}, active=${this.active}, pending=${this.tasks.length}`);
      void task()
        .catch((err) => log.error(`queue: task #${n} failed`, err))
        .finally(() => {
          this.active -= 1;
          this.pump();
        });
    }
  }
}

/** Ретрай с экспоненциальной задержкой. */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { retries: number; delayMs?: number; onRetry?: (attempt: number, err: unknown) => void }
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.retries + 1; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt > opts.retries) break;
      opts.onRetry?.(attempt, err);
      const delay = (opts.delayMs ?? 2000) * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
