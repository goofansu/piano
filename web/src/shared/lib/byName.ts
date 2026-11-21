const nameCollator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
export const byName = (a: string, b: string) => nameCollator.compare(a, b);
