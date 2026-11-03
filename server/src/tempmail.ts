import type { Browser, BrowserContext, Page } from "playwright";
import { log } from "./logger";
import { firstVisible } from "./providers/pw";

/**
 * Временная почта — напрямую через сайт https://temp-mail.org/, без API.
 *
 * Как работает:
 *  1. открываем temp-mail.org в headless-браузере;
 *  2. забираем адрес из поля на странице (ждём, пока появится);
 *  3. ждём входящее письмо в списке на главной, открываем его;
 *  4. достаём текст письма → из него код подтверждения или ссылка активации.
 */

export function randomPassword(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/** Где temp-mail.org показывает текущий адрес (несколько вариантов на случай редизайна). */
const ADDRESS_SELECTORS = [
  "input#email",
  "#email",
  "input[name='email']",
  "input[readonly][type='email']",
  ".email-address",
  "#email_ch",
  "[data-address]",
];

/** Строки списка писем на главной. */
const ROW_SELECTORS = [
  "#mails tr",
  ".mails-list tr",
  "#mail_list tr",
  "table.table tbody tr",
  "tr:has(a[href*='/mail/'])",
];

const HOME = "https://temp-mail.org/";

export interface MailMessage {
  subject: string;
  text: string;
}

export class TempMailSession {
  private readonly seen = new Set<string>();
  readonly address: string;

  private constructor(
    private readonly page: Page,
    private readonly context: BrowserContext,
    address: string
  ) {
    this.address = address;
  }

  /** Открывает temp-mail.org и ждёт, пока сайту выдадут адрес. */
  static async create(browser: Browser): Promise<TempMailSession> {
    const context = await browser.newContext({
      locale: "ru-RU",
      viewport: { width: 1280, height: 800 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 60_000 });
    // закрываем всплывашки, если они есть (cookie/реклама)
    await page
      .locator(
        "button:has-text('Accept'), button:has-text('Согласен'), button:has-text('OK'), button:has-text('Got it'), .modal button.close"
      )
      .first()
      .click({ timeout: 3000 })
      .catch(() => undefined);

    const address = await TempMailSession.readAddress(page);
    log.debug(`temp-mail.org: адрес ${address}`);
    return new TempMailSession(page, context, address);
  }

  /** Читает адрес со страницы: сначала поле, потом фоллбэк — любой @ в тексте. */
  private static async readAddress(page: Page): Promise<string> {
    const deadline = Date.now() + 60_000;

    while (Date.now() < deadline) {
      const loc = await firstVisible(page, ADDRESS_SELECTORS, 1500);
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

      await page.waitForTimeout(1500);
    }

    throw new Error("temp-mail.org: не удалось получить временный адрес (страница не загрузилась)");
  }

  /**
   * Ждёт входящее письмо: листаем список на главной, открываем первую новую
   * строку и возвращаем текст открытого письма.
   */
  async waitForMessage(timeoutSec = 150): Promise<MailMessage> {
    const deadline = Date.now() + timeoutSec * 1000;

    while (Date.now() < deadline) {
      // если ушли со главной — возвращаемся к списку
      if (!this.page.url().startsWith("https://temp-mail.org")) {
        await this.page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
        await this.page.waitForTimeout(2000);
      }

      for (const sel of ROW_SELECTORS) {
        const row = this.page.locator(sel).first();
        if (!(await row.isVisible({ timeout: 800 }).catch(() => false))) continue;

        const key = (await row.innerText().catch(() => ""))
          .replace(/\s+/g, " ")
          .trim();
        if (!key || this.seen.has(key)) continue;

        log.debug(`temp-mail.org: новое письмо в списке — «${key.slice(0, 60)}»`);

        // открываем письмо: либо по ссылке, либо кликом по строке
        const href = await row
          .locator("a")
          .first()
          .getAttribute("href")
          .catch(() => null);
        if (href) {
          const url = new URL(href, HOME).toString();
          await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
        } else {
          await row.click({ timeout: 3000 }).catch(() => undefined);
        }
        await this.page.waitForTimeout(2500);

        const text = await this.page.locator("body").innerText().catch(() => "");
        if (text.length > 60) {
          this.seen.add(key);
          log.debug(`temp-mail.org: письмо открыто (${text.length} символов)`);
          return { subject: key.split("\n")[0] ?? "", text };
        }
      }

      // ничего нового — перезагружаем список и ждём дальше
      await this.page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
      await this.page.waitForTimeout(4000);
    }

    throw new Error(`temp-mail.org: письмо не пришло за ${timeoutSec} секунд`);
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
