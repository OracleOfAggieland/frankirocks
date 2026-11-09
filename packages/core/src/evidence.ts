/** Pure Evidence helpers shared by the W-LINEAGE write check and the lineage resolver. */
import type { FP } from "./schema/primitives";
import type { Evidence } from "./schema/records";

/**
 * The LF-normalized text of one Evidence field, or null when the field is empty, is not text, or lives in an
 * object Content (whose bytes are not inline, so a Slice over it cannot be checked here).
 */
export function evidenceFieldText(e: Evidence, fieldPath: FP): string | null {
  switch (fieldPath) {
    case "body":
    case "bodyOwn":
    case "bodyQuoted":
    case "description":
    case "text": {
      const c = e[fieldPath];
      return c !== null && c.kind === "inline" ? c.text : null;
    }
    case "subject":
    case "title":
    case "sender":
      return e[fieldPath];
    default:
      // recipient is a list and the typed paths (calendar.*, bank.*, task.status, food.amount) have null ranges.
      return null;
  }
}
