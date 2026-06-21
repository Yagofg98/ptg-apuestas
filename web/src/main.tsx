import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { BetSlipProvider } from "./hooks/useBetSlip";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <BetSlipProvider>
        <App />
      </BetSlipProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
