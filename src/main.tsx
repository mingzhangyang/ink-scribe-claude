import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./fonts.ts";
import "./styles/app.css";
import "./styles/note.css";
import { startDrafts } from "./drafts/controller.ts";
import { App } from "./App.tsx";

void startDrafts().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
