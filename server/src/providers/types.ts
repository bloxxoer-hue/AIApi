import type { BrowserContext, Page } from "playwright";

/** Тип контента. */
export type GenKind = "video" | "photo";

/** Один пункт в списке моделей на фронте. */
export interface ModelDef {
  id: string;
  label: string;
  kind: GenKind;
  provider: string;
  /** Поля, которые нужны этой модели. */
  fields: ModelFields;
  description: string;
}

export interface ModelFields {
  durations?: boolean;      // слайдер длительности (видео)
  resolutions: string[];    // допустимые разрешения (пусто = провайдер не даёт выбирать)
  aspects: string[];        // соотношения сторон
  count?: boolean;          // количество изображений (фото)
  styles?: string[];        // стили (фото)
  reference?: boolean;      // референсное изображение
  /**
   * Лимиты длительности в зависимости от разрешения.
   * Например { "768p": {min:2,max:5}, "480p": {min:5,max:8} }.
   */
  durationByResolution?: Record<string, { min: number; max: number }>;
}

/** Параметры, пришедшие с фронта. */
export interface GenParams {
  prompt: string;
  duration?: number;
  resolution?: string;
  aspect?: string;
  count?: number;
  style?: string;
  /** data:URL загруженного референса (опционально). */
  reference?: string;
}

/** Аккаунт провайдера. */
export interface ProviderAccount {
  id: number;
  email: string;
  password: string;
  storagePath: string | null;
}

export interface GenerateResult {
  /** Локальный путь скачанного файла. */
  filePath: string;
  ext: string;
}

/** Контекст, который передаётся адаптеру. */
export interface AdapterContext {
  account: ProviderAccount;
  params: GenParams;
  model: ModelDef;
  /** колбэк смены стадии для UI */
  stage: (stage: StageName, progress?: number) => void;
}

export type StageName = "account" | "auth" | "submit" | "processing" | "done" | "error";

/** Интерфейс адаптера провайдера. */
export interface ProviderAdapter {
  id: string;
  name: string;
  /** Страница входа/регистрации и т.д. */
  origin: string;
  models(): ModelDef[];

  /** Регистрация нового аккаунта (через temp-mail). Сохраняет storage state. */
  register(context: BrowserContext, email: string, password: string): Promise<void>;

  /** Проверка/восстановление входа по сохранённому state. */
  ensureAuth(page: Page, account: ProviderAccount): Promise<void>;

  /** Заполнение формы и старт генерации. */
  submit(page: Page, ctx: AdapterContext): Promise<void>;

  /** Поллинг до результата, возврат URL файла. */
  waitResult(page: Page, ctx: AdapterContext): Promise<{ url: string }>;
}
