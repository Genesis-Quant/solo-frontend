import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "@/App";
import "@/assets/styles/tailwind.css";
import "@/assets/styles/base.less";
import "@/assets/styles/transition.less";

createRoot(document.getElementById("root")!).render(<BrowserRouter><App /></BrowserRouter>);
