import fs from "fs";
import type { BrowserContext, Page } from "playwright";
import type { AdapterContext, ModelDef, ProviderAdapter } from "./types";
import { clickAny, debugShot, fillAny, firstVisible, LayoutError } from "./pw";
import { log } from "../logger";
import { createMailbox, extractCode, extractLink, waitForMessage } from "../tempmail";

/**
 * Адаптер h3-max.me — MiniMax h3 (видео) + фото-режимы.
 *
 * ВАЖНО: селекторы подобраны эвристикой (placeholder, роли, текст кнопок).
 * Если провайдер поменяет вёрстку — в лог упадёт LayoutError с перечнем
 * пробованных селекторов, а UI покажет понятную причину.
 */

const ORIGIN = "https://h3-max.me";

const SELECTORS = {
  // --- навигация / авторизация ---
  loginBtn: [
    "button:has-text('Log in')",
    "button:has-text('Sign in')",
    "a[href*='login']",
    "button[aria-label*='log in' i]",
    "[data-testid='login-button']",
  ],
  signupBtn: [
    "button:has-text('Sign up')",
    "button:has-text('Register')",
    "a[href*='register']",
    "a[href*='signup']",
  ],
  emailInput: [
    "input[type='email']",
    "input[name='email']",
    "input[placeholder*='mail' i]",
  ],
  passwordInput: [
    "input[type='password']",
    "input[name='password']",
    "input[placeholder*='pass' i]",
  ],
  submitAuth: [
    "button[type='submit']",
    "button:has-text('Sign up')",
    "button:has-text('Log in')",
    "button:has-text('Continue')",
  ],
  verifyCodeInput: [
    "input[inputmode='numeric']",
    "input[name*='code' i]",
    "input[placeholder*='code' i]",
    "input[placeholder*='код' i]",
  ],
  logoutBtn: [
    "button[aria-label*='log out' i]",
    "button:has-text('Log out')",
    "[data-testid='logout']",
  ],

  // --- генерация ---
  promptInput: [
    "textarea[placeholder*='prompt' i]",
    "textarea[placeholder*='describe' i]",
    "textarea[name='prompt']",
    "textarea",
    "[contenteditable='true']",
  ],
  videoModeBtn: [
    "button:has-text('Video')",
    "[role='tab']:has-text('Video')",
    "[data-testid='tab-video']",
  ],
  photoModeBtn: [
    "button:has-text('Image')",
    "button:has-text('Photo')",
    "[role='tab']:has-text('Image')",
    "[data-testid='tab-image']",
  ],
  durationSelect: [
    "select[name*='duration' i]",
    "[data-testid='duration-select']",
    "button:has-text('Duration')",
  ],
  resolutionSelect: [
    "select[name*='resolution' i]",
    "select[name*='quality' i]",
    "[data-testid='resolution-select']",
    "button:has-text('720')",
  ],
  aspectSelect: [
    "select[name*='aspect' i]",
    "select[name*='ratio' i]",
    "[data-testid='aspect-select']",
    "button:has-text('Ratio')",
  ],
  countSelect: [
    "select[name*='count' i]",
    "select[name*='number' i]",
    "[data-testid='count-select']",
  ],
  referenceInput: [
    "input[type='file']",
    "label:has-text('Reference') input",
    "[data-testid='upload-input']",
  ],
  generateBtn: [
    "button[type='submit']:has-text('Generate')",
    "button:has-text('Generate')",
    "button:has-text('Create')",
    "[data-testid='generate-button']",
  ],

  // --- результат ---
  resultVideo: [
    "video source[src]",
    "video[src]",
    "video > source",
  ],
  resultImage: [
    "img[src*='generated' i]",
    "img[src*='result' i]",
    "[data-testid='result-image'] img",
    "main img[src^='http']",
  ],
  downloadBtn: [
    "a[download]",
    "button:has-text('Download')",
    "a:has-text('Download')",
    "[data-testid='download-button']",
  ],
};

const MODELS: ModelDef[] = [
  {
    id: "minimax-h3",
    label: "MiniMax h3",
    kind: "video",
    provider: "h3max",
    description: "Быстрое генеративное видео, плавные движения. 768 — до 5 сек, 480 — 5–8 сек.",
    fields: {
      durations: true,
      resolutions: ["768p", "480p"],
      durationByResolution: {
        "768p": { min: 2, max: 5 },
        "480p": { min: 5, max: 8 },
      },
      aspects: ["16:9", "9:16", "1:1"],
      reference: true,
    },
  },
  {
    id: "gpt-image-2",
    label: "GPT Image 2",
    kind: "photo",
    provider: "h3max",
    description: "Детализированные изображения, точное следование промту.",
    fields: {
      resolutions: ["1024x1024", "1536x1024", "1024x1536"],
      aspects: ["1:1", "16:9", "9:16"],
      count: true,
      styles: ["Фотореализм", "Иллюстрация", "3D", "Аниме", "Без стиля"],
      reference: true,
    },
  },
  {
    id: "nano-banana",
    label: "Nano Banana",
    kind: "photo",
    provider: "h3max",
    description: "Быстрый редактор изображений, отличная работа с референсами.",
    fields: {
      resolutions: ["1024x1024", "1536x1024", "1024x1536"],
      aspects: ["1:1", "16:9", "9:16"],
      count: true,
      styles: ["Фотореализм", "Иллюстрация", "3D", "Аниме", "Без стиля"],
      reference: true,
    },
  },
];

