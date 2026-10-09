import { readStorage, writeStorage } from "@/lib/storage";

const FONT_KEY = "piano.interfaceFont";
export const INTERFACE_FONTS = ["sans", "serif", "mono"] as const;
export type InterfaceFont = typeof INTERFACE_FONTS[number];

export function interfaceFont(): InterfaceFont {
  const value = document.documentElement.dataset.interfaceFont ?? readStorage(FONT_KEY);
  return INTERFACE_FONTS.find(font => font === value) ?? "sans";
}

export function applyInterfaceFont(font: InterfaceFont): void {
  document.documentElement.dataset.interfaceFont = font;
}

export function saveInterfaceFont(font: InterfaceFont): void {
  applyInterfaceFont(font);
  writeStorage(FONT_KEY, font);
}
