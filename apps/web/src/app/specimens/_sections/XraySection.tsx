"use client";
// The X-ray machine and its screen, together (brief 051 part D). The walk: the machine beside the three.js ghost at
// the Main_Screen's own stage size, pressed, the screen opening on the scripted tracker (asking, warming, searching,
// then seeing a head that turns and talks and two hands), and closed again; a press on the machine or the screen's
// close button moves the walk on by hand. The live tile: the real store, through the real machine button, with the
// browser's camera, or with a still picture from a web address played as a camera (`createPictureCamera`), so the
// real tracker can be tried on a photograph with no camera. Under the live screen, the store's signal and what the
// tracker found, as words.
// Each ghost, machine and screen with bones is one WebGL context: the walk holds three at most, the live tile three,
// and part B's short section two, so /specimens/xray holds eight at most. The main Specimens_Page gets a link only.
import Link from "next/link";
import { type FormEvent, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createBrowserClock } from "../../../client/clock";
import { createLiveXray, createPictureCamera, createXrayHost } from "../../../client/xray-live";
import type { XrayWatch } from "../../../client/xray-watch";
import { Avatar } from "../../../components/avatar/Avatar";
import { Stage } from "../../../components/avatar/Stage";
import { FOCUS, QUIET_BUTTON, TARGET } from "../../../components/surfaces/classes";
import { XrayOnStage } from "../../../components/xray/XrayOnStage";
import { XrayPanel } from "../../../components/xray/XrayPanel";
import { lookFor } from "../../../ui/avatar/look";
import { COPY } from "../../../ui/copy";
import { ReducedMotionOverride } from "../../../ui/hooks/reduced-motion";
import { SCRIPTED_ASPECT, createScriptedFeed } from "../../../ui/xray/testing/scripted-frames";
import { XRAY_OFF_VIEW, type XrayControls, type XrayFeed, type XrayFrame, type XraySignal, type XrayView, xrayPropView } from "../../../ui/xray/types";
import { avatarInput } from "../_fixtures";
import { Section, Tile } from "./Section";
import { XrayPropSection } from "./XrayPropSection";

const noop = () => {};
const noSubscribe = () => noop;
const offView = (): XrayView => XRAY_OFF_VIEW;
const noWatch = (): XrayWatch | null => null;

/** Room on the right for the machine, which stands past the stage's edge. */
const ROOM = "flex w-[44rem] max-w-full justify-center py-16 pr-40";
const LINK = `${FOCUS} self-center text-sm text-brass underline underline-offset-4 hover:text-brass-hi`;

const on = (signal: XraySignal, cameraOn: boolean): XrayView => ({ power: "on", signal, facing: "user", canFlip: cameraOn, cameraOn });

/** Off, a press, the camera allowed, the tracker loaded, bones found; then the screen is closed and it is off again. */
const WALK: { view: XrayView; ms: number }[] = [
  { view: XRAY_OFF_VIEW, ms: 2500 },
  { view: on("asking", false), ms: 2000 },
  { view: on("warming", true), ms: 2000 },
  { view: on("searching", true), ms: 3000 },
  { view: on("seeing", true), ms: 8000 },
];

/** A feed that never finds anyone, and one with no frame at all. */
const nobody = (now: () => number): XrayFeed => ({ attach: () => noop, latest: () => ({ at: now(), aspect: SCRIPTED_ASPECT, face: null, hands: [] }) });
const NO_FRAME: XrayFeed = { attach: () => noop, latest: () => null };

