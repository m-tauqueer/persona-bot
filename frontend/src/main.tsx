import React from "react";
import ReactDOM from "react-dom/client";
import Root from "./Root";

import "./styles/optimized-components/oc.tailwind.css";
import "./styles/optimized-components/oc.css";
import "./styles/fonts.css";
import "./styles/index.css";
import "./styles/surfaces.css";
import "./styles/dial.css";
import "./styles/ui.css";
import "./app/styles/app-shell.css";
import "./app/styles/dashboard.css";
import "./app/styles/status.css";
import "./app/styles/voice.css";
import "./app/styles/chat.css";
import "./app/styles/gate.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
