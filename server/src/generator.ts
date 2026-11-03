import fs from "fs";
import path from "path";
import { createWriteStream } from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";
import { chromium, type BrowserContext, type Browser } from "playwright";
import { config } from "./config";
import { log } from "./logger";
import { store, type GenerationRow } from "./db";
import { Queue, withRetry } from "./queue";
import { findModel, getAdapter } from "./providers";
import type { AdapterContext, GenParams, StageName } from "./providers/types";
import { randomPassword, TempMailSession } from "./tempmail";
import { registerH3WithMail } from "./providers/h3max";
import { registerPolyWithMail } from "./providers/polyface";

const queue = new Queue(config.concurrency);

/**
 * Свежий браузер на каждую генерацию: закрыли → память отдаётся системе сразу.
 * Общий на процесс браузер держит RSS растущим, а на 512 МБ это критично.
 */
async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      // убираем отметку webdriver — сайты по ней режут хедлес
      "--disable-blink-features=AutomationControlled",
      "--lang=ru-RU",
    ],
  });
}

function stageSetter(id: string): (stage: StageName, progress?: number) => void {
  return (stage, progress) => {
    store.updateGeneration(id, { stage, status: stage === "done" ? "done" : stage === "error" ? "error" : "running", progress });
    log.debug(`gen ${id}: ${stage} ${progress ?? ""}`);
  };
}

/**
 * Двигает прогресс во время долгих «немых» шагов (регистрация, ожидание письма) —
 * без него UI висит на одном проценте и выглядит как зависание.
 */
function heartbeat(id: string, from: number, to: number, stepMs = 5000): () => void {
  let current = from;
  const timer = setInterval(() => {
    current = Math.min(to, current + 1); // +1 каждые 5с: 10→30 ≈ 100 сек — как раз долгая регистрация
    store.updateGeneration(id, { progress: current });
  }, stepMs);
  return () => clearInterval(timer);
}

/** Шаг 1: достать/создать аккаунт провайдера. Почта — напрямую с temp-mail.io. */
async function ensureAccount(adapterId: string): Promise<number> {
  const existing = store.getActiveAccount(adapterId);
  if (existing) {
    store.touchAccount(existing.id);
    return existing.id;
  }

  const password = randomPassword();
  const storagePath = path.join(config.sessionsDir, `${adapterId}-${Date.now()}.json`);

  const browser = await launchBrowser();
  let mail: TempMailSession | null = null;
  let context: BrowserContext | null = null;
  try {
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "ru-RU",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });

    // временный ящик: открываем temp-mail.io и забираем адрес со страницы
    mail = await TempMailSession.create(browser);
    log.info(`register: ${adapterId} → ${mail.address}`);

    if (adapterId === "h3max") {
      await registerH3WithMail(context, mail.address, password, mail);
    } else {
      await registerPolyWithMail(context, mail.address, password, mail);
    }

    await context.storageState({ path: storagePath });
    return store.createAccount(adapterId, mail.address, password, storagePath);
  } finally {
    await mail?.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

/** Шаг 2–5: авторизация → форма → поллинг → скачивание. */
async function runGeneration(row: GenerationRow, attempt: number): Promise<void> {
  const stage = stageSetter(row.id);
  const params = JSON.parse(row.params_json) as GenParams;
  const found = findModel(row.model);
  if (!found) throw new Error(`Модель ${row.model} не зарегистрирована`);
  const { model, adapter } = found;

  stage("account", 10);
  // регистрация + почта идут долго и молча — подвигать проценты, чтобы UI не висел
  const stopHeartbeat = heartbeat(row.id, 10, 30);
  const accountId = await ensureAccount(adapter.id).finally(() => stopHeartbeat());
  const accountRow = store.getActiveAccount(adapter.id)!;
  store.updateGeneration(row.id, { account_id: accountId, attempts: attempt });

  const browser = await launchBrowser();
  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "ru-RU",
    ...(accountRow.storage_path && fs.existsSync(accountRow.storage_path)
      ? { storageState: accountRow.storage_path }
      : {}),
  });

  // экономия памяти: шрифты и медиа-превью в браузере не грузим —
  // результат мы читаем по атрибутам src, а скачиваем сами напрямую
  await context.route("**/*", (route) => {
    const type = route.request().resourceType();
    if (type === "media" || type === "font") return route.abort();
    return route.continue();
  });

  const page = await context.newPage();
  page.setDefaultTimeout(20_000);

  // не даём всплывашкам блокировать клики
  await page.addInitScript(() => {
    window.addEventListener(
      "DOMContentLoaded",
      () => {
        const style = document.createElement("style");
        style.textContent = `::backdrop{display:none!important}`;
        document.head.appendChild(style);
      },
      { once: true }
    );
  });

  try {
    stage("auth", 20);
    await adapter.ensureAuth(page, {
      id: accountRow.id,
      email: accountRow.email,
      password: accountRow.password,
      storagePath: accountRow.storage_path,
    });

    const ctxAdapter: AdapterContext = {
      account: { id: accountRow.id, email: accountRow.email, password: accountRow.password, storagePath: accountRow.storage_path },
      params,
      model,
      stage,
    };

    await adapter.submit(page, ctxAdapter);
    const { url } = await adapter.waitResult(page, ctxAdapter);

    stage("done", 97);
    const filePath = await downloadResult(url, row.id);
    store.updateGeneration(row.id, { status: "done", stage: "done", progress: 100, result_path: filePath });
    log.info(`gen ${row.id}: готово → ${path.basename(filePath)}`);
    await context.storageState({ path: accountRow.storage_path ?? undefined }).catch(() => undefined);
    if (accountRow.storage_path) store.saveStoragePath(accountRow.id, accountRow.storage_path);
  } catch (err) {
    // обновляем storage state, если он уже есть — вход мог восстановиться
    if (accountRow.storage_path) {
      await context.storageState({ path: accountRow.storage_path }).catch(() => undefined);
    }
    throw err;
  } finally {
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined); // RSS падает сразу после закрытия
  }
}

