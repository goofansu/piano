import { ListIcon, MessageSquareIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { useSessionDisplay } from "@/lib/useSessionDisplay";

const THEMES = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
] as const;

export function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  const [display, setDisplay] = useSessionDisplay();
  return <FieldGroup>
    <Field>
      <FieldLabel id="appearance-theme-label">Theme</FieldLabel>
      <ToggleGroup type="single" variant="outline" value={theme ?? "system"} onValueChange={value => { if (value) setTheme(value); }} aria-labelledby="appearance-theme-label">
        {THEMES.map(({ value, label, icon: Icon }) => <ToggleGroupItem key={value} value={value}><Icon />{label}</ToggleGroupItem>)}
      </ToggleGroup>
    </Field>
    <Field>
      <FieldLabel id="appearance-display-label">Session display</FieldLabel>
      <ToggleGroup type="single" variant="outline" value={display} onValueChange={value => { if (value === "everything" || value === "messages") setDisplay(value); }} aria-labelledby="appearance-display-label">
        <ToggleGroupItem value="everything"><ListIcon />Show everything</ToggleGroupItem>
        <ToggleGroupItem value="messages"><MessageSquareIcon />Messages only</ToggleGroupItem>
      </ToggleGroup>
    </Field>
  </FieldGroup>;
}
