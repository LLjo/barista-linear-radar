import { barista } from "@barista/plugin-sdk";
import plugin from "../plugin.js";
import { onWatchesChanged, radarBus } from "./bus.js";
import { closeDb, db } from "./db.js";
import { attachBus, getSnapshot, startPoller, stopPoller } from "./poller.js";
import routes from "./routes.js";
import { firstSeen } from "./workspaces.js";

plugin.server.registerRoutes(routes);
// contributes.events: the log lives in our own SQLite; replays and watches are answered from it.
const bus = barista.events.serve({ storage: db });
attachBus(radarBus(bus, firstSeen));
// A listener's new watch un-readies the event; nothing we read depends on it, so it is ready again at once.
const offWatches = bus.onWatchesChanged(() => onWatchesChanged(bus, getSnapshot()));
plugin.server.registerHealthCheck(async () => ({ ok: db.health() }));
plugin.server.registerShutdown(() => {
  offWatches();
  stopPoller();
  attachBus(null);
  bus.stop();
  closeDb();
});
await plugin.server.start();
void startPoller();
