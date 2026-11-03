<script lang="ts">
	import { age, appLink, PRIORITY, stateGlyph, stateKind, whyText } from "./format.js";
	import type { IssueRow } from "./types.js";

	let { issue, now }: { issue: IssueRow; now: number } = $props();

	const kind = $derived(stateKind(issue.state));
	const why = $derived(whyText(issue));
</script>

<div class="row" class:unseen={issue.unseen} class:seen={!issue.unseen}>
	<span class={issue.unseen ? "dot-new" : "dot-seen"} title={issue.unseen ? "Unseen in your Linear inbox" : ""}></span>
	{#if issue.priority === 1}
		<span class="prio p1" title="Urgent">!</span>
	{:else if issue.priority === 0}
		<span class="prio p0" title="No priority">–</span>
	{:else}
		<span class="prio p{issue.priority}" title={PRIORITY[issue.priority]}><i></i><i></i><i></i></span>
	{/if}
	<a class="ident" href={issue.url} target="_blank" rel="noopener">{issue.identifier}</a>
	<a class="title" href={issue.url} target="_blank" rel="noopener" title={issue.title}>{issue.title}</a>
	<span class="chips">
		<span class="chip {kind}">{stateGlyph(kind)} {issue.state.name}</span>
		{#if issue.cycle}
			<span class="chip cycle" class:now={issue.cycle.active} title={issue.cycle.active ? "Current cycle" : "Next cycle"}>C{issue.cycle.number}</span>
		{/if}
	</span>
	<span class="links">
		<a href={issue.url} target="_blank" rel="noopener">Open</a>
		<a href={appLink(issue.url)} title="Open in the Linear desktop app">App</a>
	</span>
	{#if issue.unseen}
		<span class="sub">
			{#if why}<span class="why" class:mention={issue.why !== "subscribed"}>{why}</span>{:else}updated{/if}
			· {age(issue.updatedAt, now)} ago{#if issue.project}&nbsp;· {issue.project}{/if}
		</span>
	{/if}
</div>

<style>
	.row { display: grid; grid-template-columns: auto auto 64px 1fr auto auto; gap: 2px 8px; align-items: center; padding: 7px 10px; border-radius: var(--r-sm); }
	:global(.row + .row) { border-top: 1px solid var(--line); border-radius: 0; }
	.row:hover { background: var(--hover); }
	.title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
	.chips { display: flex; gap: 6px; }
	.sub { grid-column: 4 / span 3; font-size: var(--t-xs); color: var(--ink-3); display: flex; gap: 8px; }
</style>
