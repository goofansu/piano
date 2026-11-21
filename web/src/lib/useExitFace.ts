import { type Ref, type RefCallback, useCallback, useRef } from "react";

type Face = { root: HTMLElement; content: HTMLElement; scrolled: [number, number, number][] };

const LINGER_MS = 5000;

function rootOf(content: HTMLElement): HTMLElement {
  const parent = content.parentElement;
  return parent?.matches('[role="presentation"][data-side]') ? parent : content;
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
  content.removeAttribute("data-open");
  content.setAttribute("data-closed", "");
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
      const observe = () => {
        if (content.hasAttribute("data-closed")) {
          if (leave.current) return;
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
