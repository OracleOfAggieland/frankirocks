/**
 * The transcription model for `session.update` (R13.1). Its only source is `FRANKI_TRANSCRIBE_MODEL` in
 * apps/web/apphosting.yaml; next.config.ts inlines it into the browser bundle as
 * `NEXT_PUBLIC_FRANKI_TRANSCRIBE_MODEL` at build time, so no model ID is written in code.
 */
export const TRANSCRIBE_VAR = "FRANKI_TRANSCRIBE_MODEL";

export function transcribeModel(): string | null {
  const v = process.env.NEXT_PUBLIC_FRANKI_TRANSCRIBE_MODEL;
  return typeof v === "string" && v.trim() !== "" ? v : null;
}