export const h3max: ProviderAdapter = {
  id: "h3max",
  name: "h3-max.me",
  origin: ORIGIN,
  models: () => MODELS,

  /** Регистрация: открываем signup, ждём письмо с кодом/ссылкой. */
  async register(context: BrowserContext, email: string, password: string): Promise<void> {
    const page = await context.newPage();
    try {
      log.debug("h3max: открываю страницу регистрации");
      await page.goto(`${ORIGIN}/register`, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
      await page.goto(ORIGIN, { waitUntil: "domcontentloaded", timeout: 45_000 });

      // всплывающее окно cookie/рассылки — закрываем, если мешает
      await page
        .locator("button:has-text('Accept'), button:has-text('Got it'), button:has-text('Accept all')")
        .first()
        .click({ timeout: 3000 })
        .catch(() => undefined);

      const signup = await firstVisible(page, SELECTORS.signupBtn, 6000);
      if (signup) {
        await signup.click();
        await page.waitForTimeout(800);
      }

      await fillAny(page, SELECTORS.emailInput, email, "поле email", 10_000);
      await fillAny(page, SELECTORS.passwordInput, password, "поле пароля", 5000);
      await clickAny(page, SELECTORS.submitAuth, "кнопка регистрации", 5000);
      log.debug("h3max: форма регистрации отправлена, жду письмо");

      // письмо с кодом подтверждения
      const mailbox = (page as unknown as { __mailboxToken?: string }).__mailboxToken;
      void mailbox; // токен передаётся снаружи через registerWithMail

      await page.waitForTimeout(3000);
      await debugShot(page, "h3max-after-signup");
    } finally {
      await page.close();
    }
  },

  /** Вход по восстановленному state; при провале — по паролю. */
  async ensureAuth(page: Page, account): Promise<void> {
    await page.goto(ORIGIN, { waitUntil: "domcontentloaded", timeout: 45_000 });

    // уже залогинены? ищем аватар/кнопку выхода
    const loggedOut = await firstVisible(page, SELECTORS.loginBtn, 4000);
    if (!loggedOut) {
      log.debug("h3max: сессия активна");
      return;
    }

    log.debug("h3max: сессия истекла, логинюсь по паролю");
    await loggedOut.click();
    await page.waitForTimeout(800);
    await fillAny(page, SELECTORS.emailInput, account.email, "поле email", 8000);
    await fillAny(page, SELECTORS.passwordInput, account.password, "поле пароля", 5000);
    await clickAny(page, SELECTORS.submitAuth, "кнопка входа", 5000);

    const stillOut = await firstVisible(page, SELECTORS.loginBtn, 6000);
    if (stillOut) throw new Error("h3max: вход не подтвердился (возможно, требуется код с почты)");
  },

  /** Заполнение формы генерации. */
  async submit(page: Page, ctx: AdapterContext): Promise<void> {
    const { params, model } = ctx;
    ctx.stage("submit", 35);

    await page.goto(ORIGIN, { waitUntil: "domcontentloaded", timeout: 45_000 });

    // переключаемся на нужный режим (видео/фото)
    const modeSel = model.kind === "video" ? SELECTORS.videoModeBtn : SELECTORS.photoModeBtn;
    const mode = await firstVisible(page, modeSel, 5000);
    if (mode) {
      await mode.click().catch(() => undefined);
      await page.waitForTimeout(500);
    }

    // выбор модели, если на странице есть такой дропдаун
    await page
      .locator(`button:has-text('${model.label}'), [role='option']:has-text('${model.label}')`)
      .first()
      .click({ timeout: 4000 })
      .catch(() => undefined);

    await fillAny(page, SELECTORS.promptInput, params.prompt, "поле промта", 12_000);
    ctx.stage("submit", 55);

    if (model.kind === "video" && params.duration) {
      await page
        .locator(`[data-value='${params.duration}'], option:has-text('${params.duration}')`)
        .first()
        .click({ timeout: 3000 })
        .catch(async () => {
          // фоллбэк: селект
          const sel = await firstVisible(page, SELECTORS.durationSelect, 2000);
          if (sel) await sel.fill(String(params.duration)).catch(() => undefined);
        });
    }

    if (params.resolution) {
      const picked = await page
        .locator(`text='${params.resolution}'`)
        .first()
        .click({ timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      if (!picked) {
        const fallback = await firstVisible(page, SELECTORS.resolutionSelect, 2000);
        await fallback?.click().catch(() => undefined);
      }
    }

    if (params.aspect) {
      await page
        .locator(`text='${params.aspect}'`)
        .first()
        .click({ timeout: 2500 })
        .catch(() => undefined);
    }

    if (model.kind === "photo" && params.count && params.count > 1) {
      await page
        .locator(`[data-value='${params.count}'], option:has-text('${params.count}')`)
        .first()
        .click({ timeout: 2500 })
        .catch(() => undefined);
    }

    // референсное изображение
    if (params.reference && model.fields.reference) {
      const fileInput = await firstVisible(page, SELECTORS.referenceInput, 4000);
      if (fileInput) {
        const tmp = `/tmp/unigen-ref-${Date.now()}.png`;
        const b64 = params.reference.split(",")[1] ?? "";
        fs.writeFileSync(tmp, Buffer.from(b64, "base64"));
        await fileInput.setInputFiles(tmp);
        await page.waitForTimeout(1500);
        fs.unlinkSync(tmp);
      } else {
        log.warn("h3max: поле референса не найдено — генерируем без картинки");
      }
    }

    ctx.stage("submit", 70);
    await clickAny(page, SELECTORS.generateBtn, "кнопка Generate", 8000);
    await debugShot(page, "h3max-after-submit");
  },

  /** Поллинг: ждём появления видео/картинки или текста «готово». */
  async waitResult(page: Page, ctx: AdapterContext): Promise<{ url: string }> {
    ctx.stage("processing", 75);
    const deadline = Date.now() + 10 * 60_000;

    while (Date.now() < deadline) {
      // видео
      for (const sel of SELECTORS.resultVideo) {
        const src = await page
          .locator(sel)
          .first()
          .getAttribute("src")
          .catch(() => null);
        if (src && /^https?:/.test(src) && !src.includes("placeholder")) {
          return { url: src };
        }
      }

      // картинка
      for (const sel of SELECTORS.resultImage) {
        const src = await page
          .locator(sel)
          .first()
          .getAttribute("src")
          .catch(() => null);
        if (src && /^https?:/.test(src) && !/avatar|logo|icon/i.test(src)) {
          return { url: src };
        }
      }

      // кнопка скачивания с прямой ссылкой
      const dl = await firstVisible(page, SELECTORS.downloadBtn, 500);
      if (dl) {
        const href = await dl.getAttribute("href").catch(() => null);
        if (href && /^https?:/.test(href)) return { url: href };
      }

      // ошибка на стороне провайдера
      const body = await page.locator("body").innerText().catch(() => "");
      if (/failed|error|quota|insufficient/i.test(body)) {
        throw new Error("h3max: провайдер вернул ошибку генерации — " + body.slice(0, 160).replace(/\s+/g, " "));
      }

      ctx.stage("processing", Math.min(95, 75 + Math.floor((10 * 60_000 - (deadline - Date.now())) / 1200)));
      await page.waitForTimeout(3000);
    }

    await debugShot(page, "h3max-timeout");
    throw new Error("h3max: таймаут генерации (10 минут) — результат не появился");
  },
};

/** Полная регистрация с получением письма и подтверждением. */
export async function registerH3WithMail(
  context: BrowserContext,
  email: string,
  password: string,
  mailboxToken: string
): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto(ORIGIN, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page
      .locator("button:has-text('Accept'), button:has-text('Got it')")
      .first()
      .click({ timeout: 2500 })
      .catch(() => undefined);

    const signup = await firstVisible(page, SELECTORS.signupBtn, 6000);
    if (signup) {
      await signup.click();
      await page.waitForTimeout(800);
    }

    await fillAny(page, SELECTORS.emailInput, email, "поле email", 10_000);
    await fillAny(page, SELECTORS.passwordInput, password, "поле пароля", 5000);
    await clickAny(page, SELECTORS.submitAuth, "кнопка регистрации", 5000);

    // ждём письмо и вводим код / переходим по ссылке
    const message = await waitForMessage(mailboxToken, 90);
    const code = extractCode(message);
    const link = extractLink(message);

    if (code) {
      const input = await firstVisible(page, SELECTORS.verifyCodeInput, 10_000);
      if (input) {
        await input.fill(code);
        await clickAny(page, SELECTORS.submitAuth, "кнопка подтверждения кода", 5000).catch(() => undefined);
        log.debug("h3max: код подтверждения введён");
      } else {
        log.warn("h3max: поле для кода не найдено, пробую продолжить без подтверждения");
      }
    } else if (link) {
      const verifyPage = await context.newPage();
      await verifyPage.goto(link, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
      await verifyPage.waitForTimeout(2000);
      await verifyPage.close();
      log.debug("h3max: ссылка активации открыта");
    }

    await page.waitForTimeout(2000);
    await debugShot(page, "h3max-registered");
  } finally {
    await page.close();
  }
}

export { SELECTORS as H3_SELECTORS };
