/** Loading and error states reserve the same space as a rendered note thumbnail. */
export function GalleryPlaceholder({ state, message }: { state: "loading" | "error"; message: string }) {
  const loading = state === "loading";
  return (
    <div className="gallery-card gallery-placeholder" aria-hidden={loading}>
      <div className={`gallery-thumb ${loading ? "gallery-thumb-skeleton" : "gallery-thumb-failed"}`}>
        {loading ? (
          <>
            <span className="gallery-skeleton-line gallery-skeleton-title" />
            <span className="gallery-skeleton-line" />
            <span className="gallery-skeleton-line" />
          </>
        ) : (
          <span role="status">{message}</span>
        )}
      </div>
      {loading ? <span className="gallery-skeleton-caption" /> : null}
    </div>
  );
}
