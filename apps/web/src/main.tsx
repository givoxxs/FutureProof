import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./styles.css";
import "./fidelity.css";
import "./responsive.css";
import "./action-links.css";
import "./hybrid.css";
import "./mobile-report.css";

const root = document.getElementById("root");
if (!root) throw new Error("FutureProof root element is missing");
createRoot(root).render(<React.StrictMode><App /></React.StrictMode>);