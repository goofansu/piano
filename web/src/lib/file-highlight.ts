import { type BundledLanguage, bundledLanguages, codeToHtml } from "shiki/bundle/full";

self.onmessage = async ({
  data,
}: MessageEvent<{ content: string; language: string; dark: boolean }>) => {
  if (!(data.language in bundledLanguages)) return;
  try {
    self.postMessage(
      await codeToHtml(data.content, {
        lang: data.language as BundledLanguage,
        theme: data.dark ? "github-dark" : "github-light",
        // The file viewer draws source on its own sheet; only the token colours are wanted.
        transformers: [
          {
            pre(node) {
              node.properties.style = String(node.properties.style ?? "").replace(
                /background-color:[^;]*;?/,
                "",
              );
            },
          },
        ],
      }),
    );
  } catch {
    /* Source stays readable if a grammar or theme cannot load. */
  }
};
