import {parseRekordboxXml, materializeLibrary, XML_LIMIT} from './rekordbox-xml.js';

export function mountRekordbox({getTracks, importLibrary, linkAudio}) {
  const panel = document.createElement('section');
  panel.className = 'rekordbox-panel';
  panel.innerHTML = `<div><p class="eyebrow">LIBRARY EXCHANGE</p><h2>Bring your prepared sets.</h2><p>Import a Rekordbox XML collection, then link your audio files. Files stay on this device.</p></div>
    <div class="rb-actions"><label class="import-button">Choose XML<input id="rb-file" type="file" accept=".xml,application/xml,text/xml"></label><button id="rb-toggle">Paste XML</button></div>
    <div id="rb-paste" hidden><label for="rb-text">Rekordbox XML</label><textarea id="rb-text" spellcheck="false" placeholder="Paste your DJ_PLAYLISTS export"></textarea><button id="rb-preview">Preview XML</button></div>
    <div id="rb-summary" role="status">No XML selected.</div><ul id="rb-warnings"></ul><button id="rb-import" class="import-button" disabled>Import collection & playlists</button>
    <div class="rb-link"><label for="rb-track">Audio to link</label><select id="rb-track"><option value="">No missing audio</option></select><label class="import-button">Choose matching audio<input id="rb-audio" type="file" accept="audio/*,.wav,.mp3,.flac,.aiff,.m4a"></label><p id="rb-location">XML contains locations, not audio. Select the matching song explicitly.</p><p id="rb-link-status" role="status"></p></div>`;
  document.querySelector('.library').before(panel);
  const $ = s => panel.querySelector(s);
  let pending = null, busy = false;
  const message = text => { $('#rb-summary').textContent = text; };
  function refresh() {
    const chosen = $('#rb-track').value;
    $('#rb-track').replaceChildren();
    const missing = getTracks().filter(t => t.rekordbox && !t.blob);
    if (!missing.length) { const o = document.createElement('option'); o.value = ''; o.textContent = 'No missing audio'; $('#rb-track').append(o); }
    for (const t of missing) { const o = document.createElement('option'); o.value = t.id; o.textContent = `${t.title} — ${t.artist}`; $('#rb-track').append(o); }
    if (missing.some(t => t.id === chosen)) $('#rb-track').value = chosen;
    $('#rb-audio').disabled = busy || !missing.length;
    $('#rb-location').textContent = getTracks().find(t => t.id === $('#rb-track').value)?.location || 'All imported audio is linked, or no XML tracks have been imported.';
  }
  function setBusy(value) {
    busy = value;
    for (const id of ['#rb-file', '#rb-preview', '#rb-track', '#rb-text']) $(id).disabled = value;
    $('#rb-import').disabled = value || !pending;
    refresh();
  }
  function preview(text) {
    pending = null; $('#rb-import').disabled = true; $('#rb-warnings').replaceChildren();
    try {
      pending = parseRekordboxXml(text);
      message(`${pending.tracks.length} tracks · ${pending.playlists.length} playlists · ${pending.warnings.length} notices. Existing tracks will be kept. Playlist folders become named crates.`);
      for (const warning of pending.warnings.slice(0, 20)) { const li = document.createElement('li'); li.textContent = warning; $('#rb-warnings').append(li); }
      $('#rb-import').disabled = false;
    } catch (e) { message(e.message); }
  }
  $('#rb-toggle').onclick = () => { $('#rb-paste').hidden = !$('#rb-paste').hidden; };
  $('#rb-preview').onclick = () => preview($('#rb-text').value);
  $('#rb-file').onchange = async event => {
    const file = event.target.files[0]; if (!file) return;
    setBusy(true); pending = null;
    try { if (file.size > XML_LIMIT) throw new Error('XML must be under 10 MB.'); preview(await file.text()); }
    catch (e) { message(e.message); }
    finally { setBusy(false); event.target.value = ''; }
  };
  $('#rb-import').onclick = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try { message(await importLibrary(await materializeLibrary(pending))); pending = null; }
    catch (e) { message(e.message); }
    finally { setBusy(false); }
  };
  $('#rb-track').onchange = refresh;
  $('#rb-audio').onchange = async event => {
    const file = event.target.files[0], id = $('#rb-track').value;
    if (!file || !id || busy) return;
    setBusy(true);
    try { $('#rb-link-status').textContent = await linkAudio(id, file); }
    catch (e) { $('#rb-link-status').textContent = e.message; }
    finally { event.target.value = ''; setBusy(false); }
  };
  refresh();
  return {refresh};
}
