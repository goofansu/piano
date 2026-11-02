/**
 * Piano's library: the skills and prompts it keeps in its own folders, which every Pi child it
 * starts loads last (`--skill`, `--prompt-template`, main.ts). This module decides every save and
 * delete once, for both kinds; a `Layout` says only how its kind sits on disk.
 *
 * What a save of a name meets decides what it does:
 * - Piano's own entry of that name: a proposal or an update replaces its file, only as the person
 *   saw it (`LibraryFile.replace`); a create is refused, never overwritten.
 * - Anything else of that name in Piano's folder, or a name Pi loads from another folder first
 *   (`PiLoads.ts`): refused as taken, and an update as not found.
 * - Piano's entry while Pi loads another of that name first: a proposal or update is refused, since
 *   the change would never reach a session; a delete still removes Piano's.
 * - Nothing: a proposal or a create makes a new entry; an update is refused as not found.
 *
 * Pi owns loading (INV-01, INV-12): a layout lists its folder with Pi's own rules, and skills or
 * prompts anywhere else are read only to tell whether Pi loads a name first. Nothing here changes a
 * running session: one started from now loads the new set.
 */
import { Data, Effect } from "effect";
import { checkDraft, type Draft, type DraftField } from "../shared/drafts.ts";
import type { LibraryChange, LibraryKind } from "../shared/library.ts";
import * as LibraryFile from "./LibraryFile.ts";
import { loadedBeforePiano } from "./PiLoads.ts";

/** A refusal written for people; `field` names the editor field it belongs to, if any. */
export class LibraryError extends Data.TaggedError("LibraryError")<{
  readonly detail: string;
  readonly field?: DraftField;
}> {}

/** One of Piano's entries as Pi loads it from Piano's folder, with the file a replace writes. */
export interface Shelved<Entry> {
  readonly entry: Entry;
  readonly path: string;
}

/** How one kind of entry sits in Piano's folder. */
export interface Layout<Entry extends { readonly name: string; readonly file: string }, Request> {
  readonly kind: LibraryKind;
  /** Piano's folder for this kind. */
  readonly folder: () => string;
  /** Pi's agent folder, whose settings, packages and folders Pi loads before Piano's. */
  readonly agentDir: () => string;
  /** Piano's entries by the name Pi loads each as, only those in Piano's layout and not links, so
   * nothing here reaches outside the folder. Fails only when the folder cannot be read. */
  readonly shelf: () => Promise<ReadonlyMap<string, Shelved<Entry>>>;
  /** Whether anything at all of `name` is in Piano's folder or loaded from it, entry or not. */
  readonly occupied: (name: string) => boolean;
  /** The entry a save of `saved` writes. `kept` is the entry a proposal would replace, whose
   * settings the draft does not set are kept. */
  readonly render: (saved: Draft, request: Request, kept: Entry | undefined) => Entry;
  /** Write a new entry's file, never over anything: throws an `EEXIST` error when the name is taken. */
  readonly create: (entry: Entry) => Promise<void>;
  /** Delete one of Piano's entries. */
  readonly remove: (shelved: Shelved<Entry>) => Promise<void>;
}

/** What a save does: make a new entry, or replace Piano's `current` one. */
type Decision<Entry> =
  | { readonly change: "create" }
  | { readonly change: "update"; readonly current: Shelved<Entry> };

const code = (cause: unknown) =>
  cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;

export const makeLibrary = <
  Entry extends { readonly name: string; readonly file: string },
  Request extends Draft,
