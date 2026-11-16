import { useLayoutEffect, useRef, useState } from "react";
import { middleEllipsis } from "@/lib/middleEllipsis";

export function MiddleEllipsis({ text }: { text: string }) {
  const container = useRef<HTMLSpanElement>(null);
  const ruler = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(text);
  useLayoutEffect(() => {
    const element = container.current;
    const probe = ruler.current;
    if (!element || !probe) return;
    const update = () => {
      const fitted = middleEllipsis(text, element.getBoundingClientRect().width, (value) => {
        probe.textContent = value;
        return probe.getBoundingClientRect().width;
      });
      probe.textContent = text;
      setDisplay(fitted);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    observer.observe(probe);
    return () => observer.disconnect();
  }, [text]);
  return (
    <span
      ref={container}
      className="relative block w-full min-w-0 overflow-hidden whitespace-nowrap"
    >
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">{display}</span>
      <span
        ref={ruler}
        aria-hidden="true"
        className="invisible pointer-events-none absolute top-0 left-0 w-max"
      >
        {text}
      </span>
    </span>
  );
}
