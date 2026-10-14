import { useEffect, useRef, useState } from "react";
import { FileNotice as Notice } from "@/components/FileNotice";

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
      <Notice>
        Cannot decode this file. Convert it to PNG, MP3 or H.264/AAC MP4 and try again.
      </Notice>
    );
  if (kind === "image")
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <img
          src={url}
          alt={name}
          className="max-h-full max-w-full rounded-lg shadow-1"
          onError={() => setFailed(true)}
        />
      </div>
    );
  // Local read-only media can have no caption track; the viewer must still expose the original.
  return kind === "audio" ? (
    <div className="p-4">
      {/* biome-ignore lint/a11y/useMediaCaption: arbitrary local audio has no supplied caption track. */}
      <audio
        ref={media}
        src={url}
        controls
        preload="metadata"
        className="w-full"
        onError={() => setFailed(true)}
      />
    </div>
  ) : (
    <div className="flex flex-1 items-center justify-center p-4">
      {/* biome-ignore lint/a11y/useMediaCaption: arbitrary local video has no supplied caption track. */}
      <video
        ref={(element) => {
          media.current = element;
        }}
        src={url}
        controls
        preload="metadata"
        className="max-h-full max-w-full rounded-lg shadow-1"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
