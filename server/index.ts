import plugin from "../plugin.js";
import { closeDb, db } from "./db.js";
import { startPoller, stopPoller } from "./poller.js";
import { serveTriggers } from "@barista/plugin-sdk/triggers";
import routes, { triggerHandlers } from "./routes.js";

plugin.server.registerRoutes(routes);
serveTriggers(triggerHandlers);
plugin.server.registerHealthCheck(async () => ({ ok: db.health() }));
plugin.server.registerShutdown(() => {
  stopPoller();
  closeDb();
});
await plugin.server.start();
void startPoller();
