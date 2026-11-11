// Prototype franki.html 904-952 and 971-1034 (section 6: the shared GLSL strings), ported in WP2. Byte-identical
// after interpolation (GLSL_BODY_FRAG interpolates EYE_X.toFixed(3) at 1028, as the prototype does). Allowed
// edits E1, E3 only. Until ported, each string is the NOT_PORTED marker, so importing this file never throws.
import { NOT_PORTED } from "./errors";

export const GLSL_NOISE: string = NOT_PORTED;
export const GLSL_DISPLACE: string = NOT_PORTED;
export const GLSL_SKIN: string = NOT_PORTED;
export const GLSL_BODY_FRAG: string = NOT_PORTED;
