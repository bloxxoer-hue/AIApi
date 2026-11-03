import type { Generation, GenerateRequest, ModelDef } from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
  return data;
}

export const api = {
  models: () => request<{ models: ModelDef[] }>("/api/models"),

  generate: (body: GenerateRequest) =>
    request<{ id: string }>("/api/generate", { method: "POST", body: JSON.stringify(body) }),

  generation: (id: string) => request<Generation>(`/api/generations/${id}`),

  history: () => request<{ items: Generation[] }>("/api/generations"),

  stats: () => request<{ pending: number; running: number }>("/api/stats"),
};
