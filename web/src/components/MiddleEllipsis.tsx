import { useLayoutEffect, useRef, useState } from "react";
import { middleEllipsis } from "@/lib/middleEllipsis";

/** No shadcn primitive fits both ends of a name to the available width. Inherit the row's
 * typography; measure in the DOM so proportional fonts, spacing and font loading count too. */
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
      // Observing the full text also catches a font loading or a typography change.
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
      title={text}
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
