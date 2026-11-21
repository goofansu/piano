import { libraryEndpoints } from "../../../../shared/features/library/http.ts";
import { call, type RequestOptions } from "../../shared/transport/api.ts";

export const listUserSkills = (options?: RequestOptions) =>
  call(libraryEndpoints.skills.list, {}, options);

export const createUserSkill = (
  body: import("../../../../shared/features/library/skills.ts").UserSkillCreate,
) => call(libraryEndpoints.skills.create, { body });

export const removeUserSkill = (name: string) =>
  call(libraryEndpoints.skills.remove, { body: { name } });

export const listPrompts = (options?: RequestOptions) =>
  call(libraryEndpoints.prompts.list, {}, options);

export const createPrompt = (
  body: import("../../../../shared/features/library/prompts.ts").PromptCreate,
) => call(libraryEndpoints.prompts.create, { body });

export const removePrompt = (name: string) =>
  call(libraryEndpoints.prompts.remove, { body: { name } });
