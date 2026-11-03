import fs from "fs";
import type { BrowserContext, Page } from "playwright";
import type { AdapterContext, ModelDef, ProviderAdapter } from "./types";
import { clickAny, debugShot, fillAny, firstVisible } from "./pw";
import { log } from "../logger";
import { extractCode, extractLink, type TempMailSession } from "../tempmail";

/**
 * Адаптер polyfaced.com — Kling 2.1 (видео) + фото-режимы.
 * См. комментарий в h3max.ts про смену вёрстки.
 */

const ORIGIN = "https://polyfaced.com";

const SELECTORS = {
  loginBtn: [
    "button:has-text('Log in')",
    "button:has-text('Sign in')",
    "a[href*='login']",
    "[data-testid='login-button']",
  ],
  signupBtn: [
    "button:has-text('Sign up')",
    "button:has-text('Get started')",
    "a[href*='signup']",
    "a[href*='register']",
  ],
  emailInput: ["input[type='email']", "input[name='email']", "input[placeholder*='mail' i]"],
  passwordInput: ["input[type='password']", "input[name='password']", "input[placeholder*='pass' i]"],
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
  ],

  // генерация
  promptInput: [
    "textarea[placeholder*='prompt' i]",
    "textarea[placeholder*='describe' i]",
    "textarea[name='prompt']",
    "textarea",
    "[contenteditable='true']",
  ],
  videoModeBtn: ["button:has-text('Video')", "[role='tab']:has-text('Video')", "[data-testid='tab-video']"],
  photoModeBtn: ["button:has-text('Image')", "button:has-text('Photo')", "[role='tab']:has-text('Image')"],
  modelPicker: ["[data-testid='model-picker']", "button:has-text('Kling')", "select[name*='model' i]"],
  durationChips: ["[data-testid='duration-chips']", "button:has-text('Duration')"],
  resolutionChips: ["[data-testid='resolution-chips']", "button:has-text('Resolution')"],
  aspectChips: ["[data-testid='aspect-chips']", "button:has-text('Ratio')"],
  countChips: ["[data-testid='count-chips']", "button:has-text('Number')"],
  referenceInput: ["input[type='file']", "[data-testid='upload-input']"],
  generateBtn: [
    "button[type='submit']:has-text('Generate')",
    "button:has-text('Generate')",
    "button:has-text('Create')",
    "button:has-text('Run')",
    "[data-testid='generate-button']",
  ],

  // результат
  resultVideo: ["video source[src]", "video[src]", "video > source"],
  resultImage: ["img[src*='generated' i]", "img[src*='result' i]", "[data-testid='result-image'] img", "main img[src^='http']"],
  downloadBtn: ["a[download]", "button:has-text('Download')", "a:has-text('Download')"],
};

const MODELS: ModelDef[] = [
  {
    id: "kling-2.1",
    label: "Kling 2.1",
    kind: "video",
    provider: "polyface",
    description: "Кинематографичное видео, реалистичные движения и физика. Качество выбирает провайдер.",
    fields: {
      durations: true,
      resolutions: [],
      aspects: ["16:9", "9:16", "1:1"],
      reference: true,
    },
  },
  {
    id: "gpt-image-2-poly",
    label: "GPT Image 2",
    kind: "photo",
    provider: "polyface",
    description: "Фотореализм и точная композиция, работает с референсами.",
    fields: {
      resolutions: [],
      aspects: ["1:1", "16:9", "9:16"],
      count: true,
      styles: ["Фотореализм", "Иллюстрация", "3D", "Аниме", "Без стиля"],
      reference: true,
    },
  },
  {
    id: "nano-banana-poly",
    label: "Nano Banana",
    kind: "photo",
    provider: "polyface",
    description: "Быстрый редактор картинок, сильная работа с промтом.",
    fields: {
      resolutions: [],
      aspects: ["1:1", "16:9", "9:16"],
      count: true,
      styles: ["Фотореализм", "Иллюстрация", "3D", "Аниме", "Без стиля"],
      reference: true,
    },
  },
];

