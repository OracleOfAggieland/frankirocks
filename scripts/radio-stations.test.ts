// The pure parts of the station snapshot script (brief 047). The network parts run by hand only.
import { describe, expect, it } from "vitest";
import {
  CITIES,
  CONTINENTS,
  MAX_STATIONS,
  NAME_MAX,
  checkStream,
  chooseRows,
  cleanName,
  distanceKm,
  entryUrls,
  hasTokenParam,
  isRock,
  tidyName,
  eastAsiaCity,
  eastAsiaCandidates,
  makeRoom,
  KEEP,
  MIN_ROCK_KEPT,
  isStreamType,
  renderFile,
  skipReason,
  urlsOf,
} from "./radio-stations.mjs";

const row = (patch: Record<string, unknown> = {}) => ({
  stationuuid: "00000000-0000-0000-0000-000000000001",
  name: "Radio One 101.1 FM",
  url_resolved: "https://stream.test/one.mp3",
  tags: "pop,hits",
  codec: "MP3",
  hls: 0,
  lastcheckok: 1,
  ssl_error: 0,
  geo_lat: 0,
  geo_long: 0,
  clickcount: 100,
  votes: 10,
  ...patch,
});

describe("the city list", () => {
  it("covers every continent with unique city names and coordinates in range", () => {
    expect(new Set(CITIES.map((c: { city: string }) => c.city)).size).toBe(CITIES.length);
    for (const c of CONTINENTS) expect(CITIES.some((x: { continent: string }) => x.continent === c)).toBe(true);
    for (const c of CITIES) {
      expect(Math.abs(c.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(c.lon)).toBeLessThanOrEqual(180);
    }
  });
});

describe("skipReason", () => {
  it("keeps an HTTPS MP3 or AAC music station", () => {
    expect(skipReason(row())).toBeNull();
    expect(skipReason(row({ codec: "AAC+" }))).toBeNull();
    expect(skipReason(row({ tags: "adult contemporary" }))).toBeNull();
  });

  it.each([
    [{ url_resolved: "http://stream.test/one.mp3" }, "not https"],
    [{ hls: 1 }, "hls"],
    [{ url_resolved: "https://stream.test/live.m3u8" }, "playlist url"],
    [{ codec: "OGG" }, "codec OGG"],
    [{ lastcheckok: 0 }, "last check failed"],
    [{ ssl_error: 1 }, "ssl error"],
    [{ tags: "news,talk" }, "word news"],
    [{ tags: "sports" }, "word sport"],
    [{ tags: "christian,worship" }, "word christian"],
    [{ name: "Quran Radio" }, "word quran"],
    [{ tags: "politics" }, "word politic"],
    [{ tags: "adult" }, "word adult"],
    [{ tags: "sleep,ambient" }, "word sleep"],
    [{ name: "Christmas Hits" }, "word christmas"],
    [{ name: "Radio because" }, "a banned cause word in the name"],
    [{ name: "Hits #abc" }, "a # in the name"],
  ])("%o -> %s", (patch, reason) => {
    expect(skipReason(row(patch))).toBe(reason);
  });
});

describe("tidyName", () => {
  it.each([
    ["CBC Music Eastern (Toronto) MP3 Stream", "CBC Music Eastern"],
    ["103.5 KISS FM - WKSC-FM Chicago", "103.5 KISS FM"],
    ["KEXP: The greatest radio station in the world", "KEXP"],
    ["ROCK EN ESPAÑOL: Rock de México, España", "Rock En Español"],
    ["Radio ROCKS Kyiv 103.6FM HD", "Radio ROCKS Kyiv 103.6FM"],
    ["FM4 | ORF | HQ", "FM4"],
    ["ORF Hitradio Ö3 | HQ", "ORF Hitradio Ö3"],
    ["Intense Radio - We love Dance 256K", "Intense Radio"],
    ["Radio One 320kbps AAC", "Radio One"],
    ["__80 EXITOS", "80 EXITOS"],
    ["#1 Hits", "1 Hits"],
    ["  PLANET   ROCK  ", "Planet Rock"],
    ["YleX", "YleX"],
    ["LOS40 Chile", "LOS40 Chile"],
    ["CAPITAL", "CAPITAL"],
    ["Z 92 (Miami) - 92.3 FM", "Z 92"],
    ["Radio Indigo 91.9 FM in Panaji/Bangalore", "Radio Indigo 91.9 FM"],
    ["Made in italy", "Made in italy"],
    ["X", "X"],
    ["--", "--"],
  ])("%s -> %s", (raw, want) => {
    expect(tidyName(raw)).toBe(want);
  });
});

describe("cleanName", () => {
  it("collapses whitespace and keeps short names", () => {
    expect(cleanName("  Radio   One ")).toBe("Radio One");
  });

  it(`cuts long names at a word, at most ${NAME_MAX} characters, with no dangling separator`, () => {
    const cut = cleanName("Capital The UK's No.1 Hit Music Station for London");
    expect([...cut].length).toBeLessThanOrEqual(NAME_MAX);
    expect(cut).toBe("Capital The UK's No.1 Hit Music Station");
    expect(cleanName("Radio Indigo 91.9 FM in panaji and the city of bangalore")).toBe("Radio Indigo 91.9 FM in panaji");
    // The tidy runs first: a separator cuts before the length does.
    expect(cleanName("KEXP: The greatest radio station in the world")).toBe("KEXP");
  });
});

describe("isRock and isStreamType", () => {
  it("is rock when a tag has the word rock", () => {
    expect(isRock(row({ tags: "classic rock" }))).toBe(true);
    expect(isRock(row({ tags: "rock,pop" }))).toBe(true);
    expect(isRock(row({ tags: "rockabilly" }))).toBe(false);
    expect(isRock(row({ tags: "pop" }))).toBe(false);
    expect(isRock(row({ tags: "classic rock; alternative rock indie" }))).toBe(true);
  });

  it("is not rock on a pop, soft or slow rock tag alone", () => {
    expect(isRock(row({ tags: "hawaii,love songs,rnb,slow rock" }))).toBe(false);
    expect(isRock(row({ tags: "latin pop,pop,Pop-Rock" }))).toBe(false);
    expect(isRock(row({ tags: "soft rock" }))).toBe(false);
    expect(isRock(row({ tags: "pop rock,rock,soft rock" }))).toBe(true);
    expect(isRock(row({ tags: "soft rock,hard rock" }))).toBe(true);
  });

  it("takes audio streams and refuses playlists", () => {
    expect(isStreamType("audio/mpeg")).toBe(true);
    expect(isStreamType("audio/aac; charset=x")).toBe(true);
    expect(isStreamType("audio/x-mpegurl")).toBe(false);
    expect(isStreamType("application/vnd.apple.mpegurl")).toBe(false);
    expect(isStreamType("text/html")).toBe(false);
    expect(isStreamType(null)).toBe(false);
  });
});

describe("entryUrls", () => {
  it("keeps a clean URL, dropping :443 and a bare ?", () => {
    expect(entryUrls("https://s.test:443/live.mp3?")).toEqual(["https://s.test/live.mp3"]);
    expect(entryUrls("https://s.test/live.mp3?type=.mp3")).toEqual(["https://s.test/live.mp3?type=.mp3", "https://s.test/live.mp3"]);
  });

  it("tries a tokened URL only without its query string", () => {
    expect(entryUrls("https://s.test/a?aw_0_1st.skey=123")).toEqual(["https://s.test/a"]);
    expect(entryUrls("https://s.test/a?zt=eyJ")).toEqual(["https://s.test/a"]);
    expect(entryUrls("https://s.test/a?rj-tok=x&rj-ttl=5")).toEqual(["https://s.test/a"]);
    expect(entryUrls("https://s.test/a?listening-from-radio-garden=1")).toEqual(["https://s.test/a"]);
    expect(entryUrls(`https://s.test/a?x=${"y".repeat(41)}`)).toEqual(["https://s.test/a"]);
    expect(hasTokenParam("https://s.test/a?sid=1")).toBe(true);
    expect(hasTokenParam("https://s.test/a?uid=1")).toBe(true);
    expect(hasTokenParam("https://s.test/a?type=mp3")).toBe(false);
    expect(entryUrls("http://s.test/a")).toEqual([]);
  });
});

describe("checkStream", () => {
  const answer = (status: number, headers: Record<string, string>) => ({
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    body: { cancel: async () => {} },
  });

  it("follows HTTPS redirects to an audio answer", async () => {
    const seen: string[] = [];
    const fake = async (url: string) => {
      seen.push(url);
      return url.endsWith("/a") ? answer(302, { location: "/b" }) : answer(200, { "content-type": "audio/mpeg" });
    };
    expect(await checkStream("https://s.test/a", fake)).toEqual({ ok: true, url: "https://s.test/b" });
    expect(seen).toEqual(["https://s.test/a", "https://s.test/b"]);
  });

  it("refuses a hop to HTTP, a playlist, and a bad status", async () => {
    expect((await checkStream("https://s.test/a", async () => answer(301, { location: "http://s.test/b" }))).ok).toBe(false);
    expect((await checkStream("https://s.test/a", async () => answer(200, { "content-type": "audio/x-mpegurl" }))).ok).toBe(false);
    expect((await checkStream("https://s.test/a", async () => answer(404, { "content-type": "audio/mpeg" }))).ok).toBe(false);
    expect((await checkStream("https://s.test/a", async () => answer(206, { "content-type": "audio/aac" }))).ok).toBe(true);
  });
});

describe("chooseRows", () => {
  const city = (name: string, continent: string, lat = 0) => ({ city: name, country: "Land", lat, lon: 0, continent });
  const found = (name: string, continent: string, id: string, rock: boolean, lat = 0) => {
    const r = row({ stationuuid: id, tags: rock ? "rock" : "pop" });
    return { city: city(name, continent, lat), best: r, rock: rock ? r : null, bestScore: 1, rockScore: 1 };
  };

  it("keeps one station per city and per id, at most the maximum, every continent present", () => {
    const all = CONTINENTS.flatMap((c: string) => Array.from({ length: 12 }, (_, i) => found(`${c}${i}`, c, `${c}-${i}`, i % 3 === 0)));
    const out = chooseRows(all);
    expect(out).toHaveLength(MAX_STATIONS);
    expect(new Set(out.map((o: { city: { city: string } }) => o.city.city)).size).toBe(MAX_STATIONS);
    for (const c of CONTINENTS) expect(out.some((o: { city: { continent: string } }) => o.city.continent === c)).toBe(true);
    const rock = out.filter((o: { row: unknown }) => isRock(o.row));
    expect(rock.length).toBeGreaterThanOrEqual(6);
    expect(new Set(rock.map((o: { city: { continent: string } }) => o.city.continent)).size).toBeGreaterThanOrEqual(3);
  });

  it("takes both polar edges first", () => {
    const all = [found("North", "EU", "n", false, 70), found("Mid", "EU", "m", false, 10), found("South", "SA", "s", false, -55)];
    expect(chooseRows(all, 2).map((o: { city: { city: string } }) => o.city.city)).toEqual(["North", "South"]);
  });
});

describe("renderFile and urlsOf", () => {
  it("writes rows sorted by longitude with the date, and reads the URLs back", () => {
    const s = (id: string, lon: number) => ({ id, name: `N "${id}"`, city: `C${id}`, country: "Land", lat: 1, lon, url: `https://s.test/${id}`, rock: false });
    const text = renderFile([s("b", 20), s("a", -20)], "2026-11-13");
    expect(text).toContain('date: "2026-11-13"');
    expect(text.indexOf('id: "a"')).toBeLessThan(text.indexOf('id: "b"'));
    expect(urlsOf(text)).toEqual([
      { name: 'N "a"', url: "https://s.test/a" },
      { name: 'N "b"', url: "https://s.test/b" },
    ]);
  });

  it("measures distance on the sphere", () => {
    expect(distanceKm(51.51, -0.13, 48.86, 2.35)).toBeGreaterThan(330);
    expect(distanceKm(51.51, -0.13, 48.86, 2.35)).toBeLessThan(350);
  });
});

describe("eastAsiaCity", () => {
  it("names a station with coordinates for the nearest city within 150 km, and none further", () => {
    expect(eastAsiaCity(row({ geo_lat: 35.6, geo_long: 139.7 }), "JP")?.city).toBe("Tokyo");
    expect(eastAsiaCity(row({ geo_lat: 34.7, geo_long: 135.4 }), "JP")?.city).toBe("Osaka");
    expect(eastAsiaCity(row({ geo_lat: 39.7, geo_long: 141.1 }), "JP")).toBeNull();
  });

  it("names a station without coordinates only by its name, state or tags", () => {
    const bare = { geo_lat: null, geo_long: null };
    expect(eastAsiaCity(row({ ...bare, name: "東京 FM" }), "JP")?.city).toBe("Tokyo");
    expect(eastAsiaCity(row({ ...bare, name: "K-Pop", state: "Seoul" }), "KR")?.city).toBe("Seoul");
    expect(eastAsiaCity(row({ ...bare, name: "Pop", tags: "taipei,pop" }), "TW")?.city).toBe("Taipei");
    expect(eastAsiaCity(row({ ...bare, name: "J-Pop Radio" }), "JP")).toBeNull();
  });

  it("gives any station of a city-state to its city", () => {
    expect(eastAsiaCity(row({ geo_lat: null, geo_long: null, name: "Pop" }), "SG")?.city).toBe("Singapore");
    expect(eastAsiaCity(row({ name: "Pop" }), "HK")?.city).toBe("Hong Kong");
  });

  it("keeps only rows the usual filters pass, music first", () => {
    const groups = eastAsiaCandidates([row({ geo_lat: 35.6, geo_long: 139.7 }), row({ geo_lat: 35.6, geo_long: 139.7, tags: "news" }), row({ geo_lat: 35.6, geo_long: 139.7, tags: "" })], "JP");
    expect(groups.map((g: { city: { city: string }; rows: unknown[] }) => [g.city.city, g.rows.length])).toEqual([["Tokyo", 1]]);
  });
});

describe("makeRoom", () => {
  const at = (name: string, continent: string, lat: number, lon: number, rock = false) => ({
    city: { city: name, country: "Land", lat, lon, continent },
    row: row({ stationuuid: name, tags: rock ? "rock" : "pop" }),
  });

  it("drops from the most crowded cluster, never an extra row or a polar edge", () => {
    const chosen = [at("North", "EU", 70, 19), at("South", "OC", -41, 175), at("A1", "OC", -34, 151), at("A2", "OC", -37, 145), at("A3", "OC", -35, 139), at("Lone", "AF", 0, 20)];
    const extra = [at("Tokyo", "AS", 35.7, 139.7)];
    const out = makeRoom(chosen, extra, 6).map((o: { city: { city: string } }) => o.city.city);
    expect(out).toHaveLength(6);
    expect(out).toEqual(expect.arrayContaining(["North", "South", "Tokyo", "Lone"]));
    expect(out.filter((c: string) => c.startsWith("A"))).toHaveLength(2);
  });

  it(`keeps at least ${MIN_ROCK_KEPT} rock rows and each continent at its count minus two`, () => {
    const rocks = Array.from({ length: MIN_ROCK_KEPT }, (_, i) => at(`R${i}`, "EU", 50, i, true));
    const chosen = [at("Top", "EU", 60, 0, true), ...rocks.slice(1), at("N", "EU", 50, 20), at("S", "SA", -40, -60)];
    const out = makeRoom(chosen, [at("T", "AS", 35, 139)], chosen.length).map((o: { city: { city: string } }) => o.city.city);
    expect(out).not.toContain("N");
    expect(out.filter((c: string) => c === "Top" || c.startsWith("R"))).toHaveLength(MIN_ROCK_KEPT);
  });
});

describe("KEEP", () => {
  it("every KEEP city with a passing candidate is chosen and survives the room-making", () => {
    const cityOf = (name: string) => CITIES.find((c: { city: string }) => c.city === name) ?? { city: name, country: "Land", lat: 35.7, lon: 139.7, continent: "AS" };
    const found = (name: string, i: number, rock: boolean) => {
      const r = row({ stationuuid: `id-${i}`, tags: rock ? "rock" : "pop", clickcount: 1 });
      return { city: cityOf(name), best: r, rock: rock ? r : null, bestScore: 0, rockScore: 0 };
    };
    // Every city of the list passes, the KEEP cities with the lowest scores, so nothing but KEEP saves them.
    const all = CITIES.map((c: { city: string }, i: number) => {
      const f = found(c.city, i, i % 4 === 0);
      if (!KEEP.includes(c.city)) {
        f.bestScore = 10;
        f.rockScore = 10;
      }
      return f;
    });
    const base = chooseRows(all);
    const extra = ["Osaka", "Kaohsiung", "Cebu", "Hanoi"].map((n, i) => ({ city: { city: n, country: "Land", lat: 20 + i, lon: 120 + i, continent: "AS" }, row: row({ stationuuid: `x-${i}` }) }));
    const out = makeRoom(base, extra).map((o: { city: { city: string } }) => o.city.city);
    expect(out.length).toBeLessThanOrEqual(MAX_STATIONS);
    for (const name of KEEP) if (CITIES.some((c: { city: string }) => c.city === name)) expect(out).toContain(name);
  });
});
