/** Store_Port errors. Kernel error names (contracts §7) plus tenant mismatch (R7.10). Never carries record content. */
export type StoreErrorCode = "staleRevision" | "invalidInput" | "oversize" | "tenantMismatch";

export class StoreError extends Error {
  readonly code: StoreErrorCode;
  /** The record path, or the field path inside the record, that failed. */
  readonly at: string;
  /** For W-LINEAGE rejections: the failed checks. */
  readonly lineage: readonly string[];

  constructor(code: StoreErrorCode, detail: string, at = "", lineage: readonly string[] = []) {
    super(`${code}: ${detail}${at ? ` (${at})` : ""}`);
    this.name = "StoreError";
    this.code = code;
    this.at = at;
    this.lineage = lineage;
  }
}

export const isStoreError = (e: unknown, code?: StoreErrorCode): e is StoreError =>
  e instanceof StoreError && (code === undefined || e.code === code);
