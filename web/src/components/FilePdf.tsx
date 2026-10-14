import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Button } from "@/components/ui/button";
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
    <div ref={host} className="flex flex-col gap-3">
      {error ? (
        <p role="status">{error}</p>
      ) : (
        <>
          {pages > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Previous page
              </Button>
              <span aria-live="polite">
                {page} / {pages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={page >= pages}
                onClick={() => setPage(page + 1)}
              >
                Next page
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Zoom out"
                disabled={zoom <= 0.5}
                onClick={() => setZoom(zoom - 0.25)}
              >
                −
              </Button>
              <span>{Math.round(zoom * 100)}%</span>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Zoom in"
                disabled={zoom >= 2}
                onClick={() => setZoom(zoom + 0.25)}
              >
                +
              </Button>
            </div>
          )}
          <Document
            file={file}
            options={options}
            suspense={false}
            loading={<p role="status">Opening PDF…</p>}
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
                loading={<p role="status">Opening page…</p>}
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