/** Скачивание результата в DATA_DIR/results — потоком, без буфера в RAM. */
async function downloadResult(url: string, id: string): Promise<string> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      // CDN провайдеров отдаёт файлы не безличным ботам
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "*/*",
    },
  });
  if (!res.ok || !res.body) throw new Error(`Скачивание результата не удалось: HTTP ${res.status}`);

  const contentType = res.headers.get("content-type") ?? "";
  const ext = contentType.includes("video")
    ? "mp4"
    : contentType.includes("png")
      ? "png"
      : contentType.includes("webp")
        ? "webp"
        : "jpg";

  const filePath = path.join(config.resultsDir, `${id}.${ext}`);
  const nodeStream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  await pipeline(nodeStream, createWriteStream(filePath));

  const size = fs.statSync(filePath).size;
  log.debug(`download: ${id}.${ext} ${size} bytes`);
  return filePath;
}

/** Постановка генерации в очередь. */
export function enqueueGeneration(id: string): void {
  void queue
    .push(async () => {
      const row = store.getGeneration(id);
      if (!row || row.status === "done") return;

      log.info(`gen ${id}: старт (попытка 1/${config.retries + 1})`);
      await withRetry(
        async (attempt) => {
          const fresh = store.getGeneration(id);
          if (!fresh) throw new Error("запись генерации исчезла");
          await runGeneration(fresh, attempt);
        },
        {
          retries: config.retries,
          delayMs: 5000,
          onRetry: (attempt, err) => {
            log.warn(`gen ${id}: попытка ${attempt} не вышла, ретрай…`, err instanceof Error ? err.message : err);
            // стадию не трогаем — она останется той же, но статус снова «в работе»
            store.updateGeneration(id, { status: "running" });
          },
        }
      );
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`gen ${id}: финальный провал`, message);
      store.updateGeneration(id, { status: "error", stage: "error", error: message, progress: 100 });
    });
}

/** Создать запись и поставить в очередь. */
export function createGeneration(provider: string, modelId: string, params: GenParams): string {
  const id = randomUUID();
  const kind = findModel(modelId)?.model.kind ?? "video";
  store.createGeneration({ id, provider, model: modelId, kind, prompt: params.prompt, params });
  enqueueGeneration(id);
  return id;
}

export function getQueueStats(): { pending: number; running: number } {
  return { pending: queue.size, running: queue.running };
}
