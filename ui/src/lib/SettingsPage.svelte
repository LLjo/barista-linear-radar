<script lang="ts">
	import { day } from "@barista/plugin-sdk/ui/time";
	import * as api from "./api.js";
	import { age } from "./format.js";
	import type { WorkspacePublic } from "./types.js";

	let { workspaces, now, onchanged }: { workspaces: WorkspacePublic[]; now: number; onchanged: () => void } = $props();

	// The key is write-only: it lives in these inputs until sent, then is cleared. Nothing echoes it back.
	let draft = $state("");
	let error = $state<string | null>(null);
	let busy = $state(false);
	let replacing = $state<string | null>(null);
	let replaceDraft = $state("");
	let replaceError = $state<string | null>(null);

	async function add() {
		if (!draft.trim() || busy) return;
		busy = true;
		try {
			await api.addKey(draft.trim());
			draft = "";
			error = null;
			onchanged();
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	async function replace(id: string) {
		if (!replaceDraft.trim() || busy) return;
		busy = true;
		try {
			await api.replaceKey(id, replaceDraft.trim());
			replacing = null;
			replaceDraft = "";
			replaceError = null;
			onchanged();
		} catch (e) {
			replaceError = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	async function remove(w: WorkspacePublic) {
		if (!confirm(`Remove ${w.name}? Its key is deleted from this host.`)) return;
		try {
			await api.removeWorkspace(w.id);
			onchanged();
		} catch (e) {
			error = (e as Error).message;
		}
	}

	const sub = (w: WorkspacePublic) =>
		[w.urlKey, w.status === "ok" && `signed in as ${w.viewerName}`, `key ••••${w.keyLast4}`,
			w.status === "ok" ? `added ${day(w.addedAt)}` : w.checkedAt && `last check ${age(w.checkedAt, now)} ago`]
			.filter(Boolean).join(" · ");
</script>

<div class="bar"><h1>Linear Radar</h1><a class="back" href="#lists">← back to the lists</a></div>
<div class="card">
	<h2>Workspaces</h2>
	{#each workspaces as w (w.id)}
		<div class="ws">
			<span class="name">{w.name}</span>
			<span class="sub">{sub(w)}</span>
			<span class="side">
				{#if w.status === "rejected"}<span class="chip bad">✕ key rejected</span>
				{:else}<span class="chip ok">✓ working</span>{/if}
				{#if w.status === "rejected"}<button type="button" onclick={() => { replacing = w.id; replaceError = null; }}>Replace</button>{/if}
				<button type="button" onclick={() => remove(w)}>Remove</button>
			</span>
			{#if replacing === w.id}
				<div class="add replace">
					<input type="password" placeholder="Paste a new key for {w.name}" autocomplete="off" bind:value={replaceDraft}
						onkeydown={(e) => e.key === "Enter" && replace(w.id)} />
					<button type="button" disabled={busy} onclick={() => replace(w.id)}>Save</button>
				</div>
				{#if replaceError}<div class="err">{replaceError}</div>{/if}
			{/if}
		</div>
	{/each}

	<h2>Add a workspace</h2>
	<div class="add">
		<input type="password" placeholder="Paste a Linear personal API key" autocomplete="off" bind:value={draft}
			onkeydown={(e) => e.key === "Enter" && add()} />
		<button type="button" disabled={busy} onclick={add}>Add</button>
	</div>
	{#if error}<div class="err">{error}</div>{/if}
	<div class="help">
		Create a key in Linear: <b>Settings → Security &amp; access → Personal API keys</b>, then paste it here.
		A key reads one workspace, so add one key per workspace. Read access is all Linear Radar needs: it never writes to Linear.<br />
		The key is stored on this Barista host only. It is never shown again, never logged and never sent to the browser; only its last 4 characters are.
	</div>
</div>

<style>
	.card { max-width: 640px; margin-top: 16px; display: flex; flex-direction: column; gap: 14px; }
	h2 { margin: 0; font: 600 var(--t-m) var(--sans); color: var(--ink-2); }
	.ws { display: grid; grid-template-columns: 1fr auto auto; gap: 4px 12px; align-items: center; padding: 10px 12px; border-radius: var(--r-sm); background: var(--raised); }
	.name { color: var(--ink); font-weight: 500; }
	.sub { grid-column: 1; color: var(--ink-3); font-size: var(--t-xs); font-family: var(--mono); }
	.side { grid-row: 1 / span 2; grid-column: 2 / span 2; display: flex; gap: 10px; align-items: center; font-size: var(--t-s); }
	.side button { padding: 0; border: 0; background: none; color: var(--ink-3); cursor: pointer; }
	.side button:hover { color: var(--link); }
	.ws .replace, .ws .err { grid-column: 1 / -1; }
	.add { display: flex; gap: 8px; align-items: center; }
	.add input { flex: 1; font-family: var(--mono); }
	.add button { background: var(--accent); color: var(--on-accent); border: 0; border-radius: var(--r-pill); padding: 4px 14px; font-weight: 600; cursor: pointer; }
	.add button:disabled { opacity: .6; cursor: default; }
	.help { color: var(--ink-3); font-size: var(--t-s); line-height: 1.6; }
	.err { color: var(--fail-fg); font-size: var(--t-s); }
	.back { color: var(--ink-3); font-size: var(--t-s); }
</style>
