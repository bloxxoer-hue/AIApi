import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { Generation, ModelDef } from "./types";
import { ModelCard } from "./components/ModelCard";
import { GenerateForm } from "./components/GenerateForm";
import { ProgressTrack } from "./components/ProgressTrack";
import { ResultView } from "./components/ResultView";
import { History } from "./components/History";

type Tab = "generate" | "history";

export default function App() {
  const [models, setModels] = useState<ModelDef[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [active, setActive] = useState<Generation | null>(null);
  const [history, setHistory] = useState<Generation[]>([]);
  const [tab, setTab] = useState<Tab>("generate");
  const [loadError, setLoadError] = useState<string | null>(null);

  // каталог моделей
  useEffect(() => {
    api
      .models()
      .then((r) => {
        setModels(r.models);
        if (r.models.length > 0) setSelected(r.models[0].id);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  const model = useMemo(() => models.find((m) => m.id === selected) ?? null, [models, selected]);

  const refreshHistory = useCallback(() => {
    api
      .history()
      .then((r) => setHistory(r.items))
      .catch(() => undefined);
  }, []);

  useEffect(refreshHistory, [refreshHistory]);

  // опрос активной генерации
  useEffect(() => {
    if (!active || active.status === "done" || active.status === "error") return;
    const timer = window.setInterval(() => {
      api
        .generation(active.id)
        .then((g) => {
          setActive(g);
          if (g.status === "done" || g.status === "error") refreshHistory();
        })
        .catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [active, refreshHistory]);

  const handleGenerate = useCallback(async (params: GenerateRequestShape) => {
    const { id } = await api.generate({ ...params, model: selected });
    const g = await api.generation(id);
    setActive(g);
  }, [selected]);

  const handlePickHistory = useCallback((g: Generation) => {
    setActive(g);
    setTab("generate");
  }, []);

  return (
    <div className="app">
      <div className="bg-glow" aria-hidden />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◆</span>
          <span className="brand-name">UniGen</span>
        </div>
        <nav className="tabs">
          <button className={tab === "generate" ? "tab active" : "tab"} onClick={() => setTab("generate")}>
            Генератор
          </button>
          <button className={tab === "history" ? "tab active" : "tab"} onClick={() => setTab("history")}>
            История
          </button>
        </nav>
      </header>

      <main className="content">
        {loadError && (
          <div className="banner error">
            Не удалось загрузить модели: {loadError}. Сервер запущен?
          </div>
        )}

        {tab === "generate" ? (
          <div className="layout">
            <section className="panel">
              <h2 className="panel-title">Модель</h2>
              <div className="model-grid">
                {models.map((m) => (
                  <ModelCard
                    key={m.id}
                    model={m}
                    active={m.id === selected}
                    onSelect={() => setSelected(m.id)}
                  />
                ))}
              </div>
            </section>

            <section className="panel">
              <h2 className="panel-title">Параметры</h2>
              {model ? (
                <GenerateForm
                  key={model.id}
                  model={model}
                  busy={active?.status === "running" || active?.status === "queued"}
                  onSubmit={handleGenerate}
                />
              ) : (
                <div className="muted">Загрузка моделей…</div>
              )}
            </section>

            {(active?.status === "running" || active?.status === "queued") && (
              <section className="panel">
                <h2 className="panel-title">Прогресс</h2>
                <ProgressTrack generation={active} />
              </section>
            )}

            {active && active.status === "done" && (
              <section className="panel result-panel">
                <h2 className="panel-title">Результат</h2>
                <ResultView generation={active} />
              </section>
            )}

            {active && active.status === "error" && (
              <section className="panel">
                <div className="banner error">
                  <strong>Генерация не удалась.</strong>
                  <span className="error-text">{active.error}</span>
                </div>
              </section>
            )}
          </div>
        ) : (
          <History items={history} onPick={handlePickHistory} onRefresh={refreshHistory} />
        )}
      </main>

      <footer className="footer">
        UniGen · MiniMax h3 · Kling 2.1 · GPT Image 2 · Nano Banana
      </footer>
    </div>
  );
}

/** Локальный алиас, чтобы не тянуть тип в каждый колбэк. */
interface GenerateRequestShape {
  prompt: string;
  duration?: number;
  resolution?: string;
  aspect?: string;
  count?: number;
  style?: string;
  reference?: string;
}
