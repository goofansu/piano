import { useEffect } from "react";

/** Keep browser chrome in sync with the applied theme, not the OS preference. */
export function BrowserTheme() {
  useEffect(() => {
    const root = document.documentElement;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const sync = () => {
      if (meta) meta.content = getComputedStyle(root).getPropertyValue("--surface-0").trim();
    };
    // Observe the applied class so this also follows System mode and other tabs,
    // without racing next-themes' effect that updates the root element.
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    sync();
    return () => observer.disconnect();
  }, []);

  return null;
}
