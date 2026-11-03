import { useMemo, useRef, useState } from "react";
import type { ModelDef } from "../types";

interface Props {
  model: ModelDef;
  busy: boolean;
  onSubmit: (params: {
    prompt: string;
    duration?: number;
    resolution?: string;
    aspect?: string;
    count?: number;
    style?: string;
    reference?: string;
  }) => Promise<void>;
}

const EXAMPLES = [
  "Кинематографичный план: дождь по ночному городу, неоновые отражения в лужах, медленный наплыв камеры",
  "Крупный план: чашка кофе на деревянном столе, поднимающийся пар, тёплый утренний свет, 85mm",
  "Пустыня на закате, караван дюнами, панорама, золотой час, высокая детализация",
  "Портрет космонавта в шлеме, отражение Земли в стекле, драматичный свет",
];

export function GenerateForm({ model, busy, onSubmit }: Props) {
  const [prompt, setPrompt] = useState("");
  const [resolution, setResolution] = useState(model.fields.resolutions[0] ?? "");
  const [aspect, setAspect] = useState(model.fields.aspects[0] ?? "");
  const [count, setCount] = useState(1);
  const [style, setStyle] = useState(model.fields.styles?.[0] ?? "");
  const [reference, setReference] = useState<string | undefined>();
  const [referenceName, setReferenceName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isVideo = model.kind === "video";
  const hasResolution = model.fields.resolutions.length > 0;

  // диапазон длительности зависит от разрешения (768 → 2–5, 480 → 5–8)
  const durRange = model.fields.durationByResolution?.[resolution] ?? { min: 2, max: 10 };
  const [duration, setDuration] = useState(() => Math.min(Math.max(5, durRange.min), durRange.max));

  function changeResolution(next: string) {
    setResolution(next);
    const range = model.fields.durationByResolution?.[next];
    if (range) setDuration((d) => Math.min(Math.max(d, range.min), range.max));
  }
  const canSubmit = prompt.trim().length > 0 && !busy;

  const examples = useMemo(() => EXAMPLES.slice(0, 3), []);

  function handleFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Референс должен быть изображением");
      return;
    }
    if (file.size > 6_000_000) {
      setError("Референс больше 6 МБ — уменьшите картинку");
      return;
    }
    setError(null);
    setReferenceName(file.name);
    const reader = new FileReader();
    reader.onload = () => setReference(String(reader.result));
    reader.readAsDataURL(file);
  }

  async function submit() {
    setError(null);
    try {
      await onSubmit({
        prompt: prompt.trim(),
        duration: isVideo ? duration : undefined,
        resolution: resolution || undefined,
        aspect: aspect || undefined,
        count: !isVideo ? count : undefined,
        style: style && style !== "Без стиля" ? style : undefined,
        reference,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
    }
  }

  return (
    <div className="form">
      <label className="field">
        <span className="label">Промт</span>
        <textarea
          className="textarea"
          rows={4}
          value={prompt}
          maxLength={4000}
          placeholder="Опишите, что хотите получить…"
          onChange={(e) => setPrompt(e.target.value)}
        />
        <span className="hint">{prompt.length}/4000</span>
      </label>

      <div className="examples">
        {examples.map((ex) => (
          <button key={ex} type="button" className="example-chip" onClick={() => setPrompt(ex)}>
            {ex.slice(0, 46)}…
          </button>
        ))}
      </div>

      {isVideo && model.fields.durations && (
        <label className="field">
          <span className="label">
            Длительность: <b>{duration} сек</b>
            {model.fields.durationByResolution && (
              <span className="label-sub"> · {resolution} → от {durRange.min} до {durRange.max} сек</span>
            )}
          </span>
          <input
            className="slider"
            type="range"
            min={durRange.min}
            max={durRange.max}
            step={1}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
          <div className="scale">
            <span>{durRange.min}с</span>
            <span>{Math.round((durRange.min + durRange.max) / 2)}с</span>
            <span>{durRange.max}с</span>
          </div>
        </label>
      )}

      <div className="row">
        {hasResolution && (
          <label className="field">
            <span className="label">Разрешение</span>
            <div className="chips">
              {model.fields.resolutions.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={resolution === r ? "chip active" : "chip"}
                  onClick={() => changeResolution(r)}
                >
                  {r}
                </button>
              ))}
            </div>
          </label>
        )}

        <label className={hasResolution ? "field" : "field full"}>
          <span className="label">Соотношение сторон</span>
          <div className="chips">
            {model.fields.aspects.map((a) => (
              <button
                key={a}
                type="button"
                className={aspect === a ? "chip active" : "chip"}
                onClick={() => setAspect(a)}
              >
                {a}
              </button>
            ))}
          </div>
        </label>
      </div>

      {!isVideo && model.fields.count && (
        <label className="field">
          <span className="label">
            Количество изображений: <b>{count}</b>
          </span>
          <input
            className="slider"
            type="range"
            min={1}
            max={4}
            step={1}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </label>
      )}

      {!isVideo && model.fields.styles && model.fields.styles.length > 0 && (
        <label className="field">
          <span className="label">Стиль</span>
          <div className="chips">
            {model.fields.styles.map((s) => (
              <button
                key={s}
                type="button"
                className={style === s ? "chip active" : "chip"}
                onClick={() => setStyle(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </label>
      )}

      {model.fields.reference && (
        <div className="field">
          <span className="label">Референсное изображение</span>
          <div className="upload">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <button type="button" className="ghost-btn" onClick={() => fileRef.current?.click()}>
              {reference ? "Заменить картинку" : "Загрузить картинку"}
            </button>
            {reference ? (
              <span className="file-name">
                <img className="ref-thumb" src={reference} alt="референс" />
                {referenceName}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setReference(undefined);
                    setReferenceName("");
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                >
                  убрать
                </button>
              </span>
            ) : (
              <span className="muted">необязательно</span>
            )}
          </div>
        </div>
      )}

      {error && <div className="banner error">{error}</div>}

      <button type="button" className="primary-btn" disabled={!canSubmit} onClick={submit}>
        {busy ? "Генерация идёт…" : "Сгенерировать"}
      </button>
    </div>
  );
}