/** Клик по чипу/опции с нужным текстом. */
async function pickValue(page: Page, groups: string[], value: string): Promise<boolean> {
  // сначала пробуем общий текст на странице в рамках группы
  for (const group of groups) {
    const scope = page.locator(group).first();
    if (!(await scope.isVisible().catch(() => false))) continue;
    const opt = scope.locator(`text='${value}'`).first();
    if (await opt.isVisible().catch(() => false)) {
      await opt.click();
      return true;
    }
  }
  // фоллбэк — глобальный чип
  const global = page.locator(`button:has-text('${value}'), [role='radio']:has-text('${value}'), [data-value='${value}']`).first();
  if (await global.isVisible({ timeout: 1200 }).catch(() => false)) {
    await global.click();
    return true;
  }
  return false;
}

export const polyface: ProviderAdapter = {
  id: "polyface",
  name: "polyfaced.com",
  origin: ORIGIN,
  models: () => MODELS,

  async register(context: BrowserContext, email: string, password: string): Promise<void> {
    const page = await context.newPage();
    try {
      await page.goto(ORIGIN, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page
        .locator("button:has-text('Accept'), button:has-text('Got it'), button:has-text('Accept all')")
        .first()
        .click({ timeout: 2500 })
        .catch(() => undefined);

      const signup = await firstVisible(page, SELECTORS.signupBtn, 7000);
      if (signup) {
        await signup.click();
        await page.waitForTimeout(800);
      }

      await fillAny(page, SELECTORS.emailInput, email, "поле email", 10_000);
      await fillAny(page, SELECTORS.passwordInput, password, "поле пароля", 5000);
      await clickAny(page, SELECTORS.submitAuth, "кнопка регистрации", 5000);
      await page.waitForTimeout(3000);
      await debugShot(page, "polyface-after-signup");
    } finally {
      await page.close();
    }
  },

  async ensureAuth(page: Page, account): Promise<void> {
    await page.goto(ORIGIN, { waitUntil: "domcontentloaded", timeout: 45_000 });

    const loggedOut = await firstVisible(page, SELECTORS.loginBtn, 4000);
    if (!loggedOut) {
      log.debug("polyface: сессия активна");
      return;
    }

    log.debug("polyface: логинюсь по паролю");
    await loggedOut.click();
    await page.waitForTimeout(800);
    await fillAny(page, SELECTORS.emailInput, account.email, "поле email", 8000);
    await fillAny(page, SELECTORS.passwordInput, account.password, "поле пароля", 5000);
    await clickAny(page, SELECTORS.submitAuth, "кнопка входа", 5000);

    const stillOut = await firstVisible(page, SELECTORS.loginBtn, 6000);
    if (stillOut) throw new Error("polyface: вход не подтвердился");
  },

  async submit(page: Page, ctx: AdapterContext): Promise<void> {
    const { params, model } = ctx;
    ctx.stage("submit", 35);

    await page.goto(ORIGIN, { waitUntil: "domcontentloaded", timeout: 45_000 });

    const modeSel = model.kind === "video" ? SELECTORS.videoModeBtn : SELECTORS.photoModeBtn;
    const mode = await firstVisible(page, modeSel, 5000);
    if (mode) {
      await mode.click().catch(() => undefined);
      await page.waitForTimeout(500);
    }

    // выбор модели Kling / другая
    const modelOption = page.locator(`text='${model.label}'`).first();
    if (await modelOption.isVisible({ timeout: 2500 }).catch(() => false)) {
      await modelOption.click().catch(() => undefined);
      await page.waitForTimeout(400);
    }

    await fillAny(page, SELECTORS.promptInput, params.prompt, "поле промта", 12_000);
    ctx.stage("submit", 55);

    if (model.kind === "video" && params.duration) {
      const ok = await pickValue(page, SELECTORS.durationChips, String(params.duration));
      if (!ok) log.warn(`polyface: чип длительности ${params.duration} не найден`);
    }

    if (params.resolution) await pickValue(page, SELECTORS.resolutionChips, params.resolution);
    if (params.aspect) await pickValue(page, SELECTORS.aspectChips, params.aspect);
    if (model.kind === "photo" && params.count && params.count > 1) {
      await pickValue(page, SELECTORS.countChips, String(params.count));
    }

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
        log.warn("polyface: поле референса не найдено");
      }
    }

    ctx.stage("submit", 70);
    await clickAny(page, SELECTORS.generateBtn, "кнопка Generate", 8000);
    await debugShot(page, "polyface-after-submit");
  },

  async waitResult(page: Page, ctx: AdapterContext): Promise<{ url: string }> {
    ctx.stage("processing", 75);
    const deadline = Date.now() + 10 * 60_000;

    while (Date.now() < deadline) {
      for (const sel of SELECTORS.resultVideo) {
        const src = await page
          .locator(sel)
          .first()
          .getAttribute("src")
          .catch(() => null);
        if (src && /^https?:/.test(src) && !/placeholder|blank/i.test(src)) return { url: src };
      }

      for (const sel of SELECTORS.resultImage) {
        const src = await page
          .locator(sel)
          .first()
          .getAttribute("src")
          .catch(() => null);
        if (src && /^https?:/.test(src) && !/avatar|logo|icon/i.test(src)) return { url: src };
      }

      const dl = await firstVisible(page, SELECTORS.downloadBtn, 500);
      if (dl) {
        const href = await dl.getAttribute("href").catch(() => null);
        if (href && /^https?:/.test(href)) return { url: href };
      }

      const body = await page.locator("body").innerText().catch(() => "");
      if (/failed|error|quota|insufficient/i.test(body)) {
        throw new Error("polyface: провайдер вернул ошибку — " + body.slice(0, 160).replace(/\s+/g, " "));
      }

      ctx.stage("processing", Math.min(95, 75 + Math.floor((10 * 60_000 - (deadline - Date.now())) / 1200)));
      await page.waitForTimeout(3000);
    }

    await debugShot(page, "polyface-timeout");
    throw new Error("polyface: таймаут генерации (10 минут)");
  },
};

