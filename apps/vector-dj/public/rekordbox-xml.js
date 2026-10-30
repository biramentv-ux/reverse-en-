// Independently implemented from the public Pioneer XML playlist specification.
export const XML_LIMIT = 10 * 1024 * 1024;
const children = (node, name) => Array.from(node.childNodes || []).filter(n => n.nodeType === 1 && (!name || n.nodeName === name));
const attr = (node, name, fallback = '') => node.hasAttribute(name) ? node.getAttribute(name) : fallback;
const attributes = node => Object.fromEntries(Array.from(node.attributes || []).map(a => [a.name, a.value]));
const numeric = (node, key, fallback = 0) => {
  const value = attr(node, key);
  if (!value.trim()) return fallback;
  const n = Number(value.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${key}: ${value}`);
  return n;
};
export function parseRekordboxXml(text, Parser = globalThis.DOMParser) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > XML_LIMIT) throw new Error('XML must be under 10 MB.');
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(text)) throw new Error('DTD and entity declarations are not supported.');
  const doc = new Parser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || doc.documentElement?.nodeName !== 'DJ_PLAYLISTS') throw new Error('Select a valid Rekordbox DJ_PLAYLISTS XML export.');
  const collection = children(doc.documentElement, 'COLLECTION');
  if (collection.length !== 1) throw new Error('XML requires one COLLECTION.');
  const nodes = children(collection[0], 'TRACK');
  if (nodes.length > 5000) throw new Error('This build supports at most 5000 XML tracks.');
  const ids = new Map(), locations = new Map(), warnings = [];
  const tracks = nodes.map((node, index) => {
    const location = attr(node, 'Location'), sourceId = attr(node, 'TrackID');
    let uri;
    try { uri = new URL(location); } catch { throw new Error(`Track ${index + 1}: invalid Location.`); }
    if (uri.protocol !== 'file:' || !uri.pathname || uri.pathname.endsWith('/')) throw new Error(`Track ${index + 1}: expected a file URI.`);
    if ((sourceId && ids.has(sourceId)) || locations.has(location)) throw new Error('Duplicate TrackID or Location in XML.');
    const duration = numeric(node, 'TotalTime'), bpm = numeric(node, 'AverageBpm');
    const tempos = children(node, 'TEMPO').map(attributes), marks = children(node, 'POSITION_MARK').map(attributes);
    const cues = Array(8).fill(null);
    for (const mark of children(node, 'POSITION_MARK')) {
      const slot = Number(attr(mark, 'Num', '-1')), position = numeric(mark, 'Start');
      if (attr(mark, 'Type') === '0' && Number.isInteger(slot) && slot >= 0 && slot < 8 && (!duration || position <= duration)) cues[slot] = position;
      else warnings.push(`Track ${index + 1}: a memory cue, loop or unsupported mark was retained as metadata only.`);
    }
    let gridAnchor = 0;
    if (tempos.length === 1 && tempos[0].Metro === '4/4' && numeric(children(node, 'TEMPO')[0], 'Bpm') === bpm) gridAnchor = numeric(children(node, 'TEMPO')[0], 'Inizio');
    else if (tempos.length) warnings.push(`Track ${index + 1}: variable or non-4/4 grid is retained but not applied.`);
    if (bpm && (bpm < 40 || bpm > 300)) warnings.push(`Track ${index + 1}: BPM outside the engine range; set it manually.`);
    const track = { sourceId, location, title: attr(node, 'Name') || decodeURIComponent(uri.pathname.split('/').pop()), artist: attr(node, 'Artist'), bpm: bpm >= 40 && bpm <= 300 ? bpm : null, duration, cues, gridAnchor, rekordbox: {attributes: attributes(node), tempos, marks} };
    if (sourceId) ids.set(sourceId, index);
    locations.set(location, index);
    return track;
  });
  const playlists = [];
  function visit(node, path, depth) {
    if (depth > 32) throw new Error('Playlist folders are too deeply nested.');
    const name = attr(node, 'Name', 'Untitled'), type = attr(node, 'Type');
    if (type === '0') { for (const next of children(node, 'NODE')) visit(next, name === 'ROOT' && !path.length ? [] : [...path, name], depth + 1); }
    else if (type === '1') {
      if (playlists.length >= 100) throw new Error('This build supports at most 100 XML playlists.');
      const keyType = attr(node, 'KeyType', '0');
      if (!['0', '1'].includes(keyType)) throw new Error('Unsupported playlist KeyType.');
      const lookup = keyType === '1' ? locations : ids;
      const indexes = children(node, 'TRACK').map(ref => {
        const key = attr(ref, 'Key');
        if (!lookup.has(key)) throw new Error(`Playlist ${name} references a missing track: ${key}`);
        return lookup.get(key);
      });
      playlists.push({name: [...path, name].join(' / '), indexes: [...new Set(indexes)]});
    } else throw new Error('Unknown playlist node type.');
  }
  for (const container of children(doc.documentElement, 'PLAYLISTS')) for (const node of children(container, 'NODE')) visit(node, [], 0);
  return {tracks, playlists, warnings: [...new Set(warnings)]};
}
export async function materializeLibrary(parsed) {
  const tracks = await Promise.all(parsed.tracks.map(async t => {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t.location));
    const id = 'rb-' + Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
    return {...t, id, blob: null, favorite: false, estimated: false};
  }));
  return {tracks, playlists: parsed.playlists.map(p => ({name: p.name, trackIds: p.indexes.map(i => tracks[i].id)})), warnings: parsed.warnings};
}
