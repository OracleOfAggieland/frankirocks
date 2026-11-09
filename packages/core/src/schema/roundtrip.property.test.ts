/**
 * Schema round trip (R31.4, R31.5): FOR ALL valid values of each in-scope type, validate → JSON.stringify →
 * JSON.parse → validate gives a value deep-equal to the original.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbitraryFor } from "../testing/arbitrary";
import { Head } from "./primitives";
import { CORE_DOCS, Evidence, Job, Ledger, Memory, Session, Turn } from "./records";
import {
  Card,
  CloseRequest,
  DebugPage,
  Deck,
  InspectItem,
  OpenRequest,
  OpenResponse,
  Permit,
  ReceiptRequest,
  SafeTurn,
  StateRequest,
  StateResponse,
  ToolRequest,
  ToolResponse,
  TurnRequest,
  TurnResponse,
  W,
} from "./wire";
import { type Schema, validate } from "./v";

const TYPES: [string, Schema<unknown>][] = [
  ["Evidence", Evidence],
  ["Memory", Memory],
  ["Session", Session],
  ["Turn", Turn],
  ["Job", Job],
  ["Ledger", Ledger],
  ["core/epoch", CORE_DOCS.epoch],
  ["core/state", CORE_DOCS.state],
  ["core/counters", CORE_DOCS.counters],
  ["core/rules", CORE_DOCS.rules],
  ["core/bundle", CORE_DOCS.bundle],
  ["Head", Head],
  ["Deck", Deck],
  ["W", W],
  ["SafeTurn", SafeTurn],
  ["Card", Card],
  ["Permit", Permit],
  ["InspectItem", InspectItem],
  ["TurnRequest", TurnRequest],
  ["TurnResponse", TurnResponse],
  ["OpenRequest", OpenRequest],
  ["OpenResponse", OpenResponse],
  ["StateRequest", StateRequest],
  ["StateResponse", StateResponse],
  ["CloseRequest", CloseRequest],
  ["ToolRequest", ToolRequest],
  ["ToolResponse", ToolResponse],
  ["ReceiptRequest", ReceiptRequest],
  ["DebugPage", DebugPage],
];

describe("schema round trip", () => {
  it.each(TYPES)(
    "%s: validate, JSON round trip, validate again, deep-equal",
    (_name, schema) => {
      fc.assert(
        fc.property(arbitraryFor(schema), (value) => {
          const first = validate(schema, value);
          expect(first.ok ? null : first.path).toBeNull();
          const parsed: unknown = JSON.parse(JSON.stringify(value));
          const second = validate(schema, parsed);
          expect(second.ok ? null : second.path).toBeNull();
          expect(parsed).toStrictEqual(value);
        }),
        { numRuns: 100 },
      );
    },
    60_000,
  );
});
