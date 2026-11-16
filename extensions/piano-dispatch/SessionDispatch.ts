import { createHash } from "node:crypto";
import { creationVerdictOf } from "../../shared/creationVerdict.ts";
import {
  type Attribution,
  type CreatedWorktree,
  type FollowUpDelivery,
  type FollowUpResult,
  type SessionCreation,
  type SessionHandle,
  type SessionObservation,
  type SessionStatus,
  type SessionSubmission,
  STATUS_DEADLINE_MS,
  type StartResult,
  type WaitEnding,
  type WaitStatus,
  type WorktreeRequest,
} from "../../shared/dispatch.ts";
import { type InputVerdict, inputVerdictOf, submissionVerdict } from "../../shared/inputVerdict.ts";
import { applySessionEvent, cursorStep } from "../../shared/sessionProjection.ts";
import { dialogAsks, isAnswer, liveActivityOf } from "../../shared/sessionStatus.ts";
import { turnEnding } from "../../shared/turnEnding.ts";
import {
  type ClientMessage,
  type Dialog,
  type PromptSubmission,
  type RenderMsg,
  type ServerMessage,
  type SessionClosure,
  type SessionStatusFacts,
  type Snapshot,
  WORKTREE_CREATION_MS,
} from "../../shared/wire.ts";
import {
  type Connection,
  openConnection,
  type SendDisposition,
  type SocketEnvironment,
} from "../../web/src/lib/ws.ts";

export interface StartRequest {
  readonly prompt: string;
  readonly cwd: string;
  readonly worktree?: WorktreeRequest;
  readonly dispatchedFrom?: string;
  readonly inheritProject?: boolean;
}

export type {
  Attribution,
  FollowUpDelivery,
  FollowUpResult,
  SessionCreation,
  SessionHandle,
  SessionObservation,
  StartResult,
  WaitEnding,
} from "../../shared/dispatch.ts";

export const WAIT_MIN_MS = 1_000;
export const WAIT_MAX_MS = 60_000;
const START_DEADLINE_MS = 30_000;
const QUIESCENCE_RECHECKS = 3;
const RECHECK_DELAY_MS = 250;
const SELECT_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;
const READ_DEADLINE_MS = 30_000;
const MAX_VIEW_MESSAGES = 5_000;
const MAX_VIEW_CHARS = 4_000_000;

const waitTimeout = (timeoutMs: number | undefined): number | undefined =>
  timeoutMs === undefined || !Number.isFinite(timeoutMs)
    ? undefined
    : Math.min(WAIT_MAX_MS, Math.max(WAIT_MIN_MS, Math.trunc(timeoutMs)));

const fingerprint = (text: string): string => createHash("sha256").update(text).digest("hex");
const baselineFingerprintOf = (messages: ReadonlyArray<RenderMsg>): string =>
  fingerprint(JSON.stringify(messages.map((m) => [m.id, m.role, m.text, m.toolCalls ?? null])));

const oversized = (snapshot: Snapshot): boolean =>
  snapshot.messages.length > MAX_VIEW_MESSAGES || JSON.stringify(snapshot).length > MAX_VIEW_CHARS;

interface Link {
  readonly send: (message: ClientMessage) => void;
  readonly commit: (message: ClientMessage) => boolean;
  readonly committed: () => boolean;
  readonly nonce: () => string;
  readonly after: (ms: number, run: () => void) => unknown;
  readonly cancel: (timer: unknown) => void;
}

interface Observer<T> {
  readonly connected: () => void;
  readonly disconnected: (fatal: boolean) => void;
  readonly message: (message: ServerMessage) => void;
  readonly deadline: () => T;
  readonly aborted: () => T;
}

