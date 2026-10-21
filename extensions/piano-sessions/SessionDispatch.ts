/**
 * Starting and observing Piano sessions from a Pi extension, over the browser's own transport
 * (`openConnection`) and wire vocabulary. A tool invocation owns its connections: a start opens
 * one, a wait opens one per handle, and each closes with its timers when its call returns. There
 * is no worker, registry or shared map; everything a later call needs travels in the handle the
 * model keeps in its tool history.
 *
 * Attribution is conservative. An answer is returned only while the facts that tie it to this
 * handle's input still hold: the same child incarnation, the same submission, the same transcript
 * prefix, and no later input of anyone else's. Anything else is reported as unattributable rather
 * than guessed, because Pi has no durable receipt for a prompt. An answer already observed is
 * kept: later interference cannot retract what this call saw.
 */
import { createHash } from "node:crypto";
import type {
  Attribution,
  CreatedWorktree,
  SessionCreation,
  SessionHandle,
  SessionObservation,
  SessionStatus,
  SessionSubmission,
  StartResult,
  WaitEnding,
  WaitStatus,
  WorktreeRequest,
} from "../../shared/dispatch.ts";
import { applySessionEvent, cursorStep } from "../../shared/sessionProjection.ts";
import { liveActivityOf } from "../../shared/sessionStatus.ts";
import { turnEnding } from "../../shared/turnEnding.ts";
import type {
  ClientMessage,
  RenderMsg,
  ServerMessage,
  SessionClosure,
  SessionStatusFacts,
  Snapshot,
  ThinkingLevel,
} from "../../shared/wire.ts";
import { type Connection, openConnection, type SocketEnvironment } from "../../web/src/lib/ws.ts";

// ── Public vocabulary ───────────────────────────────────────────────────────

export interface StartRequest {
  readonly prompt: string;
  /** The session's directory; with `worktree`, the checkout whose repository it branches from. */
  readonly cwd: string;
  /** Start in a new worktree Piano creates; a failure creates no session. */
  readonly worktree?: WorktreeRequest;
  readonly model?: string;
  readonly thinkingLevel?: ThinkingLevel;
  /** The dispatching session, recorded in the new one's history for its backlink. */
  readonly dispatchedFrom?: string;
}

export type {
  Attribution,
  SessionCreation,
  SessionHandle,
  SessionObservation,
  StartResult,
  WaitEnding,
} from "../../shared/dispatch.ts";

/** A wait's bounds. A model asking for less than a second, or for an hour, gets neither. */
export const WAIT_DEFAULT_MS = 30_000;
export const WAIT_MIN_MS = 1_000;
export const WAIT_MAX_MS = 60_000;
/** A start waits this long for creation and the input's acknowledgement. */
const START_DEADLINE_MS = 30_000;
/** Re-selects allowed to confirm quiescence after the session looks finished. */
const QUIESCENCE_RECHECKS = 3;
/** Milliseconds between those re-selects. */
const RECHECK_DELAY_MS = 250;
/** Attempts to attach before a wait reports that it could not observe the session. */
const SELECT_ATTEMPTS = 3;
/** Milliseconds before retrying a refused or failed attach. */
const RETRY_DELAY_MS = 500;
/** How much of a session a wait is willing to hold in memory before it gives up on observing it. */
const MAX_VIEW_MESSAGES = 5_000;
const MAX_VIEW_CHARS = 4_000_000;

export const waitTimeout = (timeoutMs: number | undefined): number =>
  timeoutMs === undefined || !Number.isFinite(timeoutMs)
    ? WAIT_DEFAULT_MS
    : Math.min(WAIT_MAX_MS, Math.max(WAIT_MIN_MS, Math.trunc(timeoutMs)));

const fingerprint = (text: string): string => createHash("sha256").update(text).digest("hex");
const baselineFingerprintOf = (messages: ReadonlyArray<RenderMsg>): string =>
  fingerprint(JSON.stringify(messages.map((m) => [m.id, m.role, m.text, m.toolCalls ?? null])));

