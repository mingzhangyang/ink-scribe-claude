import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./fonts.ts";
import "./styles/app.css";
import "./styles/note.css";
import { App } from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