function observe<T>(
  environment: SocketEnvironment,
  options: { readonly deadlineMs: number | undefined; readonly signal?: AbortSignal },
  create: (link: Link, settle: (value: T) => void) => Observer<T>,
): Promise<T> {
  return new Promise<T>((resolve) => {
    let connection: Connection | null = null;
    let done = false;
    const timers = new Set<unknown>();
    let sending = false;
    let heldLoss: (() => void) | null = null;
    const send = (message: ClientMessage): SendDisposition => {
      if (!connection) return "not-sent";
      sending = true;
      try {
        return connection.send(message);
      } finally {
        sending = false;
        const loss = heldLoss;
        heldLoss = null;
        if (loss) queueMicrotask(loss);
      }
    };
    let mutation: "unsent" | "attempted" | "committed" = "unsent";
    const link: Link = {
      send: (message) => {
        send(message);
      },
      commit: (message) => {
        if (mutation !== "unsent") throw new Error("An observation sends one mutation.");
        mutation = "attempted";
        if (send(message) === "not-sent") return false;
        mutation = "committed";
        return true;
      },
      committed: () => mutation === "committed",
      nonce: () => environment.nonce(),
      after: (ms, run) => {
        const timer = environment.setTimeout(() => {
          timers.delete(timer);
          if (!done) run();
        }, ms);
        timers.add(timer);
        return timer;
      },
      cancel: (timer) => {
        timers.delete(timer);
        environment.clearTimeout(timer);
      },
    };
    const settle = (value: T) => {
      if (done) return;
      done = true;
      for (const timer of timers) environment.clearTimeout(timer);
      timers.clear();
      options.signal?.removeEventListener("abort", onAbort);
      connection?.close();
      resolve(value);
    };
    const observer = create(link, settle);
    function onAbort() {
      settle(observer.aborted());
    }
    if (options.signal?.aborted) {
      settle(observer.aborted());
      return;
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.deadlineMs !== undefined)
      link.after(options.deadlineMs, () => settle(observer.deadline()));
    connection = openConnection(
      {
        onMessage: (message) => {
          if (!done) observer.message(message);
        },
        onStatus: (connected, reason) => {
          if (done) return;
          if (connected) observer.connected();
          else if (sending) heldLoss = () => !done && observer.disconnected(reason === "too-large");
          else observer.disconnected(reason === "too-large");
        },
      },
      environment,
    );
    if (done) connection.close();
  });
}

const selectionOf = (message: ServerMessage): string | undefined =>
  "selectionId" in message ? message.selectionId : undefined;

interface InputDisposition {
  readonly submission: SessionSubmission;
  readonly detail: string | undefined;
}

const dispositionOf = (
  verdict: InputVerdict | undefined,
  dialogs: ReadonlyArray<Dialog>,
  opened: ReadonlySet<string>,
): InputDisposition | undefined => {
  if (verdict) return { submission: verdict.outcome, detail: verdict.detail };
  const dialog = dialogs.find((d) => !opened.has(d.id));
  return dialog && { submission: "needs_input", detail: dialogAsks(dialog) };
};

