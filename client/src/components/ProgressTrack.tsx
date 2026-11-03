import type { Generation, StageName } from "../types";
import { STAGE_LABELS } from "../types";

const ORDER: StageName[] = ["queued", "account", "auth", "submit", "processing", "done"];

interface Props {
  generation: Generation;
}

export function ProgressTrack({ generation }: Props) {
  const currentIndex = ORDER.indexOf(generation.stage as StageName);
  const pct = Math.max(4, generation.progress);

  return (
    <div className="progress">
      <div className="progress-stages">
        {ORDER.map((stage, i) => {
          const state = i < currentIndex ? "done" : i === currentIndex ? "current" : "future";
          return (
            <div key={stage} className={`stage ${state}`}>
              <span className="stage-dot" />
              <span className="stage-label">{STAGE_LABELS[stage]}</span>
            </div>
          );
        })}
      </div>

      <div className="bar">
        <div className="bar-fill" style={{ width: `${pct}%` }} />
      </div>

      <div className="progress-meta">
        <span>{STAGE_LABELS[generation.stage] ?? generation.stage}</span>
        <span>{pct}%</span>
      </div>

      {generation.stage === "processing" && (
        <div className="pulse-hint">Модель рисует — это занимает до нескольких минут</div>
      )}
    </div>
  );
}
