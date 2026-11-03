<script lang="ts">
	import { natsClient } from "@barista/plugin-sdk/ui/nats";
	import { subjects } from "../../server/subjects.js";
	import * as api from "./lib/api.js";
	import { applyFilters, FILTERS_KEY, groups, LISTS, parseFilters, problems, syncLine, total } from "./lib/format.js";
	import IssueRow from "./lib/IssueRow.svelte";
	import SettingsPage from "./lib/SettingsPage.svelte";
	import SidePanel from "./lib/SidePanel.svelte";
	import type { RefreshSec, Snapshot } from "./lib/types.js";

	let snapshot = $state<Snapshot | null>(null);
	let refreshSec = $state<RefreshSec>(300);
	let loadError = $state<string | null>(null);
	let refreshing = $state(false);
	let now = $state(Date.now());
	let page = $state(location.hash === "#settings" ? "settings" : "lists");

	let filters = $state(parseFilters(localStorage.getItem(FILTERS_KEY)));
	$effect(() => { localStorage.setItem(FILTERS_KEY, JSON.stringify(filters)); });

	const rows = $derived(applyFilters(snapshot?.[filters.tab] ?? [], filters));
	const grouped = $derived(groups(rows));
	const tabs = $derived(LISTS.map((l) => {
		const r = applyFilters(snapshot?.[l.id] ?? [], filters);
		return { ...l, unseen: r.filter((i) => i.unseen).length, total: total(r.length, !!snapshot?.more[l.id]) };
	}));
	const lines = $derived(problems(snapshot, now));
	const noWorkspace = $derived(snapshot !== null && snapshot.workspaces.length === 0);

	async function load() {
		try {
			snapshot = await api.getSnapshot();
			loadError = null;
		} catch (e) {
			loadError = (e as Error).message;
		}
	}

	async function refresh() {
		refreshing = true;
		try {
			snapshot = await api.refresh();
			loadError = null;
		} catch (e) {
			loadError = (e as Error).message;
		} finally {
			refreshing = false;
		}
	}

	async function setEvery(s: RefreshSec) {
		const before = refreshSec;
		refreshSec = s;
		try {
			refreshSec = (await api.saveSettings({ refreshSec: s })).refreshSec;
		} catch (e) {
			refreshSec = before;
			loadError = `Settings not saved: ${(e as Error).message}`;
		}
	}

	$effect(() => {
		api.getSettings().then((s) => (refreshSec = s.refreshSec), (e) => (loadError = (e as Error).message));
		load();
		const sub = natsClient.subscribe(subjects.changed, () => load());
		const clock = setInterval(() => (now = Date.now()), 30_000);
		const onHash = () => (page = location.hash === "#settings" ? "settings" : "lists");
		window.addEventListener("hashchange", onHash);
		return () => { sub.unsubscribe(); clearInterval(clock); window.removeEventListener("hashchange", onHash); };
	});

	// Fallback for a missed NATS event: re-read at the refresh interval.
	$effect(() => {
		const t = setInterval(load, refreshSec * 1000);
		return () => clearInterval(t);
	});
</script>

<div class="page">
	{#if page === "settings"}
		<SettingsPage workspaces={snapshot?.workspaces ?? []} {now} onchanged={load} />
	{:else}
		<div class="bar">
			<h1>Linear Radar</h1>
			<span class="sync">
				{#if snapshot?.workspaces.length}<span class="chip wait">{snapshot.unseen} unseen</span>{/if}
				{syncLine(snapshot, now)}
				<button type="button" title="Refresh" aria-label="Refresh" class:spin={refreshing} disabled={refreshing} onclick={refresh}>↻</button>
				<a class="iconbtn" href="#settings" title="Settings: API keys">⚙</a>
			</span>
		</div>
		{#if loadError}<p class="banner">Linear Radar: {loadError}</p>{/if}
		{#each lines as l (l)}<p class="banner">{l}</p>{/each}

		{#if noWorkspace}
			<p class="empty"><a href="#settings">Add a Linear API key in settings.</a></p>
		{:else}
			<div class="wrap">
				<SidePanel {snapshot} bind:filters {refreshSec} onevery={setEvery} />
				<main>
					<div class="tabs" role="tablist">
						{#each tabs as t (t.id)}
							<button type="button" role="tab" aria-selected={filters.tab === t.id} class:on={filters.tab === t.id} onclick={() => (filters.tab = t.id)}>
								{t.label}{#if t.unseen}<b>{t.unseen}</b>{/if}<i>{t.total}</i>
							</button>
						{/each}
					</div>
					{#if !snapshot || (!snapshot.fetchedAt && !snapshot.ready && !lines.length)}
						<p class="empty">Loading…</p>
					{:else if !rows.length}
						<p class="empty">{(snapshot[filters.tab]?.length ?? 0) ? "Nothing matches the filters." : "Nothing here."}</p>
					{/if}
					{#if grouped.unseen.length}
						<div class="grp"><h3 class="new">● Unseen</h3>{#each grouped.unseen as i (i.id)}<IssueRow issue={i} {now} />{/each}</div>
					{/if}
					{#each grouped.teams as g (g.id)}
						<div class="grp"><h3>{g.key}</h3>{#each g.rows as i (i.id)}<IssueRow issue={i} {now} />{/each}</div>
					{/each}
				</main>
			</div>
		{/if}
	{/if}
</div>

<style>
	.page { padding: 14px 18px 30px; }
	.wrap { display: grid; grid-template-columns: 190px 1fr; gap: 18px; margin-top: 14px; }
	@media (max-width: 860px) { .wrap { grid-template-columns: 1fr; } }
	main { min-width: 0; }
	.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); }
	.tabs button { padding: 6px 12px; color: var(--ink-3); cursor: pointer; border: 0; border-bottom: 2px solid transparent; background: none; font-weight: 500; }
	.tabs button.on { color: var(--ink); border-color: var(--accent); }
	.tabs b { margin-left: 6px; padding: 0 6px; border-radius: var(--r-pill); background: var(--accent); color: var(--on-accent); font: 600 var(--t-xs)/16px var(--mono); }
	.tabs i { margin-left: 6px; font: normal var(--t-xs) var(--mono); color: var(--ink-3); }
	.grp h3 { margin: 12px 0 2px; padding: 0 10px; font: 500 var(--t-xs) var(--mono); color: var(--ink-3); }
	.grp h3.new { color: var(--accent); }
	.sync button:disabled { cursor: default; opacity: .6; }
	.spin { animation: spin 1s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
</style>