export function startSession(
  request: StartRequest,
  environment: SocketEnvironment,
  signal?: AbortSignal,
): Promise<StartResult> {
  const { cwd, prompt, dispatchedFrom, worktree, inheritProject } = request;
  return observe<StartResult>(
    environment,
    { deadlineMs: START_DEADLINE_MS + (worktree ? WORKTREE_CREATION_MS : 0), signal },
    (link, settle) => {
      let selectionId: string | null = null;
      let inputId: string | null = null;
      let reconciling = false;
      let handle: SessionHandle | null = null;
      let snapshot: Snapshot | null = null;
      let sequence = 0;
      let expectedSubmission = 1;
      const result = (
        creation: SessionCreation,
        submission: SessionSubmission,
        detail?: string,
      ): StartResult => ({
        cwd: handle?.cwd ?? cwd,
        creation,
        submission,
        handle,
        worktree:
          handle && worktree
            ? ({ path: handle.cwd, branch: worktree.branch.trim() } satisfies CreatedWorktree)
            : null,
        detail,
      });
      const unnamed = (detail: string) => result("uncertain", "uncertain", detail);
      const unsent = (detail: string) =>
        result("refused", "not_sent", `${detail} The creation request was not sent.`);
      const mine = (message: ServerMessage) =>
        selectionId !== null && selectionOf(message) === selectionId;
      const applyInput = () => {
        if (!snapshot || !handle) return;
        const submission = snapshot.state.submission;
        if (!submission || submission.id < expectedSubmission) {
          settleOn(undefined);
          return;
        }
        if (submission.id !== expectedSubmission) {
          settle(
            result("created", "uncertain", "Another input superseded the initial submission."),
          );
          return;
        }
        if (handle.submissionId === null && submission.inputId !== inputId) {
          settle(
            result(
              "created",
              "uncertain",
              "The submission could not be tied to the creation request.",
            ),
          );
          return;
        }
        if (handle.submissionId === null)
          handle = {
            ...handle,
            submissionId: submission.id,
            inputFingerprint: submission.inputFingerprint ?? "",
          };
        settleOn(submission);
      };
      const settleOn = (submission: PromptSubmission | undefined) => {
        const known =
          snapshot && dispositionOf(submissionVerdict(submission), snapshot.dialogs, new Set());
        if (known) settle(result("created", known.submission, known.detail));
      };
      return {
        connected: () => {
          if (!link.committed()) {
            selectionId = link.nonce();
            inputId = selectionId;
            const sent = link.commit({
              _tag: "create_session",
              selectionId,
              attemptId: inputId,
              cwd,
              options: { dispatchedFrom },
              ...(inheritProject === undefined ? {} : { inheritProject }),
              ...(worktree ? { worktree } : {}),
              text: prompt,
            });
            if (!sent) settle(unsent("The connection closed before it could send."));
            return;
          }
          if (!handle) {
            reconciling = true;
            selectionId = link.nonce();
            link.send({ _tag: "select", selectionId, cwd, sessionId: null, attemptId: inputId! });
            return;
          }
          selectionId = link.nonce();
          link.send({
            _tag: "select",
            selectionId,
            cwd: handle.cwd,
            sessionId: handle.sessionId,
          });
        },
        disconnected: (fatal) => {
          if (!link.committed()) settle(unsent("Piano could not be reached."));
          else if (!handle && fatal)
            settle(
              unnamed(
                "The connection was dropped for a frame over the delivery limit, before Pi named the session.",
              ),
            );
          else if (fatal)
            settle(
              result(
                "created",
                "uncertain",
                "The connection was dropped for a frame over the delivery limit.",
              ),
            );
        },
        message: (message) => {
          if (!mine(message)) return;
          switch (message._tag) {
            case "selected": {
              snapshot = message.snapshot;
              sequence = message.cursor?.sequence ?? 0;
              if (!handle) {
                if (message.sessionId === null) {
                  settle(unnamed("Piano answered the creation without a session."));
                  return;
                }
                const messages = message.snapshot.messages;
                handle = {
                  cwd: message.cwd,
                  sessionId: message.sessionId,
                  generation: message.cursor?.generation ?? "",
                  submissionId: null,
                  baselineMessages: messages.length,
                  baselineFingerprint: oversized(snapshot) ? "" : baselineFingerprintOf(messages),
                  inputFingerprint: "",
                  anchorMessageId: null,
                };
                if (reconciling) {
                  settle(
                    result(
                      "created",
                      "uncertain",
                      "Found the original session. Initial observations were missed; nothing was restarted or resent.",
                    ),
                  );
                  return;
                }
                expectedSubmission = (snapshot.state.submission?.id ?? 0) + 1;
                if (oversized(snapshot) || !message.hosted || !message.cursor) {
                  settle(
                    result(
                      "created",
                      "uncertain",
                      "The initial session view cannot be observed safely.",
                    ),
                  );
                  return;
                }
                applyInput();
                return;
              }
              if ((message.cursor?.generation ?? "") !== handle.generation) {
                settle(
                  result(
                    "created",
                    "uncertain",
                    "Pi restarted before this input was acknowledged.",
                  ),
                );
                return;
              }
              if (handle.submissionId === null) {
                settle(
                  result(
                    "created",
                    "uncertain",
                    "The connection was lost before Pi acknowledged this input.",
                  ),
                );
                return;
              }
              applyInput();
              return;
            }
            case "session": {
              if (!snapshot || !handle) return;
              const step = cursorStep({ generation: handle.generation, sequence }, message.cursor);
              if (step === "other-generation" || step === "gap") {
                settle(
                  result(
                    "created",
                    "uncertain",
                    "Initial submission observations were missed or Pi restarted.",
                  ),
                );
                return;
              }
              if (step === "duplicate") return;
              sequence = message.cursor.sequence;
              snapshot = applySessionEvent(snapshot, message.event);
              if (
                oversized(snapshot) ||
                snapshot.state.projectionError ||
                snapshot.state.stateRefreshError
              ) {
                settle(
                  result(
                    "created",
                    "uncertain",
                    "The initial session view cannot be observed safely.",
                  ),
                );
                return;
              }
              if (message.event._tag === "closed") {
                settle(
                  result("created", "uncertain", `Pi stopped: ${message.event.closure.detail}`),
                );
                return;
              }
              if (
                message.event._tag === "message_end" &&
                message.event.message.role === "user" &&
                handle.anchorMessageId === null &&
                snapshot.messages.length > handle.baselineMessages
              )
                handle = { ...handle, anchorMessageId: message.event.message.id };
              applyInput();
              return;
            }
            case "selection_rejected":
            case "selection_failed":
            case "error": {
              const verdict = creationVerdictOf(message, {
                attemptId: inputId!,
                sessionNamed: handle !== null,
              });
              settle(
                verdict.kind === "refused"
                  ? result("refused", "not_sent", verdict.detail)
                  : verdict.kind === "created_not_sent"
                    ? result("created", "not_sent", verdict.detail)
                    : verdict.kind === "created_uncertain"
                      ? result("created", "uncertain", verdict.detail)
                      : unnamed(verdict.detail),
              );
              return;
            }
            default:
              return;
          }
        },
        deadline: () =>
          !link.committed()
            ? unsent("Piano could not be reached before the start deadline.")
            : handle
              ? result(
                  "created",
                  "uncertain",
                  "Pi did not acknowledge this input before the start deadline.",
                )
              : unnamed("Piano did not answer before the start deadline."),
        aborted: () =>
          !link.committed()
            ? unsent("The start was abandoned before it was sent.")
            : handle
              ? result(
                  "created",
                  "uncertain",
                  "Observation was abandoned; the session was left running.",
                )
              : unnamed("Observation was abandoned before Pi named the session."),
      };
    },
  );
}

