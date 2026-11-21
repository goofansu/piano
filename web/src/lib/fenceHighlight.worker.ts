import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { bundledLanguagesInfo } from "shiki/langs";
import { bundledThemes } from "shiki/themes";
import type { FenceRequest, FenceResponse, FenceToken } from "./fenceHighlight.ts";

const languages = new Map(
  bundledLanguagesInfo.flatMap((info) =>
    [info.id, ...(info.aliases ?? [])].map((name) => [name, info]),
  ),
);
const highlighter = createHighlighterCore({
  themes: [bundledThemes["github-light"](), bundledThemes["github-dark"]()],
  langs: [],
  engine: createJavaScriptRegexEngine({ forgiving: true }),
});

async function highlight({ id, code, lang }: FenceRequest): Promise<FenceResponse> {
  const info = languages.get(lang);
  if (!info) return { id, unsupported: true };
  const shiki = await highlighter;
  if (!shiki.getLoadedLanguages().includes(info.id)) await shiki.loadLanguage(info.import());
  const lines = shiki.codeToTokensWithThemes(code, {
    lang: info.id,
    themes: { light: "github-light", dark: "github-dark" },
    tokenizeMaxLineLength: 1000,
  });
  const light = shiki.getTheme("github-light").fg.toLowerCase();
  const dark = shiki.getTheme("github-dark").fg.toLowerCase();
  return {
    id,
    lines: lines.map((line) => {
      const merged: FenceToken[] = [];
      for (const token of line) {
        const blank = !token.content.trim();
        const tokenLight = token.variants.light?.color?.toLowerCase() ?? light;
        const tokenDark = token.variants.dark?.color?.toLowerCase() ?? dark;
        const plain = blank || (tokenLight === light && tokenDark === dark);
        const previous = merged.at(-1);
        if (
          previous &&
          (blank ||
            (previous[1] === (plain ? "" : tokenLight) && previous[2] === (plain ? "" : tokenDark)))
        )
          previous[0] += token.content;
        else merged.push([token.content, plain ? "" : tokenLight, plain ? "" : tokenDark]);
      }
      return merged;
    }),
  };
}

self.onmessage = (event: MessageEvent<FenceRequest>) => {
  highlight(event.data).then(
    (response) => self.postMessage(response),
    () => self.postMessage({ id: event.data.id } satisfies FenceResponse),
  );
};
