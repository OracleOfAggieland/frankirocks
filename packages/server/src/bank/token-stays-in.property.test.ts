// Brief 046 property "The token stays in": for any connector state, no route answer, ledger row or log line holds the
// access token or its sealed form, and a token sealed for one connector does not open for another. Seed recorded in
// brief 046's Outcome.
import { BANK_PROBLEMS, CONNECTOR_STATES, type Connector } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { listTenantRows } from "../seed/clear";
import { paths } from "../store/paths";
import { OWNER, bankRequestId, bankRig, connectVia, connectorIdOf, storedConnector } from "../testing/bank-rig";
import { BANK_ENV, plaidError } from "../testing/fake-bank";
import { callRoute, patchRecord } from "../testing/fakes";
import { bankConfig } from "./config";
import { RELINK_CODES, REVOKED_CODES } from "./plaid";
import { bankDisconnectRoute, bankLinkTokenRoute, bankStatusRoute, bankSyncRoute } from "./routes";
import { openToken, sealToken } from "./seal";

const CODES = [...RELINK_CODES, ...REVOKED_CODES, "INTERNAL_SERVER_ERROR", "RATE_LIMIT_EXCEEDED", null] as const;

describe("property: the token stays in (brief 046)", () => {
  it("1,000 runs", async () => {
    const keys = bankConfig(BANK_ENV).tokenKeys;
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^access-(sandbox|production)-[0-9a-f-]{8,40}$/),
        fc.constantFrom(...CONNECTOR_STATES),
        fc.option(fc.constantFrom(...BANK_PROBLEMS), { nil: null }),
        fc.option(fc.constantFrom(...CODES), { nil: undefined }),
        fc.option(fc.constantFrom(...CODES), { nil: undefined }),
        async (token, state, problem, syncError, removeError) => {
          const { rig, bank } = bankRig();
          bank.accessToken = token;
          const answers: unknown[] = [];
          answers.push((await connectVia(rig)).body);
          const id = connectorIdOf(rig);
          const sealed = (await storedConnector(rig, id))!.bank!.token!;
          await patchRecord<Connector>(rig.store, OWNER, paths.connector(OWNER, id), { state, bank: { ...(await storedConnector(rig, id))!.bank!, problem } });
          if (syncError !== undefined) bank.failNext("sync", plaidError(syncError ?? "UNKNOWN", syncError !== null));
          if (removeError !== undefined) bank.failNext("remove", plaidError(removeError ?? "UNKNOWN", removeError !== null));
          const status = { method: "GET", url: "http://localhost:3000/api/bank/status", origin: null };
          answers.push((await callRoute(rig, bankStatusRoute, undefined, status)).body);
          answers.push((await callRoute(rig, bankSyncRoute, { connectorId: id })).body);
          answers.push((await callRoute(rig, bankLinkTokenRoute, {})).body);
          answers.push((await callRoute(rig, bankDisconnectRoute, { requestId: bankRequestId("d"), connectorId: id })).body);
          answers.push((await callRoute(rig, bankStatusRoute, undefined, status)).body);
          const ledger = (await listTenantRows(rig.store, OWNER)).filter((r) => r.path.includes("/ledger/")).map((r) => r.data);
          const text = JSON.stringify({ answers, ledger, logs: rig.logs });
          for (const secret of [token, sealed.body, sealed.iv]) expect(text.includes(secret)).toBe(false);
          // Sealed for this connector, it opens only here.
          expect(openToken(keys, OWNER, id, sealed)).toBe(token);
          const other = sealToken(keys, OWNER, id, token);
          expect(() => openToken(keys, OWNER, connectorIdOf(rig, 2), other)).toThrow();
          expect(() => openToken(keys, "owner-2", id, other)).toThrow();
        },
      ),
      { numRuns: 1000 },
    );
  }, 600_000);
});
