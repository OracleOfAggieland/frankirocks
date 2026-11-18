/**
 * POST /api/account/delete: erases everything stored for the caller, then their sign-in.
 *
 * Order, so nothing outside Franki is left holding the owner's data or billing for it:
 *   1. every connected bank is removed at Plaid (the bank disconnect, once per bank);
 *   2. a connected Google account's grant is revoked (the Google disconnect);
 *   3. the whole tenant, `users/{uid}` and every collection under it, is deleted;
 *   4. the Firebase Auth user is deleted, so the ID token is refused from then on (`checkRevoked`);
 *   5. the tenant is deleted again, for anything a request already in flight wrote after step 3.
 *
 * A step that fails stops the delete with its error, before anything is erased if it is step 1 or 2, so the owner
 * can press Delete again. Every step can run twice: a removed bank, a revoked grant, an empty tenant and a deleted
 * user are each skipped.
 */
import { AccountDeleteRequest, type AccountDeleteResponse, type Connector } from "@franki/core";
import { disconnectBank } from "../bank/routes";
import { disconnectGoogle } from "../google/routes";
import { type RouteContext, type RouteSpec, parseWith } from "../routes/runtime";
import { paths } from "../store/paths";
import { type AccountPort, liveAccount } from "./live";

export type { AccountPort };

const accountOf = (ctx: RouteContext): AccountPort => ctx.deps.account ?? liveAccount(ctx.deps.env);

export async function deleteAccount(ctx: RouteContext): Promise<AccountDeleteResponse> {
  const { uid, deps } = ctx;
  const now = deps.clock.read().opsClock.now;
  const connectors = await deps.store.query<Connector>(uid, {
    collection: paths.collection(uid, "connectors"),
    where: [],
    orderBy: { field: "__name__", dir: "asc" },
    limit: 100,
  });

  // 1. Banks with a token still held. A disconnected bank has none and needs nothing from Plaid.
  for (const c of connectors) {
    if (c.data.bank?.token == null) continue;
    await disconnectBank(ctx, { requestId: deps.hasher.id(["account-delete", "bank", uid, c.id, String(now)]), connectorId: c.id });
  }
  // 2. Google: one revoke covers mail and calendar.
  if (connectors.some((c) => c.data.google?.token != null)) {
    await disconnectGoogle(ctx, { requestId: deps.hasher.id(["account-delete", "google", uid, String(now)]) });
  }

  const account = accountOf(ctx);
  await account.deleteTenant(uid);
  await account.deleteUser(uid);
  await account.deleteTenant(uid);
  deps.log("account.deleted", { banks: connectors.filter((c) => c.data.bank !== null).length });
  return { deleted: true };
}

export const accountDeleteRoute: RouteSpec<AccountDeleteRequest> = {
  name: "accountDelete",
  parse: ({ body }) => parseWith(AccountDeleteRequest, body),
  run: (ctx) => deleteAccount(ctx),
};
