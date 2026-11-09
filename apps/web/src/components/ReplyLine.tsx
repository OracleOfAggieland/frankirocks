// The Reply_Line (lab-ui-foundation R14.8, R18.1): Franki's latest reply to a typed turn, as one line in
// a polite region. No earlier lines show. Stored text is a React text child, so markup never runs.
import { type ReplyEntry, latestReply } from "../ui/turn-copies";

export function ReplyLine({ entries }: { entries: readonly ReplyEntry[] }) {
  const reply = latestReply(entries);
  return (
    <p aria-live="polite" data-reply-line="" className="min-h-6 w-full max-w-[343px] truncate text-center text-base text-ink sm:max-w-xl">
      {reply ?? ""}
    </p>
  );
}
