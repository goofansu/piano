import { Tooltip } from "@base-ui/react/tooltip";
import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { vite } from "../shared/vite.ts";

const { Markdown } = (await vite.ssrLoadModule("/src/shared/markdown/Markdown.tsx")) as {
  Markdown: ComponentType<{
    text: string;
    images?: ReadonlyMap<string, string>;
    mode?: "static" | "streaming";
    streaming?: boolean;
    preserveLineBreaks?: boolean;
  }>;
};
export const renderMarkdown = (
  text: string,
  images: boolean | ReadonlyMap<string, string> = false,
  streaming = false,
  preserveLineBreaks = false,
) =>
  renderToStaticMarkup(
    createElement(
      Tooltip.Provider,
      null,
      createElement(Markdown, {
        text,
        images: typeof images === "boolean" ? (images ? new Map() : undefined) : images,
        mode: streaming ? "streaming" : "static",
        streaming,
        preserveLineBreaks,
      }),
    ),
  );
