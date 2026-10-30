import {readFile,writeFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const panel='<section class="library-main"><h2>MIDI integration QA — synthetic input</h2><p>Runs the real studio UI with synthetic MIDI messages. No native MIDI access or physical hardware is tested. Master stays muted during playback.</p><button id="run-midi-qa">Run MIDI UI checks</button><pre id="midi-qa-results">Ready</pre></section>';
await writeFile(new URL('../public/midi-qa.html',import.meta.url),source.replace('<main>','<main>'+panel).replace('src="app.js"','src="midi-qa.js"'));
