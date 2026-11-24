/**
 * Brief 054 ruling 3: anonymous and the demo persona go together (R5). A demo fixture (one with a `demo` profile) is
 * cloned into an anonymous tenant and only into one; every other fixture into a tenant that is not anonymous and
 * only into one. `anonymous` is the verified token's, never the body's; absent counts as not anonymous (R4.6).
 *
 * The refusal is the same 404 SCOPE as an unknown fixture ID, so a probe can't tell "wrong fixture" from "no such
 * fixture" (contract question 99). The reset calls this before anything else, so a refusal writes nothing (R5.4).
 */
import { scopeError } from "../routes/errors";
import type { SeedFixture } from "./fixture";
import { FIXTURES } from "./persona";

export function pairedFixture(anonymous: boolean | undefined, fixtureId: string, fixtures: ReadonlyMap<string, SeedFixture> = FIXTURES): SeedFixture {
  const f = fixtures.get(fixtureId);
  if (f === undefined) throw scopeError();
  if ((f.demo !== undefined) !== (anonymous === true)) throw scopeError();
  return f;
}
