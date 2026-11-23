# Franki's architecture (decided Oct 30, 2026)

> ✅ **Decision:** Next.js 16 on Firebase App Hosting, with the brain in route handlers, Cloud Functions for background work, Firestore for data, and OpenAI for voice and reasoning. Three agent advocates debated it, a reviewer agent scored the winner **56/70** (the others scored 52 and 47), and the owner confirmed it.

## How it was decided
Each advocate wrote a position from npm and the official docs (checked Oct 30), then rebutted the other two. A reviewer agent scored them and wrote the verdict. The debate documents are working notes and are not in this repo.

| Position | Shape | Outcome |
|---|---|---|
| **A** | Next.js on App Hosting, brain in route handlers | **Picked.** B's model choices and C's safety ideas were folded in. |
| **B** | Vite SPA on classic Hosting, brain as Cloud Functions callables | Backed App Hosting in its rebuttal, since its edge was only in the shell |
| **C** | One long-lived Cloud Run process per conversation (GPT-Live sideband, brain, approvals, credentials) | Too much to build first. It stays the upgrade path. |

## The stack
| Part | Choice | Why |
|---|---|---|
| Web app | Next.js **16.4.3** (App Router) on App Hosting backend `franki-web`, us-central1 | A stack the owner has shipped on before. Next 16 apps already ship on App Hosting. |
| Version pin | 16.4.3, fallback **15.5.28**, **never 15.2.x** | 15.2.x is App Hosting's newest *officially* supported line, but it falls inside unpatched 2026 advisories (the May proxy bypass, the Oct 14 RCE and DoS). Newer lines are "preview". |
| Brain | Route handlers in `apps/web`. The logic lives in framework-agnostic `packages/server`. | App Hosting allows 5-minute requests, and a turn takes seconds. One warm instance serves first paint, client-secret minting and the brain, all same-origin. Moving to callables or Cloud Run later means a new adapter, not a rewrite. |
| API surface | Route handlers that check a Firebase ID token and App Check. **No Server Actions, `use cache`, `next/og` or ISR.** | Those are 2026's Next.js CVE and out-of-memory hot spots. |
| Voice | OpenAI Realtime **`gpt-realtime-2.1`** over WebRTC, straight from the browser to OpenAI, through `RealtimeSession` in `@openai/agents` 0.21.0 with short-lived client secrets | GA, with first-class Agents SDK support: tools, approvals, interruption handling. **GPT-Live 1** gets a spike in week 2. |
| Reasoning | **`gpt-6.1-terra`** at low effort for live turns, escalating to **`gpt-6.1-sol`**. **`gpt-6-luna`** for background work. | The newest generation. Terra costs $1/$5 per 1M tokens. Models are env vars, and a week-1 eval picks the settings. |
| Memory | `text-embedding-3-small` vectors in Firestore, searched with `findNearest` | Firestore vector search takes up to 2048 dimensions, so there's no second database. |
| Background | Cloud Functions 2nd gen on **nodejs24**: schedules, Gmail through Pub/Sub, webhooks | nodejs20 was decommissioned on Oct 30, 2026. nodejs24 is supported until 2028. |
| Data | Firestore `(default)` in us-central1, with delete protection | Same region as everything else |
| Secrets | API keys in Secret Manager. Google and Plaid tokens are encrypted with Cloud KMS, and only the Functions service account can decrypt them. | The web server never holds a connector token it can read. |
| Repo | npm workspaces + Turborepo. TypeScript 6.0.3, Vitest 5 + fast-check (property tests), ESLint 10. | Turborepo is a monorepo type App Hosting documents. TypeScript 7 waits on typescript-eslint. |

Two safety ideas from C carry over and fit the CORVUS watch set (arXiv:2607.22711): revision counters that drop stale results, and approvals bound to the tool, an args hash and the item version.

**Changed by the memory decision (Nov 2; see [the memory spec](memory-spec-v3.md)):**

