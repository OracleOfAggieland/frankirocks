/**
 * Store_Port (R7.1–R7.5, R7.9, R7.10; KC01, KC02). One interface, two implementations: the Memory_Store for tests
 * and the Firestore_Store for production. Every call takes one Owner `uid` and touches only `users/{uid}`.
 *
 * Transactions buffer their writes and apply them at commit, all or nothing. At commit the store:
 *   1. validates every written record against its closed schema (invalidInput) and the 512 KiB cap (oversize);
 *   2. checks `record.uid` equals the caller's uid (tenantMismatch);
 *   3. compares every read and every expected `rev` with the stored `rev` (staleRevision);
 *   4. rejects in-place changes to Evidence content or Memory value/args (invalidInput);
 *   5. runs the W-LINEAGE check on every Memory write (invalidInput, naming the failed checks).
 * Each written record's `rev` is set by the store: 1 on create, prior + 1 on update.
 * Neither store retries a transaction; callers decide (R19.11).
 */

export type FieldValue = string | number | boolean | null;

export type Op = "==" | "<" | "<=" | ">" | ">=";

export interface Filter {
  /** A Firestore field path, or `__name__` for the document ID (Q28). */
  field: string;
  op: Op;
  value: FieldValue;
}

export interface QuerySpec {
  /** A collection path under the caller's Tenant_Root, e.g. `users/{uid}/jobs`. */
  collection: string;
  where: Filter[];
  /** Ties sort by document ID in the same direction (Firestore "name follows last direction"). */
  orderBy: { field: string; dir: "asc" | "desc" };
  /** 1 to 100 (contracts §9 page limits). */
  limit: number;
}

export interface StoredDoc<T = Record<string, unknown>> {
  path: string;
  id: string;
  data: T;
}

export interface Tx {
  get<T = Record<string, unknown>>(path: string): Promise<StoredDoc<T> | null>;
  query<T = Record<string, unknown>>(spec: QuerySpec): Promise<StoredDoc<T>[]>;
  /** Creates a record. The path must be absent at commit. */
  create(path: string, record: object): void;
  /**
   * Replaces a record. `expectRev` is required unless the path was read in this transaction; either way the
   * stored `rev` must still match at commit.
   */
  update(path: string, record: object, expectRev?: number): void;
  /**
   * Deletes a record (brief 019: the seed reset's clear is its only caller). A path already absent at commit is
   * not an error. A path read in this transaction must still hold the rev that was read. A path may not be both
   * written and deleted in one transaction.
   */
  delete(path: string): void;
}

export interface StorePort {
  get<T = Record<string, unknown>>(uid: string, path: string): Promise<StoredDoc<T> | null>;
  query<T = Record<string, unknown>>(uid: string, spec: QuerySpec): Promise<StoredDoc<T>[]>;
  transaction<R>(uid: string, fn: (tx: Tx) => Promise<R>): Promise<R>;
  /**
   * Runs `fn` over one consistent read-only view that takes no locks, so it never makes a transaction wait or
   * abort. Optional: a store without it (test wrappers) is read through plain `get` and `query`.
   */
  snapshot?<R>(uid: string, fn: (reader: Reader) => Promise<R>): Promise<R>;
}

/** The read half of a transaction. */
export type Reader = Pick<Tx, "get" | "query">;

/** `store.snapshot`, or plain reads when the store has none. */
export function readSnapshot<R>(store: StorePort, uid: string, fn: (reader: Reader) => Promise<R>): Promise<R> {
  if (store.snapshot !== undefined) return store.snapshot(uid, fn);
  return fn({ get: <T>(path: string) => store.get<T>(uid, path), query: <T>(spec: QuerySpec) => store.query<T>(uid, spec) });
}

/** 512 KiB record cap (contracts §1 Cap512KiB; R4.7). */
export const MAX_RECORD_BYTES = 524_288;

export const MAX_QUERY_LIMIT = 100;
