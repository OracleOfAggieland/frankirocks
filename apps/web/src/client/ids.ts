/** Random 43-character base64url IDs (the contracts `ID` shape) for requestId and turnId. Browser crypto only. */
export type RandomBytes = (n: number) => Uint8Array;

export const cryptoBytes: RandomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

export function randomId(bytes: RandomBytes = cryptoBytes): string {
  const b = bytes(32);
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
