import { LANDING } from "../../ui/copy-landing";
import { FuseDrawing } from "./FuseDrawing";
import { Room, SYSTEM_BRASS, SYSTEM_QUIET } from "./Room";

// The error page body: the blown fuse, a brass button that tries the page again, and a quiet link to
// the front door.

export function FuseRoom({ onRetry }: { onRetry: () => void }) {
  return (
    <Room
      kind="error"
      drawing={<FuseDrawing />}
      fig={{ n: "500", label: LANDING.error.fig }}
      title={
        <>
          {LANDING.error.titleStart} <em className="italic">{LANDING.error.titleWord}</em>
        </>
      }
      body={LANDING.error.body}
      actions={
        <>
          <button type="button" onClick={onRetry} className={SYSTEM_BRASS}>
            {LANDING.error.retry}
          </button>
          {/* A full page load, not a client navigation: it rebuilds the crashed tree, even when the crash was on `/`. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className={SYSTEM_QUIET}>
            {LANDING.error.home}
          </a>
        </>
      }
    />
  );
}