const closureReading = (closure: SessionClosure, completed: boolean): Reading => {
  const detail = closure.detail;
  switch (closure._tag) {
    case "released":
      return { status: "settled", terminal: true, detail };
    case "released_during_work":
    case "stopped":
      return { status: "cancelled", terminal: true, detail };
    case "exited":
      if (closure.code !== 0) return { status: "failed", terminal: true, detail };
      return completed
        ? { status: "settled", terminal: true, detail }
        : {
            status: "unknown",
            terminal: true,
            detail: `${detail}; no completed response was observed for this input.`,
          };
    case "failed":
      return { status: "failed", terminal: true, detail };
  }
};

interface Attributed {
  readonly answer: string | null;
  readonly attribution: Attribution;
  readonly message?: RenderMsg;
  readonly detail?: string;
  readonly mismatch?: boolean;
  readonly pending?: boolean;
}

function attribute(
  handle: SessionHandle,
  snapshot: Snapshot,
  hosted: boolean,
  generation: string,
): Attributed {
  const mismatch = (detail: string): Attributed => ({
    answer: null,
    attribution: "unattributable",
    detail,
    mismatch: true,
  });
  if (snapshot.state.projectionError || snapshot.state.stateRefreshError)
    return mismatch(snapshot.state.projectionError ?? snapshot.state.stateRefreshError!);
  if (!hosted) return mismatch("The session is not running; only its history is readable.");
  if (generation !== handle.generation)
    return mismatch("Pi restarted; this incarnation cannot answer for that input.");
  if (handle.submissionId === null)
    return mismatch("Pi never acknowledged that input, so no output can be attributed.");
  const submission = snapshot.state.submission;
  if (!submission || submission.id < handle.submissionId)
    return {
      answer: null,
      attribution: "unattributable",
      detail: "Pi has not recorded that input yet.",
      pending: true,
    };
  if (submission.id > handle.submissionId)
    return mismatch("Newer input superseded that submission.");
  const messages = snapshot.messages;
  const baseline = handle.baselineMessages;
  if (
    messages.length < baseline ||
    baselineFingerprintOf(messages.slice(0, baseline)) !== handle.baselineFingerprint
  )
    return mismatch("The transcript was replaced since that input was sent.");
  const after = messages.slice(baseline);
  if (after.some((message) => message.role === "context"))
    return mismatch(
      "Conversation context changed; the initial input's output can no longer be attributed.",
    );
  const prompts = after.filter((message) => message.role === "user");
  if (prompts.length > 1) return mismatch("Later input was sent to this session.");
  if (handle.anchorMessageId !== null && prompts[0]?.id !== handle.anchorMessageId)
    return mismatch("This input's message is no longer where it was recorded.");
  const input = prompts[0];
  if (
    input &&
    (!handle.inputFingerprint ||
      submission.inputFingerprint !== handle.inputFingerprint ||
      input.inputFingerprint !== handle.inputFingerprint)
  )
    return mismatch(
      "The initial input was transformed or replaced; its answer cannot be attributed.",
    );
  if (!input) return { answer: null, attribution: "no-output" };
  const last = after
    .slice(after.indexOf(input) + 1)
    .filter((message) => message.role === "assistant")
    .at(-1);
  if (!last) return { answer: null, attribution: "no-output" };
  return isAnswer(last)
    ? { answer: last.text, attribution: "attributed", message: last }
    : { answer: null, attribution: "no-output", message: last };
}