/** Includes tool arguments, pending output and attachments, not only finalized message text. */
const oversized = (snapshot: Snapshot): boolean =>
  snapshot.messages.length > MAX_VIEW_MESSAGES || JSON.stringify(snapshot).length > MAX_VIEW_CHARS;

// ── One connection, its deadline and its cleanup ────────────────────────────

/** What an observation may do while it runs. Timers and the socket belong to `observe`. */
interface Link {
  readonly send: (message: ClientMessage) => void;
  readonly nonce: () => string;
  readonly after: (ms: number, run: () => void) => unknown;
  readonly cancel: (timer: unknown) => void;
}

interface Observer<T> {
  /** The socket is up, for the first time or after a loss: issue what this observation needs. */
  readonly connected: () => void;
  /** The socket is down; `fatal` means this connection will not come back. */
  readonly disconnected: (fatal: boolean) => void;
  readonly message: (message: ServerMessage) => void;
  /** The observation deadline passed. */
  readonly deadline: () => T;
  /** The caller abandoned the observation. Pi is never told. */
  readonly aborted: () => T;
}

/**
 * Runs one observation over one connection and resolves exactly once: with the observer's own
 * conclusion, with its deadline value or with its aborted value. Closes the socket and clears
 * every timer it started, whichever of those happens.
 */
