import type { Generation } from "../types";

interface Props {
  generation: Generation;
}

export function ResultView({ generation }: Props) {
  if (!generation.url) {
    return <div className="muted">Ссылка на результат ещё не готова…</div>;
  }

  const fileExt = generation.kind === "video" ? "mp4" : "png";
  const fileName = `unigen-${generation.id.slice(0, 8)}.${fileExt}`;

  return (
    <div className="result">
      {generation.kind === "video" ? (
        <video className="result-media" src={generation.url} controls autoPlay loop playsInline />
      ) : (
        <img className="result-media" src={generation.url} alt="результат генерации" />
      )}

      <div className="result-meta">
        <div className="result-prompt">{generation.prompt}</div>
        <div className="result-tags">
          {generation.params.resolution && <span className="tag">{generation.params.resolution}</span>}
          {generation.params.aspect && <span className="tag">{generation.params.aspect}</span>}
          {generation.params.duration && <span className="tag">{generation.params.duration} сек</span>}
          {generation.params.count && generation.params.count > 1 && (
            <span className="tag">×{generation.params.count}</span>
          )}
          {generation.params.style && <span className="tag">{generation.params.style}</span>}
        </div>
        <a className="primary-btn download" href={generation.url} download={fileName}>
          Скачать {generation.kind === "video" ? "видео" : "изображение"}
        </a>
      </div>
    </div>
  );
}
