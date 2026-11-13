// The radio's two phrases (brief 047, ruling 10). Pure. Matched only against the owner's own words: a spoken item's
// transcript and a typed line. Case and punctuation are ignored.
//   "rock": a Franki-like name and "you rock" in one utterance, in either order, or the name with "rocks"
//           ("Franki rocks"; "Frank Sinatra rocks the house" is a hit by this rule). "You rock" alone is not.
//   "off":  "radio off", or "stop" or "turn ... off" with "the radio" or "the music", in either order. Not when the
//           line says not to ("don't stop the music"). The machine acts on it only while the radio is on.
// A line that says both is ambiguous and matches neither.

export type RadioPhrase = "rock" | "off";

/** The spellings a transcriber produces for the name. */
export const FRANKI_NAMES: readonly string[] = ["franki", "frankie", "franky", "frankey", "frank"];
/** Words that turn the off phrase round. */
const NEGATIONS = new Set(["dont", "never", "not", "cant", "wont", "doesnt", "shouldnt"]);

/** Lower case, apostrophes dropped ("don't" is "dont"), everything else that is not a letter or digit a space. */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’‘`]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t !== "");
}

const hasPair = (t: readonly string[], a: string, b: string) => t.some((w, i) => w === a && t[i + 1] === b);

function isRock(t: readonly string[]): boolean {
  if (t.includes("frankirocks")) return true;
  if (!t.some((w) => FRANKI_NAMES.includes(w))) return false;
  return hasPair(t, "you", "rock") || t.includes("rocks");
}

function isOff(t: readonly string[]): boolean {
  if (t.some((w) => NEGATIONS.has(w)) || hasPair(t, "do", "not")) return false;
  if (hasPair(t, "radio", "off")) return true;
  const object = hasPair(t, "the", "radio") || hasPair(t, "the", "music");
  const verb = t.includes("stop") || (t.includes("turn") && t.includes("off"));
  return object && verb;
}

export function radioPhrase(text: string): RadioPhrase | null {
  const t = tokens(text);
  const rock = isRock(t);
  const off = isOff(t);
  if (rock && off) return null;
  return rock ? "rock" : off ? "off" : null;
}
