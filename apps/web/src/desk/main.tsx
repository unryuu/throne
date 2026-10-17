import { createRoot } from "react-dom/client";
import { initialState } from "../../tui/state.ts";
import { request } from "./api.ts";
import { DeskApp } from "./app.tsx";
import { DeskController } from "./controller.ts";
import { recall, remember } from "./storage.ts";
import "./style.css";

const storage = {
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => localStorage.setItem(key, value),
};
let memory = recall(storage);
const root = createRoot(document.getElementById("root")!);
const controller = new DeskController(
  {
    request,
    operationId: () => crypto.randomUUID(),
    enthrone: () => new Promise((resolve) => setTimeout(resolve, 6000)),
    packs: () => memory.packs,
    remember: (snapshot) => {
      memory = remember(memory, snapshot, storage);
      const url = new URL(location.href);
      url.searchParams.set("run", snapshot.id);
      history.replaceState(null, "", url);
      render();
    },
  },
  {
    ...initialState(memory.runs),
    settings: { register: "plain", summaries: true },
  },
);
function render() {
  root.render(
    <DeskApp controller={controller} storageWarning={memory.warning} />,
  );
}
render();
const run = new URL(location.href).searchParams.get("run");
if (run) void controller.load(run);
