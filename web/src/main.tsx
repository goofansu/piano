import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider delayDuration={300}>
        <App />
        {/* Keep notices below the header and away from Send/Stop, including on phones. */}
        <Toaster position="top-right" offset={{ top: 64, right: 24 }} mobileOffset={{ top: 64, left: 16, right: 16 }} visibleToasts={4} closeButton />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
