import {
  LIBRARY_KINDS,
  type LibraryKind,
  type LibraryChange,
} from "../../../shared/session/libraryTools.ts";
import type { Draft } from "./drafts.ts";

export interface SkillDraft extends Draft {
  disableModelInvocation: boolean;
}

export const skillFile = ({
  name,
  description,
  instructions,
  disableModelInvocation,
}: SkillDraft) =>
  [
    "---",
    `name: ${JSON.stringify(name)}`,
    `description: ${JSON.stringify(description)}`,
    ...(disableModelInvocation ? ["disable-model-invocation: true"] : []),
    "---",
    "",
    `${instructions.trimEnd()}\n`,
  ].join("\n");

export const promptFile = ({
  description,
  instructions,
}: Pick<Draft, "description" | "instructions">) =>
  [
    "---",
    `description: ${JSON.stringify(description.trim())}`,
    "---",
    `${instructions.trim()}\n`,
  ].join("\n");

export const savedToast = (kind: LibraryKind, change: LibraryChange) =>
  `${LIBRARY_KINDS[kind].Noun} ${change === "create" ? "created" : "saved"}`;