function WalkTile() {
  const [step, setStep] = useState(0);
  const clock = useMemo(() => createBrowserClock(), []);
  const scripted = useMemo(() => createScriptedFeed(() => clock.mono()), [clock]);
  const empty = useMemo(() => nobody(() => clock.mono()), [clock]);
  useEffect(() => {
    const timer = setTimeout(() => setStep((s) => (s + 1) % WALK.length), WALK[step]!.ms);
    return () => clearTimeout(timer);
  }, [step]);
  const { view } = WALK[step]!;
  // The walk's own machine: a press turns it on or off, and the screen's close turns it off.
  const controls: XrayControls = useMemo(() => ({ press: () => setStep((s) => (s === 0 ? 1 : 0)), close: () => setStep(0), flip: noop, retry: noop }), []);
  const feed = view.signal === "seeing" ? scripted : view.signal === "searching" ? empty : NO_FRAME;
  const bones = view.signal === "warming" || view.signal === "searching" || view.signal === "seeing" ? "auto" : "none";
  const input = avatarInput("listening", null, { reduced: false });
  return (
    <ReducedMotionOverride reduced={false}>
      <Tile label={`the whole thing → ${view.power === "off" ? "off" : view.signal}`} data-specimen="xray" data-xray-tile="walk" data-xray-walk={view.signal}>
        <div className={ROOM}>
          <Stage reduced={false} aside={<XrayOnStage view={xrayPropView(view)} onPress={controls.press} />}>
            <Avatar look={lookFor(input)} input={input} />
          </Stage>
        </div>
        <XrayPanel view={view} feed={feed} controls={controls} reduced={false} presentation="inline" bones={bones} />
      </Tile>
    </ReducedMotionOverride>
  );
}

/** Where the live tile's picture comes from. */
type LiveSource = { kind: "camera" } | { kind: "picture"; url: string };

