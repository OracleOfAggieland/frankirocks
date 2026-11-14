"use client";
// The Google sheet (brief 049 part B), in every phase the machine has and the notes worth seeing, drawn inline from
// fixture states. Nothing here calls a route or opens Google's window. Then the way in, unlit and lit.
import { GoogleSheet } from "../../../components/google/GoogleSheet";
import { GoogleWayIn } from "../../../components/google/GoogleWayIn";
import { GOOGLE_CONNECTED, GOOGLE_ZONE, googleSpecimens } from "../_fixtures/google";
import { Section, Tile } from "./Section";

const noop = () => {};
const actions = { onClose: noop, onRetry: noop, onConnect: noop, onStopWaiting: noop, onDisconnect: noop, onYes: noop, onNotNow: noop };

export function GoogleSection() {
  return (
    <>
      <Section id="google" title="Google">
        {googleSpecimens().map((s) => (
          <Tile key={s.id} label={s.label} data-specimen="google" data-google-tile={s.id}>
            <GoogleSheet state={s.state} zone={GOOGLE_ZONE} {...actions} />
          </Tile>
        ))}
      </Section>
      <Section id="google-way-in" title="Google, the way in">
        <Tile label="before any answer" data-specimen="google-way-in" data-google-tile="way-in-unlit">
          <GoogleWayIn google={null} open={false} onOpen={noop} />
        </Tile>
        <Tile label="mail and calendar being read" data-specimen="google-way-in" data-google-tile="way-in-lit">
          <GoogleWayIn google={GOOGLE_CONNECTED} open={false} onOpen={noop} />
        </Tile>
      </Section>
    </>
  );
}