interface Reading {
  readonly status: WaitStatus;
  readonly detail?: string;
  readonly terminal: boolean;
  readonly needsQuiescence?: boolean;
}

const AWAITING_QUIESCENCE =
  "The run looks finished, but Piano still reports pending work for this session.";

function read(snapshot: Snapshot, attributed: Attributed, completed: boolean): Reading {
  const state = snapshot.state;
  if (attributed.mismatch) return { status: "unknown", terminal: true, detail: attributed.detail };
  if (state.closure) return closureReading(state.closure, completed);
  const submission = state.submission;
  if (submission?.outcome === "rejected" || submission?.outcome === "not_sent")
    return {
      status: "failed",
      terminal: true,
      detail: submission.detail ?? "Pi refused the input.",
    };
  const activity = liveActivityOf(snapshot);
  switch (activity._tag) {
    case "needs_input": {
      const { dialog } = activity;
      return {
        status: "needs_input",
        terminal: true,
        detail: dialogAsks(dialog),
      };
    }
    case "running":
      return { status: "running", terminal: false };
    case "uncertain":
      return { status: "unknown", terminal: true, detail: activity.detail };
    case "idle":
      if (attributed.pending)
        return { status: "running", terminal: false, detail: attributed.detail };
      return {
        status: "running",
        terminal: true,
        needsQuiescence: true,
        detail: AWAITING_QUIESCENCE,
      };
  }
}

function verdict(
  snapshot: Snapshot,
  attributed: Attributed,
  sawResponseCompleted: boolean,
): Reading {
  const submission = snapshot.state.submission;
  if (attributed.attribution === "unattributable")
    return { status: "unknown", terminal: true, detail: attributed.detail };
  const message = attributed.message;
  const stop = message?.stopReason;
  const ending = turnEnding(stop);
  if (ending === "cancelled")
    return { status: "cancelled", terminal: true, detail: `Pi stopped: ${stop}` };
  if (message?.isError || message?.errorMessage)
    return { status: "failed", terminal: true, detail: message.errorMessage };
  if (ending === "failed")
    return { status: "failed", terminal: true, detail: `Pi stopped: ${stop}` };
  if (
    sawResponseCompleted ||
    submission?.outcome === "handled" ||
    attributed.answer !== null ||
    ending === "completed"
  )
    return { status: "settled", terminal: true };
  return {
    status: "unknown",
    terminal: true,
    detail: "Pi is idle, but nothing attributable to that input completed.",
  };
}

