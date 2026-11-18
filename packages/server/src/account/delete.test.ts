import { describe, expect, it } from "vitest";
import { listTenantRows } from "../seed/clear";
import { OWNER, connectVia } from "../testing/bank-rig";
import { ACCESS_TOKEN, BANK_ENV, FakeBank, plaidError } from "../testing/fake-bank";
import { FakeAccount } from "../testing/fake-account";
import { FakeGoogle, GOOGLE_TEST_ENV } from "../testing/fake-google";
import { TEST_ENV, callRoute, testRig } from "../testing/fakes";
import { connectGoogleVia } from "../testing/google-rig";
import { accountDeleteRoute } from "./delete";

const CONFIRM = { confirm: "delete everything" };

function rig() {
  const r = testRig({ ...TEST_ENV, ...BANK_ENV, ...GOOGLE_TEST_ENV });
  const bank = new FakeBank();
  const google = new FakeGoogle();
  const account = new FakeAccount(r.store);
  r.deps.bank = bank;
  r.deps.google = google;
  r.deps.account = account;
  return { r, bank, google, account };
}

describe("POST /api/account/delete", () => {
  it("removes the bank at Plaid, revokes Google, deletes every row, then the sign-in", async () => {
    const { r, bank, google, account } = rig();
    expect((await connectVia(r)).status).toBe(200);
    expect((await connectGoogleVia(r)).status).toBe(200);
    expect((await listTenantRows(r.store, OWNER)).length).toBeGreaterThan(0);

    const res = await callRoute(r, accountDeleteRoute, CONFIRM);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });
    expect(bank.calls.filter((c) => c.method === "remove").map((c) => c.token)).toEqual([ACCESS_TOKEN]);
    expect(google.count("revoke")).toBe(1);
    expect(await listTenantRows(r.store, OWNER)).toEqual([]);
    expect(account.deletedUsers).toEqual([OWNER]);
    expect(account.tenantDeletes).toBe(2);
  });

  it("works with nothing connected and nothing stored, and calls neither Plaid nor Google", async () => {
    const { r, bank, google, account } = rig();
    const res = await callRoute(r, accountDeleteRoute, CONFIRM);
    expect(res.status).toBe(200);
    expect(bank.calls).toEqual([]);
    expect(google.count("revoke")).toBe(0);
    expect(account.deletedUsers).toEqual([OWNER]);
  });

  it("stops before erasing anything when Plaid can't remove the bank, so a second press can finish", async () => {
    const { r, bank, account } = rig();
    expect((await connectVia(r)).status).toBe(200);
    bank.failNext("remove", plaidError("INTERNAL_SERVER_ERROR"));

    const failed = await callRoute(r, accountDeleteRoute, CONFIRM);
    expect(failed.status).toBeGreaterThanOrEqual(400);
    expect(account.tenantDeletes).toBe(0);
    expect(account.deletedUsers).toEqual([]);
    expect((await listTenantRows(r.store, OWNER)).length).toBeGreaterThan(0);

    const again = await callRoute(r, accountDeleteRoute, CONFIRM);
    expect(again.status).toBe(200);
    expect(await listTenantRows(r.store, OWNER)).toEqual([]);
  });

  it("refuses a body that doesn't say so in words", async () => {
    const { r, account } = rig();
    for (const body of [{}, { confirm: "yes" }, { confirm: "delete everything", extra: 1 }, null]) {
      const res = await callRoute(r, accountDeleteRoute, body);
      expect(res.status).toBe(400);
    }
    expect(account.tenantDeletes).toBe(0);
  });
});
