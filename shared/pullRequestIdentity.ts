/**
 * Which GitHub pull request a URL names: its repository, number and canonical github.com URL.
 * The server saves and reads links by it and the browser names a link by it, so neither can name
 * a pull request differently from the other.
 */
export const EXE_GITHUB = "github.int.exe.xyz";
/** The API route `gh` authenticates against; browser URLs always name github.com. */
export type GitHubHost = "github.com" | typeof EXE_GITHUB;

export interface PullRequestIdentity {
  /** Lower-case "owner/name". */
  readonly repo: string;
  readonly number: number;
  /** Canonical browser URL on github.com. */
  readonly url: string;
  /** The host the URL named: an exe.dev integration URL implies that route. */
  readonly host: GitHubHost;
}

/** Parse a GitHub pull request URL (github.com or the exe.dev integration), or null. */
export function pullRequestIdentity(raw: string): PullRequestIdentity | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const match = u.pathname.match(
    /^\/([\w.-]+\/[\w.-]+)\/pull\/([1-9]\d*)(?:\/(?:files|commits|checks))?\/?$/,
  );
  if (
    u.protocol !== "https:" ||
    (u.hostname !== "github.com" && u.hostname !== EXE_GITHUB) ||
    u.port ||
    u.username ||
    u.password ||
    !match
  )
    return null;
  const repo = match[1]!.toLowerCase(),
    number = Number(match[2]);
  if (!Number.isSafeInteger(number)) return null;
  return {
    repo,
    number,
    url: `https://github.com/${repo}/pull/${number}`,
    host: u.hostname === EXE_GITHUB ? EXE_GITHUB : "github.com",
  };
}