/** Полная регистрация: адрес и письма — с temp-mail.org. */
export async function registerPolyWithMail(
  context: BrowserContext,
  email: string,
  password: string,
  mail: TempMailSession
): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto(ORIGIN, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page
      .locator("button:has-text('Accept'), button:has-text('Got it')")
      .first()
      .click({ timeout: 2500 })
      .catch(() => undefined);

    const signup = await firstVisible(page, SELECTORS.signupBtn, 7000);
    if (signup) {
      await signup.click();
      await page.waitForTimeout(800);
    }

    await fillAny(page, SELECTORS.emailInput, email, "поле email", 10_000);
    await fillAny(page, SELECTORS.passwordInput, password, "поле пароля", 5000);
    await clickAny(page, SELECTORS.submitAuth, "кнопка регистрации", 5000);

    const message = await mail.waitForMessage(150);
    const code = extractCode(message);
    const link = extractLink(message);

    if (code) {
      const input = await firstVisible(page, SELECTORS.verifyCodeInput, 10_000);
      if (input) {
        await input.fill(code);
        await clickAny(page, SELECTORS.submitAuth, "подтверждение кода", 5000).catch(() => undefined);
        log.debug("polyface: код подтверждения введён");
      }
    } else if (link) {
      const verifyPage = await context.newPage();
      await verifyPage.goto(link, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
      await verifyPage.waitForTimeout(2000);
      await verifyPage.close();
      log.debug("polyface: ссылка активации открыта");
    }

    await page.waitForTimeout(2000);
    await debugShot(page, "polyface-registered");
  } finally {
    await page.close();
  }
}

export { SELECTORS as POLY_SELECTORS };
