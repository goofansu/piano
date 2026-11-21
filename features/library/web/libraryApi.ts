import { call, type RequestOptions } from "../../../web/src/shared/transport/api.ts";
import { libraryEndpoints } from "../contracts/http.ts";

export const listUserSkills = (options?: RequestOptions) =>
  call(libraryEndpoints.skills.list, {}, options);

export const createUserSkill = (body: import("../contracts/skills.ts").UserSkillCreate) =>
  call(libraryEndpoints.skills.create, { body });

export const removeUserSkill = (name: string) =>
  call(libraryEndpoints.skills.remove, { body: { name } });

export const listPrompts = (options?: RequestOptions) =>
  call(libraryEndpoints.prompts.list, {}, options);

export const createPrompt = (body: import("../contracts/prompts.ts").PromptCreate) =>
  call(libraryEndpoints.prompts.create, { body });

export const removePrompt = (name: string) =>
  call(libraryEndpoints.prompts.remove, { body: { name } });
