import type { ModelCatalog } from "@shared/wire";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  catalog: ModelCatalog | null;
  value: string | undefined;
  onChange: (ref: string) => void;
  disabled?: boolean;
}

/** Models pi can actually use; pi's default preselected; enabled ones first. */
export function ModelSelect({ catalog, value, onChange, disabled }: Props) {
  const want = value || catalog?.defaultModel || "";
  const models = catalog?.models ?? [];
  const enabled = models.filter((m) => m.enabled);
  const other = models.filter((m) => !m.enabled);
  const unknown = want && !models.some((m) => m.ref === want);
  const label = (ref: string) => `${ref}${ref === catalog?.defaultModel ? "  (default)" : ""}`;

  return (
    <Select value={want} onValueChange={onChange} disabled={disabled || !models.length}>
      <SelectTrigger className="h-8 w-[280px] max-w-full text-xs" aria-label="Model">
        <SelectValue placeholder={catalog ? (catalog.error ? `no models: ${catalog.error}` : "no models") : "loading models…"} />
      </SelectTrigger>
      <SelectContent>
        {unknown && (
          <SelectGroup>
            <SelectLabel>from session</SelectLabel>
            <SelectItem value={want}>{want}</SelectItem>
          </SelectGroup>
        )}
        {enabled.length > 0 && other.length > 0 ? (
          <>
            <SelectGroup>
              <SelectLabel>enabled in settings</SelectLabel>
              {enabled.map((m) => <SelectItem key={m.ref} value={m.ref}>{label(m.ref)}</SelectItem>)}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>all available</SelectLabel>
              {other.map((m) => <SelectItem key={m.ref} value={m.ref}>{label(m.ref)}</SelectItem>)}
            </SelectGroup>
          </>
        ) : (
          models.map((m) => <SelectItem key={m.ref} value={m.ref}>{label(m.ref)}</SelectItem>)
        )}
      </SelectContent>
    </Select>
  );
}
