// The radio's station snapshot (brief 047, part A). Run by hand, never in a build or a test:
//   node scripts/radio-stations.mjs --date 2026-11-13   picks the stations and writes apps/web/src/ui/radio/stations.ts
//   node scripts/radio-stations.mjs --check             re-tests the streams of the file as it stands; writes nothing
// Stations come from Radio Browser (https://www.radio-browser.info), a community list in the public domain. The app
// never calls that API: it plays only the stream the owner tuned to. The date comes from the argument, not the clock.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findBannedCauseWords } from "./copy-check.mjs";

export const API = "https://de1.api.radio-browser.info";
export const USER_AGENT = "radio-globe-snapshot/1.0";
export const SOURCE = "Radio Browser (radio-browser.info), public domain";
export const OUT_FILE = "apps/web/src/ui/radio/stations.ts";
export const MAX_STATIONS = 70;
export const RADIUS_KM = 80;
export const STREAM_TIMEOUT_MS = 8_000;
export const NAME_MAX = 40;
export const MIN_ROCK = 6;
export const MIN_ROCK_CONTINENTS = 3;
const MAX_REDIRECTS = 5;
const CANDIDATES_TRIED = 6;
const CONCURRENCY = 8;

/** [city, country, lat, lon, continent]. Every continent with a station; both polar edges where one exists. */
export const CITIES = [
  // North America
  ["Anchorage", "United States", 61.22, -149.9, "NA"],
  ["Honolulu", "United States", 21.31, -157.86, "OC"],
  ["Vancouver", "Canada", 49.28, -123.12, "NA"],
  ["Seattle", "United States", 47.61, -122.33, "NA"],
  ["San Francisco", "United States", 37.77, -122.42, "NA"],
  ["Los Angeles", "United States", 34.05, -118.24, "NA"],
  ["Denver", "United States", 39.74, -104.99, "NA"],
  ["Mexico City", "Mexico", 19.43, -99.13, "NA"],
  ["Dallas", "United States", 32.78, -96.8, "NA"],
  ["Chicago", "United States", 41.88, -87.63, "NA"],
  ["Nashville", "United States", 36.16, -86.78, "NA"],
  ["Atlanta", "United States", 33.75, -84.39, "NA"],
  ["Miami", "United States", 25.76, -80.19, "NA"],
  ["Toronto", "Canada", 43.65, -79.38, "NA"],
  ["Montreal", "Canada", 45.5, -73.57, "NA"],
  ["New York", "United States", 40.71, -74.01, "NA"],
  ["Havana", "Cuba", 23.11, -82.37, "NA"],
  ["Kingston", "Jamaica", 18.0, -76.79, "NA"],
  ["San Juan", "Puerto Rico", 18.47, -66.11, "NA"],
  ["Guatemala City", "Guatemala", 14.63, -90.51, "NA"],
  ["San José", "Costa Rica", 9.93, -84.08, "NA"],
  ["Panama City", "Panama", 8.98, -79.52, "NA"],
  ["Nuuk", "Greenland", 64.18, -51.72, "NA"],
  // South America
  ["Bogotá", "Colombia", 4.71, -74.07, "SA"],
  ["Caracas", "Venezuela", 10.48, -66.9, "SA"],
  ["Quito", "Ecuador", -0.18, -78.47, "SA"],
  ["Lima", "Peru", -12.05, -77.04, "SA"],
  ["La Paz", "Bolivia", -16.5, -68.15, "SA"],
  ["Santiago", "Chile", -33.45, -70.67, "SA"],
  ["Buenos Aires", "Argentina", -34.6, -58.38, "SA"],
  ["Córdoba", "Argentina", -31.42, -64.18, "SA"],
  ["Montevideo", "Uruguay", -34.9, -56.16, "SA"],
  ["São Paulo", "Brazil", -23.55, -46.63, "SA"],
  ["Rio de Janeiro", "Brazil", -22.91, -43.17, "SA"],
  ["Brasília", "Brazil", -15.79, -47.88, "SA"],
  ["Salvador", "Brazil", -12.97, -38.5, "SA"],
  ["Manaus", "Brazil", -3.12, -60.02, "SA"],
  ["Punta Arenas", "Chile", -53.16, -70.91, "SA"],
  ["Ushuaia", "Argentina", -54.8, -68.3, "SA"],
  // Europe
  ["Reykjavik", "Iceland", 64.15, -21.94, "EU"],
  ["Dublin", "Ireland", 53.35, -6.26, "EU"],
  ["London", "United Kingdom", 51.51, -0.13, "EU"],
  ["Glasgow", "United Kingdom", 55.86, -4.25, "EU"],
  ["Lisbon", "Portugal", 38.72, -9.14, "EU"],
  ["Madrid", "Spain", 40.42, -3.7, "EU"],
  ["Barcelona", "Spain", 41.39, 2.17, "EU"],
  ["Paris", "France", 48.86, 2.35, "EU"],
  ["Amsterdam", "Netherlands", 52.37, 4.9, "EU"],
  ["Berlin", "Germany", 52.52, 13.4, "EU"],
  ["Munich", "Germany", 48.14, 11.58, "EU"],
  ["Zurich", "Switzerland", 47.37, 8.54, "EU"],
  ["Vienna", "Austria", 48.21, 16.37, "EU"],
  ["Prague", "Czechia", 50.08, 14.44, "EU"],
  ["Warsaw", "Poland", 52.23, 21.01, "EU"],
  ["Rome", "Italy", 41.9, 12.5, "EU"],
  ["Milan", "Italy", 45.46, 9.19, "EU"],
  ["Athens", "Greece", 37.98, 23.73, "EU"],
  ["Budapest", "Hungary", 47.5, 19.04, "EU"],
  ["Bucharest", "Romania", 44.43, 26.1, "EU"],
  ["Stockholm", "Sweden", 59.33, 18.07, "EU"],
  ["Oslo", "Norway", 59.91, 10.75, "EU"],
  ["Copenhagen", "Denmark", 55.68, 12.57, "EU"],
  ["Helsinki", "Finland", 60.17, 24.94, "EU"],
  ["Tromsø", "Norway", 69.65, 18.96, "EU"],
  ["Kyiv", "Ukraine", 50.45, 30.52, "EU"],
  ["Moscow", "Russia", 55.76, 37.62, "EU"],
  ["Murmansk", "Russia", 68.97, 33.08, "EU"],
  ["Istanbul", "Türkiye", 41.01, 28.98, "EU"],
  // Africa
  ["Cairo", "Egypt", 30.04, 31.24, "AF"],
  ["Casablanca", "Morocco", 33.57, -7.59, "AF"],
  ["Tunis", "Tunisia", 36.81, 10.18, "AF"],
  ["Dakar", "Senegal", 14.72, -17.47, "AF"],
  ["Accra", "Ghana", 5.6, -0.19, "AF"],
  ["Lagos", "Nigeria", 6.52, 3.38, "AF"],
  ["Abidjan", "Côte d’Ivoire", 5.36, -4.01, "AF"],
  ["Nairobi", "Kenya", -1.29, 36.82, "AF"],
  ["Addis Ababa", "Ethiopia", 9.03, 38.74, "AF"],
  ["Kampala", "Uganda", 0.35, 32.58, "AF"],
  ["Dar es Salaam", "Tanzania", -6.79, 39.21, "AF"],
  ["Kinshasa", "DR Congo", -4.44, 15.27, "AF"],
  ["Johannesburg", "South Africa", -26.2, 28.05, "AF"],
  ["Cape Town", "South Africa", -33.92, 18.42, "AF"],
  ["Durban", "South Africa", -29.86, 31.02, "AF"],
  ["Antananarivo", "Madagascar", -18.88, 47.51, "AF"],
  ["Port Louis", "Mauritius", -20.16, 57.5, "AF"],
  // Asia
  ["Dubai", "United Arab Emirates", 25.2, 55.27, "AS"],
  ["Tehran", "Iran", 35.69, 51.39, "AS"],
  ["Beirut", "Lebanon", 33.89, 35.5, "AS"],
  ["Karachi", "Pakistan", 24.86, 67.01, "AS"],
  ["Mumbai", "India", 19.08, 72.88, "AS"],
  ["Delhi", "India", 28.61, 77.21, "AS"],
  ["Bengaluru", "India", 12.97, 77.59, "AS"],
  ["Dhaka", "Bangladesh", 23.81, 90.41, "AS"],
  ["Almaty", "Kazakhstan", 43.24, 76.89, "AS"],
  ["Bangkok", "Thailand", 13.76, 100.5, "AS"],
  ["Kuala Lumpur", "Malaysia", 3.14, 101.69, "AS"],
  ["Singapore", "Singapore", 1.35, 103.82, "AS"],
  ["Jakarta", "Indonesia", -6.21, 106.85, "AS"],
  ["Ho Chi Minh City", "Vietnam", 10.82, 106.63, "AS"],
  ["Manila", "Philippines", 14.6, 120.98, "AS"],
  ["Hong Kong", "China", 22.32, 114.17, "AS"],
  ["Taipei", "Taiwan", 25.03, 121.57, "AS"],
  ["Shanghai", "China", 31.23, 121.47, "AS"],
  ["Beijing", "China", 39.9, 116.41, "AS"],
  ["Ulaanbaatar", "Mongolia", 47.89, 106.91, "AS"],
  ["Seoul", "South Korea", 37.57, 126.98, "AS"],
  ["Tokyo", "Japan", 35.68, 139.69, "AS"],
  ["Sapporo", "Japan", 43.06, 141.35, "AS"],
  ["Vladivostok", "Russia", 43.12, 131.89, "AS"],
  ["Novosibirsk", "Russia", 55.01, 82.93, "AS"],
  ["Yakutsk", "Russia", 62.03, 129.73, "AS"],
  // Oceania
  ["Perth", "Australia", -31.95, 115.86, "OC"],
  ["Adelaide", "Australia", -34.93, 138.6, "OC"],
  ["Melbourne", "Australia", -37.81, 144.96, "OC"],
  ["Sydney", "Australia", -33.87, 151.21, "OC"],
  ["Brisbane", "Australia", -27.47, 153.03, "OC"],
  ["Darwin", "Australia", -12.46, 130.84, "OC"],
  ["Hobart", "Australia", -42.88, 147.33, "OC"],
  ["Auckland", "New Zealand", -36.85, 174.76, "OC"],
  ["Wellington", "New Zealand", -41.29, 174.78, "OC"],
  ["Suva", "Fiji", -18.14, 178.44, "OC"],
  ["Port Moresby", "Papua New Guinea", -9.44, 147.18, "OC"],
  ["Papeete", "French Polynesia", -17.54, -149.57, "OC"],
].map(([city, country, lat, lon, continent]) => ({ city, country, lat, lon, continent }));

