import { ThemeProvider } from "next-themes";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/PianoTooltip";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Make next-themes' SSR script inert to avoid React's warning; index.html sets the theme. */}
    <ThemeProvider
      storageKey="piano.theme"
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      scriptProps={{ type: "application/json" }}
    >
      <TooltipProvider delay={300}>
        <App />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
