import type { ReactNode } from "react";
import { linkBrand } from "@/lib/linkBrand";

/** Web-link presentation policy: explicit HTTP(S) links are clickable; implicit links only
 * for recognized brands. Local files/images are handled by the owning Markdown surface. */
export function MarkdownWebLink({
  href,
  title,
  implicit,
  children,
}: {
  href: string;
  title?: string;
  implicit: boolean;
  children: ReactNode;
}) {
  if (!/^https?:\/\//i.test(href)) return <>{children}</>;
  const brand = linkBrand(href);
  if (implicit && !brand) return <>{children}</>;
  // Custom inline link: shadcn has no Markdown link primitive with bundled provider branding.
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={brand ? "brand-link" : undefined}
      title={title ?? (brand ? href : undefined)}
    >
      {brand && (
        <svg
          className="brand-link-icon"
          viewBox={brand.icon.viewBox}
          fill="currentColor"
          aria-hidden="true"
          focusable="false"
        >
          {"path" in brand.icon ? <path d={brand.icon.path} /> : <use href={brand.icon.href} />}
        </svg>
      )}
      {brand?.label && children === href ? brand.label : children}
    </a>
  );
}