>(
  layout: Layout<Entry, Request>,
) => {
  const noun = layout.kind;
  const Noun = `${noun[0]?.toUpperCase()}${noun.slice(1)}`;
  const refused = (detail: string, field?: DraftField) =>
    new LibraryError(field ? { detail, field } : { detail });
  const couldNotSave = () => refused(`Could not save ${noun}.`);
  const notFound = (field?: DraftField) => refused(`${Noun} not found.`, field);
  const taken = (name: string) => refused(`A ${noun} named ${name} already exists.`, "name");
  const shadowed = (name: string) =>
    refused(`Pi loads another ${noun} named ${name} instead of this one.`, "name");

  const shelf = (failure: () => LibraryError) =>
    Effect.tryPromise({ try: layout.shelf, catch: failure });

  /** The draft as it would be saved, or the refusal of the first field that cannot be. */
  const draft = (request: Request) => {
    const check = checkDraft(request);
    return check.saved
      ? Effect.succeed(check.saved)
      : Effect.fail(new LibraryError(check.problem ?? { detail: `Could not save ${noun}.` }));
  };

  /**
   * What a save of `name` meets: Piano's entry of that name, if any; whether anything else holds
   * the name in Piano's folder; and whether Pi loads that name from another folder first.
   */
  const placeOf = Effect.fn("Library.placeOf")(function* (name: string) {
    const current = (yield* shelf(couldNotSave)).get(name);
    const elsewhere = yield* Effect.tryPromise({
      try: () => loadedBeforePiano(noun, layout.agentDir(), layout.folder()),
      catch: couldNotSave,
    });
    return { current, occupied: layout.occupied(name), elsewhere: elsewhere.has(name) };
  });

  /** The one decision: what a save of the name does, given what it meets; an update names the
   * entry it replaces. */
  const decide = (
    intent: LibraryChange | "propose",
    name: string,
    place: Effect.Success<ReturnType<typeof placeOf>>,
  ): Effect.Effect<Decision<Entry>, LibraryError> => {
    const { current } = place;
    if (current) {
      if (intent === "create") return Effect.fail(taken(name));
      if (place.elsewhere) return Effect.fail(shadowed(name));
      return Effect.succeed({ change: "update", current });
    }
    if (intent === "update") return Effect.fail(notFound("name"));
    if (place.occupied || place.elsewhere) return Effect.fail(taken(name));
    return Effect.succeed({ change: "create" });
  };

  /** Piano's entries by name. */
  const list = shelf(() => refused(`Could not load ${noun}s.`)).pipe(
    Effect.map((entries) =>
      [...entries.values()].map(({ entry }) => entry).sort((a, b) => a.name.localeCompare(b.name)),
    ),
  );

  /** What saving `request` would do, refused as the save would refuse it; writes nothing. */
  const propose = Effect.fn("Library.propose")(function* (request: Request) {
    const saved = yield* draft(request);
    const place = yield* placeOf(saved.name);
    const decision = yield* decide("propose", saved.name, place);
    const entry = layout.render(saved, request, place.current?.entry);
    return decision.change === "update"
      ? { change: decision.change, entry, previous: decision.current.entry.file }
      : { change: decision.change, entry };
  });

  /** Save a new entry; a name already taken is refused, never overwritten. */
  const create = Effect.fn("Library.create")(function* (request: Request) {
    const saved = yield* draft(request);
    yield* decide("create", saved.name, yield* placeOf(saved.name));
    const entry = layout.render(saved, request, undefined);
    yield* Effect.tryPromise({
      try: () => layout.create(entry),
      catch: (cause) => (code(cause) === "EEXIST" ? taken(saved.name) : couldNotSave()),
    });
    return entry;
  });

  /** Replace Piano's entry, only while its file is still `previous`, the text the person saw. */
  const update = Effect.fn("Library.update")(function* (request: Request & { previous: string }) {
    const saved = yield* draft(request);
    const decision = yield* decide("update", saved.name, yield* placeOf(saved.name));
    if (decision.change !== "update") return yield* notFound("name");
    const entry = layout.render(saved, request, undefined);
    yield* LibraryFile.replace(decision.current.path, request.previous, entry.file).pipe(
      Effect.mapError(({ reason }) =>
        reason === "missing"
          ? notFound("name")
          : reason === "changed"
            ? refused(`This ${noun} changed since it was shown. Review it again.`)
            : couldNotSave(),
      ),
    );
    return entry;
  });

  /** Delete Piano's entry by the name Pi loads it as, even one Pi loads another of first. */
  const remove = Effect.fn("Library.remove")(function* (name: string) {
    const couldNotDelete = () => refused(`Could not delete ${noun}.`);
    const current = (yield* shelf(couldNotDelete)).get(name);
    if (!current) return yield* notFound();
    yield* Effect.tryPromise({
      try: () => layout.remove(current),
      catch: (cause) => (code(cause) === "ENOENT" ? notFound() : couldNotDelete()),
    }).pipe(LibraryFile.alone);
  });

  return { list, propose, create, update, remove };
};
