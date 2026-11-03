import { mount } from "svelte";
import App from "./App.svelte";
// The one theme (issue #648): tokens + fonts first, this UI's own rules over them.
import "@barista/plugin-sdk/ui/theme.css";
import "./app.css";

const app = mount(App, { target: document.getElementById("app")! });

export default app;
