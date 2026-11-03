// Fake sample data shared by every mockup. Nothing here is real: invented workspaces, people and issues.
// list: which list the issue lands in (each issue shows in exactly one: assigned > created > mentions).
// why: for "mentions", what put it there (mention | comment-mention | subscribed).
const ISSUES = [
	{ id: "1", ws: "Acme", key: "ENG-412", title: "Checkout returns 500 when the cart has a gift card", prio: 1, state: ["In Progress", "started"], team: "ENG", cycle: [42, true], project: "Payments v2", labels: ["bug"], age: "12m", list: "assigned", unseen: true },
	{ id: "2", ws: "Acme", key: "ENG-398", title: "Move session tokens to HttpOnly cookies", prio: 2, state: ["Todo", "unstarted"], team: "ENG", cycle: [42, true], project: "Security hardening", labels: ["security"], age: "3h", list: "assigned", unseen: true },
	{ id: "3", ws: "Acme", key: "WEB-77", title: "Dark mode for the partner dashboard", prio: 3, state: ["In Review", "review"], team: "WEB", cycle: [42, true], project: null, labels: ["frontend"], age: "1d", list: "assigned", unseen: false },
	{ id: "4", ws: "Acme", key: "ENG-350", title: "Retry failed webhook deliveries with backoff", prio: 3, state: ["Backlog", "backlog"], team: "ENG", cycle: null, project: "Payments v2", labels: [], age: "4d", list: "assigned", unseen: false },
	{ id: "5", ws: "Northwind", key: "OPS-19", title: "Rotate the staging database credentials", prio: 2, state: ["Triage", "triage"], team: "OPS", cycle: null, project: null, labels: ["infra"], age: "2d", list: "assigned", unseen: false },
	{ id: "6", ws: "Acme", key: "ENG-405", title: "Flaky e2e: login redirect loop on Safari", prio: 2, state: ["In Progress", "started"], team: "ENG", cycle: [42, true], project: null, labels: ["bug", "e2e"], age: "40m", list: "mentions", why: "mention", by: "Sam Rivera", unseen: true },
	{ id: "7", ws: "Acme", key: "DES-31", title: "New empty states for the onboarding flow", prio: 4, state: ["Todo", "unstarted"], team: "DES", cycle: [42, true], project: "Onboarding", labels: ["design"], age: "5h", list: "mentions", why: "comment-mention", by: "Kim Lee", unseen: true },
	{ id: "8", ws: "Acme", key: "WEB-80", title: "Lazy-load the analytics bundle", prio: 0, state: ["Backlog", "backlog"], team: "WEB", cycle: [43, false], project: null, labels: ["perf"], age: "1d", list: "mentions", why: "subscribed", unseen: false },
	{ id: "9", ws: "Northwind", key: "OPS-12", title: "Alerting runbook for queue backlog", prio: 3, state: ["In Progress", "started"], team: "OPS", cycle: null, project: "Reliability", labels: [], age: "3d", list: "mentions", why: "subscribed", unseen: false },
	{ id: "10", ws: "Acme", key: "ENG-418", title: "Spike: replace the cron runner with a queue", prio: 0, state: ["Triage", "triage"], team: "ENG", cycle: null, project: null, labels: ["spike"], age: "2h", list: "created", unseen: true },
	{ id: "11", ws: "Acme", key: "WEB-71", title: "Typo in the pricing page footer", prio: 4, state: ["Todo", "unstarted"], team: "WEB", cycle: [42, true], project: null, labels: [], age: "6d", list: "created", unseen: false },
	{ id: "12", ws: "Acme", key: "DES-28", title: "Icon set audit before the rebrand", prio: 3, state: ["In Review", "review"], team: "DES", cycle: null, project: "Rebrand", labels: ["design"], age: "1w", list: "created", unseen: false },
];
const LISTS = [
	{ id: "assigned", label: "Assigned" },
	{ id: "mentions", label: "Mentions & subscribed" },
	{ id: "created", label: "Created by me" },
];
const PRIO = ["No priority", "Urgent", "High", "Medium", "Low"];
const WHY = { mention: "mentioned you", "comment-mention": "mentioned you in a comment", subscribed: "subscribed" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const url = (i) => `https://linear.app/${i.ws.toLowerCase()}/issue/${i.key}`;
// unseen first, then most recently updated (data is already in age order)
const listOf = (id) => ISSUES.filter((i) => i.list === id).sort((a, b) => b.unseen - a.unseen);
const unseenIn = (id) => listOf(id).filter((i) => i.unseen).length;
function prio(p) {
	if (p === 1) return `<span class="prio p1" title="Urgent">!</span>`;
	if (p === 0) return `<span class="prio p0" title="No priority">–</span>`;
	return `<span class="prio p${p}" title="${PRIO[p]}"><i></i><i></i><i></i></span>`;
}
const stateChip = (i) => `<span class="chip ${i.state[1]}">${i.state[1] === "started" ? "◐" : i.state[1] === "review" ? "◑" : i.state[1] === "triage" ? "◇" : "○"} ${esc(i.state[0])}</span>`;
const cycleChip = (i) => (i.cycle ? `<span class="chip cycle${i.cycle[1] ? " now" : ""}" title="${i.cycle[1] ? "Current cycle" : "Next cycle"}">C${i.cycle[0]}</span>` : "");
const dot = (i) => `<span class="${i.unseen ? "dot-new" : "dot-seen"}" title="${i.unseen ? "Unseen in your Linear inbox" : ""}"></span>`;
const links = (i) => `<span class="links"><a href="${url(i)}" target="_blank" rel="noopener">Open</a><a href="linear://${i.ws.toLowerCase()}/issue/${i.key}" title="Open in the Linear desktop app">App</a></span>`;
const whyText = (i) => (i.why ? `<span class="why${i.why === "subscribed" ? "" : " mention"}">${i.by ? esc(i.by) + " " : ""}${WHY[i.why]}</span>` : "");
function themeFromQuery() {
	const q = new URLSearchParams(location.search).get("theme");
	if (q) document.documentElement.dataset.theme = q;
}
function flip() { const r = document.documentElement; r.dataset.theme = r.dataset.theme === "light" ? "dark" : "light"; }