export const CONTINENTS = ["NA", "SA", "EU", "AF", "AS", "OC"];

// ---------------------------------------------------------------------------------------------
// Pure picking

/** Great-circle distance in km. */
export function distanceKm(aLat, aLon, bLat, bLon) {
  const r = Math.PI / 180;
  const dLat = (bLat - aLat) * r;
  const dLon = (bLon - aLon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const words = (s) => ` ${String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}/+&]+/gu, " ")} `;

/** A word or the start of one, matched in the tags and the name. */
const SKIP_WORDS = [
  "news", "noticias", "nachrichten", "info", "talk", "talkradio", "sport", "sports", "deportes", "football", "futbol",
  "religion", "religious", "christian", "gospel", "islam", "islamic", "quran", "coran", "catholic", "catolica", "católica",
  "bible", "church", "iglesia", "buddhis", "worship", "praise", "sermon", "evangel", "politic", "sleep", "nature",
  "christmas", "xmas", "weihnacht", "navidad", "noel", "meditation", "asmr", "supreme master", "reading radio",
  "sensual", "sexy", "erotic",
];
/** Stations left out by hand after reading the list, each with its reason. */
export const DENY = new Map([
  ["89a65395-9af4-4c9d-9300-d765029785e8", "no tags, and its content could not be confirmed as music"],
  ["c6f6b3d8-c63d-40db-a1be-f1ca31095117", "listed with a radio-garden tracking parameter, and its bare URL times out now and then"],
  ["51232ec5-c0e7-4741-a86d-a5881c04879f", "a talk station (講台Talkonly, tagged podcasts and technology): the word check misses talk glued to Chinese"],
]);
/** "adult" is skipped, except where it names a music format. */
const ADULT_FORMATS = [" adult contemporary ", " adult hits ", " adult album alternative ", " adult alternative "];
/** Words of generic loop channels: kept only when nothing local is near. */
const LOOP_WORDS = [" 24/7 ", " 24 7 ", " lofi ", " lo fi ", " loop ", " nonstop ", " non stop "];
const MUSIC_WORDS = [
  "music", "pop", "rock", "jazz", "hits", "dance", "electronic", "indie", "alternative", "classical", "blues", "soul",
  "funk", "reggae", "latin", "salsa", "hip hop", "hiphop", "rnb", "r&b", "country", "folk", "top 40", "80s", "90s",
  "70s", "oldies", "chill", "lounge", "metal", "punk", "house", "techno", "afrobeat", "kpop", "k pop", "jpop", "j pop",
  "bossa", "samba", "tango", "world", "contemporary", "mpb", "sertanejo", "cumbia", "bollywood", "highlife", "classic",
];

/** Why a row is skipped by rulings 4 and 5, or null when it may be kept. */
export function skipReason(row) {
  if (DENY.has(String(row.stationuuid))) return `denied: ${DENY.get(String(row.stationuuid))}`;
  const url = String(row.url_resolved ?? "");
  if (!url.startsWith("https://")) return "not https";
  if (Number(row.hls) === 1) return "hls";
  if (/\.(m3u8?|pls|asx|xspf)(\?|$)/i.test(url)) return "playlist url";
  const codec = String(row.codec ?? "").toUpperCase();
  if (codec !== "MP3" && codec !== "AAC" && codec !== "AAC+") return `codec ${codec || "unknown"}`;
  if (Number(row.lastcheckok) !== 1) return "last check failed";
  if (Number(row.ssl_error) !== 0) return "ssl error";
  const text = words(`${row.name} ${row.tags}`);
  for (const w of SKIP_WORDS) if (text.includes(` ${w}`)) return `word ${w}`;
  if (text.includes(" adult") && !ADULT_FORMATS.some((f) => text.includes(f))) return "word adult";
  const name = cleanName(row.name);
  if (name === "") return "no name";
  if (findBannedCauseWords(name).length > 0) return "a banned cause word in the name";
  if (name.includes("#")) return "a # in the name";
  return null;
}

const NAME_CUTS = [" - ", " | ", " – ", ": ", " ("];
const TRAILING_FORMAT = /\s+(mp3|aac\+?|hd|hq|stream|\d+\s?k(bps)?)$/iu;
const EDGE_PUNCTUATION = /^[\s\p{P}|]+|[\s\p{P}|]+$/gu;

/**
 * The station's name as a light on the globe shows it: the listing's noise taken off. Collapses whitespace, drops a
 * leading "#" or "__" and edge punctuation, cuts at the first separator that leaves at least 3 characters, drops
 * trailing format words (MP3, AAC, HD, HQ, Stream, a bitrate), and puts an all-caps name of more than 8 letters in
 * title case. A result under 2 characters falls back to the collapsed raw name.
 */
export function tidyName(raw) {
  const collapsed = String(raw ?? "").replace(/\s+/g, " ").trim();
  let s = collapsed.replace(/^(#|__)+/u, "").replace(EDGE_PUNCTUATION, "");
  let cut = -1;
  for (const sep of NAME_CUTS) {
    for (let at = s.indexOf(sep); at >= 0; at = s.indexOf(sep, at + 1)) {
      if (s.slice(0, at).trim().length >= 3) {
        if (cut < 0 || at < cut) cut = at;
        break;
      }
    }
  }
  // " in " before a capitalised word names a place: "Radio Indigo 91.9 FM in Panaji".
  for (const m of s.matchAll(/\sin\s(?=\p{Lu})/gu)) {
    if (s.slice(0, m.index).trim().length >= 3) {
      if (cut < 0 || m.index < cut) cut = m.index;
      break;
    }
  }
  if (cut >= 0) s = s.slice(0, cut);
  let prev;
  do {
    prev = s;
    s = s.replace(EDGE_PUNCTUATION, "").replace(TRAILING_FORMAT, "").trim();
  } while (s !== prev);
  const letters = s.match(/\p{L}/gu) ?? [];
  if (letters.length > 8 && !/\p{Ll}/u.test(s)) {
    s = s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, sp, c) => sp + c.toUpperCase());
  }
  return [...s].length < 2 ? collapsed : s;
}

/** The name as it is shown: tidied (tidyName), then trimmed to NAME_MAX characters. */
export function cleanName(name) {
  const s = tidyName(name);
  const chars = [...s];
  if (chars.length <= NAME_MAX) return s;
  // Cut at the last whole word that fits, then drop a dangling separator.
  let cut = chars.slice(0, NAME_MAX + 1).join("");
  const space = cut.lastIndexOf(" ");
  cut = space >= NAME_MAX / 2 ? cut.slice(0, space) : chars.slice(0, NAME_MAX).join("");
  let prev;
  do {
    prev = cut;
    cut = cut.replace(/[\s\-–—|:,.(/]+$/u, "").replace(/\s(the|of|in|and|from|for|a|de|la|el|du|der|die)$/iu, "").trim();
  } while (cut !== prev);
  return cut;
}

/** Tags with the word rock that don't make a station a rock station: "Franki, you rock" should land on guitars. */
export const SOFT_ROCK_TAGS = ["pop rock", "soft rock", "slow rock"];
/** Rock by its tags: one tag has the word rock and is not one of SOFT_ROCK_TAGS. */
export const isRock = (row) =>
  String(row.tags ?? "")
    .toLowerCase()
    .split(/[,;]/)
    .map((tag) => tag.replace(/[-_\s]+/g, " ").trim())
    .some((tag) => /(^|[^\p{L}])rock([^\p{L}]|$)/u.test(tag) && !SOFT_ROCK_TAGS.includes(tag));
export const isMusic = (row) => {
  const t = words(row.tags);
  return MUSIC_WORDS.some((w) => t.includes(` ${w}`));
};

/** Public and long-standing broadcasters, by the start of the name. */
const PUBLIC_BROADCASTERS =
  /^(CBC|BBC|ORF|NRK|Yle|DR |Danmarks Radio|SR |Sveriges Radio|RTÉ|RTE|FIP|France Inter|ABC|SBS|NPO|RNE|Radio Nacional|RTP|Antena|SRF|RAI|Rai|Radio Jamaica|RÚV|Rás|Bayern|WDR|NDR|SWR|MDR|Deutschlandfunk|NHK|KBS|RTHK|Triple J|Triple M)/;

/** True when the name looks like a local broadcaster: a frequency, a call sign, a public broadcaster or the city. */
export function looksLocal(row, city) {
  const name = String(row.name ?? "");
  return (
    /\b\d{2,3}([.,\s]\d)?\s?(fm|mhz)\b|\bfm\s?\d{2,3}\b/i.test(name) ||
    /\b[CKW][A-Z]{2,3}(-FM)?\b/.test(name) ||
    PUBLIC_BROADCASTERS.test(name) ||
    words(`${row.name} ${row.tags}`).includes(` ${city.city.toLowerCase()} `)
  );
}

/** Higher is better: clicks and votes on a log scale, music first, local broadcasters over loops when close. */
export function score(row, city) {
  const clicks = Math.log10(1 + Math.max(0, Number(row.clickcount) || 0));
  const votes = Math.log10(1 + Math.max(0, Number(row.votes) || 0));
  const name = String(row.name ?? "");
  const text = words(`${row.name} ${row.tags}`);
  const local = looksLocal(row, city);
  const loop = LOOP_WORDS.some((w) => text.includes(w)) || /100\s?%/.test(name);
  // Web loop channels tend to shout their name: "SENSUAL LOUNGE RADIO".
  const shouting = !local && /[A-Z]{3,}/.test(name) && !/[a-z]/.test(name) && name.includes(" ");
  return clicks + 0.5 * votes + (isMusic(row) ? 2 : 0) + (local ? 1.5 : 0) - (loop ? 2 : 0) - (shouting ? 1 : 0);
}

/** The rows within RADIUS_KM of `city` that rulings 4 and 5 keep, best first. */
export function candidatesFor(city, rows) {
  return rows
    .filter((r) => r.geo_lat != null && r.geo_long != null)
    .filter((r) => distanceKm(city.lat, city.lon, Number(r.geo_lat), Number(r.geo_long)) <= RADIUS_KM)
    .filter((r) => skipReason(r) === null)
    .map((r) => ({ row: r, score: score(r, city) }))
    .sort((a, b) => b.score - a.score || String(a.row.stationuuid).localeCompare(String(b.row.stationuuid)))
    .map((x) => x.row);
}

/** Cities that are always chosen and never dropped to make room, whenever they have a passing station. */
export const KEEP = [
  "New York", "Chicago", "Mexico City", "Bogotá", "São Paulo", "Buenos Aires", "Honolulu", "London", "Paris", "Berlin",
  "Athens", "Kyiv", "Tromsø", "Cairo", "Dakar", "Nairobi", "Johannesburg", "Delhi", "Bengaluru", "Bangkok", "Jakarta",
  "Tokyo", "Seoul", "Hong Kong", "Shanghai", "Singapore", "Manila", "Sydney", "Melbourne", "Auckland", "Wellington",
];

const out0 = (chosen, extra) => [...chosen, ...extra];

/**
 * Chooses at most MAX_STATIONS cities. `found` holds, per city, its best working station and its best working rock
 * station (either may be null). Rock first, round-robin over continents until MIN_ROCK across MIN_ROCK_CONTINENTS;
 * then every continent in turn, best station first, so no continent is empty.
 */
export function chooseRows(found, max = MAX_STATIONS) {
  const usable = found.filter((f) => f.best !== null || f.rock !== null);
  const usedIds = new Set();
  const usedCities = new Set();
  const out = [];
  const take = (f, row) => {
    if (out.length >= max || usedCities.has(f.city.city) || usedIds.has(row.stationuuid)) return false;
    usedCities.add(f.city.city);
    usedIds.add(row.stationuuid);
    out.push({ city: f.city, row });
    return true;
  };
  const byContinent = (list) => CONTINENTS.map((c) => list.filter((f) => f.city.continent === c));
  // Both polar edges: the northernmost and the southernmost city with a station.
  const byLat = [...usable].sort((a, b) => a.city.lat - b.city.lat);
  for (const f of [byLat.at(-1), byLat[0]]) if (f !== undefined) take(f, f.best ?? f.rock);
  // The cities on KEEP, whenever they have a passing station.
  for (const name of KEEP) {
    const f = usable.find((x) => x.city.city === name);
    if (f !== undefined) take(f, f.best ?? f.rock);
  }
  // Rock: the best rock row of each continent in turn, until the minimum is met on enough continents.
  const rockQueues = byContinent(usable.filter((f) => f.rock !== null).sort((a, b) => b.rockScore - a.rockScore));
  const rockGoal = () => out.filter((o) => isRock(o.row)).length >= MIN_ROCK + 2 && new Set(out.filter((o) => isRock(o.row)).map((o) => o.city.continent)).size >= MIN_ROCK_CONTINENTS;
  while (!rockGoal() && rockQueues.some((q) => q.length > 0)) {
    for (const q of rockQueues) {
      const f = q.shift();
      if (f !== undefined) take(f, f.rock);
      if (rockGoal()) break;
    }
  }
  // Everyone else: one per continent per round, best first.
  const queues = byContinent(usable.filter((f) => f.best !== null).sort((a, b) => b.bestScore - a.bestScore));
  while (out.length < max && queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      const f = q.shift();
      if (f !== undefined) take(f, f.best);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// East Asia: a second way in, by country, used only for a country the 80 km search left dark

/** How far a station with coordinates may be from a city of EAST_ASIA_CITIES and still be named for it. */
export const EAST_ASIA_RADIUS_KM = 150;
export const EAST_ASIA_MAX = 8;
export const EAST_ASIA_PER_COUNTRY = 2;
/** City-states: any passing station of the country code is the city's. */
const CITY_STATES = new Set(["HK", "SG"]);

/** [code, city, country, lat, lon, spellings]: the cities a station found by country may be named for. */
export const EAST_ASIA_CITIES = [
  ["JP", "Tokyo", "Japan", 35.68, 139.69, ["tokyo", "東京"]],
  ["JP", "Osaka", "Japan", 34.69, 135.5, ["osaka", "大阪"]],
  ["JP", "Nagoya", "Japan", 35.18, 136.91, ["nagoya", "名古屋"]],
  ["JP", "Sapporo", "Japan", 43.06, 141.35, ["sapporo", "札幌"]],
  ["JP", "Fukuoka", "Japan", 33.59, 130.4, ["fukuoka", "福岡"]],
  ["KR", "Seoul", "South Korea", 37.57, 126.98, ["seoul", "서울"]],
  ["KR", "Busan", "South Korea", 35.18, 129.08, ["busan", "pusan", "부산"]],
  ["TW", "Taipei", "Taiwan", 25.03, 121.57, ["taipei", "台北", "臺北"]],
  ["TW", "Kaohsiung", "Taiwan", 22.63, 120.3, ["kaohsiung", "高雄"]],
  ["HK", "Hong Kong", "China", 22.32, 114.17, ["hong kong", "hongkong", "香港"]],
  ["PH", "Manila", "Philippines", 14.6, 120.98, ["manila", "maynila"]],
  ["PH", "Cebu", "Philippines", 10.32, 123.89, ["cebu"]],
  ["PH", "Davao", "Philippines", 7.19, 125.46, ["davao"]],
  ["SG", "Singapore", "Singapore", 1.35, 103.82, ["singapore"]],
  ["VN", "Hanoi", "Vietnam", 21.03, 105.85, ["hanoi", "ha noi", "hà nội"]],
  ["VN", "Ho Chi Minh City", "Vietnam", 10.82, 106.63, ["ho chi minh", "saigon", "sài gòn", "hcmc"]],
  ["CN", "Shanghai", "China", 31.23, 121.47, ["shanghai", "上海"]],
  ["CN", "Beijing", "China", 39.9, 116.41, ["beijing", "peking", "北京"]],
  ["CN", "Guangzhou", "China", 23.13, 113.26, ["guangzhou", "canton", "广州", "廣州"]],
  ["CN", "Chengdu", "China", 30.57, 104.07, ["chengdu", "成都"]],
].map(([code, city, country, lat, lon, spellings]) => ({ code, city, country, lat, lon, continent: "AS", spellings }));

/** Within a country the first-listed city that passes wins: Tokyo before Osaka. */
const eastAsiaRank = (city) => {
  const i = EAST_ASIA_CITIES.findIndex((c) => c.city === city.city);
  return i < 0 ? EAST_ASIA_CITIES.length : i;
};
const byListOrder = (a, b) => eastAsiaRank(a.city) - eastAsiaRank(b.city);

export const EAST_ASIA_CODES = [...new Set(EAST_ASIA_CITIES.map((c) => c.code))];

/**
 * The city a station found by country is named for, or null. With coordinates: the nearest city of its country
 * within EAST_ASIA_RADIUS_KM. Without: a city its name, `state` or tags name. A city-state takes any station.
 */
export function eastAsiaCity(row, code) {
  const cities = EAST_ASIA_CITIES.filter((c) => c.code === code);
  if (cities.length === 0) return null;
  if (CITY_STATES.has(code)) return cities[0];
  const lat = row.geo_lat == null ? NaN : Number(row.geo_lat);
  const lon = row.geo_long == null ? NaN : Number(row.geo_long);
  if (Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0)) {
    const near = cities
      .map((c) => ({ c, d: distanceKm(lat, lon, c.lat, c.lon) }))
      .filter((x) => x.d <= EAST_ASIA_RADIUS_KM)
      .sort((a, b) => a.d - b.d)[0];
    return near?.c ?? null;
  }
  const text = `${row.name ?? ""} ${row.state ?? ""} ${row.tags ?? ""}`.toLowerCase();
  return cities.find((c) => c.spellings.some((s) => text.includes(s))) ?? null;
}

/** The rows of one country's list that may be used, grouped by the city they are named for, best first. */
export function eastAsiaCandidates(rows, code) {
  const byCity = new Map();
  for (const row of rows) {
    if (skipReason(row) !== null || !isMusic(row)) continue;
    const city = eastAsiaCity(row, code);
    if (city === null) continue;
    if (!byCity.has(city.city)) byCity.set(city.city, { city, rows: [] });
    byCity.get(city.city).rows.push(row);
  }
  for (const g of byCity.values()) g.rows.sort((a, b) => score(b, g.city) - score(a, g.city));
  return [...byCity.values()];
}

/** How many other rows sit within this many km: the measure of a crowded cluster. */
export const CROWD_KM = 2_000;
export const MIN_ROCK_KEPT = 10;

/**
 * Adds `extra` to `chosen` and drops rows until at most `max` remain: always the row with the most neighbours within
 * CROWD_KM (then the lower score), never an extra row, a KEEP city, a polar edge, a rock row that would leave fewer than
 * MIN_ROCK_KEPT, or a row that would leave its continent with fewer than its count in `chosen` minus two.
 */
export function makeRoom(chosen, extra, max = MAX_STATIONS) {
  const count = (list, c) => list.filter((o) => o.city.continent === c).length;
  const floor = new Map(CONTINENTS.map((c) => [c, count(chosen, c) - 2]));
  const byLat = [...chosen].sort((a, b) => a.city.lat - b.city.lat);
  const keep = new Set([byLat[0], byLat.at(-1), ...extra, ...out0(chosen, extra).filter((o) => KEEP.includes(o.city.city))]);
  const out = [...chosen, ...extra];
  while (out.length > max) {
    const rock = out.filter((o) => isRock(o.row)).length;
    const droppable = out.filter(
      (o) => !keep.has(o) && count(out, o.city.continent) - 1 >= floor.get(o.city.continent) && !(isRock(o.row) && rock <= MIN_ROCK_KEPT),
    );
    if (droppable.length === 0) break;
    const crowd = (o) => out.filter((x) => x !== o && distanceKm(o.city.lat, o.city.lon, x.city.lat, x.city.lon) <= CROWD_KM).length;
    droppable.sort((a, b) => crowd(b) - crowd(a) || score(a.row, a.city) - score(b.row, b.city));
    out.splice(out.indexOf(droppable[0]), 1);
  }
  return out.slice(0, max);
}

/** One Station row as the app holds it. */
export function toStation({ city, row }) {
  return {
    id: String(row.stationuuid),
    name: cleanName(row.name),
    city: city.city,
    country: city.country,
    lat: city.lat,
    lon: city.lon,
    url: String(row.url_resolved),
    rock: isRock(row),
  };
}

/** The generated file's text. */
export function renderFile(stations, date) {
  const sorted = [...stations].sort((a, b) => a.lon - b.lon || a.id.localeCompare(b.id));
  const lines = sorted.map(
    (s) =>
      `  { id: ${JSON.stringify(s.id)}, name: ${JSON.stringify(s.name)}, city: ${JSON.stringify(s.city)}, country: ${JSON.stringify(s.country)}, lat: ${s.lat}, lon: ${s.lon}, url: ${JSON.stringify(s.url)}, rock: ${s.rock} },`,
  );
  return [
    "// Generated by scripts/radio-stations.mjs. Do not edit by hand: run the script again.",
    "// One station per city, from Radio Browser (radio-browser.info, public domain); each id is its station UUID.",
    "// Pure: no imports but the type.",
    'import type { Station } from "./types";',
    "",
    `export const STATIONS_SNAPSHOT = { source: ${JSON.stringify(SOURCE)}, date: ${JSON.stringify(date)} } as const;`,
    "",
    "/** Sorted by longitude, west to east. */",
    "export const STATIONS: readonly Station[] = [",
    ...lines,
    "];",
    "",
  ].join("\n");
}

/** Query parameter names that look like a session or tracking token. */
const TOKEN_PARAM = /tok|token|zt|sid|uid|session|skey|playerid|listening-from/i;
export const TOKEN_VALUE_MAX = 40;

/** The URL with an explicit :443 and a trailing bare "?" dropped, or null when it does not parse. */
export function tidyUrl(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return null;
  }
  if (u.port === "443") u.port = "";
  return u.href.replace(/\?$/, "");
}

/** True when a query parameter looks like a per-listener token: by its name, or a value over TOKEN_VALUE_MAX characters. */
export function hasTokenParam(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return true;
  }
  for (const [name, value] of u.searchParams) if (TOKEN_PARAM.test(name) || value.length > TOKEN_VALUE_MAX) return true;
  return false;
}

/** The URLs worth checking for a listed URL, in order: as listed (unless it carries a token), then without its query string. */
export function entryUrls(url) {
  const tidy = tidyUrl(url);
  if (tidy === null) return [];
  const u = new URL(tidy);
  const out = [];
  if (!hasTokenParam(tidy)) out.push(tidy);
  if (u.search !== "") {
    u.search = "";
    const bare = tidyUrl(u.href);
    if (bare !== null && !out.includes(bare)) out.push(bare);
  }
  return out.filter((x) => x.startsWith("https://"));
}

const PLAYLIST_TYPES =["audio/x-mpegurl", "audio/mpegurl", "application/vnd.apple.mpegurl", "audio/x-scpls", "application/pls+xml"];

/** True when the content type is a playable audio stream, not a playlist. */
export function isStreamType(contentType) {
  const t = String(contentType ?? "").split(";")[0].trim().toLowerCase();
  return t.startsWith("audio/") && !PLAYLIST_TYPES.includes(t);
}

// ---------------------------------------------------------------------------------------------
// Network (run by hand only)

/** Follows redirects by hand; every hop must stay HTTPS. Resolves to the final URL, or null with a reason. */
export async function checkStream(url, fetchImpl = fetch) {
  const signal = AbortSignal.timeout(STREAM_TIMEOUT_MS);
  let current = url;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!current.startsWith("https://")) return { ok: false, reason: `not https: ${current}` };
      const res = await fetchImpl(current, { redirect: "manual", signal, headers: { "User-Agent": USER_AGENT, Range: "bytes=0-" } });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        await res.body?.cancel().catch(() => {});
        if (loc === null) return { ok: false, reason: `redirect without location` };
        current = new URL(loc, current).href;
        continue;
      }
      const type = res.headers.get("content-type");
      await res.body?.cancel().catch(() => {});
      if (res.status !== 200 && res.status !== 206) return { ok: false, reason: `status ${res.status}` };
      if (!isStreamType(type)) return { ok: false, reason: `type ${type}` };
      return { ok: true, url: current };
    }
    return { ok: false, reason: "too many redirects" };
  } catch (e) {
    return { ok: false, reason: e?.name === "TimeoutError" ? "timeout" : `error ${e?.message ?? e}` };
  }
}

