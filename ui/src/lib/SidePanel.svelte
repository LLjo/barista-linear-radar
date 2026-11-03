<script lang="ts">
	import { teamCounts, workspaceCounts, type Filters } from "./format.js";
	import type { RefreshSec, Snapshot } from "./types.js";

	let {
		snapshot, filters = $bindable(), refreshSec, onevery,
	}: { snapshot: Snapshot | null; filters: Filters; refreshSec: RefreshSec; onevery: (s: RefreshSec) => void } = $props();

	const EVERY: { value: RefreshSec; label: string }[] = [
		{ value: 60, label: "1 min" },
		{ value: 300, label: "5 min" },
		{ value: 900, label: "15 min" },
	];

	const toggle = (list: string[], v: string, on: boolean) => (on ? list.filter((x) => x !== v) : [...new Set([...list, v])]);
	const workspaces = $derived(workspaceCounts(snapshot));
	const teams = $derived(teamCounts(snapshot, filters.offTeams));
</script>

<aside>
	{#if workspaces.length}
		<div>
			<h4>Workspaces</h4>
			{#each workspaces as { ws, count } (ws.id)}
				<label>
					<input type="checkbox" checked={!filters.offWorkspaces.includes(ws.id)}
						onchange={(e) => (filters.offWorkspaces = toggle(filters.offWorkspaces, ws.id, e.currentTarget.checked))} />
					{ws.name}<span class="count">{count}</span>
				</label>
			{/each}
		</div>
	{/if}
	{#if teams.length}
		<div>
			<h4>Teams</h4>
			{#each teams as t (t.key)}
				<label title={t.name}>
					<input type="checkbox" checked={!filters.offTeams.includes(t.key)}
						onchange={(e) => (filters.offTeams = toggle(filters.offTeams, t.key, e.currentTarget.checked))} />
					{t.key}<span class="count">{t.count}</span>
				</label>
			{/each}
		</div>
	{/if}
	<div>
		<h4>Only</h4>
		<label><input type="checkbox" bind:checked={filters.cycle} /> Current cycle</label>
		<label><input type="checkbox" bind:checked={filters.urgent} /> Urgent + high</label>
	</div>
	<div>
		<h4>Refresh</h4>
		<select value={refreshSec} onchange={(e) => onevery(Number(e.currentTarget.value) as RefreshSec)}>
			{#each EVERY as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
		</select>
	</div>
</aside>

<style>
	aside { font-size: var(--t-s); color: var(--ink-2); display: flex; flex-direction: column; gap: 14px; }
	h4 { margin: 0 0 4px; font: 600 var(--t-xs) var(--sans); color: var(--ink-3); letter-spacing: .06em; text-transform: uppercase; }
	label { display: flex; align-items: center; gap: 6px; padding: 2px 0; }
	.count { margin-left: auto; color: var(--ink-3); font: var(--t-xs) var(--mono); }
</style>
