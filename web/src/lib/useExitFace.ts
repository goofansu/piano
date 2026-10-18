import { type Ref, type RefCallback, useCallback, useRef } from "react";

/** A copy of an overlay's face: its root (the popper wrapper, or the content itself), the copy of
 * the content in it, and where its scrolled elements stood. */
type Face = { root: HTMLElement; content: HTMLElement; scrolled: [number, number, number][] };

// Long enough for any exit (reduced motion included); a ghost normally leaves on animationend.
const LINGER_MS = 5000;

/** What moves on screen: the popper wrapper that positions anchored content, or the content. */
function rootOf(content: HTMLElement): HTMLElement {
  const parent = content.parentElement;
  return parent?.hasAttribute("data-radix-popper-content-wrapper") ? parent : content;
}

function copy(content: HTMLElement): Face {
  const live = rootOf(content);
  const root = live.cloneNode(true) as HTMLElement;
  const from = [live, ...live.querySelectorAll<HTMLElement>("*")];
  const to = [root, ...root.querySelectorAll<HTMLElement>("*")];
  const scrolled: Face["scrolled"] = [];
  from.forEach((element, i) => {
    const twin = to[i];
    if (element.scrollTop || element.scrollLeft)
      scrolled.push([i, element.scrollTop, element.scrollLeft]);
    // What a person typed or ticked lives in properties, which cloning drops.
    if (element instanceof HTMLTextAreaElement) twin.textContent = element.value;
    else if (element instanceof HTMLInputElement) {
      twin.setAttribute("value", element.value);
      twin.toggleAttribute("checked", element.checked);
    }
    twin.removeAttribute("id");
  });
  return { root, content: to[from.indexOf(content)], scrolled };
}

function play({ root, content, scrolled }: Face, after: HTMLElement): () => void {
  root.setAttribute("aria-hidden", "true");
  root.inert = true;
  root.style.pointerEvents = "none";
  content.setAttribute("data-state", "closed");
  after.after(root);
  const all = [root, ...root.querySelectorAll<HTMLElement>("*")];
  for (const [i, top, left] of scrolled) all[i].scrollTo(left, top);
  const leave = () => {
    clearTimeout(timer);
    root.remove();
  };
  const timer = setTimeout(leave, LINGER_MS);
  const ended = (event: AnimationEvent) => event.target === content && leave();
  content.addEventListener("animationend", ended);
  content.addEventListener("animationcancel", ended);
  if (getComputedStyle(content).animationName === "none") leave();
  return leave;
}

/**
 * An overlay animates closed after its state closes, and whatever it renders meanwhile reads state
 * that closing has already changed. So the content keeps a copy of the face it last showed open and
 * plays the exit on that copy, inert, while the live content hides and unmounts as usual. Returns
 * the ref for the overlay's content element, merged with the caller's.
 */
export function useExitFace<T extends HTMLElement>(ref?: Ref<T>): RefCallback<T> {
  const leave = useRef<() => void>(undefined);
  return useCallback(
    (content: T | null) => {
      const cleanup = typeof ref === "function" ? ref(content) : undefined;
      if (ref && typeof ref === "object") ref.current = content;
      if (!content) return;
      leave.current?.();
      leave.current = undefined;
      let face = copy(content);
      let pending = 0;
      // Mutations arrive after the commit that caused them, so a batch that closes the overlay
      // leaves `face` as it was before that batch: the last open face.
      const observe = () => {
        if (content.dataset.state === "closed") {
          if (leave.current) return;
          // A transition on the content would hold `visibility` until it ends.
          content.style.transition = "none";
          content.style.visibility = "hidden";
          leave.current = play(face, rootOf(content));
          return;
        }
        if (leave.current) {
          leave.current();
          leave.current = undefined;
          content.style.transition = "";
          content.style.visibility = "";
        }
        face = copy(content);
      };
      const observer = new MutationObserver(observe);
      observer.observe(rootOf(content), {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      // Typing into an uncontrolled field and scrolling change no markup.
      const later = () => {
        cancelAnimationFrame(pending);
        pending = requestAnimationFrame(observe);
      };
      content.addEventListener("input", observe, true);
      content.addEventListener("scroll", later, true);
      return () => {
        observer.disconnect();
        cancelAnimationFrame(pending);
        content.removeEventListener("input", observe, true);
        content.removeEventListener("scroll", later, true);
        if (typeof cleanup === "function") cleanup();
        else if (typeof ref === "function") ref(null);
        else if (ref && typeof ref === "object") ref.current = null;
      };
    },
    [ref],
  );
}
