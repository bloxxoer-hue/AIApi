import type { ModelDef, ProviderAdapter } from "./types";
import { h3max } from "./h3max";
import { polyface } from "./polyface";

export const adapters: Record<string, ProviderAdapter> = {
  [h3max.id]: h3max,
  [polyface.id]: polyface,
};

export function getAdapter(provider: string): ProviderAdapter {
  const adapter = adapters[provider];
  if (!adapter) throw new Error(`Неизвестный провайдер: ${provider}`);
  return adapter;
}

/** Все модели для /api/models. */
export function allModels(): ModelDef[] {
  return Object.values(adapters).flatMap((a) => a.models());
}

/** Найти модель по id. */
export function findModel(modelId: string): { model: ModelDef; adapter: ProviderAdapter } | null {
  for (const adapter of Object.values(adapters)) {
    const model = adapter.models().find((m) => m.id === modelId);
    if (model) return { model, adapter };
  }
  return null;
}
