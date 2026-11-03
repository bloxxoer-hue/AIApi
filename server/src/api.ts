import path from "path";
import express, { type Request, type Response } from "express";
import { config } from "./config";
import { log } from "./logger";
import { store, type GenerationRow } from "./db";
import { allModels, findModel } from "./providers";
import { createGeneration, getQueueStats } from "./generator";
import type { GenParams } from "./providers/types";

export const api = express.Router();

function publicView(row: GenerationRow) {
  const params = JSON.parse(row.params_json) as GenParams;
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    kind: row.kind,
    prompt: row.prompt,
    status: row.status,
    stage: row.stage,
    progress: row.progress,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // ссылка на файл появляется только когда всё готово
    url: row.status === "done" && row.result_path ? `${config.baseUrl}/api/results/${row.id}` : null,
    params: {
      duration: params.duration,
      resolution: params.resolution,
      aspect: params.aspect,
      count: params.count,
      style: params.style,
      hasReference: Boolean(params.reference),
    },
  };
}

/** Каталог моделей для карточек на фронте. */
api.get("/models", (_req: Request, res: Response) => {
  res.json({ models: allModels() });
});

/** Статус очереди. */
api.get("/stats", (_req: Request, res: Response) => {
  res.json(getQueueStats());
});

/** Создание генерации. */
api.post("/generate", (req: Request, res: Response) => {
  try {
    const body = req.body as {
      model?: string;
      prompt?: string;
      duration?: number;
      resolution?: string;
      aspect?: string;
      count?: number;
      style?: string;
      reference?: string;
    };

    if (!body.model || typeof body.model !== "string") {
      res.status(400).json({ error: "Не указана модель" });
      return;
    }
    if (!body.prompt || typeof body.prompt !== "string" || !body.prompt.trim()) {
      res.status(400).json({ error: "Промт не может быть пустым" });
      return;
    }
    if (body.prompt.length > 4000) {
      res.status(400).json({ error: "Промт слишком длинный (макс. 4000 символов)" });
      return;
    }

    const found = findModel(body.model);
    if (!found) {
      res.status(400).json({ error: `Неизвестная модель: ${body.model}` });
      return;
    }

    const params: GenParams = {
      prompt: body.prompt.trim(),
      duration: body.duration,
      resolution: body.resolution,
      aspect: body.aspect,
      count: body.count,
      style: body.style,
      // ограничиваем размер референса — 8 МБ base64 достаточно для превью
      reference: body.reference && body.reference.length < 12_000_000 ? body.reference : undefined,
    };

    // подрезаем длительность под лимиты провайдера (768 → до 5с, 480 → 5–8с)
    const durLimit = found.model.fields.durationByResolution?.[params.resolution ?? ""];
    if (durLimit && typeof params.duration === "number") {
      params.duration = Math.min(Math.max(params.duration, durLimit.min), durLimit.max);
    }
    // пусто = у провайдера нет выбора качества
    if (!found.model.fields.resolutions.length) {
      params.resolution = undefined;
    }

    const id = createGeneration(found.adapter.id, found.model.id, params);
    log.info(`api: generate ${found.model.id} → ${id}`);
    res.status(201).json({ id });
  } catch (err) {
    log.error("api: generate failed", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Внутренняя ошибка" });
  }
});

/** Статус одной генерации (фронт опрашивает). */
api.get("/generations/:id", (req: Request, res: Response) => {
  const row = store.getGeneration(req.params.id);
  if (!row) {
    res.status(404).json({ error: "Генерация не найдена" });
    return;
  }
  res.json(publicView(row));
});

/** История. */
api.get("/generations", (_req: Request, res: Response) => {
  res.json({ items: store.listGenerations().map(publicView) });
});

/** Отдача скачанного файла. */
api.get("/results/:id", (req: Request, res: Response) => {
  const row = store.getGeneration(req.params.id);
  if (!row || !row.result_path) {
    res.status(404).send("Результат не найден");
    return;
  }
  if (!path.isAbsolute(row.result_path)) {
    res.status(400).send("Некорректный путь");
    return;
  }
  res.sendFile(row.result_path, { dotfiles: "deny" }, (err) => {
    if (err && !res.headersSent) {
      log.error(`results: ${req.params.id}`, err);
      res.status(404).send("Файл недоступен");
    }
  });
});
