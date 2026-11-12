import Link from "next/link";
import { LANDING } from "../../ui/copy-landing";
import { Room, SYSTEM_BRASS, SYSTEM_QUIET } from "./Room";
import { SlabDrawing } from "./SlabDrawing";

// The 404 page body: the empty slab, a way back to the front door (brass) and a quiet way into the lab.

export function NotFoundRoom() {
  return (
    <Room
      kind="not-found"
      drawing={<SlabDrawing />}
      fig={{ n: "404", label: LANDING.notFound.fig }}
      title={
        <>
          {LANDING.notFound.titleStart} <em className="italic">{LANDING.notFound.titleWord}</em>
        </>
      }
      body={LANDING.notFound.body}
      actions={
        <>
          <Link href="/" className={SYSTEM_BRASS}>
            {LANDING.notFound.home}
          </Link>
          <Link href="/lab" className={SYSTEM_QUIET}>
            {LANDING.notFound.lab}
          </Link>
        </>
      }
    />
  );
}
