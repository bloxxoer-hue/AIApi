import type { Frame, Locator, Page } from "playwright";
import { log } from "../logger";

/**
 * Хелперы для работы с вёрсткой, которая может меняться.
 * Каждый селектор ищется по списку-фоллбэку, первый видимый — побеждает.
 */

/** Кадры страницы: главный + все iframe (авторизация часто живёт в iframe/модалке). */
function allFrames(page: Page): Frame[] {
  try {
    return page.frames();
  } catch {
    return [];
  }
}

/** Первый селектор, который реально виден — ищем по всем фреймам. */
export async function firstVisible(page: Page, selectors: string[], timeoutMs = 8000): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of allFrames(page)) {
      for (const sel of selectors) {
        try {
          const loc = frame.locator(sel).first();
          if (await loc.isVisible({ timeout: 200 })) return loc;
        } catch {
          // элемент/кадр исчез между проверками — ок, идём дальше
        }
      }
    }
    await page.waitForTimeout(250);
  }
  return null;
}

/** Клик, если элемент есть. Не ошибка, если нет — просто пропускаем шаг. */
export async function clickIfPresent(page: Page, selectors: string[], timeoutMs = 2500): Promise<boolean> {
  const loc = await firstVisible(page, selectors, timeoutMs);
  if (!loc) return false;
  await loc.click({ timeout: 3000 }).catch(() => undefined);
  return true;
}

/** Относительный src («/files/x.mp4») → абсолютный URL, иначе скачивание упадёт. */
export function absolutize(src: string | null, base: string): string | null {
  if (!src) return null;
  if (src.startsWith("//")) return `https:${src}`;
  if (/^https?:\/\//.test(src)) return src;
  if (src.startsWith("/")) {
    try {
      return new URL(src, base).toString();
    } catch {
      return null;
    }
  }
  return null;
}

/** Клик по элементу, найденному по одному из селекторов. Бросает понятную ошибку. */
export async function clickAny(page: Page, selectors: string[], what: string, timeoutMs = 8000): Promise<void> {
  const loc = await firstVisible(page, selectors, timeoutMs);
  if (!loc) throw new LayoutError(what, selectors, page.url());
  await loc.click();
}

/** Ввод текста в поле (placeholder/name/aria подсказки). */
export async function fillAny(page: Page, selectors: string[], value: string, what: string, timeoutMs = 8000): Promise<void> {
  const loc = await firstVisible(page, selectors, timeoutMs);
  if (!loc) throw new LayoutError(what, selectors, page.url());
  await loc.click();
  await loc.fill(value);
}

/** Выбор значения в селекте / дропдауне / радио-кнопке. */
export async function chooseOption(page: Page, selectors: string[], value: string, what: string): Promise<boolean> {
  const loc = await firstVisible(page, selectors, 4000);
  if (!loc) return false;

  const tag = (await loc.evaluate((el) => el.tagName)).toLowerCase();
  if (tag === "select") {
    await loc.selectOption({ label: value }).catch(async () => {
      await loc.selectOption({ value }).catch(() => undefined);
    });
    return true;
  }

  // кликабельный чип / кнопка-переключатель с нужным текстом
  const scope = loc.locator("xpath=.");
  const option = scope.locator(`text=${JSON.stringify(value)}`).first();
  if (await option.isVisible().catch(() => false)) {
    await option.click();
    return true;
  }
  return false;
}

/** Ошибка «вёрстка провайдера изменилась» — с понятным сообщением. */
export class LayoutError extends Error {
  constructor(
    public readonly what: string,
    public readonly selectors: string[],
    public readonly url: string
  ) {
    super(
      `Не найден элемент «${what}» на ${url}\n` +
        `Пробованные селекторы: ${selectors.join(", ")}\n` +
        `Скорее всего провайдер поменял вёрстку — обновите адаптер.`
    );
    this.name = "LayoutError";
  }
}

/** Снимок страницы для отладки в логах (только debug). */
export async function debugShot(page: Page, label: string): Promise<void> {
  try {
    const buf = await page.screenshot({ fullPage: false });
    log.debug(`shot ${label}: ${buf.length} bytes @ ${page.url()}`);
  } catch (err) {
    log.debug(`shot ${label} failed`, err);
  }
}

/** Ожидание появления текста статуса (обработка → готово). */
export async function waitForText(page: Page, patterns: RegExp[], timeoutMs: number): Promise<RegExp | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = await page.locator("body").innerText().catch(() => "");
    for (const p of patterns) {
      if (p.test(body)) return p;
    }
    await page.waitForTimeout(1500);
  }
  return null;
}
