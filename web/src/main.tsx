import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import App from "./App";
import "./index.css";

/** Notices stay above the work: top-right beside the sheet on desktop, top-centre on phones. Each carries a line that drains as its time runs out. */
function Notices() {
  const [wide, setWide] = useState(() => matchMedia("(min-width: 768px)").matches);
  useEffect(() => {
    const query = matchMedia("(min-width: 768px)");
    const update = () => setWide(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return (
    <Toaster
      position={wide ? "top-right" : "top-center"}
      offset={{ top: 16, right: 16 }}
      mobileOffset={{ top: 12, left: 16, right: 16 }}
      visibleToasts={4}
      duration={4000}
      closeButton
      toastOptions={{ style: { "--toast-life": "4s" } as React.CSSProperties }}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider delayDuration={300}>
        <App />
        <Notices />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
