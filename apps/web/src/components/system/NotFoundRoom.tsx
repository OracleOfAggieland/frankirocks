import Link from "next/link";
import { Room, SYSTEM_BRASS, SYSTEM_QUIET } from "./Room";
import { SlabDrawing } from "./SlabDrawing";

// The 404 page body: the empty slab, a way back to the front door (brass) and a quiet way into the lab.
export const NOT_FOUND_COPY = {
  docTitle: "Empty room · Franki",
  titleStart: "This room is",
  titleWord: "empty",
  body: "Franki isn't here. The page you're after may have moved, or was never built.",
  fig: "the slab, empty",
  home: "Back to the front door",
  lab: "Go to the lab",
} as const;

export function NotFoundRoom() {
  return (
    <Room
      kind="not-found"
      drawing={<SlabDrawing />}
      fig={{ n: "404", label: NOT_FOUND_COPY.fig }}
      title={
        <>
          {NOT_FOUND_COPY.titleStart} <em className="italic">{NOT_FOUND_COPY.titleWord}</em>
        </>
      }
      body={NOT_FOUND_COPY.body}
      actions={
        <>
          <Link href="/" className={SYSTEM_BRASS}>
            {NOT_FOUND_COPY.home}
          </Link>
          <Link href="/lab" className={SYSTEM_QUIET}>
            {NOT_FOUND_COPY.lab}
          </Link>
        </>
      }
    />
  );
}
