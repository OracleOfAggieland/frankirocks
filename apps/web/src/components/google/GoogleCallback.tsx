"use client";
// The callback page in Google's window (brief 049 ruling 16). It runs `runGoogleCallback` once: the query is taken
// out of the address bar before anything else, the connect is sent with the signed-in user's token, the sheet is
// told in one word, and the window closes itself. Only fixed words are shown; nothing from the address bar is.
import { useEffect, useRef, useState } from "react";
import { createApiClient } from "../../client/api";
import { createAuthClient } from "../../client/auth";
import { publicEnv, readFirebaseConfig } from "../../client/firebase-config";
import { GOOGLE_CALLBACK_AUTH_WAIT_MS, browserTell, runGoogleCallback } from "../../client/google-callback";
import { randomId } from "../../client/ids";
import type { ApiClient } from "../../client/api";
import { COPY } from "../../ui/copy";

type Shown = "working" | "done" | "failed";

/** Resolves with an API client for whoever Firebase says is signed in, or null after the wait. */
function signedInClient(): Promise<ApiClient | null> {
  const config = readFirebaseConfig(publicEnv());
  if (!config.ok) return Promise.resolve(null);
  const auth = createAuthClient(config.config);
  return new Promise((resolve) => {
    let settled = false;
    let stop: () => void = () => {};
    const finish = (api: ApiClient | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stop();
      resolve(api);
    };
    const timer = setTimeout(() => finish(null), GOOGLE_CALLBACK_AUTH_WAIT_MS);
    stop = auth.subscribe((user) => {
      if (user === null) return;
      finish(createApiClient({ getToken: () => user.getIdToken(), fetch: (input, init) => fetch(input, init) }));
    });
    if (settled) stop();
  });
}

export function GoogleCallback() {
  const ran = useRef(false);
  const [shown, setShown] = useState<Shown>("working");
  useEffect(() => {
    // Once per page: a code is good for one exchange, and Strict Mode runs effects twice.
    if (ran.current) return;
    ran.current = true;
    const search = window.location.search;
    void runGoogleCallback({
      search,
      scrub: () => window.history.replaceState(null, "", window.location.pathname),
      signedIn: signedInClient,
      newId: () => randomId(),
      tell: browserTell,
    }).then((outcome) => {
      const ok = outcome === "connected" || outcome === "nothingGranted";
      setShown(ok ? "done" : "failed");
      window.close();
    });
  }, []);
  return (
    <main data-google-callback={shown} className="flex min-h-svh flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-lg text-ink">{COPY.google.callback.title}</h1>
      <p role="status" className="text-sm text-ink-dim">
        {COPY.google.callback[shown]}
      </p>
    </main>
  );
}