async function getJson(path) {
  let last = null;
  // The community servers answer 502 now and then: three tries, a second apart.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1_000));
    const res = await fetch(API + path, { headers: { "User-Agent": USER_AGENT } });
    if (res.ok) return res.json();
    last = res.status;
  }
  throw new Error(`${path}: ${last}`);
}

const FIELDS = "has_geo_info=true&is_https=true&hidebroken=true&order=clickcount&reverse=true";

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/** The first candidate whose stream answers, with its final URL. */
/** The pause between the two checks of one URL, so a token that works once does not slip through. */
export const RECHECK_GAP_MS = 3_000;

/** Two stream checks from fresh requests, RECHECK_GAP_MS apart; both must pass. */
async function checkTwice(url) {
  const first = await checkStream(url);
  if (!first.ok) return first;
  await new Promise((r) => setTimeout(r, RECHECK_GAP_MS));
  const second = await checkStream(url);
  return second.ok ? { ok: true } : { ok: false, reason: `second check: ${second.reason}` };
}

/**
 * The first candidate whose stable entry URL answers twice. The stored URL is Radio Browser's own (the browser
 * follows redirects at play time), never a hop of the chain, which may carry a per-listener token.
 */
async function firstWorking(rows, cache) {
  for (const row of rows.slice(0, CANDIDATES_TRIED)) {
    let result = cache.get(row.stationuuid);
    if (result === undefined) {
      result = { ok: false };
      for (const url of entryUrls(String(row.url_resolved))) {
        const r = await checkTwice(url);
        if (r.ok) {
          result = { ok: true, url };
          break;
        }
      }
      cache.set(row.stationuuid, result);
    }
    if (result.ok) return { ...row, url_resolved: result.url };
  }
  return null;
}

