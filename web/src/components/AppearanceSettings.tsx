import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const THEMES = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
] as const;

export function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  return <FieldGroup>
    <Field>
      <FieldLabel id="appearance-theme-label">Theme</FieldLabel>
      <ToggleGroup type="single" variant="outline" value={theme ?? "system"} onValueChange={value => { if (value) setTheme(value); }} aria-labelledby="appearance-theme-label">
        {THEMES.map(({ value, label, icon: Icon }) => <ToggleGroupItem key={value} value={value}><Icon />{label}</ToggleGroupItem>)}
      </ToggleGroup>
    </Field>
  </FieldGroup>;
}
