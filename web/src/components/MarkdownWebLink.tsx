import type { ReactNode } from "react";
import { linkBrand } from "@/lib/linkBrand";

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
