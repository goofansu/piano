type LinkBrand = {
  /** A compact URL label when the provider has one; never replaces supplied link text. */
  label?: string;
  icon: { viewBox: string } & ({ path: string } | { href: string });
};

/** Bundled branding for a recognized destination, shared by prose and session-link labels.
 * Recognition, URL safeguards, compact labels and icon sources belong here, not in callers. */
export function linkBrand(href: string): LinkBrand | undefined {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return;
  }
  if (url.username || url.password || url.port || !/^https?:$/.test(url.protocol)) return;
  switch (url.hostname) {
    case "github.com": {
      const label = githubLabel(url.pathname);
      if (!label) return;
      return {
        label,
        icon: {
          viewBox: "0 0 16 16",
          path: "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z",
        },
      };
    }
    case "linear.app":
      return { icon: { viewBox: "0 0 24 24", href: "/mcp-logos.svg#linear" } };
    case "radius.earendil.com":
      return { icon: { viewBox: "0 0 24 24", href: "/provider-logos/radius.svg#logo" } };
  }
}

function githubLabel(pathname: string): string | undefined {
  const issue = pathname.match(/^\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull)\/([1-9]\d*)\/?$/);
  if (issue) return `${issue[2]}#${issue[3]}`;
  const repo = pathname.match(/^\/([\w.-]+)\/([\w.-]+)\/?$/);
  return repo ? `${repo[1]}/${repo[2]}` : undefined;
}
