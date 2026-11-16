import { relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const hasWord = (text) => /[\p{L}\p{N}]/u.test(text);
const ruleNames = String.raw`[@\w][@\w/.-]*(?:\s*,\s*[@\w][@\w/.-]*)*`;
const lintDirective = (tool) =>
  new RegExp(
    `^${tool}-(?:disable(?:-next-line|-line)?|enable)\\s+${ruleNames}\\s+--\\s+(\\S[\\s\\S]*)$`,
  );
const jsLintDirective = lintDirective("(?:oxlint|eslint)");
const cssLintDirective = lintDirective("stylelint");

export const commentPolicyMessage =
  "Remove narration, move necessary explanations to the owning docs, or use WORKAROUND(tool/platform): concrete problem or trigger. Preserve recognized tooling directives and legal notices.";

export function authoredCommentFile(filename) {
  const path = relative(root, filename).split(sep).join("/");
  if (!/\.(?:[cm]?js|jsx|[cm]?ts|tsx|css)$/.test(path)) return false;
  if (
    path.startsWith("web/src/components/ui/") ||
    path === "web/src/hooks/use-mobile.ts" ||
    path.startsWith("web/public/") ||
    path.startsWith("web/dist/")
  )
    return false;
  return (
    /^(?:server|shared|web|scripts|test|extensions|\.husky)\//.test(path) ||
    /^[^/]+\.mjs$/.test(path)
  );
}

export function allowedComment(value, kind, language) {
  if (kind === "Shebang") return true;
  const text =
    kind === "Block" && value.startsWith("*")
      ? value
          .replace(/^\* ?/, "")
          .replace(/\n[ \t]*\* ?/g, "\n")
          .trim()
      : value.trim();
  const workaround = /^WORKAROUND\(([^()\r\n]+)\):\s*(\S[\s\S]*)$/.exec(text);
  if (workaround && hasWord(workaround[1]) && hasWord(workaround[2])) return true;

  const legal = text.replace(/^!\s*/, "");
  if (/^(?:@license\s+)?Copyright\s+(?:\(c\)\s*|©\s*)?\d{4}(?:[-, ]+\d{4})*\s+\S/i.test(legal))
    return true;
  if (
    /^(?:SPDX-License-Identifier:|@license)\s+[A-Za-z0-9][A-Za-z0-9.+-]*(?:\s+(?:AND|OR|WITH)\s+[A-Za-z0-9][A-Za-z0-9.+-]*)*$/.test(
      legal,
    )
  )
    return true;

  const directive = (language === "css" ? cssLintDirective : jsLintDirective).exec(value.trim());
  if (directive && hasWord(directive[1])) return true;
  if (language === "css") return false;

  if (kind === "Line") {
    if (/^@ts-expect-error(?:\s|:)+(\S.*)$/.test(text) && hasWord(text.slice(16))) return true;
    if (text === "@ts-check") return true;
    return (
      value.startsWith("/") &&
      /^\/\s*<reference\s+(?:(?:lib|path|types)=(?:"[^"\r\n]+"|'[^'\r\n]+')|no-default-lib=(?:"true"|'true'))\s*\/>$/.test(
        text,
      )
    );
  }
  if (/^(?:[@#]__(?:PURE|NO_SIDE_EFFECTS)__|@vite-ignore)$/.test(value.trim())) return true;
  return (
    value.startsWith("*") &&
    /^@type\s+\{import\((?:"[^"\r\n]+"|'[^'\r\n]+')\)(?:\.[A-Za-z_$][\w$]*)+\}$/.test(text)
  );
}

export const commentPolicyRule = {
  meta: {
    type: "suggestion",
    schema: [],
    messages: { comment: commentPolicyMessage },
  },
  create(context) {
    if (!authoredCommentFile(context.filename)) return {};
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (!allowedComment(comment.value, comment.type, "js"))
            context.report({ loc: comment.loc, messageId: "comment" });
        }
      },
    };
  },
};
