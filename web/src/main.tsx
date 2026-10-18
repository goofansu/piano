import { ThemeProvider } from "next-themes";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/PianoTooltip";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* index.html applies the theme before paint; mark next-themes' SSR script inert so React does not warn about it. */}
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      scriptProps={{ type: "application/json" }}
    >
      <TooltipProvider delayDuration={300}>
        <App />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
