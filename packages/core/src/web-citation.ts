import { type Infer, issue, obj, refine, str } from "./schema/v";

/** A provider citation opens an ordinary, absolute web address in the user's browser. */
export function isWebCitationUrl(value: string): boolean {
  if (value.length > 2048 || !/^https?:\/\//i.test(value) || /[\s\\\p{Cc}\p{Cf}]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export const WebCitationUrl = refine(str(2048, { min: 1 }), (url, path) =>
  isWebCitationUrl(url) ? null : issue(path, "expected an absolute HTTP or HTTPS citation"));
export const WebCitation = obj({ title: str(256, { min: 1 }), url: WebCitationUrl });
export type WebCitation = Infer<typeof WebCitation>;
