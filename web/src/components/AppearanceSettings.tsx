import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useState } from "react";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { INTERFACE_FONTS, interfaceFont, saveInterfaceFont } from "@/lib/appearance";

const THEMES = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
] as const;

export function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  const [font, setFont] = useState(interfaceFont);
  return <FieldGroup>
    <Field>
      <FieldLabel id="appearance-theme-label">Theme</FieldLabel>
      <ToggleGroup type="single" variant="outline" value={theme ?? "system"} onValueChange={value => { if (value) setTheme(value); }} aria-labelledby="appearance-theme-label">
        {THEMES.map(({ value, label, icon: Icon }) => <ToggleGroupItem key={value} value={value}><Icon />{label}</ToggleGroupItem>)}
      </ToggleGroup>
    </Field>
    <Field>
      <FieldLabel id="appearance-font-label">Interface font</FieldLabel>
      <ToggleGroup type="single" variant="outline" value={font} onValueChange={value => {
        const next = INTERFACE_FONTS.find(font => font === value);
        if (next) { saveInterfaceFont(next); setFont(next); }
      }} aria-labelledby="appearance-font-label" aria-describedby="appearance-font-description">
        <ToggleGroupItem value="sans">Sans</ToggleGroupItem>
        <ToggleGroupItem value="serif">Serif</ToggleGroupItem>
        <ToggleGroupItem value="mono">Mono</ToggleGroupItem>
      </ToggleGroup>
      <FieldDescription id="appearance-font-description">Uses fonts available on your device. Code stays monospace.</FieldDescription>
    </Field>
  </FieldGroup>;
}