| Part | Was | Now |
|---|---|---|
| Voice client | `RealtimeSession` in `@openai/agents` | A thin app-owned `RTCPeerConnection` and `oai-events` adapter. The pinned SDK can't use a server-side SDP proxy. |
| Session setup | Browser mints a client secret | The server proxies SDP and holds the call ID; media stays direct |
| Transcription | `gpt-transcribe` assumed | `gpt-4o-mini-transcribe` baseline, removal Feb 26, 2027; others are spikes |
| API surface | Firebase ID token and App Check | Firebase ID token plus origin and CSRF checks until after submission |
| Firestore indexes | Empty file | The query registry in the memory contracts |
| Warm instance | `minInstances:0` | Warm on page entry; one min instance while the demo is open |

## When to change course
- **Move the brain to a Cloud Run sideband** (with `packages/server` unchanged) if any of these happen:
  - Hanging up a call by its browser-reported `callId` fails.
  - The week-2 red team gets a side effect or an over-quota minute past the server.
  - Traces show the browser-to-brain hop costs more than 300 ms p50.
- **Shell escape hatch:** if 16.4.3 and 15.5.28 both fail to roll out by Nov 1, static-export to classic Hosting and turn the handlers into callables.

## Week-1 checkpoints
| Date | Checkpoint |
|---|---|
| Fri Oct 30 | ✅ Scaffold deployed and the smoke test green on 16.4.3; no fallback needed |
| Sat Oct 31 | CI deploys through Workload Identity Federation; GCP budget alert set |
| Mon Nov 2 | Voice spike: time to first audio at p50 ≤ 800 ms |
| Tue Nov 3 | Brain eval on 10 scripted hero turns: Terra at `low`, Terra at `none`, 6.1 Sol |
| Wed Nov 4 | Hangup and sideband attach on a browser-minted `callId` |
| Thu Nov 5 | App Check on minting, red team on `session.update`, `findNearest` in the emulator |
| Fri Nov 6 | Judge path (seeded accounts, fake limbs, Plaid Sandbox); go/no-go on GPT-Live |

## Provisioned on Oct 30
- **Firebase project** `frankirocks` (Blaze). Web app `franki-web`, App ID `1:1072058223425:web:760293638ce18e2820afc0`.
- **App Hosting** backend `franki-web`: us-central1, nodejs24, automatic base-image updates on. URL: https://franki-web--frankirocks.us-central1.hosted.app
- **Firestore** `(default)` in us-central1, with deny-all rules deployed.
- **Auth:** Google and email/password sign-in.
- **Cloud KMS** key `franki/limb-tokens` in us-central1. The `franki-functions@` service account has Firestore access and the only encrypt/decrypt grant on that key.
- **Secrets:** `OPENAI_API_KEY` and `SMOKE_TOKEN` (random; version 2 is live) in Secret Manager. `franki-web` can read both, and `franki-functions@` can read the OpenAI key.

## First deploy (Oct 30)
The smoke test passed against the live backend: Firestore 822 ms, OpenAI model lookup 969 ms, Realtime client-secret mint 1094 ms, and a fresh heartbeat. Next 16.4.3 and the workspace packages built on App Hosting on the first try, which settles the "preview" and monorepo-install risks.

Gotchas, so they don't bite twice:
- Give Functions the **full** service-account email. The CLI's secret-access step rejects the `name@` shorthand.
- A brand-new Cloud Scheduler job took about 3½ minutes to dispatch its first manual run.
- On Windows, strip `\r\n` from generated tokens. Git for Windows' `openssl` ends its output with `\r\n`, and the stray `\r` made the first smoke token impossible to match over HTTP.

## Open risks
- The Firestore emulator tests need Java 21 locally. CI has it.

## Kiro
On Oct 30 there was no `.kiro/` yet, on purpose, so Kiro could own it. The scaffold was set up with Claude Code, and its commits say so. Kiro's steering, specs, hooks and custom agent came next, in [`.kiro/`](../../.kiro/). The README's "Who built what" says which parts Kiro built and which Claude Code built.