/** East Asian lights from the by-country lists, for each country the 80 km search left dark. */
async function eastAsia(found, base, cache) {
  const lit = new Set(base.map((o) => o.city.city));
  const out = [];
  for (const code of EAST_ASIA_CODES) {
    const names = new Set(EAST_ASIA_CITIES.filter((c) => c.code === code).map((c) => c.city));
    if ([...names].some((n) => lit.has(n))) continue;
    // The 80 km search found a station that the spread across continents left out: it is the country's light.
    const near = found.filter((f) => names.has(f.city.city) && f.best !== null).map((f) => ({ city: { ...f.city, code }, row: f.best }));
    if (near.length > 0) {
      near.sort(byListOrder);
      const taken = near.slice(0, EAST_ASIA_PER_COUNTRY);
      process.stdout.write(`EAST ${code}: from the 80 km search, ${taken.map((p) => `${p.city.city}: ${cleanName(p.row.name)}`).join("; ")}\n`);
      out.push(...taken);
      continue;
    }
    const rows = await getJson(`/json/stations/search?countrycode=${code}&is_https=true&hidebroken=true&order=clickcount&reverse=true&limit=500`);
    const groups = eastAsiaCandidates(rows, code);
    const picks = [];
    for (const g of groups) {
      const row = await firstWorking(g.rows, cache);
      if (row !== null) picks.push({ city: g.city, row });
    }
    picks.sort(byListOrder);
    const taken = picks.filter((p) => !out.some((o) => o.row.stationuuid === p.row.stationuuid)).slice(0, EAST_ASIA_PER_COUNTRY);
    process.stdout.write(`EAST ${code}: ${rows.length} listed, ${groups.length} cities named, ${taken.map((p) => `${p.city.city}: ${cleanName(p.row.name)}`).join("; ") || "dark"}\n`);
    out.push(...taken);
  }
  out.sort(byListOrder);
  // At most EAST_ASIA_MAX, and every lit country keeps one before any takes a second.
  const first = out.filter((o, i) => out.findIndex((x) => x.city.country === o.city.country && x.city.code === o.city.code) === i);
  // The region's lights already chosen count toward EAST_ASIA_MAX.
  const regional = new Set(EAST_ASIA_CITIES.map((c) => c.city));
  const already = base.filter((o) => regional.has(o.city.city)).length;
  return [...first, ...out.filter((o) => !first.includes(o))].slice(0, Math.max(0, EAST_ASIA_MAX - already));
}

