import { useEffect, useRef, useState } from "react";

/** Native media only: shadcn has no media decoder. No autoplay or executable SVG. */
export function NativeFile({
  kind,
  url,
  name,
}: {
  kind: "image" | "audio" | "video";
  url: string;
  name: string;
}) {
  const media = useRef<HTMLMediaElement | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = media.current;
    if (element) {
      element.src = url;
      element.load();
    }
    return () => {
      if (element) {
        element.pause();
        element.removeAttribute("src");
        element.load();
      }
    };
  }, [url]);
  if (failed)
    return (
      <p role="status">
        Cannot decode this file. Convert it to PNG, MP3 or H.264/AAC MP4 and try again.
      </p>
    );
  if (kind === "image")
    return <img src={url} alt={name} className="max-w-full" onError={() => setFailed(true)} />;
  // Local read-only media can have no caption track; the viewer must still expose the original.
  return kind === "audio" ? (
    // biome-ignore lint/a11y/useMediaCaption: arbitrary local audio has no supplied caption track.
    <audio ref={media} src={url} controls preload="metadata" onError={() => setFailed(true)} />
  ) : (
    // biome-ignore lint/a11y/useMediaCaption: arbitrary local video has no supplied caption track.
    <video
      ref={(element) => {
        media.current = element;
      }}
      src={url}
      controls
      preload="metadata"
      className="max-w-full"
      onError={() => setFailed(true)}
    />
  );
}
