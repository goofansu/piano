import { Schema } from "effect";
import { endpoint, type Json } from "../../../shared/endpoint.ts";
import {
  LIBRARY_KINDS,
  type LibraryKind,
  type LibraryKindWords,
} from "../../../shared/session/libraryTools.ts";
import { Prompt, PromptCreate, PromptProposal, PromptUpdate } from "./prompts.ts";
import { UserSkill, UserSkillCreate, UserSkillProposal, UserSkillUpdate } from "./skills.ts";

const collectionEndpoints = <E extends Json, C extends Json, U extends Json, P extends Json>(
  { kind, Noun }: LibraryKindWords,
  schemas: { entry: E; create: C; update: U; proposal: P },
) => {
  const path: `/api/settings/${LibraryKind}s` = `/api/settings/${kind}s`;
  const shared = { noStore: true, redact: false } as const;
  const save = {
    ...shared,
    invalid: "Enter a name, a description and instructions.",
    refused: 400,
  } as const;
  return {
    list: endpoint({
      ...shared,
      method: "GET",
      path,
      response: Schema.Array(schemas.entry),
      fallback: `Could not load ${kind}s.`,
    }),
    create: endpoint({
      ...save,
      method: "POST",
      path,
      body: schemas.create,
      response: schemas.entry,
      fallback: `Could not create ${kind}.`,
    }),
    propose: endpoint({
      ...save,
      method: "POST",
      path: `${path}/proposal`,
      body: schemas.create,
      response: schemas.proposal,
      fallback: `Could not save ${kind}.`,
    }),
    update: endpoint({
      ...save,
      method: "PUT",
      path,
      body: schemas.update,
      response: schemas.entry,
      fallback: `Could not save ${kind}.`,
    }),
    remove: endpoint({
      method: "POST",
      path: `${path}/remove`,
      body: Schema.Struct({ name: Schema.String }),
      invalid: `${Noun} name required.`,
      response: Schema.Struct({ ok: Schema.Literal(true) }),
      noStore: true,
      refused: 400,
      fallback: `Could not delete ${kind}.`,
    }),
  };
};

export const libraryEndpoints = {
  skills: collectionEndpoints(LIBRARY_KINDS.skill, {
    entry: UserSkill,
    create: UserSkillCreate,
    update: UserSkillUpdate,
    proposal: UserSkillProposal,
  }),
  prompts: collectionEndpoints(LIBRARY_KINDS.prompt, {
    entry: Prompt,
    create: PromptCreate,
    update: PromptUpdate,
    proposal: PromptProposal,
  }),
} as const;
