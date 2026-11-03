/** Open a link the way the transcript's anchors do: a new tab that cannot reach this one. */
export function openLink(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
