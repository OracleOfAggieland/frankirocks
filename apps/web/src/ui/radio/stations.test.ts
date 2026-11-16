import { describe, expect, it } from "vitest";
import { STATIONS, STATIONS_SNAPSHOT } from "./stations";

describe("the station snapshot", () => {
  it("has 1 to 70 rows", () => {
    expect(STATIONS.length).toBeGreaterThanOrEqual(1);
    expect(STATIONS.length).toBeLessThanOrEqual(70);
  });

  it("names its source and the day it was taken", () => {
    expect(STATIONS_SNAPSHOT.source).toMatch(/Radio Browser/);
    expect(STATIONS_SNAPSHOT.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("has unique ids and unique cities", () => {
    expect(new Set(STATIONS.map((s) => s.id)).size).toBe(STATIONS.length);
    expect(new Set(STATIONS.map((s) => s.city)).size).toBe(STATIONS.length);
  });

  it("carries a Radio Browser station UUID on every row", () => {
    for (const s of STATIONS) expect(s.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("plays HTTPS streams only", () => {
    for (const s of STATIONS) expect(new URL(s.url).protocol).toBe("https:");
  });

  it("has coordinates in range and is sorted by longitude", () => {
    for (const s of STATIONS) {
      expect(s.lat).toBeGreaterThanOrEqual(-90);
      expect(s.lat).toBeLessThanOrEqual(90);
      expect(s.lon).toBeGreaterThanOrEqual(-180);
      expect(s.lon).toBeLessThanOrEqual(180);
    }
    const lons = STATIONS.map((s) => s.lon);
    expect(lons).toEqual([...lons].sort((a, b) => a - b));
  });

  it("stores stable entry URLs: no session or tracking token in the query", () => {
    for (const s of STATIONS) {
      expect(s.url).not.toMatch(/[?&](tok|zt|sid|uid)=/i);
      for (const [, value] of new URL(s.url).searchParams) expect(value.length).toBeLessThanOrEqual(40);
    }
  });

  it("has at least 3 rock stations", () => {
    expect(STATIONS.filter((s) => s.rock).length).toBeGreaterThanOrEqual(3);
  });

  it("has names of at most 40 characters, trimmed", () => {
    for (const s of STATIONS) {
      expect([...s.name].length).toBeLessThanOrEqual(40);
      expect(s.name).toBe(s.name.trim());
      expect(s.name).not.toBe("");
    }
  });
});
