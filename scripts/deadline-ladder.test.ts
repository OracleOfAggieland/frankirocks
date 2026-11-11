// The deadline ladder (docs/machines/deadlines.md): limits that must stay ordered, as inequalities over the
// exported constants. A server route answers inside its budget, the browser's request timeout sits at or above
// it, and the call's own wait sits at or above both. A change to one limit that breaks an order turns this red;
// the fix is to change its neighbours, or the page and this test, in the same change.
//
// Only the relations the page states are checked. Each constant is imported from the file that defines it; limits
// that are not exported are left out.
import { describe, expect, it } from "vitest";
import {
  CLOSE_TIMEOUT_MS,
  OPEN_TIMEOUT_MS,
  RECEIPT_TIMEOUT_MS,
  SDP_TIMEOUT_MS,
  STATE_TIMEOUT_MS,
  TOOL_TIMEOUT_MS,
  TURN_TIMEOUT_MS,
} from "../apps/web/src/client/voice-client";
import { OPEN_TIMEOUT_MS as TYPED_OPEN_TIMEOUT_MS, TURN_TIMEOUT_MS as TYPED_TURN_TIMEOUT_MS } from "../apps/web/src/client/typed-turns";
import { RECALL_DEADLINE_MS } from "../packages/core/src/recall";
import { FAST_O_ACK_AGE_MS } from "../packages/core/src/voice/fast-o";
import {
  ACK_LIMIT_MS,
  ADMITTED_TRANSCRIPT_LIMIT_MS,
  CONNECT_LIMIT_MS,
  FAST_ACK_AGE_MS,
  HELD_TRANSCRIPT_LIMIT_MS,
  MISSING_WINDOW_MS,
  OPEN_LIMIT_MS,
  REFRESH_MS,
  STATE_STALE_MS,
  TOOL_LIMIT_MS,
  TURN_RESPONSE_LIMIT_MS,
} from "../packages/core/src/voice/machine";
import { MISSING_LEASE_MS, REPAIR_LEASE_MS } from "../packages/server/src/audience";
import { REPAIR_DEADLINE_MS } from "../packages/server/src/intents/repair";
import { LEASE_MS as REQUEST_LEASE_MS } from "../packages/server/src/ledger/request";
import { OPEN_BUDGET_MS } from "../packages/server/src/routes/open";
import { SDP_OPENAI_BUDGET_MS } from "../packages/server/src/routes/sdp";
import { PARSE_WAIT_MS, TOOL_RESULT_LIMIT_MS } from "../packages/server/src/routes/tool";
import { ACK_TTL_MS, DECK_TTL_MS } from "../packages/server/src/sessions";

describe("deadline ladder: route budget, browser timeout, call's wait", () => {
  it("session open: OPEN_BUDGET_MS < OPEN_TIMEOUT_MS <= OPEN_LIMIT_MS", () => {
    expect(OPEN_BUDGET_MS).toBeLessThan(OPEN_TIMEOUT_MS);
    expect(OPEN_TIMEOUT_MS).toBeLessThanOrEqual(OPEN_LIMIT_MS);
  });

  it("SDP: SDP_OPENAI_BUDGET_MS < SDP_TIMEOUT_MS <= CONNECT_LIMIT_MS", () => {
    expect(SDP_OPENAI_BUDGET_MS).toBeLessThan(SDP_TIMEOUT_MS);
    expect(SDP_TIMEOUT_MS).toBeLessThanOrEqual(CONNECT_LIMIT_MS);
  });

  it("state poll: STATE_TIMEOUT_MS <= ACK_LIMIT_MS < STATE_STALE_MS", () => {
    expect(STATE_TIMEOUT_MS).toBeLessThanOrEqual(ACK_LIMIT_MS);
    expect(ACK_LIMIT_MS).toBeLessThan(STATE_STALE_MS);
  });

  it("turn post: the browser budget is the call's wait, TURN_TIMEOUT_MS = TURN_RESPONSE_LIMIT_MS", () => {
    expect(TURN_TIMEOUT_MS).toBe(TURN_RESPONSE_LIMIT_MS);
  });

  it("recall tool: PARSE_WAIT_MS + RECALL_DEADLINE_MS <= TOOL_RESULT_LIMIT_MS < TOOL_LIMIT_MS = TOOL_TIMEOUT_MS", () => {
    expect(PARSE_WAIT_MS + RECALL_DEADLINE_MS).toBeLessThanOrEqual(TOOL_RESULT_LIMIT_MS);
    expect(TOOL_RESULT_LIMIT_MS).toBeLessThan(TOOL_LIMIT_MS);
    expect(TOOL_TIMEOUT_MS).toBe(TOOL_LIMIT_MS);
  });
});

describe("deadline ladder: server leases against browser timeouts", () => {
  it("the request ledger's lease outlasts every browser request timeout, so a retry of a slow request is refused, not run twice", () => {
    const timeouts = { OPEN_TIMEOUT_MS, SDP_TIMEOUT_MS, STATE_TIMEOUT_MS, TURN_TIMEOUT_MS, TOOL_TIMEOUT_MS, CLOSE_TIMEOUT_MS, RECEIPT_TIMEOUT_MS, TYPED_OPEN_TIMEOUT_MS, TYPED_TURN_TIMEOUT_MS };
    for (const [name, ms] of Object.entries(timeouts)) expect(ms, name).toBeLessThan(REQUEST_LEASE_MS);
  });

  it("parse repair: REPAIR_DEADLINE_MS < REPAIR_LEASE_MS", () => {
    expect(REPAIR_DEADLINE_MS).toBeLessThan(REPAIR_LEASE_MS);
  });
});

describe("deadline ladder: limits inside the call and their server twins", () => {
  it("a StateAck is fresh for fastO for as long on both sides: FAST_ACK_AGE_MS = FAST_O_ACK_AGE_MS = ACK_TTL_MS", () => {
    expect(FAST_ACK_AGE_MS).toBe(FAST_O_ACK_AGE_MS);
    expect(FAST_O_ACK_AGE_MS).toBe(ACK_TTL_MS);
  });

  it("the missing window equals the server's lease: MISSING_WINDOW_MS = MISSING_LEASE_MS", () => {
    expect(MISSING_WINDOW_MS).toBe(MISSING_LEASE_MS);
  });

  it("the Deck is refreshed before it expires: REFRESH_MS < DECK_TTL_MS", () => {
    expect(REFRESH_MS).toBeLessThan(DECK_TTL_MS);
  });

  it("a held Turn is posted missing sooner than an admitted one: HELD_TRANSCRIPT_LIMIT_MS < ADMITTED_TRANSCRIPT_LIMIT_MS", () => {
    expect(HELD_TRANSCRIPT_LIMIT_MS).toBeLessThan(ADMITTED_TRANSCRIPT_LIMIT_MS);
  });
});
