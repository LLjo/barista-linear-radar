// The toolbar every mockup shares: title, workspace + team filter pills, refresh interval, sync line.
// Pills are client-side filters over the snapshot; a dimmed pill is switched off.
function toolbar(opts = {}) {
	const n = ISSUES.filter((i) => i.unseen).length;
	return `<div class="bar">
		<h1>Linear Radar</h1>
		<label>Workspace <span class="pill">Acme</span><span class="pill">Northwind</span></label>
		<label>Teams <span class="pill">ENG</span><span class="pill">WEB</span><span class="pill off">DES</span><span class="pill">OPS</span></label>
		${opts.noEvery ? "" : `<label>Every <select><option>1 min</option><option selected>5 min</option><option>15 min</option></select></label>`}
		<span class="sync"><span class="chip wait">${n} unseen</span> synced 1 min ago <button title="Refresh">↻</button><a class="iconbtn" href="settings.html" title="Settings: API keys">⚙</a></span>
	</div>`;
}
