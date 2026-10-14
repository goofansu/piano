import { ChevronLeftIcon, ChevronRightIcon, MinusIcon, PlusIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { FileNotice as Notice } from "@/components/FileNotice";
import { IconButton } from "@/components/IconButton";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();
const options = {
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
  enableXfa: false,
  useSystemFonts: false,
  maxImageSize: 16_000_000,
  canvasMaxAreaInBytes: 32 * 1024 * 1024,
};

/** One page at a time; no annotation layer, links, forms, scripting or external resources.
 * shadcn has no PDF renderer. React-PDF destroys its loading task/worker when released. */
export default function FilePdf({ bytes }: { bytes: Uint8Array }) {
  // PDF.js transfers its input to the worker; never detach the owner's acquired bytes.
  const file = useMemo(() => ({ data: new Uint8Array(bytes) }), [bytes]);
  const loadedPage = useRef<pdfjs.PDFPageProxy | undefined>(undefined);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState("");
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(400);
  const [pageSize, setPageSize] = useState<{ page: number; ratio: number }>();
  const measured = pageSize?.page === page;
  const ratio = measured ? pageSize.ratio : Math.SQRT2;
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(100, entry.contentRect.width)),
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (pages || error) return;
    const timer = setTimeout(
      () => setError("This PDF is taking too long to open. Try a smaller or re-exported copy."),
      15_000,
    );
    return () => clearTimeout(timer);
  }, [pages, error]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: page/error mark release of the current Page, even before the next Page loads.
  useEffect(() => {
    return () => {
      loadedPage.current?.cleanup();
      loadedPage.current = undefined;
    };
  }, [page, error]);
  const renderedWidth = Math.min(width * zoom, 1600, 8192 / ratio, Math.sqrt(4_000_000 / ratio));
  return (
    <div ref={host} className="flex flex-1 flex-col">
      {error ? (
        <Notice>{error}</Notice>
      ) : (
        <>
          {pages > 0 && (
            <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-line bg-conversation px-3 py-1.5 text-xs text-ink-2 tabular-nums">
              <IconButton
                label="Previous page"
                size="icon-xs"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeftIcon />
              </IconButton>
              <span aria-live="polite" className="min-w-12 text-center">
                {page} / {pages}
              </span>
              <IconButton
                label="Next page"
                size="icon-xs"
                disabled={page >= pages}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRightIcon />
              </IconButton>
              <span className="ml-auto" />
              <IconButton
                label="Zoom out"
                size="icon-xs"
                disabled={zoom <= 0.5}
                onClick={() => setZoom(zoom - 0.25)}
              >
                <MinusIcon />
              </IconButton>
              <span className="min-w-10 text-center">{Math.round(zoom * 100)}%</span>
              <IconButton
                label="Zoom in"
                size="icon-xs"
                disabled={zoom >= 2}
                onClick={() => setZoom(zoom + 0.25)}
              >
                <PlusIcon />
              </IconButton>
            </div>
          )}
          <Document
            file={file}
            options={options}
            suspense={false}
            className="flex justify-center p-4 [&_.react-pdf__Page]:shadow-2"
            loading={<Notice>Opening PDF…</Notice>}
            onPassword={() =>
              setError(
                "This PDF is password-protected. Open it locally and save an unlocked copy to preview.",
              )
            }
            onLoadError={() =>
              setError("Cannot read this PDF. Check or re-export the original and try again.")
            }
            onLoadSuccess={({ numPages }) => setPages(numPages)}
          >
            {pages > 0 && (
              <Page
                key={page}
                pageNumber={page}
                width={renderedWidth}
                devicePixelRatio={1}
                renderAnnotationLayer={false}
                renderForms={false}
                // Measure before creating a canvas: the previous page's aspect ratio is not a bound.
                renderMode={measured ? "canvas" : "none"}
                renderTextLayer={measured}
                loading={<Notice>Opening page…</Notice>}
                onLoadSuccess={(loaded) => {
                  loadedPage.current = loaded;
                  const viewport = loaded.getViewport({ scale: 1 });
                  const ratio = viewport.height / viewport.width;
                  if (!Number.isFinite(ratio) || ratio < 0.01 || ratio > 100) {
                    setError(
                      "This PDF page has unsupported dimensions. Re-export it at a standard page size.",
                    );
                    return;
                  }
                  setPageSize({ page, ratio });
                }}
                onLoadError={() =>
                  setError("Cannot read this page. Re-export the PDF and try again.")
                }
                onRenderError={() =>
                  setError("Cannot render this page. Try a smaller or re-exported PDF.")
                }
              />
            )}
          </Document>
        </>
      )}
    </div>
  );
}
