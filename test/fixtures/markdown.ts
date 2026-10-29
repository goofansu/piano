import path from "node:path";
import { after } from "node:test";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const vite = await createServer({
  root: path.resolve("web"),
  server: { middlewareMode: true, watch: null, ws: false },
  appType: "custom",
});
after(() => vite.close());
const { Markdown } = (await vite.ssrLoadModule("/src/components/Markdown.tsx")) as {
  Markdown: ComponentType<{
    text: string;
    images?: ReadonlyMap<string, string>;
    mode?: "static" | "streaming";
    streaming?: boolean;
  }>;
};
export const renderMarkdown = (
  text: string,
  images: boolean | ReadonlyMap<string, string> = false,
  streaming = false,
) =>
  renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(Markdown, {
        text,
        images: typeof images === "boolean" ? (images ? new Map() : undefined) : images,
        mode: streaming ? "streaming" : "static",
        streaming,
      }),
    ),
  );
