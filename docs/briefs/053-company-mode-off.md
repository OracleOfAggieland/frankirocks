# Brief 053: company mode off (lane `no-company`)

**Who builds this.** Claude, from the owner's ruling of Nov 18. It is not Kiro's work, and its commit does not carry the Kiro trailer.

## The ruling

Owner, Nov 18: company mode is off for now. It misfires too often.

The first call from a new account showed why. The intent parse read an ordinary line as someone else in the room. The call hung up and reopened in company mode, and the reopened call never connected in that browser: three reconnects, each giving up after 5 seconds with no voice setup sent. The Nov 14 live session had already shown the check misfiring both ways.

## What changes

- **Company mode is off unless `FRANKI_COMPANY_MODE` is `on`.** Nothing sets it in `apps/web/apphosting.yaml` or `.env.local`, so it is off on the live site and in local development.
- **The slow parse reads `company` and `quiet` as 0** when it is off (`withoutCompanyMode`, `packages/core/src/intents/parse.ts`; applied in `packages/server/src/intents/slow-parse.ts`). Neither is ever a candidate, so no turn narrows the audience. No call hangs up for a walk-in or for "keep that between us", and the company line is never said. The Parse_Repair and the late narrowing read the same parse.
- **The probabilities stay the model's own.** G19 (`speakerCertain`, `packages/server/src/onturn/trigger.ts`) still reads them, so a line the model hears as someone else's still writes no fact or hard rule as the owner's and starts no moment. That fails closed and ends no call.
- **A Session already left in `company` passes nothing on** (`narrowestInherited`, `packages/server/src/audience-swap.ts`). An account an earlier hit narrowed opens its next call private.

## What stays

- **The machinery.** The rule rows, the swap, the inheritance and the company Head are unchanged, and the shared test settings turn company mode on, so every existing test still runs it. Turning it back on is one setting.
- **`unknown` from a failed parse.** A parse that misses its deadline still leaves the call in `unknown` until an `alone` line or the owner's own hang-up. That is not company mode, so `alone` keeps working.
- **Crisis care.** A crisis line still gets care and 988. Only its company-or-quiet variant (care first, then the swap) can no longer happen.
- **"Don't bring it up."** Quiet topics are Memories and Effects, not the `quiet` class, and are untouched.
- **The judge prompt** still lists company among the things that hold a turn for the slow parse. Such a turn now waits for the parse and then gets an ordinary reply.

## What it doesn't do

- **The reconnect stall is not fixed.** A forget during a call still hangs up and swaps to a fresh call by the same path, and a dropped connection still reconnects by it. Why the fresh call never reached the voice setup in that browser is unknown: the server saw no SDP request at all.
- **The company tap still narrows.** `/api/turn` keeps the trusted tap (brief 044, item 3). No screen shows it outside `/specimens`.
- **Release gates that count company leaks** have nothing to measure while it is off.
- **No design doc is changed.** This departs from voice-control R14 (company, quiet and the swap) while the setting is off.
