export function FilePath({
  path,
  title = path,
  filenameClassName,
}: {
  path: string;
  title?: string;
  filenameClassName?: string;
}) {
  const slash = path.lastIndexOf("/");
  const directory = path.slice(0, Math.max(slash, 0));
  const filename = path.slice(slash + 1);
  return (
    <span className="flex min-w-0 font-mono" title={title}>
      {directory && <span className="min-w-0 truncate text-ink-3">{directory}</span>}
      <span className="max-w-full shrink-0 truncate font-medium">
        {slash >= 0 && <span className="font-normal text-ink-3">/</span>}
        <span className={filenameClassName}>{filename}</span>
      </span>
    </span>
  );
}
