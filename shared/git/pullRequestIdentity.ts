export const EXE_GITHUB = "github.int.exe.xyz";
export type GitHubHost = "github.com" | typeof EXE_GITHUB;

export interface PullRequestIdentity {
  readonly repo: string;
  readonly number: number;
  readonly url: string;
  readonly host: GitHubHost;
}

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

export function pullRequestLabel(link: { url: string } | null | undefined) {
  if (!link) return undefined;
  const identity = pullRequestIdentity(link.url);
  return {
    name: identity ? `#${identity.number}` : "PR",
    reference: identity ? `${identity.repo}#${identity.number}` : undefined,
  };
}
