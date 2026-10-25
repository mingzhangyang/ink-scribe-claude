import { startCreationTracking } from "./analytics/creation.ts";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./fonts.ts";
import "./styles/app.css";
import "./styles/note.css";
import { startDrafts } from "./drafts/controller.ts";
import { App } from "./App.tsx";
import { startPwa } from "./pwa/register.ts";

// 在加载草稿前开始监听，避免错过浏览器较早发出的安装提示
startPwa();

void startDrafts().then(() => {
  startCreationTracking();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