async function build(date) {
  const top = await getJson(`/json/stations/search?${FIELDS}&limit=3000`);
  process.stdout.write(`top list: ${top.length} rows\n`);
  const cache = new Map();
  const found = await pool(CITIES, CONCURRENCY, async (city) => {
    let rows = candidatesFor(city, top);
    let best = await firstWorking(rows, cache);
    if (best === null) {
      // Nothing usable in the top list: ask for the stations near the city itself.
      const near = await getJson(`/json/stations/search?${FIELDS}&geo_lat=${city.lat}&geo_long=${city.lon}&geo_distance=${RADIUS_KM * 1000}&limit=200`);
      rows = candidatesFor(city, near);
      best = await firstWorking(rows, cache);
    }
    const rock = await firstWorking(rows.filter(isRock), cache);
    process.stdout.write(`${city.city}: ${rows.length} candidates, ${best ? cleanName(best.name) : "none"}${rock ? ` / rock ${cleanName(rock.name)}` : ""}\n`);
    return { city, best, rock, bestScore: best ? score(best, city) : 0, rockScore: rock ? score(rock, city) : 0 };
  });
  const base = chooseRows(found);
  const extra = await eastAsia(found, base, cache);
  const chosen = makeRoom(base, extra);
  for (const o of base) if (!chosen.includes(o)) process.stdout.write(`DROPPED ${o.city.city} | ${cleanName(o.row.name)}\n`);
  for (const c of chosen) process.stdout.write(`CHOSEN ${c.city.city} | ${cleanName(c.row.name)} | rock ${isRock(c.row)} | ${c.row.tags}
`);
  return renderFile(chosen.map(toStation), date);
}

