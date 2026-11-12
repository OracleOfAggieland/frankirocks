// The Reply_Line (lab-ui-foundation R14.8, R18.1): Franki's latest reply to a typed turn, as one line in
// a polite region. No earlier lines show. Stored text is a React text child, so markup never runs.
// The region is always mounted; the reply shows in one glass capsule with a small ghost glyph, and with no
// reply there is no capsule. Each new turn's reply materializes (screen.css), even with the last one's words.
// The glyph is drawn in CSS (.franki-reply-ghost), so the region's markup holds nothing but the reply's words.
import { type ReplyEntry, latestReply } from "../ui/turn-copies";

const CAPSULE = "mat-glass franki-materialize inline-flex min-w-0 max-w-full items-center gap-2 rounded-full py-2 pl-3 pr-4";

/**
 * The capsule's key: one per turn, not per wording, so a reply with the same words as the last one still
 * remounts, materializes and is announced. A typed turn appends its user entry and all of Franki's notes in one
 * update, so the entry count changes once per turn.
 */
export const replyKey = (entries: readonly ReplyEntry[]) => entries.length;

export function ReplyLine({ entries }: { entries: readonly ReplyEntry[] }) {
  const reply = latestReply(entries);
  return (
    <p aria-live="polite" data-reply-line="" className="flex min-h-11 w-full max-w-[343px] justify-center text-center text-base text-ink sm:max-w-xl">
      {reply === null || reply === "" ? null : (
        <span key={replyKey(entries)} data-reply-capsule="" className={CAPSULE}>
          <span className="franki-reply-ghost pointer-events-none shrink-0" />
          <span className="min-w-0 truncate">{reply}</span>
        </span>
      )}
    </p>
  );
}
