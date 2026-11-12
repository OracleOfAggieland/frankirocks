/**
 * The one seed load (brief 019 task 4). Not built yet: writes nothing.
 */
import type { ClockPort, Hasher, ID } from "@franki/core";
import type { StorePort } from "../store/port";
import type { SeedRows } from "./build";
import type { SeedFixture } from "./fixture";

export interface LoadDeps {
  store: StorePort;
  hasher: Hasher;
  clock: ClockPort;
}

export interface LoadInput {
  fixture: SeedFixture;
  namespace: ID;
  zone: string;
  worldStart: number;
  core: { epoch: number; policyRev: number };
}

export async function loadSeed(_deps: LoadDeps, _uid: string, _input: LoadInput): Promise<SeedRows> {
  return { friday: "", window: { from: "", to: "" }, groups: [] };
}
