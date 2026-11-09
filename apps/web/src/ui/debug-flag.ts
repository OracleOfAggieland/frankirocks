// The Debug_Panel flag (lab-ui-foundation R21.1, R21.3, R21.4). Pure: true only outside production
// with `debug=1` in the query string.
export function debugVisible(nodeEnv: string | undefined, search: string): boolean {
  if (nodeEnv === "production") return false;
  try {
    return new URLSearchParams(search).get("debug") === "1";
  } catch {
    return false;
  }
}
