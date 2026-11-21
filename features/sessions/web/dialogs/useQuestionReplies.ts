import { createContext, useContext } from "react";
import type { QuestionReplies } from "./piDialogs.ts";
export const QuestionRepliesContext = createContext<QuestionReplies | null>(null);
export function useQuestionReplies(): QuestionReplies {
  const value = useContext(QuestionRepliesContext);
  if (!value) throw new Error("Missing QuestionReplies provider");
  return value;
}
