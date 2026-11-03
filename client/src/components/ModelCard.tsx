import type { ModelDef } from "../types";

interface Props {
  model: ModelDef;
  active: boolean;
  onSelect: () => void;
}

const KIND_LABEL: Record<string, string> = { video: "Видео", photo: "Фото" };

const ICONS: Record<string, string> = {
  video: "▶",
  photo: "◍",
};

export function ModelCard({ model, active, onSelect }: Props) {
  return (
    <button
      type="button"
      className={active ? "model-card active" : "model-card"}
      onClick={onSelect}
      aria-pressed={active}
    >
      <div className="model-card-top">
        <span className={`model-icon ${model.kind}`}>{ICONS[model.kind] ?? "◆"}</span>
        <span className={`kind-badge ${model.kind}`}>{KIND_LABEL[model.kind]}</span>
      </div>
      <div className="model-name">{model.label}</div>
      <div className="model-desc">{model.description}</div>
      <div className="model-provider">{model.provider === "h3max" ? "h3-max.me" : "polyfaced.com"}</div>
    </button>
  );
}
