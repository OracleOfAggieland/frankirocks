/**
 * Fake_OpenAI: a test double that records every request and answers from a script, with no network and no cost.
 * This is the skeleton from task 6. Later tasks put the real Responses and Realtime clients behind the same
 * `OpenAIPort` shape, so routes and workers take either one.
 */
export type OpenAIEndpoint = "responses.create" | "realtime.calls.create" | "realtime.calls.hangup";

export interface RecordedRequest {
  endpoint: OpenAIEndpoint;
  body: unknown;
  /** 0-based position across all endpoints. */
  index: number;
}

/** One scripted answer. `never` leaves the call pending forever, for deadline tests. */
export type ScriptedResult =
  | { kind: "ok"; value: unknown }
  | { kind: "error"; error: Error }
  | { kind: "never" };

export interface OpenAIPort {
  call(endpoint: OpenAIEndpoint, body: unknown): Promise<unknown>;
}

export class FakeOpenAIUnscriptedError extends Error {
  constructor(endpoint: OpenAIEndpoint) {
    super(`Fake_OpenAI has no scripted result left for ${endpoint}`);
    this.name = "FakeOpenAIUnscriptedError";
  }
}

export class FakeOpenAI implements OpenAIPort {
  readonly requests: RecordedRequest[] = [];
  private readonly queues = new Map<OpenAIEndpoint, ScriptedResult[]>();
  private readonly fallbacks = new Map<OpenAIEndpoint, ScriptedResult>();

  /** Queues results for an endpoint; they are used once each, in order. */
  script(endpoint: OpenAIEndpoint, ...results: ScriptedResult[]): this {
    const queue = this.queues.get(endpoint) ?? [];
    queue.push(...results);
    this.queues.set(endpoint, queue);
    return this;
  }

  /** Result used for every call once the endpoint's queue is empty. */
  always(endpoint: OpenAIEndpoint, result: ScriptedResult): this {
    this.fallbacks.set(endpoint, result);
    return this;
  }

  /** Discards any queued results for an endpoint that were not used. */
  drain(endpoint: OpenAIEndpoint): this {
    this.queues.delete(endpoint);
    return this;
  }

  /** Requests sent to one endpoint, in order. */
  requestsTo(endpoint: OpenAIEndpoint): RecordedRequest[] {
    return this.requests.filter((r) => r.endpoint === endpoint);
  }

  call(endpoint: OpenAIEndpoint, body: unknown): Promise<unknown> {
    this.requests.push({ endpoint, body: structuredClone(body), index: this.requests.length });
    const result = this.queues.get(endpoint)?.shift() ?? this.fallbacks.get(endpoint);
    if (result === undefined) return Promise.reject(new FakeOpenAIUnscriptedError(endpoint));
    switch (result.kind) {
      case "ok":
        return Promise.resolve(structuredClone(result.value));
      case "error":
        return Promise.reject(result.error);
      case "never":
        return new Promise<unknown>(() => {});
    }
  }
}

export const ok = (value: unknown): ScriptedResult => ({ kind: "ok", value });
export const fail = (error: Error): ScriptedResult => ({ kind: "error", error });
export const never = (): ScriptedResult => ({ kind: "never" });
