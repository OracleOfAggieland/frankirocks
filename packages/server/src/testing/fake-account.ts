/** A fake AccountPort over the test store: the tenant delete removes every row, the user delete is recorded. */
import type { AccountPort } from "../account/live";
import { listTenantRows } from "../seed/clear";
import type { StorePort } from "../store/port";

export class FakeAccount implements AccountPort {
  readonly deletedUsers: string[] = [];
  tenantDeletes = 0;
  constructor(private readonly store: StorePort) {}

  async deleteTenant(uid: string): Promise<void> {
    this.tenantDeletes += 1;
    const rows = await listTenantRows(this.store, uid);
    for (let i = 0; i < rows.length; i += 100) {
      const page = rows.slice(i, i + 100);
      await this.store.transaction(uid, async (tx) => {
        for (const r of page) tx.delete(r.path);
      });
    }
  }

  async deleteUser(uid: string): Promise<void> {
    this.deletedUsers.push(uid);
  }
}