/** A picture's web address as typed, made whole against this page; null unless it is http or https. */
export function pictureAddress(text: string, base: string): string | null {
  const t = text.trim();
  if (t === "") return null;
  try {
    const url = new URL(t, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** What the tracker found in a frame, as words for the lead to read with no camera. */
export function foundWords(frame: XrayFrame | null): { face: string; hands: string } {
  if (frame === null) return { face: "no frame yet", hands: "no frame yet" };
  const face = frame.face === null ? "none" : `found, ${frame.face.points.length} points, jaw ${frame.face.jaw.toFixed(2)}`;
  const hands = frame.hands.length === 0 ? "none" : frame.hands.map((h) => h.side).join(" and ");
  return { face, hands };
}

/** How often the words under the live screen read the feed. */
const READOUT_MS = 250;

function Readout({ watch, view }: { watch: XrayWatch | null; view: XrayView }) {
  const [frame, setFrame] = useState<XrayFrame | null>(null);
  useEffect(() => {
    if (watch === null) return;
    const timer = window.setInterval(() => setFrame(watch.feed.latest()), READOUT_MS);
    return () => {
      window.clearInterval(timer);
      setFrame(null);
    };
  }, [watch]);
  const words = foundWords(frame);
  return (
    <dl data-xray-readout="" className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs text-ink-dim">
      <dt>signal</dt>
      <dd data-xray-live-signal={view.signal} className="text-ink">
        {view.signal} ({COPY.xray.signal[view.signal]})
      </dd>
      <dt>camera</dt>
      <dd data-xray-live-camera={view.cameraOn ? "on" : "off"}>{view.cameraOn ? `on, ${view.facing}` : "off"}</dd>
      <dt>face</dt>
      <dd data-xray-live-face="">{words.face}</dd>
      <dt>hands</dt>
      <dd data-xray-live-hands="">{words.hands}</dd>
    </dl>
  );
}

/**
 * The real store and the real machine button. With the camera, nothing opens until the machine is pressed. With a
 * still picture, the "Run the tracker" press turns the machine on at once.
 */
function LiveTile({ source }: { source: LiveSource }) {
  // Held as the app holds its own: a host made once, started in an effect and disposed for good on stop (StrictMode
  // starts it twice, and each start makes its own watch). The tile is keyed by its source, so the source never changes.
  const [host] = useState(() => createXrayHost(() => createLiveXray(source.kind === "picture" ? { camera: createPictureCamera(source.url) } : {})));
  useEffect(() => {
    host.start();
    if (source.kind === "picture") host.getSnapshot()?.controls.press();
    return () => host.stop();
  }, [host, source]);
  const watch = useSyncExternalStore(host.subscribe, host.getSnapshot, noWatch);
  const view = useSyncExternalStore(watch?.subscribe ?? noSubscribe, watch?.getSnapshot ?? offView, offView);
  const input = avatarInput("listening", null, { reduced: false });
  const label = source.kind === "camera" ? "the real camera" : "a still picture";
  return (
    <ReducedMotionOverride reduced={false}>
      <Tile label={`by hand, ${label} → ${view.power === "off" ? "off" : view.signal}`} data-specimen="xray" data-xray-tile={source.kind === "camera" ? "live" : "live-picture"}>
        <div className={ROOM}>
          <Stage reduced={false} aside={<XrayOnStage view={xrayPropView(view)} onPress={() => watch?.controls.press()} />}>
            <Avatar look={lookFor(input)} input={input} />
          </Stage>
        </div>
        {watch !== null ? <XrayPanel view={view} feed={watch.feed} controls={watch.controls} reduced={false} presentation="inline" /> : null}
        <Readout watch={watch} view={view} />
      </Tile>
    </ReducedMotionOverride>
  );
}

/** The box that takes a picture's address. The picture must be served with CORS, or it is "No camera". */
function PictureBox({ onRun, onCamera, picture }: { onRun: (url: string) => void; onCamera: () => void; picture: boolean }) {
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const url = pictureAddress(text, window.location.href);
    setBad(url === null);
    if (url !== null) onRun(url);
  };
  return (
    <form onSubmit={submit} className="flex w-full flex-wrap items-end gap-2">
      <label className="flex min-w-[20rem] flex-1 flex-col gap-1 text-sm text-ink-dim">
        A still picture&apos;s web address (served with CORS)
        <input
          type="url"
          data-xray-picture=""
          value={text}
          placeholder="https://…/face.jpg"
          onChange={(e) => setText(e.currentTarget.value)}
          aria-invalid={bad}
          className={`${TARGET} ${FOCUS} rounded-control border border-ink/20 bg-night-1 px-3 text-sm text-ink`}
        />
      </label>
      <button type="submit" data-action="xray-picture" className={`${QUIET_BUTTON} text-sm`}>
        Run the tracker on it
      </button>
      {picture ? (
        <button type="button" data-action="xray-camera" className={`${QUIET_BUTTON} text-sm`} onClick={onCamera}>
          Use the camera instead
        </button>
      ) : null}
      {bad ? (
        <p role="status" data-xray-picture-bad="" className="w-full text-sm text-ember">
          Type a web address that starts with https:// or http://.
        </p>
      ) : null}
    </form>
  );
}

const CAMERA: LiveSource = { kind: "camera" };

/** One live tile at a time, so the page holds one real store: the camera first, a still picture on request. */
function LiveTiles() {
  const [source, setSource] = useState<LiveSource>(CAMERA);
  // Each run is a new source, so the same address typed twice runs the tracker again.
  const [run, setRun] = useState(0);
  return (
    <>
      <PictureBox
        picture={source.kind === "picture"}
        onRun={(url) => {
          setSource({ kind: "picture", url });
          setRun((n) => n + 1);
        }}
        onCamera={() => setSource(CAMERA)}
      />
      <LiveTile key={source.kind === "camera" ? "camera" : `picture-${run}`} source={source} />
    </>
  );
}

/**
 * `full`: every tile, on /specimens/xray. Short, for the main Specimens_Page, which is near the browser's WebGL
 * context limit: links only, no context.
 */
export function XraySection({ full }: { full: boolean }) {
  const links = (
    <>
      <Link href="/specimens/xray/machine" data-xray-more="machine" className={LINK}>
        The machine in each state
      </Link>
      <Link href="/specimens/xray/view" data-xray-more="view" className={LINK}>
        The X-ray screen in each signal
      </Link>
    </>
  );
  if (!full) {
    return (
      <Section id="xray" title="X-ray machine and its screen">
        <Link href="/specimens/xray" data-xray-more="all" className={LINK}>
          The X-ray, walked and by hand
        </Link>
        {links}
      </Section>
    );
  }
  return (
    <>
      <Section id="xray" title="X-ray machine and its screen">
        <WalkTile />
      </Section>
      <Section id="xray-live" title="X-ray, by hand: the real camera or a still picture">
        <LiveTiles />
      </Section>
      <XrayPropSection full={false} />
      <Section id="xray-more" title="More X-ray specimens">
        {links}
      </Section>
    </>
  );
}