function observeHandle(
  handle: SessionHandle,
  deadlineMs: number | undefined,
  environment: SocketEnvironment,
  signal?: AbortSignal,
): Promise<SessionObservation> {
  return observe<SessionObservation>(environment, { deadlineMs, signal }, (link, settle) => {
    let selectionId: string | null = null;
    let snapshot: Snapshot | null = null;
    let hosted = false;
    let generation = "";
    let sequence = 0;
    let fresh = false;
    let sawResponseCompleted = false;
    let attempts = 0;
    let rechecks = 0;
    let recheck: unknown;
    let captured: Attributed | null = null;
    const completed = (attributed: Attributed) =>
      sawResponseCompleted || turnEnding(attributed.message?.stopReason) === "completed";
    const observation = (
      status: WaitStatus,
      ending: WaitEnding,
      detail?: string,
    ): SessionObservation => {
      const current = snapshot
        ? attribute(handle, snapshot, hosted, generation)
        : { answer: null, attribution: "unattributable" as const, detail: "Nothing was observed." };
      const attributed = current.attribution === "unattributable" && captured ? captured : current;
      return {
        handle,
        status,
        ending,
        answer: attributed.answer,
        attribution: attributed.attribution,
        detail: detail ?? attributed.detail,
      };
    };
    let readDeadline: unknown;
    const boundRead = () => {
      if (readDeadline !== undefined) return;
      readDeadline = link.after(READ_DEADLINE_MS, () => {
        settle(
          observation(
            "unknown",
            "observed",
            "Piano could not be read within 30 seconds; inspect the session before waiting again.",
          ),
        );
      });
    };
    const recovered = () => {
      link.cancel(readDeadline);
      readDeadline = undefined;
      attempts = 0;
    };
    const select = () => {
      boundRead();
      selectionId = link.nonce();
      sequence = 0;
      link.send({
        _tag: "select",
        selectionId,
        cwd: handle.cwd,
        sessionId: handle.sessionId,
      });
    };
    const reattach = (detail: string) => {
      boundRead();
      if (attempts >= SELECT_ATTEMPTS) {
        settle(observation("unknown", "observed", detail));
        return;
      }
      link.after(RETRY_DELAY_MS, () => {
        attempts++;
        select();
      });
    };
    const evaluate = () => {
      if (!snapshot) return;
      if (oversized(snapshot)) {
        snapshot = null;
        settle(
          observation(
            "unknown",
            "observed",
            "This session is larger than the dispatch tool will hold; read it in Piano instead.",
          ),
        );
        return;
      }
      const attributed = attribute(handle, snapshot, hosted, generation);
      if (attributed.attribution !== "unattributable") captured = attributed;
      const reading = read(snapshot, attributed, completed(attributed));
      if (!reading.terminal) {
        link.cancel(recheck);
        recheck = undefined;
        return;
      }
      if (!reading.needsQuiescence) {
        settle(observation(reading.status, "observed", reading.detail));
        return;
      }
      const final = verdict(snapshot, attributed, sawResponseCompleted);
      if (fresh && snapshot.state.isQuiescent === true) {
        settle(observation(final.status, "observed", final.detail));
        return;
      }
      if (recheck !== undefined) return;
      if (rechecks >= QUIESCENCE_RECHECKS) {
        settle(observation(reading.status, "observed", reading.detail));
        return;
      }
      recheck = link.after(RECHECK_DELAY_MS, () => {
        recheck = undefined;
        rechecks++;
        select();
      });
    };
    const conclude = (ending: WaitEnding, detail?: string): SessionObservation => {
      const attributed = snapshot
        ? attribute(handle, snapshot, hosted, generation)
        : { answer: null, attribution: "unattributable" as const };
      const reading = snapshot ? read(snapshot, attributed, completed(attributed)) : undefined;
      return observation(reading?.status ?? "unknown", ending, detail ?? reading?.detail);
    };
    boundRead();
    return {
      connected: () => {
        attempts++;
        select();
      },
      disconnected: (fatal) => {
        fresh = false;
        boundRead();
        if (fatal)
          settle(
            observation(
              "unknown",
              "observed",
              "The connection was dropped for a frame over the delivery limit.",
            ),
          );
      },
      message: (message) => {
        if (selectionId === null || selectionOf(message) !== selectionId) return;
        switch (message._tag) {
          case "selected":
            recovered();
            snapshot = message.snapshot;
            hosted = message.hosted;
            generation = message.cursor?.generation ?? "";
            sequence = message.cursor?.sequence ?? 0;
            fresh = true;
            evaluate();
            return;
          case "session": {
            if (!snapshot) return;
            const step = cursorStep({ generation, sequence }, message.cursor);
            if (step === "other-generation") {
              generation = message.cursor.generation;
              evaluate();
              return;
            }
            if (step === "duplicate") return;
            if (step === "gap") {
              snapshot = null;
              reattach("Frames were missed and the session could not be re-read.");
              return;
            }
            sequence = message.cursor.sequence;
            const event = message.event;
            snapshot = applySessionEvent(snapshot, event);
            fresh = false;
            if (event._tag === "response_completed") sawResponseCompleted = true;
            evaluate();
            return;
          }
          case "selection_rejected":
          case "selection_failed":
          case "error":
            reattach(message.message);
            return;
          default:
            return;
        }
      },
      deadline: () => conclude("deadline"),
      aborted: () =>
        conclude("aborted", "Observation was abandoned; the session was left running."),
    };
  });
}

