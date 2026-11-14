/** Brief 049 part C: the Google errand agents' IDs, apart so the Google routes can name them without a cycle. */
export const MAIL_AGENT_ID = "google-mail";
export const CALENDAR_AGENT_ID = "google-calendar";
/** Review fix T10: the agents whose Errands a Google disconnect drops. */
export const GOOGLE_AGENT_IDS: readonly string[] = [MAIL_AGENT_ID, CALENDAR_AGENT_ID];
