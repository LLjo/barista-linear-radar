import { nats } from "@barista/plugin-sdk";
import { getKey } from "./keys.js";
import { gql } from "./linear.js";
import { createPoller } from "./poll-loop.js";
import { buildVars, RADAR_QUERY, TEAMS_QUERY, type RadarData, type TeamsData } from "./query.js";
import { getSettings } from "./settings.js";
import { subjects } from "./subjects.js";
import { listWorkspaces, recordPoll, setStatus } from "./workspaces.js";

// The query's cost against Linear's complexity limit (SPEC "Data"): logged once per boot to measure it.
let complexityLogged = false;

const poller = createPoller({
  listWorkspaces,
  getKey,
  fetchRadar: async (key) => {
    const r = await gql<RadarData>(key, RADAR_QUERY, { ...buildVars() });
    if (r.complexity && !complexityLogged) {
      complexityLogged = true;
      console.info(`[linear-radar] radar query complexity: ${r.complexity}`);
    }
    return r.data;
  },
  fetchTeams: async (key) => (await gql<TeamsData>(key, TEAMS_QUERY)).data.teams.nodes,
  setRejected: (id, now) => setStatus(id, "rejected", now),
  recordPoll,
  getSettings,
  changed: () => nats.publish(subjects.changed, undefined),
});

export const { getSnapshot, poll, pollFresh, schedule, forget } = poller;
export const startPoller = poller.start;
export const stopPoller = poller.stop;
