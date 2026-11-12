import { describe, expect, it } from "vitest";
import { createHasher } from "../crypto";
import { FAKE_HMAC_KEY } from "../testing/fakes";
import { buildSeed } from "./build";
import { cloneWorldStart } from "./clock";
import { PERSONA } from "./persona";

const hasher = createHasher(FAKE_HMAC_KEY);
const ZONE = "America/Chicago";
const OPS = Date.UTC(2026, 10, 12, 18);
const input = { uid: "owner-1", namespace: hasher.id(["ns", 1]), zone: ZONE, worldStart: cloneWorldStart(OPS, ZONE), opsNow: OPS, core: { epoch: 2, policyRev: 1 }, hasher };

describe("buildSeed on the persona", () => {
  it("builds", async () => {
    const rows = await buildSeed(PERSONA, input);
    const all = rows.groups.flatMap((g) => g.writes);
    expect(all.filter((w) => w.path.includes("/memories/")).length).toBe(43);
  });
});
