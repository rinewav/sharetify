import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import { markPlatform } from "./lib/platform.js";
import "./index.css";

// 開いた場所に応じた印を先に付ける。上端の作りがそれで変わる。
markPlatform();

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
