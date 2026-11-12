import { FuseDrawing } from "./FuseDrawing";
import { Room, SYSTEM_BRASS, SYSTEM_QUIET } from "./Room";

// The error page body: the blown fuse, a brass button that tries the page again, and a quiet link to
// the front door.
export const FUSE_COPY = {
  docTitle: "A fuse blew · Franki",
  titleStart: "A fuse",
  titleWord: "blew",
  body: "Something in the lab tripped. Put a new one in and try again.",
  fig: "the main fuse, blown",
  retry: "Try again",
  home: "Back to the front door",
} as const;

export function FuseRoom({ onRetry }: { onRetry: () => void }) {
  return (
    <Room
      kind="error"
      drawing={<FuseDrawing />}
      fig={{ n: "500", label: FUSE_COPY.fig }}
      title={
        <>
          {FUSE_COPY.titleStart} <em className="italic">{FUSE_COPY.titleWord}</em>
        </>
      }
      body={FUSE_COPY.body}
      actions={
        <>
          <button type="button" onClick={onRetry} className={SYSTEM_BRASS}>
            {FUSE_COPY.retry}
          </button>
          {/* A full page load, not a client navigation: it rebuilds the crashed tree, even when the crash was on `/`. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className={SYSTEM_QUIET}>
            {FUSE_COPY.home}
          </a>
        </>
      }
    />
  );
}
