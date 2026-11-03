/** Общие типы — зеркалят server/src/providers/types.ts. */

export type GenKind = "video" | "photo";

export interface ModelFields {
  durations?: boolean;
  resolutions: string[];
  aspects: string[];
  count?: boolean;
  styles?: string[];
  reference?: boolean;
  /** Лимиты длительности по разрешению: { "768p": {min,max} }. */
  durationByResolution?: Record<string, { min: number; max: number }>;
}

export interface ModelDef {
  id: string;
  label: string;
  kind: GenKind;
  provider: string;
  description: string;
  fields: ModelFields;
}

export type StageName = "queued" | "account" | "auth" | "submit" | "processing" | "done" | "error";

export interface Generation {
  id: string;
  provider: string;
  model: string;
  kind: GenKind;
  prompt: string;
  status: "queued" | "running" | "done" | "error";
  stage: StageName;
  progress: number;
  error: string | null;
  url: string | null;
  createdAt: number;
  updatedAt: number;
  params: {
    duration?: number;
    resolution?: string;
    aspect?: string;
    count?: number;
    style?: string;
    hasReference?: boolean;
  };
}

export interface GenerateRequest {
  model: string;
  prompt: string;
  duration?: number;
  resolution?: string;
  aspect?: string;
  count?: number;
  style?: string;
  reference?: string;
}

export const STAGE_LABELS: Record<StageName, string> = {
  queued: "В очереди",
  account: "Регистрация аккаунта",
  auth: "Авторизация",
  submit: "Отправка промта",
  processing: "Генерация",
  done: "Готово",
  error: "Ошибка",
};
