import { nats } from "@barista/plugin-sdk";
import { getKey } from "./keys.js";
import { gql } from "./linear.js";
import { createPoller } from "./poll-loop.js";
import { buildVars, RADAR_QUERY, TEAMS_QUERY, type RadarData, type TeamsData } from "./query.js";
import { getSettings } from "./settings.js";
import { subjects } from "./subjects.js";
import { listWorkspaces, markPolled, recordSeen, setStatus } from "./workspaces.js";

const poller = createPoller({
  listWorkspaces,
  getKey,
  fetchRadar: async (key) => (await gql<RadarData>(key, RADAR_QUERY, { ...buildVars() })).data,
  fetchTeams: async (key) => (await gql<TeamsData>(key, TEAMS_QUERY)).data.teams.nodes,
  markPolled,
  setRejected: (id, now) => setStatus(id, "rejected", now),
  recordSeen,
  getSettings,
  changed: () => nats.publish(subjects.changed, undefined),
});

export const { getSnapshot, poll, pollFresh, schedule, forget } = poller;
export const startPoller = poller.start;
export const stopPoller = poller.stop;
