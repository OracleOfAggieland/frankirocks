/**
 * Regenerating the seed's packets (brief 019 task 3: "A later paid run can regenerate them; build the script for
 * that run behind a port that is fake by default, and do not run it live").
 *
 * Only the lines a model reads have packets to regenerate: owner turns (ExtractV1, PrivateReadOwnV1) and full
 * inbound mail (ClaimsV1, PrivateReadInboundV1). Calendar and bank rows are read by code, and bulk and own mail keep
 * whatever the authored line holds. The text of every line stays as authored; only the packets change.
 *
 * The output is marked `origin: "regenerated"`, and the load refuses it until regenerated packets have a parser
 * version of their own. No live reader is built here: a paid run would add one behind `PacketReader`, built on the
 * OpenAI port and the extraction request, and nothing in this lane calls a model.
 */
import type { AuthoredClaims, AuthoredGuess, AuthoredItem, AuthoredSignal, MailLine, SeedFixture, SeedLine, TurnLine } from "./fixture";

export type TurnPackets = { extract: AuthoredItem[]; privateRead?: AuthoredGuess[] };
export type MailPackets = { claims?: AuthoredClaims; inbound?: AuthoredSignal[] };

/** Reads one line alone and returns its packets. */
export interface PacketReader {
  readonly live: boolean;
  turn(line: TurnLine): Promise<TurnPackets>;
  mail(line: MailLine): Promise<MailPackets>;
}

/** The default reader: returns each line's authored packets unchanged. Never calls anything. */
export const authoredReader: PacketReader = {
  live: false,
  turn: async (line) => ({ extract: line.extract, ...(line.privateRead === undefined ? {} : { privateRead: line.privateRead }) }),
  mail: async (line) => ({ ...(line.claims === undefined ? {} : { claims: line.claims }), ...(line.inbound === undefined ? {} : { inbound: line.inbound }) }),
};

export const regenerates = (line: SeedLine): line is TurnLine | MailLine => line.kind === "turn" || (line.kind === "mail" && !line.bulk && !line.fromSelf);

/**
 * Returns the fixture with every model-read line's packets from `reader`, one line at a time. A live reader must be
 * asked for by name (`allowLive`), so a test or script that forgets cannot reach a paid call.
 */
export async function regenerateFixture(fixture: SeedFixture, reader: PacketReader = authoredReader, opts: { allowLive?: boolean } = {}): Promise<SeedFixture> {
  if (reader.live && opts.allowLive !== true) throw new Error("regenerateFixture: a live reader needs allowLive");
  const lines: SeedLine[] = [];
  for (const line of fixture.lines) {
    if (!regenerates(line)) {
      lines.push(line);
      continue;
    }
    if (line.kind === "turn") {
      const { privateRead: _old, ...rest } = line;
      lines.push({ ...rest, ...(await reader.turn(line)) });
    } else {
      const { claims: _c, inbound: _i, ...rest } = line;
      lines.push({ ...rest, ...(await reader.mail(line)) });
    }
  }
  return { ...fixture, origin: "regenerated", lines };
}
