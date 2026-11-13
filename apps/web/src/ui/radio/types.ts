// The radio's shared types (brief 047). Pure: no imports, no browser globals.
// The machine (ui/radio/radio-machine.ts), the radio on the stage (components/radio/RadioOnStage.tsx) and
// the globe panel (components/radio/RadioPanel.tsx) all code against this file.

/** One station on the globe: a row of the bundled snapshot in ui/radio/stations.ts. */
export interface Station {
  /** The Radio Browser station UUID, which is also where the row came from. */
  readonly id: string;
  /** The station's name as listed, trimmed. */
  readonly name: string;
  /** The city the globe shows it at. */
  readonly city: string;
  /** The country's English name. */
  readonly country: string;
  /** Degrees north, -90 to 90. */
  readonly lat: number;
  /** Degrees east, -180 to 180. */
  readonly lon: number;
  /** An HTTPS stream an audio element plays as it is: MP3 or AAC, never HLS. */
  readonly url: string;
  /** True when the station's own tags call it rock. "Franki, you rock" tunes to one of these. */
  readonly rock: boolean;
}

export type RadioPower = "off" | "on";
export type RadioPanelState = "closed" | "open";

/**
 * What the speaker is doing.
 * - silent: the radio is off.
 * - tuning: a station is chosen and its stream has not started.
 * - playing: sound is coming out.
 * - noSignal: the stream failed or never started, and the automatic hops ran out.
 * - tapToPlay: the browser refused to start sound without a press.
 */
export type RadioSignal = "silent" | "tuning" | "playing" | "noSignal" | "tapToPlay";

/** What the screen draws: the machine's state with the station looked up. */
export interface RadioView {
  readonly power: RadioPower;
  readonly panel: RadioPanelState;
  readonly station: Station | null;
  readonly signal: RadioSignal;
  /** The owner's own setting, 0 to 1. Ducking for speech is applied after this and is not shown. */
  readonly volume: number;
}

export const RADIO_OFF_VIEW: RadioView = { power: "off", panel: "closed", station: null, signal: "silent", volume: 0.8 };

/** What the radio on the stage needs. */
export interface RadioPropView {
  readonly power: RadioPower;
  readonly signal: RadioSignal;
  /** True while the globe panel is open. */
  readonly open: boolean;
}

export function radioPropView(view: RadioView): RadioPropView {
  return { power: view.power, signal: view.signal, open: view.panel === "open" };
}

/** Everything the screen can ask of the radio. Each call is one event into the machine. */
export interface RadioControls {
  /** The radio on the stage was pressed. Off: on, panel open, a rock station. On: the panel opens or closes. */
  press(): void;
  /** Close the panel. The station keeps playing. */
  closePanel(): void;
  /** Turn the radio off: sound stops and the panel closes. */
  powerOff(): void;
  /** Tune to one station by id. */
  tune(stationId: string): void;
  /** The next (1) or previous (-1) station going east. */
  step(direction: 1 | -1): void;
  /** A different station picked at random. */
  spin(): void;
  /** Set the owner's volume, 0 to 1. */
  setVolume(volume: number): void;
  /** Try the current station again. Called from a press, so the browser lets sound start. */
  retry(): void;
}
