import plugin from "../plugin.js";
import { closeDb, db } from "./db.js";
import { startPoller, stopPoller } from "./poller.js";
import routes from "./routes.js";

plugin.server.registerRoutes(routes);
plugin.server.registerHealthCheck(async () => ({ ok: db.health() }));
plugin.server.registerShutdown(() => {
  stopPoller();
  closeDb();
});
await plugin.server.start();
void startPoller();
