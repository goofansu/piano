import { Data, Effect } from "effect";
import { type DraftField } from "../../../shared/session/libraryTools.ts";
import {
  LIBRARY_KINDS,
  type LibraryChange,
  type LibraryKind,
} from "../../../shared/session/libraryTools.ts";
import { checkDraft, type Draft } from "../contracts/drafts.ts";
import * as LibraryFile from "./LibraryFile.ts";
import { loadedBeforePiano } from "./PiLoads.ts";

export class LibraryError extends Data.TaggedError("LibraryError")<{
  readonly detail: string;
  readonly field?: DraftField;
}> {}

export interface Shelved<Entry> {
  readonly entry: Entry;
  readonly path: string;
}

export interface Layout<Entry extends { readonly name: string; readonly file: string }, Request> {
  readonly kind: LibraryKind;
  readonly folder: () => string;
  readonly agentDir: () => string;
  readonly shelf: () => Promise<ReadonlyMap<string, Shelved<Entry>>>;
  readonly find: (name: string) => Promise<Shelved<Entry> | undefined>;
  readonly occupied: (name: string) => boolean;
  readonly render: (saved: Draft, request: Request, kept: Entry | undefined) => Entry;
  readonly create: (entry: Entry) => Promise<void>;
  readonly remove: (shelved: Shelved<Entry>) => Promise<void>;
}

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
  const { kind: noun, Noun } = LIBRARY_KINDS[layout.kind];
  const refused = (detail: string, field?: DraftField) =>
    new LibraryError(field ? { detail, field } : { detail });
  const couldNotSave = () => refused(`Could not save ${noun}.`);
  const notFound = (field?: DraftField) => refused(`${Noun} not found.`, field);
  const taken = (name: string) => refused(`A ${noun} named ${name} already exists.`, "name");
  const shadowed = (name: string) =>
    refused(`Pi loads another ${noun} named ${name} instead of this one.`, "name");

  const draft = (request: Request) => {
    const check = checkDraft(request);
    return check.saved
      ? Effect.succeed(check.saved)
      : Effect.fail(new LibraryError(check.problem ?? { detail: `Could not save ${noun}.` }));
  };

  const placeOf = Effect.fn("Library.placeOf")(function* (name: string) {
    const current = yield* Effect.tryPromise({ try: () => layout.find(name), catch: couldNotSave });
    const elsewhere = yield* Effect.tryPromise({
      try: () => loadedBeforePiano(noun, layout.agentDir(), layout.folder()),
      catch: couldNotSave,
    });
    const occupied = yield* Effect.try({ try: () => layout.occupied(name), catch: couldNotSave });
    return { current, occupied, elsewhere: elsewhere.has(name) };
  });

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

  const list = Effect.promise(layout.shelf).pipe(
    Effect.map((entries) =>
      [...entries.values()].map(({ entry }) => entry).sort((a, b) => a.name.localeCompare(b.name)),
    ),
  );

  const plan = Effect.fn("Library.plan")(function* (
    intent: LibraryChange | "propose",
    request: Request,
  ) {
    const saved = yield* draft(request);
    const decision = yield* decide(intent, saved.name, yield* placeOf(saved.name));
    const kept = decision.change === "update" ? decision.current.entry : undefined;
    return { saved, decision, entry: layout.render(saved, request, kept) };
  });

  const propose = Effect.fn("Library.propose")(function* (request: Request) {
    const { decision, entry } = yield* plan("propose", request);
    return decision.change === "update"
      ? { change: decision.change, entry, previous: decision.current.entry.file }
      : { change: decision.change, entry };
  });

  const create = Effect.fn("Library.create")(function* (request: Request) {
    const { saved, entry } = yield* plan("create", request);
    yield* Effect.tryPromise({
      try: () => layout.create(entry),
      catch: (cause) => (code(cause) === "EEXIST" ? taken(saved.name) : couldNotSave()),
    });
    return entry;
  });

  const update = Effect.fn("Library.update")(function* (request: Request & { previous: string }) {
    const changed = () => refused(`This ${noun} changed since it was shown. Review it again.`);
    const { decision, entry } = yield* plan("update", request);
    if (decision.change !== "update") return yield* notFound("name");
    if (decision.current.entry.file !== request.previous) return yield* changed();
    yield* LibraryFile.replace(decision.current.path, request.previous, entry.file).pipe(
      Effect.mapError(({ reason }) =>
        reason === "missing" ? notFound("name") : reason === "changed" ? changed() : couldNotSave(),
      ),
    );
    return entry;
  });

  const remove = Effect.fn("Library.remove")(function* (name: string) {
    const couldNotDelete = () => refused(`Could not delete ${noun}.`);
    const current = yield* Effect.tryPromise({
      try: () => layout.find(name),
      catch: couldNotDelete,
    });
    if (!current) return yield* notFound();
    yield* Effect.tryPromise({
      try: () => layout.remove(current),
      catch: (cause) => (code(cause) === "ENOENT" ? notFound() : couldNotDelete()),
    }).pipe(LibraryFile.alone);
  });

  return { list, propose, create, update, remove };
};