export function waitSessions(
  handles: ReadonlyArray<SessionHandle>,
  timeoutMs: number | undefined,
  environment: SocketEnvironment,
  signal?: AbortSignal,
): Promise<ReadonlyArray<SessionObservation>> {
  const deadlineMs = waitTimeout(timeoutMs);
  const attention = new AbortController();
  const observationSignal = signal ? AbortSignal.any([signal, attention.signal]) : attention.signal;
  return Promise.all(
    handles.map(async (handle): Promise<SessionObservation> => {
      const result = await observeHandle(handle, deadlineMs, environment, observationSignal).catch(
        (error: unknown): SessionObservation => ({
          handle,
          status: "unknown",
          ending: "observed",
          answer: null,
          attribution: "unattributable",
          detail: error instanceof Error ? error.message : String(error),
        }),
      );
      if (result.ending === "aborted" && attention.signal.aborted && !signal?.aborted)
        return {
          ...result,
          ending: "observed",
          detail:
            "Observation ended early because another session needs attention; this worker was not stopped.",
        };
      if (
        result.ending === "observed" &&
        (result.status === "needs_input" ||
          result.status === "unknown" ||
          result.status === "failed" ||
          result.status === "cancelled")
      )
        attention.abort();
      return result;
    }),
  );
}

export interface FollowUpRequest {
  readonly cwd: string;
  readonly sessionId: string;
  readonly text: string;
  readonly delivery: FollowUpDelivery;
}

const FOLLOW_UP_DEADLINE_MS = 30_000;
const FAILURE_GRACE_MS = 1_000;