/** The stream URLs written in a stations file. */
export function urlsOf(text) {
  return [...text.matchAll(/\bname: ("(?:[^"\\]|\\.)*"),.*?\burl: ("(?:[^"\\]|\\.)*")/g)].map((m) => ({ name: JSON.parse(m[1]), url: JSON.parse(m[2]) }));
}

async function check(root) {
  const rows = urlsOf(readFileSync(join(root, OUT_FILE), "utf8"));
  const results = await pool(rows, CONCURRENCY, (r) => checkTwice(r.url));
  let failed = 0;
  rows.forEach((r, i) => {
    if (!results[i].ok) {
      failed++;
      process.stdout.write(`FAILED ${r.name}: ${results[i].reason} (${r.url})\n`);
    }
  });
  process.stdout.write(`${rows.length - failed} of ${rows.length} streams answer\n`);
  return failed === 0 ? 0 : 1;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(fileURLToPath(import.meta.url), "..", "..");
  const args = process.argv.slice(2);
  if (args.includes("--check")) {
    process.exit(await check(root));
  }
  const date = args[args.indexOf("--date") + 1];
  if (!args.includes("--date") || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
    process.stderr.write("usage: node scripts/radio-stations.mjs --date YYYY-MM-DD | --check\n");
    process.exit(2);
  }
  const text = await build(date);
  writeFileSync(join(root, OUT_FILE), text);
  process.stdout.write(`wrote ${OUT_FILE}\n`);
}
