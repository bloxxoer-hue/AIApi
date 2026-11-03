import type { Locator, Page } from "playwright";
import { log } from "../logger";

/**
 * Хелперы для работы с вёрсткой, которая может меняться.
 * Каждый селектор ищется по списку-фоллбэку, первый видимый — побеждает.
 */

/** Первый селектор, который реально виден на странице. */
export async function firstVisible(page: Page, selectors: string[], timeoutMs = 8000): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const loc = page.locator(sel).first();
      try {
        if (await loc.isVisible({ timeout: 300 })) return loc;
      } catch {
        // элемент исчез между проверками — ок, идём дальше
      }
    }
    await page.waitForTimeout(250);
  }
  return null;
}

/** Первый селектор, который существует (даже скрытый). */
export function firstExisting(page: Page, selectors: string[]): Locator | null {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if (loc.count() > 0) return loc;
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
