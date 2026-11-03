import type { Browser, BrowserContext, Page } from "playwright";
import { log } from "./logger";
import { firstVisible } from "./providers/pw";

/**
 * Временная почта — напрямую через https://temp-mail.io/en, без API.
 *
 * Флоу:
 *  1. открываем сайт в headless-браузере;
 *  2. забираем адрес со страницы (поле или любой @ в тексте);
 *  3. ждём входящее в списке писем, открываем, читаем текст;
 *  4. из текста достаём код подтверждения или ссылку активации.
 */

export function randomPassword(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

interface MailSite {
  id: string;
  home: string;
  /** селекторы поля с адресом */
  address: string[];
  /** селекторы строк списка входящих */
  rows: string[];
}

const IO: MailSite = {
  id: "temp-mail.io",
  home: "https://temp-mail.io/en",
  address: [
    "input#email",
    "#email",
    "input[name='email']",
    "input[readonly]",
    "input[placeholder*='mail' i]",
    "#mail",
    "#copymail",
    ".email-address",
    "[data-email]",
    "[data-address]",
  ],
  rows: [
    "#mails tr",
    ".mail-list tr",
    ".mails-list tr",
    ".email-list tr",
    ".mail-item",
    "table tbody tr",
    "tr:has(a[href*='mail'])",
  ],
};

const SITES: MailSite[] = [IO];

export interface MailMessage {
  subject: string;
  text: string;
}

export class TempMailSession {
  private readonly seen = new Set<string>();
  readonly address: string;
  readonly siteId: string;

  private constructor(
    private readonly page: Page,
    private readonly context: BrowserContext,
    private readonly site: MailSite,
    address: string
  ) {
    this.address = address;
    this.siteId = site.id;
  }

  static async create(browser: Browser): Promise<TempMailSession> {
    const context = await browser.newContext({
      locale: "ru-RU",
      viewport: { width: 1280, height: 800 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    // прячем признаки автотеста — иначе сайт роботу отдаёт капчу вместо адреса
    await page.addInitScript(() => {
      try {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        Object.defineProperty(navigator, "languages", { get: () => ["ru-RU", "ru", "en-US", "en"] });
        Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
      } catch {
        /* ignore */
      }
    });

    const diagnostics: string[] = [];

    for (const site of SITES) {
      log.info(`temp-mail: пробую ${site.id}`);
      const address = await TempMailSession.trySite(page, site, diagnostics);
      if (address) {
        log.debug(`${site.id}: адрес получен ${address}`);
        return new TempMailSession(page, context, site, address);
      }
    }

    await context.close().catch(() => undefined);
    throw new Error(`temp-mail.io: адрес не получен. ${diagnostics.join(" || ")}`);
  }

  /** Один сайт: несколько заходов подряд, пока не появится адрес. */
  private static async trySite(page: Page, site: MailSite, diagnostics: string[]): Promise<string> {
    const deadline = Date.now() + 60_000;
    let lastInfo = "страница не открывалась";

    while (Date.now() < deadline) {
      await page.goto(site.home, { waitUntil: "domcontentloaded", timeout: 40_000 }).catch((err: Error) => {
        lastInfo = `goto failed: ${err.message.slice(0, 80)}`;
      });
      await page.waitForTimeout(4000);

      // закрываем всплывашки (cookie/реклама), если они есть
      await page
        .locator(
          "button:has-text('Accept'), button:has-text('Согласен'), button:has-text('OK'), button:has-text('Got it'), button:has-text('Agree'), .modal button.close"
        )
        .first()
        .click({ timeout: 2000 })
        .catch(() => undefined);

      const address = await TempMailSession.readAddress(page, site.address, 10_000);
      if (address) return address;

      const title = await page.title().catch(() => "");
      const body = await page.locator("body").innerText().catch(() => "");
      lastInfo = `${title || "без заголовка"} → ${body.replace(/\s+/g, " ").trim().slice(0, 180)}`;
      log.warn(`${site.id}: адрес пока не виден, повтор (${lastInfo.slice(0, 120)})`);
      await page.waitForTimeout(5000);
    }

    diagnostics.push(`${site.id}: ${lastInfo}`);
    return "";
  }

  /** Читает адрес со страницы: сначала поле, потом фоллбэк — любой @ в тексте. */
  private static async readAddress(page: Page, selectors: string[], windowMs: number): Promise<string> {
    const deadline = Date.now() + windowMs;

    while (Date.now() < deadline) {
      const loc = await firstVisible(page, selectors, 1500);
      if (loc) {
        const raw = await loc
          .evaluate((el: Element) => {
            const node = el as HTMLInputElement;
            return (node.value || node.textContent || node.innerText || "").trim();
          })
          .catch(() => "");
        const match = raw.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
        if (match) return match[0];
      }

      // фоллбэк: адрес встречается просто в тексте страницы
      const body = await page.locator("body").innerText().catch(() => "");
      const match = body.match(/\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i);
      if (match && !/example\.com|noreply|test@/i.test(match[0])) return match[0];

      await page.waitForTimeout(1200);
    }

    return ""; // вызывающий сам решит, ретраить или перейти на следующий сайт
  }

  /**
   * Ждёт входящее письмо: листаем список на главной, открываем первую новую
   * строку и возвращаем текст открытого письма.
   */
  async waitForMessage(timeoutSec = 150): Promise<MailMessage> {
    const deadline = Date.now() + timeoutSec * 1000;
    const origin = new URL(this.site.home).origin;

    while (Date.now() < deadline) {
      // если ушли со главной — возвращаемся к списку
      if (!this.page.url().startsWith(origin)) {
        await this.page
          .goto(this.site.home, { waitUntil: "domcontentloaded", timeout: 40_000 })
          .catch(() => undefined);
        await this.page.waitForTimeout(2000);
      }

      for (const sel of this.site.rows) {
        const row = this.page.locator(sel).first();
        if (!(await row.isVisible({ timeout: 800 }).catch(() => false))) continue;

        const key = (await row.innerText().catch(() => ""))
          .replace(/\s+/g, " ")
          .trim();
        if (!key || this.seen.has(key)) continue;

        log.debug(`${this.site.id}: новое письмо в списке — «${key.slice(0, 60)}»`);

        // открываем письмо: либо по ссылке, либо кликом по строке
        const href = await row
          .locator("a")
          .first()
          .getAttribute("href")
          .catch(() => null);
        if (href) {
          const url = new URL(href, this.site.home).toString();
          await this.page
            .goto(url, { waitUntil: "domcontentloaded", timeout: 40_000 })
            .catch(() => undefined);
        } else {
          await row.click({ timeout: 3000 }).catch(() => undefined);
        }
        await this.page.waitForTimeout(2500);

        const text = await this.page.locator("body").innerText().catch(() => "");
        if (text.length > 60) {
          this.seen.add(key);
          log.debug(`${this.site.id}: письмо открыто (${text.length} символов)`);
          return { subject: key.split("\n")[0] ?? "", text };
        }
      }

      // ничего нового — перезагружаем список и ждём дальше
      await this.page
        .goto(this.site.home, { waitUntil: "domcontentloaded", timeout: 40_000 })
        .catch(() => undefined);
      await this.page.waitForTimeout(4000);
    }

    throw new Error(
      `temp-mail (${this.siteId}): письмо не пришло за ${timeoutSec} секунд — проверьте адрес ${this.address} вручную`
    );
  }

  async close(): Promise<void> {
    await this.context.close().catch(() => undefined);
  }
}

/** Достаёт 4–8-значный код подтверждения из текста письма. */
export function extractCode(message: MailMessage): string | null {
  const plain = message.text.replace(/<[^>]+>/g, " ");
  // сначала ищем рядом со словами «код/code/verification»
  const nearWords = plain.match(/(?:код|code|pin|verification|verify|подтверждени\w*)\D{0,30}(\d{4,8})/i);
  if (nearWords) return nearWords[1];
  const any = plain.match(/\b(\d{4,8})\b/);
  return any ? any[1] : null;
}

/** Достаёт ссылку активации из текста письма. */
export function extractLink(message: MailMessage): string | null {
  const match = message.text.match(/https?:\/\/[^\s"'<>]+/);
  if (!match) return null;
  return match[0].replace(/&amp;/g, "&");
}
