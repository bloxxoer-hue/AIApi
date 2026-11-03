import type { Generation } from "../types";

interface Props {
  items: Generation[];
  onPick: (g: Generation) => void;
  onRefresh: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "В очереди",
  running: "В работе",
  done: "Готово",
  error: "Ошибка",
};

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  return new Date(ts).toLocaleDateString("ru-RU");
}

export function History({ items, onPick, onRefresh }: Props) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h2 className="panel-title">История генераций</h2>
        <button type="button" className="ghost-btn" onClick={onRefresh}>
          Обновить
        </button>
      </div>

      {items.length === 0 ? (
        <div className="muted">Пока пусто — сгенерируйте что-нибудь во вкладке «Генератор».</div>
      ) : (
        <div className="history-list">
          {items.map((g) => (
            <button key={g.id} type="button" className="history-item" onClick={() => onPick(g)}>
              <span className={`kind-badge ${g.kind}`}>{g.kind === "video" ? "Видео" : "Фото"}</span>
              <span className="history-prompt">{g.prompt}</span>
              <span className={`status status-${g.status}`}>{STATUS_LABEL[g.status]}</span>
              <span className="history-time">{timeAgo(g.createdAt)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