function observe<T>(
  environment: SocketEnvironment,
  options: { readonly deadlineMs: number; readonly signal?: AbortSignal },
  create: (link: Link, settle: (value: T) => void) => Observer<T>,
): Promise<T> {
  return new Promise<T>((resolve) => {
    let connection: Connection | null = null;
    let done = false;
    const timers = new Set<unknown>();
    const link: Link = {
      send: (message) => connection?.send(message),
      nonce: () => environment.nonce(),
      after: (ms, run) => {
        const timer = environment.setTimeout(() => {
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
    link.after(options.deadlineMs, () => settle(observer.deadline()));
    connection = openConnection(
      {
        onMessage: (message) => {
          if (!done) observer.message(message);
        },
        onStatus: (connected, reason) => {
          if (done) return;
          if (connected) observer.connected();
          else observer.disconnected(reason === "too-large");
        },
      },
      environment,
    );
    // A conclusion reached while the socket was being opened still closes it.
    if (done) connection.close();
  });
}

/** The selection a reply belongs to, when the message carries one. */
const selectionOf = (message: ServerMessage): string | undefined =>
  "selectionId" in message ? message.selectionId : undefined;

// ── Starting a session ──────────────────────────────────────────────────────

/**
 * Creates a session in `cwd` and sends `prompt` as its first input, then returns as soon as Pi's
 * handling of that input is known — including when Pi answers with a dialog, which it cannot
 * resolve on its own. `create_session` is sent exactly once: a connection lost before the session
 * is named leaves creation uncertain rather than creating a second session, and a loss after it
 * only re-attaches by identity.
 */
export function startSession(
  request: StartRequest,
  environment: SocketEnvironment,
  signal?: AbortSignal,
): Promise<StartResult> {
  const { cwd, prompt, model, thinkingLevel, dispatchedFrom, worktree } = request;
  return observe<StartResult>(
    environment,
    { deadlineMs: START_DEADLINE_MS, signal },
    (link, settle) => {
      let selectionId: string | null = null;
      let inputId: string | null = null;
      let requested = false;
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
        // A session exists only once its worktree was created, at the path Piano placed it in.
        worktree:
          handle && worktree
            ? ({ path: handle.cwd, branch: worktree.branch.trim() } satisfies CreatedWorktree)
            : null,
        detail,
      });
      const unnamed = (detail: string) => result("uncertain", "uncertain", detail);
      const mine = (message: ServerMessage) =>
        selectionId !== null && selectionOf(message) === selectionId;
      /** Settles once this input's own submission is final; `submitting` is not an outcome. */
      const applySubmission = () => {
        const submission = snapshot?.state.submission;
        if (!submission || !handle) return;
        // The id is this child's counter: observing it is what lets a later wait attribute output.
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
        if (submission.outcome === "submitting") return;
        settle(result("created", submission.outcome, submission.detail));
      };
      /** A dialog blocks the input until a person answers; the caller hears that now, not in 30s. */
      const applyDialogs = () => {
        const dialog = snapshot?.dialogs[0];
        if (!dialog || !handle) return;
        settle(
          result(
            "created",
            "waiting_for_input",
            dialog.message ?? dialog.title ?? `Pi is waiting for a ${dialog.method} answer.`,
          ),
        );
      };
      return {
        connected: () => {
          if (!requested) {
            requested = true;
            selectionId = link.nonce();
            inputId = selectionId;
            link.send({
              _tag: "create_session",
              selectionId,
              cwd,
              options: { model, thinkingLevel, dispatchedFrom },
              ...(worktree ? { worktree } : {}),
              text: prompt,
            });
            return;
          }
          // Only an identity may be re-sent. Creating again would start a second session for
          // one request, and no acknowledgement is worth that.
          if (!handle) {
            settle(unnamed("The connection was lost before Pi named the session."));
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
          if (!handle)
            settle(
              unnamed(
                fatal
                  ? "The connection was dropped for a frame over the delivery limit, before Pi named the session."
                  : "The connection was lost before Pi named the session.",
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
                  // Piano's spelling of the directory, not the caller's.
                  cwd: message.cwd,
                  sessionId: message.sessionId,
                  generation: message.cursor?.generation ?? "",
                  submissionId: null,
                  // Taken before the prompt is sent, so startup output is never read as an answer.
                  baselineMessages: messages.length,
                  baselineFingerprint: oversized(snapshot) ? "" : baselineFingerprintOf(messages),
                  inputFingerprint: "", // Filled only by this submission's server-owned proof.
                  anchorMessageId: null,
                };
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
                applyDialogs();
                return;
              }
              // A re-attach after a loss. Only this incarnation can report on this input.
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
              applyDialogs();
              applySubmission();
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
              // The user message Pi records for this prompt anchors later attribution. Pi
              // acknowledges input before it records it, so it may never arrive in time.
              if (
                message.event._tag === "message_end" &&
                message.event.message.role === "user" &&
                handle.anchorMessageId === null &&
                snapshot.messages.length > handle.baselineMessages
              )
                handle = { ...handle, anchorMessageId: message.event.message.id };
              applyDialogs();
              applySubmission();
              return;
            }
            case "selection_rejected":
              settle(
                handle
                  ? result("created", "uncertain", message.message)
                  : result("refused", "not_sent", message.message),
              );
              return;
            // `selection_failed` answers an attach; creation fails with `error`. Either way an
            // admitted request may already have created the session and sent its input.
            case "selection_failed":
            case "error":
              settle(
                handle ? result("created", "uncertain", message.message) : unnamed(message.message),
              );
              return;
            default:
              return;
          }
        },
        deadline: () =>
          handle
            ? result(
                "created",
                "uncertain",
                "Pi did not acknowledge this input before the start deadline.",
              )
            : unnamed("Piano did not answer before the start deadline."),
        aborted: () =>
          handle
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

// ── Observing sessions ──────────────────────────────────────────────────────

/**
 * What a stopped child proves. An ordinary exit is not evidence that this input's work finished:
 * Pi can exit zero with the run abandoned, so that needs separate completion evidence.
 */
const closureReading = (closure: SessionClosure, completed: boolean): Reading => {
  const detail = closure.detail;
  switch (closure._tag) {
    case "released":
      return { status: "settled", terminal: true, detail };
    case "released_during_work":
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
  /** The last reply of this input's turn, even when it has no text: it carries how the turn ended. */
  readonly message?: RenderMsg;
  readonly detail?: string;
  /** The session is no longer this handle's to read: stop observing and say so. */
  readonly mismatch?: boolean;
  /** Pi has not recorded this input yet: what the session shows is older than the prompt. */
  readonly pending?: boolean;
}

/**
 * The finalized assistant text this handle's input produced, if the facts still tie it to that
 * input. Partial replies are never read: only a message Pi finished is an answer.
 */
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
  // A remembered closure in saved history cannot speak for this handle's live input.
  if (!hosted) return mismatch("The session is not running; only its history is readable.");
  if (generation !== handle.generation)
    return mismatch("Pi restarted; this incarnation cannot answer for that input.");
  if (handle.submissionId === null)
    return mismatch("Pi never acknowledged that input, so no output can be attributed.");
  const submission = snapshot.state.submission;
  // An idle session whose last submission predates this one has not acted on it yet: that is
  // something to keep waiting for, not a finished run to report.
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
  // A second user message is someone else's input, whatever the submission counter says.
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
  // A handled command may have no user message at all. Never adopt unrelated startup output.
  if (!input) return { answer: null, attribution: "no-output" };
  const last = after
    .slice(after.indexOf(input) + 1)
    .filter((message) => message.role === "assistant")
    .at(-1);
  if (!last) return { answer: null, attribution: "no-output" };
  return last.text.trim().length > 0 && last.stopReason !== "toolUse"
    ? { answer: last.text, attribution: "attributed", message: last }
    : { answer: null, attribution: "no-output", message: last };
}

/** What the live facts say, and whether anything more can arrive without a person acting. */
interface Reading {
  readonly status: WaitStatus;
  readonly detail?: string;
  /** Nothing more will arrive on its own. */
  readonly terminal: boolean;
  /** Terminal only once the host confirms it has no pending work. */
  readonly needsQuiescence?: boolean;
}

/**
 * The session's own facts, in the order that decides them. A closure, a mismatch or a projection
 * failure ends observation at once — even mid-run — because waiting longer cannot improve them.
 */
function read(snapshot: Snapshot, attributed: Attributed, completed: boolean): Reading {
  const state = snapshot.state;
  // Attribution owns view validity, including history-only and projection failures. No lifecycle
  // fact may bypass that gate; output already captured is retained separately by observation.
  if (attributed.mismatch) return { status: "unknown", terminal: true, detail: attributed.detail };
  if (state.closure) return closureReading(state.closure, completed);
  const submission = state.submission;
  if (submission?.outcome === "rejected")
    return {
      status: "failed",
      terminal: true,
      detail: submission.detail ?? "Pi refused the input.",
    };
  // This input's own delivery is uncertain: nothing later in the session can settle it.
  if (submission?.outcome === "uncertain")
    return {
      status: "unknown",
      terminal: true,
      detail: submission.detail ?? "Prompt delivery is uncertain.",
    };
  const activity = liveActivityOf(snapshot);
  switch (activity._tag) {
    case "needs_input": {
      const { dialog } = activity;
      return {
        status: "waiting_for_input",
        terminal: true,
        detail: dialog.message ?? dialog.title ?? `Pi is waiting for a ${dialog.method} answer.`,
      };
    }
    case "running":
      return { status: "running", terminal: false };
    // Pi may act on it or never do anything, and never becomes quiescent: as status reads it.
    case "uncertain":
      return { status: "unknown", terminal: true, detail: activity.detail };
    case "idle":
      if (attributed.pending)
        return { status: "running", terminal: false, detail: attributed.detail };
      return { status: "unknown", terminal: true, needsQuiescence: true };
  }
}

/** The verdict for an idle, quiescent session, from the facts it kept about this input. */
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
  // An interrupted turn often also carries an error: the interruption is the better answer.
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

/**
 * Observes one session for one handle on its own connection. Quiescence is read from a snapshot
 * a `select` just produced: after a run drains, live events no longer report the host's pending
 * work, so a terminal-looking session is re-selected (a bounded number of times) before it is
 * called settled. Nothing here mutates the session: only `select` is ever sent.
 */
function observeHandle(
  handle: SessionHandle,
  deadlineMs: number,
  environment: SocketEnvironment,
  signal?: AbortSignal,
): Promise<SessionObservation> {
  return observe<SessionObservation>(environment, { deadlineMs, signal }, (link, settle) => {
    let selectionId: string | null = null;
    let snapshot: Snapshot | null = null;
    let hosted = false;
    let generation = "";
    let sequence = 0;
    /** The snapshot came from a `select` and no live event has been folded into it since. */
    let fresh = false;
    let sawResponseCompleted = false;
    let attempts = 0;
    let rechecks = 0;
    let recheck: unknown;
    /** Latest attributable finalized output, including an empty reply; survives interference. */
    let captured: Attributed | null = null;
    /** Positive evidence that this input's turn finished, rather than merely stopped arriving. */
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
      // A captured answer outlives later interference; a fresh one supersedes nothing it had.
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
    const select = () => {
      selectionId = link.nonce();
      sequence = 0;
      link.send({
        _tag: "select",
        selectionId,
        cwd: handle.cwd,
        sessionId: handle.sessionId,
      });
    };
    /** Attaches again, up to the attempt bound, rather than trusting an incomplete view. */
    const reattach = (detail: string) => {
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
      // Output attribution does not depend on execution ending: message_end can arrive while
      // still streaming. Retain empty newer replies too, never falling back to older text.
      if (attributed.attribution !== "unattributable") captured = attributed;
      const reading = read(snapshot, attributed, completed(attributed));
      if (!reading.terminal) {
        link.cancel(recheck);
        recheck = undefined;
        return;
      }
      if (!reading.needsQuiescence) {
        // Retain already observed output, but interference before quiescence cannot certify settlement.
        settle(observation(reading.status, "observed", reading.detail));
        return;
      }
      const final = verdict(snapshot, attributed, sawResponseCompleted);
      // Only a snapshot this attach just produced reports the host's pending work.
      if (fresh && snapshot.state.isQuiescent === true) {
        settle(observation(final.status, "observed", final.detail));
        return;
      }
      if (recheck !== undefined) return;
      if (rechecks >= QUIESCENCE_RECHECKS) {
        settle(
          observation(
            "running",
            "observed",
            "The run looks finished, but Piano still reports pending work for this session.",
          ),
        );
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
      return observation(
        reading && !reading.terminal ? "running" : (reading?.status ?? "unknown"),
        ending,
        detail ?? reading?.detail,
      );
    };
    return {
      connected: () => {
        attempts++;
        select();
      },
      disconnected: (fatal) => {
        fresh = false;
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
            snapshot = message.snapshot;
            hosted = message.hosted;
            generation = message.cursor?.generation ?? "";
            sequence = message.cursor?.sequence ?? 0;
            fresh = true;
            evaluate();
            return;
          case "session": {
            if (!snapshot) return;
            // A frame of another incarnation, or a gap in this one, cannot be folded into
            // this view: the cursor is the only ordering this attachment has.
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

/**
 * Observes each handle on its own connection, up to a shared deadline (30 seconds by default,
 * never under a second or over a minute). Every handle is reported: a handle that could not be
 * observed, timed out or was abandoned produces an observation that says so, not a missing row
 * and not a rejected promise.
 */
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
      // A deadline or caller cancellation ends observation, not the child's work. Only an
      // observed outcome can require attention and shorten the other handles' observations.
      if (
        result.ending === "observed" &&
        (result.status === "waiting_for_input" ||
          result.status === "unknown" ||
          result.status === "failed" ||
          result.status === "cancelled")
      )
        attention.abort();
      return result;
    }),
  );
}

// ── Reading status ──────────────────────────────────────────────────────────

/** A status read waits this long for Piano's answer, which may include a GitHub lookup. */
const STATUS_DEADLINE_MS = 30_000;

export type StatusTarget = { readonly sessionId: string } | { readonly projectId: string };

/** A status with the links its reader opens: the session, and the dialog it needs answered there. */
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
  | { readonly status: "error"; readonly detail: string };

/**
 * One read of sessions' status: a session by ID, or a project's active sessions. It mutates
 * nothing, so a connection lost before the answer simply asks again.
 */
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
