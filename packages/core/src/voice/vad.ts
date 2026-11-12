/**
 * The VAD settings (voice-control R19; design "VAD", question 53). `semantic_vad` stays, because a 300 ms silence
 * cut the Owner off mid-sentence in the Nov 6 live check. Responses stay app-created after admission and barge-in
 * stays app-handled. Tune `VAD_EAGERNESS` from the Latency_Clock's commit delay.
 */
export const VAD_TYPE = "semantic_vad";
export const VAD_EAGERNESS = "auto";

export const SEMANTIC_VAD = { type: VAD_TYPE, eagerness: VAD_EAGERNESS, create_response: false, interrupt_response: false } as const;
