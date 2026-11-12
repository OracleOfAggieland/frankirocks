/**
 * Output shapes of the source readers (contracts §5 ClaimsV1, PrivateReadOwnV1, PrivateReadInboundV1). Closed and
 * bounded, as the contracts give them. Brief 019 uses them to validate the seed's authored packets; no live reader
 * calls a model with them yet.
 *
 * ClaimsV1 attributes what mail says: logistics, the sender's own promises, claims about the Owner and topic
 * signals. It never binds an identity, sets a truth, writes a rule or grants a permission. Bulk mail is
 * logistics-only (contracts §4 Gmail row).
 */
import { WhenDraft } from "./extract";
import { Domain, ID, Span } from "./schema/primitives";
import { type Infer, arr, int, literal, nat, nullable, obj, oneOf, plainObject, str } from "./schema/v";

export const TOPICS = ["health", "money", "relationship", "work", "travel", "food", "family", "time", "identity", "other_secret"] as const;
export const Topic = oneOf(TOPICS);
export type Topic = Infer<typeof Topic>;

export const Signal = obj({ topic: Topic, subjectName: nullable(str(120)), spans: arr(Span, 4) });
export type Signal = Infer<typeof Signal>;

const Continuation = nullable(obj({ fieldIndex: nat(), offset: nat() }));

export const LOGISTICS_TYPES = ["arrival", "departure", "delivery", "pickup", "deadline", "reschedule", "cancellation", "location"] as const;
export const CLAIM_TYPES = ["address", "bereavement", "job_change", "relationship", "health", "obligation", "identity", "purchase"] as const;

export const ClaimsOutput = obj({
  version: literal("ClaimsV1"),
  logistics: arr(
    obj({ type: oneOf(LOGISTICS_TYPES), when: WhenDraft, where: nullable(str(160)), participants: arr(str(120), 8), spans: arr(Span, 4) }),
    8,
  ),
  senderPromises: arr(obj({ object: str(240), beneficiary: nullable(str(120)), when: WhenDraft, spans: arr(Span, 4) }), 8),
  claimsAboutUser: arr(obj({ type: oneOf(CLAIM_TYPES), claim: str(240), when: WhenDraft, spans: arr(Span, 4) }), 8),
  topicSignals: arr(Signal, 16),
  directiveCount: int(0, 100),
  continuation: Continuation,
});
export type ClaimsOutput = Infer<typeof ClaimsOutput>;

export const PrivateReadInboundOutput = obj({
  version: literal("PrivateReadInboundV1"),
  topicSignals: arr(Signal, 24),
  continuation: Continuation,
});
export type PrivateReadInboundOutput = Infer<typeof PrivateReadInboundOutput>;

export const PrivateHypothesis = obj({
  topic: Topic,
  claim: str(320, { min: 1 }),
  /** Sensitive guesses need support (contracts §5): at least one span of the Owner's own text. */
  support: arr(Span, 8, 1),
  counter: arr(Span, 8),
  contextIds: arr(ID, 8),
  subtract: arr(obj({ kind: oneOf(["exclude", "hold"]), targetMid: ID }), 4),
});
export type PrivateHypothesis = Infer<typeof PrivateHypothesis>;

export const PrivateReadOwnOutput = obj({
  version: literal("PrivateReadOwnV1"),
  /** ExtractV1 Items the extractor missed; checked one by one by `planItem`. */
  missed: arr(plainObject, 8),
  hypotheses: arr(PrivateHypothesis, 6),
  continuation: Continuation,
});
export type PrivateReadOwnOutput = Infer<typeof PrivateReadOwnOutput>;

/** Every Span a ClaimsV1 output quotes, in output order. */
export function claimsSpans(out: ClaimsOutput): Span[] {
  return [
    ...out.logistics.flatMap((l) => l.spans),
    ...out.senderPromises.flatMap((p) => p.spans),
    ...out.claimsAboutUser.flatMap((c) => c.spans),
    ...out.topicSignals.flatMap((s) => s.spans),
  ];
}

/**
 * The `hypothesis` predicate's Domain for a reader Topic. The two lists differ (contracts §3 Domain, §5 Topic):
 * family reads as relationship, identity and other_secret as other.
 */
export function topicDomain(topic: Topic): Infer<typeof Domain> {
  switch (topic) {
    case "family":
      return "relationship";
    case "identity":
    case "other_secret":
      return "other";
    case "health":
    case "money":
    case "relationship":
    case "work":
    case "travel":
    case "food":
    case "time":
      return topic;
    default:
      topic satisfies never;
      return "other";
  }
}