export function sendFollowUp(
  request: FollowUpRequest,
  environment: SocketEnvironment,
  signal?: AbortSignal,
): Promise<FollowUpResult> {
  const { cwd, sessionId, text, delivery } = request;
  return observe<FollowUpResult>(
    environment,
    { deadlineMs: FOLLOW_UP_DEADLINE_MS, signal },
    (link, settle) => {
      let selectionId: string | null = null;
      let inputId: string | null = null;
      let failed = false;
      let verdict: InputVerdict | undefined;
      let opened: ReadonlySet<string> = new Set();
      const result = (
        submission: FollowUpResult["submission"],
        detail?: string,
      ): FollowUpResult => ({
        sessionId,
        delivery,
        submission,
        ...(detail === undefined ? {} : { detail }),
      });
      const unsent = (detail: string) => result("not_sent", detail);
      const unconfirmed = (detail: string) =>
        result("uncertain", `${detail} Read the session's status before sending again.`);
      const ended = (before: string, after: string) =>
        link.committed() ? unconfirmed(after) : unsent(before);
      const apply = (message: ServerMessage, dialogs: ReadonlyArray<Dialog> = []) => {
        if (inputId === null) return false;
        const next = inputVerdictOf(message);
        if (next?.inputId === inputId) verdict = next;
        const known = dispositionOf(verdict, dialogs, opened);
        if (known) settle(result(known.submission, known.detail));
        return known !== undefined;
      };
      return {
        connected: () => {
          if (link.committed()) {
            settle(unconfirmed("The connection was lost after the message was sent."));
            return;
          }
          selectionId = link.nonce();
          link.send({ _tag: "select", selectionId, cwd, sessionId });
        },
        disconnected: (fatal) => {
          const detail = "The connection was dropped for a frame over the delivery limit.";
          if (fatal) settle(ended(detail, detail));
        },
        message: (message) => {
          if (selectionId === null || selectionOf(message) !== selectionId) return;
          switch (message._tag) {
            case "selected":
              if (inputId === null) {
                if (message.sessionId !== sessionId) {
                  settle(unsent("Piano did not open this session."));
                  return;
                }
                inputId = selectionId;
                opened = new Set(message.snapshot.dialogs.map((d) => d.id));
                const sent = link.commit({
                  _tag: "act",
                  selectionId,
                  action: {
                    _tag: delivery === "steer" ? "steer" : "prompt",
                    text,
                    inputId,
                  },
                  start: {},
                });
                if (!sent) settle(unsent("The connection closed before it could send."));
                return;
              }
              apply(message, message.snapshot.dialogs);
              return;
            case "session": {
              const event = message.event;
              if (event._tag === "snapshot") apply(message, event.snapshot.dialogs);
              else if (event._tag === "dialog") apply(message, [event.dialog]);
              else apply(message);
              return;
            }
            case "selection_rejected":
            case "selection_failed":
            case "error":
              if (!link.committed()) {
                settle(unsent(message.message));
                return;
              }
              if (apply(message) || failed) return;
              failed = true;
              link.after(FAILURE_GRACE_MS, () => settle(unconfirmed(message.message)));
              return;
            default:
              return;
          }
        },
        deadline: () =>
          ended(
            "Piano did not open the session before the deadline.",
            "Pi did not acknowledge the message before the deadline.",
          ),
        aborted: () =>
          ended(
            "The follow-up was abandoned before it was sent.",
            "Observation was abandoned after the message was sent.",
          ),
      };
    },
  );
}

export type StatusTarget = { readonly sessionId: string } | { readonly projectId: string };

export const withLinks = (
  facts: SessionStatusFacts,
  link: (sessionId: string) => string,
): SessionStatus => ({
  ...facts,
  link: link(facts.sessionId),
  needs: facts.needs && { ...facts.needs, link: link(facts.sessionId) },
});

export type StatusReply =
  | { readonly status: "ready"; readonly sessions: ReadonlyArray<SessionStatusFacts> }
  | { readonly status: "unlisted"; readonly detail: string }
  | { readonly status: "error"; readonly detail: string };

export function readStatus(
  target: StatusTarget,
  environment: SocketEnvironment,
  signal?: AbortSignal,
): Promise<StatusReply> {
  return observe<StatusReply>(
    environment,
    { deadlineMs: STATUS_DEADLINE_MS, signal },
    (link, settle) => {
      let requestId: string | null = null;
      return {
        connected: () => {
          requestId = link.nonce();
          link.send({ _tag: "session_status", requestId, target });
        },
        disconnected: (fatal) => {
          if (fatal)
            settle({
              status: "error",
              detail: "The connection was dropped for a frame over the delivery limit.",
            });
        },
        message: (message) => {
          if (message._tag === "session_status" && message.requestId === requestId)
            settle(message.result);
        },
        deadline: () => ({ status: "error", detail: "Piano did not answer before the deadline." }),
        aborted: () => ({ status: "error", detail: "The status read was abandoned." }),
      };
    },
  );
}
