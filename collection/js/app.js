// Vault — Hypercube collection manager. Main UI controller.

import { TYPES, TYPE_ORDER, STATUSES, typeFields, newItem, BASE_ALIASES } from './schema.js';
import * as store from './db.js';
import { parseCSV, sniffDelimiter, toCSV, sheetsCsvUrl } from './csv.js';
import { LOOKUP, NeedsKeyError } from './api.js';
import { getSettings, saveSettings } from './settings.js';

// ---------- tiny DOM helpers ----------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (v != null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el;
}

function toast(msg, isErr = false, ms = 3400) {
  const root = document.getElementById('toast-root');
  const t = h('div', { class: 'toast' + (isErr ? ' err' : '') }, msg);
  root.append(t);
  setTimeout(() => t.remove(), ms);
}

function openModal(title, body, footer = [], { wide = false, onclose = null } = {}) {
  const root = document.getElementById('modal-root');
  const close = () => { overlay.remove(); onclose?.(); };
  const overlay = h('div', { class: 'overlay', onclick: e => { if (e.target === overlay) close(); } },
    h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-label': title },
      h('header', {}, h('h2', {}, title), h('button', { class: 'x', title: 'Close', onclick: close }, '✕')),
      h('div', { class: 'body' }, body),
      footer.length ? h('footer', {}, ...footer) : null,
    ));
  root.append(overlay);
  return { close, overlay };
}

function confirmDlg(msg, okLabel = 'Delete') {
  return new Promise(resolve => {
    const m = openModal('Are you sure?', h('p', {}, msg), [
      h('button', { class: 'btn', onclick: () => { m.close(); resolve(false); } }, 'Cancel'),
      h('button', { class: 'btn danger', onclick: () => { m.close(); resolve(true); } }, okLabel),
    ], { onclose: () => resolve(false) });
  });
}

const fmtMoney = v => (v == null || v === '' || isNaN(+v)) ? '' : (+v).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
const esc = s => String(s ?? '');

// ---------- state ----------

let items = [];
let filters = { type: 'all', status: 'all', tag: null };
let query = '';
let selectMode = false;
const selection = new Set();

function itemText(it) {
  const parts = [it.title, it.status, (it.tags || []).join(' '), it.notes,
    ...Object.values(it.fields || {}), ...Object.entries(it.custom || {}).flat()];
  return parts.join(' ').toLowerCase();
}

function filteredItems() {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  let list = items.filter(it => {
    if (filters.type !== 'all' && it.type !== filters.type) return false;
    if (filters.status !== 'all' && it.status !== filters.status) return false;
    if (filters.tag && !(it.tags || []).includes(filters.tag)) return false;
    if (terms.length) {
      const text = itemText(it);
      if (!terms.every(t => text.includes(t))) return false;
    }
    return true;
  });
  const [key, dir] = (getSettings().sort || 'updatedAt-desc').split('-');
  const mul = dir === 'desc' ? -1 : 1;
  const val = it => {
    if (key === 'title') return it.title.toLowerCase();
    if (key === 'year') return +(it.fields?.year) || 0;
    if (key === 'rating') return +it.rating || 0;
    if (key === 'value') return +(it.fields?.currentValue) || 0;
    return it[key] || '';
  };
  list.sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * mul);
  return list;
}

// ---------- rendering ----------

function renderAll() {
  renderSidebar();
  renderToolbar();
  renderItems();
  renderBulkBar();
}

function renderSidebar() {
  const side = document.getElementById('sidebar');
  side.replaceChildren();

  const counts = { all: items.length };
  for (const it of items) counts[it.type] = (counts[it.type] || 0) + 1;

  const typeBtn = (id, label, icon) => h('button', {
    class: filters.type === id ? 'active' : '',
    onclick: () => { filters.type = id; filters.tag = null; renderAll(); },
  }, h('span', {}, icon), ` ${label}`, h('span', { class: 'cnt' }, String(counts[id] || 0)));

  const typesDiv = h('div', {},
    h('h3', {}, 'Collections'),
    h('div', { class: 'navlist' },
      typeBtn('all', 'Everything', '⬡'),
      ...TYPE_ORDER.map(id => typeBtn(id, TYPES[id].label, TYPES[id].icon))));

  const statusDiv = h('div', {},
    h('h3', {}, 'Status'),
    h('div', { class: 'navlist' },
      h('button', { class: filters.status === 'all' ? 'active' : '', onclick: () => { filters.status = 'all'; renderAll(); } }, 'Any'),
      ...STATUSES.map(s => {
        const n = items.filter(i => i.status === s).length;
        if (!n && filters.status !== s) return null;
        return h('button', { class: filters.status === s ? 'active' : '', onclick: () => { filters.status = s; renderAll(); } },
          s, h('span', { class: 'cnt' }, String(n)));
      })));

  const tagCounts = {};
  for (const it of items) for (const t of it.tags || []) tagCounts[t] = (tagCounts[t] || 0) + 1;
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 30);
  const tagsDiv = topTags.length ? h('div', {},
    h('h3', {}, 'Tags'),
    h('div', { class: 'tagcloud' }, ...topTags.map(([t, n]) =>
      h('button', { class: 'tagchip' + (filters.tag === t ? ' active' : ''), onclick: () => { filters.tag = filters.tag === t ? null : t; renderAll(); } },
        `${t} · ${n}`)))) : null;

  side.append(typesDiv, statusDiv, ...(tagsDiv ? [tagsDiv] : []));
}

function renderToolbar() {
  const bar = document.getElementById('toolbar');
  bar.replaceChildren();
  const list = filteredItems();
  const settings = getSettings();

  const sortSel = h('select', {
    onchange: e => { saveSettings({ sort: e.target.value }); renderItems(); },
  }, ...[
    ['updatedAt-desc', 'Recently updated'],
    ['createdAt-desc', 'Recently added'],
    ['title-asc', 'Title A–Z'],
    ['title-desc', 'Title Z–A'],
    ['year-desc', 'Year (newest)'],
    ['year-asc', 'Year (oldest)'],
    ['rating-desc', 'My rating'],
    ['value-desc', 'Est. value'],
  ].map(([v, l]) => h('option', { value: v, selected: settings.sort === v || null }, l)));

  bar.append(
    h('span', { class: 'count' }, `${list.length} item${list.length === 1 ? '' : 's'}`,
      filters.tag ? ` · tag “${filters.tag}”` : ''),
    h('button', { class: 'btn small', title: 'Pick a random item from the current view', onclick: randomPick }, '🎲 Surprise me'),
    h('button', { class: 'btn small' + (selectMode ? ' primary' : ''), onclick: () => { selectMode = !selectMode; selection.clear(); renderItems(); renderBulkBar(); } },
      selectMode ? 'Done selecting' : 'Select'),
    h('button', { class: 'btn small', title: 'Export the current view as CSV', onclick: exportCurrentCSV }, '⇩ CSV'),
    sortSel,
    h('div', { class: 'viewtoggle' },
      h('button', { class: settings.view === 'grid' ? 'active' : '', title: 'Grid view', onclick: () => { saveSettings({ view: 'grid' }); renderItems(); renderToolbar(); } }, '▦'),
      h('button', { class: settings.view === 'list' ? 'active' : '', title: 'List view', onclick: () => { saveSettings({ view: 'list' }); renderItems(); renderToolbar(); } }, '☰')),
  );
}

function itemBadges(it) {
  const badges = [];
  if (it.status && it.status !== 'Owned') badges.push(h('span', { class: 'badge status-' + it.status.replace(/[^A-Za-z]/g, '') }, it.status));
  if (it.rating) badges.push(h('span', { class: 'badge rating' }, `★ ${it.rating}`));
  const year = it.fields?.year;
  if (year) badges.push(h('span', { class: 'badge' }, String(year)));
  return badges;
}

function cardEl(it) {
  const t = TYPES[it.type] || TYPES.other;
  const card = h('div', { class: 'card' + (selection.has(it.id) ? ' selected' : ''), dataset: { id: it.id } },
    h('input', { type: 'checkbox', class: 'selbox', checked: selection.has(it.id), onclick: e => { e.stopPropagation(); toggleSel(it.id); } }),
    h('div', { class: 'thumb' }, it.imageUrl
      ? h('img', { src: it.imageUrl, alt: '', loading: 'lazy', onerror: e => { e.target.replaceWith(h('span', {}, t.icon)); } })
      : t.icon),
    h('div', { class: 'meta' },
      h('div', { class: 't' }, it.title || '(untitled)'),
      h('div', { class: 's' }, subtitleFor(it)),
      h('div', { class: 'badges' }, ...itemBadges(it))));
  card.addEventListener('click', () => selectMode ? toggleSel(it.id) : openDetail(it));
  return card;
}

function subtitleFor(it) {
  const f = it.fields || {};
  switch (it.type) {
    case 'book': return f.author || '';
    case 'movie': return [f.format, f.director].filter(Boolean).join(' · ');
    case 'videogame': return f.platform || '';
    case 'boardgame': return f.players ? `${f.players} players` : (f.designer || '');
    case 'actionfigure': return [f.line, f.manufacturer].filter(Boolean).join(' · ');
    case 'comic': return [f.series, f.issueNum ? `#${f.issueNum}` : ''].filter(Boolean).join(' ');
    default: return f.category || '';
  }
}

function renderItems() {
  const root = document.getElementById('items');
  root.replaceChildren();
  const list = filteredItems();
  document.body.classList.toggle('selectmode', selectMode);

  if (!list.length) {
    const anyAtAll = items.length > 0;
    root.append(h('div', { class: 'empty' },
      h('div', { class: 'big' }, '⬡'),
      h('div', {}, anyAtAll ? 'Nothing matches this filter or search.' : 'Your vault is empty.'),
      anyAtAll ? null : h('p', {},
        h('button', { class: 'btn primary', onclick: () => openEditor() }, '+ Add your first item'), ' or ',
        h('button', { class: 'btn', onclick: openImport }, 'Import a spreadsheet'))));
    return;
  }

  if (getSettings().view === 'list') {
    const rows = list.map(it => {
      const t = TYPES[it.type] || TYPES.other;
      const tr = h('tr', { dataset: { id: it.id } },
        h('td', {}, it.imageUrl ? h('img', { class: 'mini', src: it.imageUrl, alt: '', loading: 'lazy' }) : h('span', { style: 'font-size:22px' }, t.icon)),
        h('td', {}, h('strong', {}, it.title || '(untitled)'), h('div', { class: 'muted', style: 'font-size:12px' }, subtitleFor(it))),
        h('td', {}, t.singular),
        h('td', {}, esc(it.fields?.year || '')),
        h('td', {}, it.status),
        h('td', {}, it.rating ? `★ ${it.rating}` : ''),
        h('td', {}, fmtMoney(it.fields?.currentValue)),
        h('td', {}, (it.tags || []).join(', ')));
      tr.addEventListener('click', () => selectMode ? toggleSel(it.id) : openDetail(it));
      return tr;
    });
    root.append(h('div', { class: 'listwrap' }, h('table', { class: 'listtable' },
      h('thead', {}, h('tr', {}, ...['', 'Title', 'Type', 'Year', 'Status', 'Rating', 'Value', 'Tags'].map(x => h('th', {}, x)))),
      h('tbody', {}, ...rows))));
  } else {
    root.append(h('div', { class: 'grid' }, ...list.map(cardEl)));
  }
}

// ---------- selection / bulk ----------

function toggleSel(id) {
  selection.has(id) ? selection.delete(id) : selection.add(id);
  renderItems();
  renderBulkBar();
}

function renderBulkBar() {
  document.querySelector('.bulkbar')?.remove();
  if (!selectMode || !selection.size) return;
  const bar = h('div', { class: 'bulkbar' },
    h('strong', {}, `${selection.size} selected`),
    h('button', { class: 'btn small', onclick: () => { filteredItems().forEach(i => selection.add(i.id)); renderItems(); renderBulkBar(); } }, 'Select all'),
    h('button', { class: 'btn small', onclick: bulkTag }, '+ Tag'),
    h('button', { class: 'btn small', onclick: bulkStatus }, 'Set status'),
    h('button', { class: 'btn small danger', onclick: bulkDelete }, 'Delete'),
  );
  document.body.append(bar);
}

async function bulkDelete() {
  if (!await confirmDlg(`Delete ${selection.size} item(s)? This can't be undone.`)) return;
  await store.deleteItems([...selection]);
  items = items.filter(i => !selection.has(i.id));
  selection.clear();
  toast('Deleted.');
  renderAll();
}

function bulkTag() {
  const input = h('input', { placeholder: 'tag name' });
  const m = openModal('Add tag to selected', h('div', { class: 'field' }, h('label', {}, 'Tag'), input), [
    h('button', { class: 'btn primary', onclick: async () => {
      const tag = input.value.trim();
      if (!tag) return;
      const changed = [];
      for (const it of items) if (selection.has(it.id) && !(it.tags || []).includes(tag)) {
        it.tags = [...(it.tags || []), tag]; it.updatedAt = new Date().toISOString(); changed.push(it);
      }
      await store.putItems(changed);
      m.close(); toast(`Tagged ${changed.length} item(s).`); renderAll();
    } }, 'Apply'),
  ]);
  input.focus();
}

function bulkStatus() {
  const sel = h('select', {}, ...STATUSES.map(s => h('option', { value: s }, s)));
  const m = openModal('Set status for selected', h('div', { class: 'field' }, h('label', {}, 'Status'), sel), [
    h('button', { class: 'btn primary', onclick: async () => {
      const changed = [];
      for (const it of items) if (selection.has(it.id)) {
        it.status = sel.value; it.updatedAt = new Date().toISOString(); changed.push(it);
      }
      await store.putItems(changed);
      m.close(); toast(`Updated ${changed.length} item(s).`); renderAll();
    } }, 'Apply'),
  ]);
}

// ---------- detail view ----------

function openDetail(it) {
  const t = TYPES[it.type] || TYPES.other;
  const rows = [];
  for (const f of typeFields(it.type)) {
    const v = it.fields?.[f.key];
    if (v != null && v !== '') rows.push([f.label, ['purchasePrice', 'currentValue'].includes(f.key) ? fmtMoney(v) : String(v)]);
  }
  for (const [k, v] of Object.entries(it.custom || {})) if (v) rows.push([k, v]);

  const m = openModal(`${t.icon} ${it.title || '(untitled)'}`, h('div', { class: 'detail' },
    h('div', { class: 'cover' },
      it.imageUrl ? h('img', { src: it.imageUrl, alt: '' }) : h('div', { class: 'noimg' }, t.icon)),
    h('div', { style: 'flex:1;min-width:0' },
      h('div', { class: 'muted' }, subtitleFor(it)),
      h('div', { class: 'badges', style: 'display:flex;gap:5px;flex-wrap:wrap;margin:8px 0' },
        h('span', { class: 'badge' }, t.singular), ...itemBadges(it),
        ...(it.tags || []).map(tag => h('span', { class: 'badge' }, '#' + tag))),
      it.link ? h('p', {}, h('a', { href: it.link, target: '_blank', rel: 'noopener' }, 'View on ' + linkLabel(it.link) + ' ↗')) : null,
      rows.length ? h('dl', {}, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])) : null,
      it.notes ? h('p', { style: 'white-space:pre-wrap' }, it.notes) : null,
      h('p', { class: 'muted', style: 'font-size:12px' }, `Added ${it.createdAt?.slice(0, 10) || '?'} · Updated ${it.updatedAt?.slice(0, 10) || '?'}`),
    )),
    [
      h('button', { class: 'btn danger', onclick: async () => {
        if (!await confirmDlg(`Delete “${it.title}”?`)) return;
        await store.deleteItem(it.id);
        items = items.filter(x => x.id !== it.id);
        m.close(); toast('Deleted.'); renderAll();
      } }, 'Delete'),
      h('button', { class: 'btn', onclick: async () => {
        const copy = { ...structuredClone(it), id: crypto.randomUUID(), title: it.title + ' (copy)', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        await store.putItem(copy); items.push(copy);
        m.close(); toast('Duplicated.'); renderAll();
      } }, 'Duplicate'),
      h('button', { class: 'btn primary', onclick: () => { m.close(); openEditor(it); } }, 'Edit'),
    ]);
}

function linkLabel(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'source'; }
}

// ---------- editor ----------

function openEditor(existing = null, prefill = null) {
  let typeId = existing?.type || prefill?.type || (filters.type !== 'all' ? filters.type : 'book');
  const item = existing ? structuredClone(existing) : newItem(typeId);
  if (prefill) applyPrefill(item, prefill);

  const bodyWrap = h('div');
  let m;

  function applyPrefill(target, p) {
    if (p.title) target.title = p.title;
    if (p.imageUrl) target.imageUrl = p.imageUrl;
    if (p.link) target.link = p.link;
    for (const [k, v] of Object.entries(p.fields || {})) if (v !== '' && v != null) target.fields[k] = v;
  }

  function buildForm() {
    bodyWrap.replaceChildren();
    const t = TYPES[item.type] || TYPES.other;
    const lookup = LOOKUP[item.type];

    const typeSel = h('select', { onchange: e => { item.type = e.target.value; buildForm(); } },
      ...TYPE_ORDER.map(id => h('option', { value: id, selected: item.type === id || null }, `${TYPES[id].icon} ${TYPES[id].singular}`)));

    const titleInput = h('input', { value: item.title, placeholder: 'Title', oninput: e => item.title = e.target.value });

    const lookupBtn = lookup ? h('button', { class: 'btn small', style: 'margin-top:6px', onclick: e => {
      e.preventDefault();
      openLookup(item.type, titleInput.value.trim(), picked => { applyPrefill(item, picked); buildForm(); });
    } }, `⌕ Look up on ${lookup.name}`) : null;

    const fieldInputs = typeFields(item.type).map(f => {
      const val = item.fields[f.key] ?? '';
      let input;
      const set = v => { item.fields[f.key] = v; };
      if (f.input === 'select') {
        input = h('select', { onchange: e => set(e.target.value) },
          ...f.options.map(o => h('option', { value: o, selected: String(val) === o || null }, o || '—')));
      } else if (f.input === 'textarea') {
        input = h('textarea', { oninput: e => set(e.target.value) }, esc(val));
      } else {
        input = h('input', {
          type: f.input === 'number' ? 'number' : 'text',
          step: f.step || (f.input === 'number' ? 'any' : null),
          inputmode: f.input === 'year' ? 'numeric' : null,
          placeholder: f.placeholder || '',
          value: esc(val),
          oninput: e => set(e.target.value),
        });
      }
      return h('div', { class: 'field' + (f.input === 'textarea' ? ' full' : '') }, h('label', {}, f.label), input);
    });

    const customRows = h('div', { class: 'full' });
    const addCustomRow = (k = '', v = '') => {
      const kIn = h('input', { placeholder: 'Field name', value: k });
      const vIn = h('input', { placeholder: 'Value', value: v });
      const row = h('div', { class: 'kvrow' }, kIn, vIn,
        h('button', { class: 'btn small', onclick: e => { e.preventDefault(); row.remove(); } }, '✕'));
      row.getKV = () => [kIn.value.trim(), vIn.value.trim()];
      customRows.append(row);
    };
    for (const [k, v] of Object.entries(item.custom || {})) addCustomRow(k, v);

    bodyWrap.append(
      t.dbNote ? h('p', { class: 'notice' }, t.dbNote) : null,
      h('div', { class: 'formgrid' },
        h('div', { class: 'field' }, h('label', {}, 'Type'), typeSel),
        h('div', { class: 'field' }, h('label', {}, 'Status'),
          h('select', { onchange: e => item.status = e.target.value },
            ...STATUSES.map(s => h('option', { value: s, selected: item.status === s || null }, s)))),
        h('div', { class: 'field full' }, h('label', {}, 'Title *'), titleInput, lookupBtn),
        h('div', { class: 'sectionlabel' }, `${t.singular} details`),
        ...fieldInputs,
        h('div', { class: 'sectionlabel' }, 'General'),
        h('div', { class: 'field' }, h('label', {}, 'My rating (0–5)'),
          h('input', { type: 'number', min: 0, max: 5, step: 0.5, value: item.rating ?? '', oninput: e => item.rating = e.target.value === '' ? null : +e.target.value })),
        h('div', { class: 'field' }, h('label', {}, 'Tags (comma-separated)'),
          h('input', { value: (item.tags || []).join(', '), placeholder: 'sci-fi, favorites', oninput: e => item.tags = e.target.value.split(',').map(s => s.trim()).filter(Boolean) })),
        h('div', { class: 'field full' }, h('label', {}, 'Image URL'),
          h('input', { value: item.imageUrl, placeholder: 'https://…', oninput: e => item.imageUrl = e.target.value.trim() })),
        h('div', { class: 'field full' }, h('label', {}, 'Link'),
          h('input', { value: item.link, placeholder: 'https://…', oninput: e => item.link = e.target.value.trim() })),
        h('div', { class: 'field full' }, h('label', {}, 'Notes'),
          h('textarea', { oninput: e => item.notes = e.target.value }, esc(item.notes))),
        h('div', { class: 'sectionlabel' }, 'Custom fields'),
        customRows,
        h('div', { class: 'full' }, h('button', { class: 'btn small', onclick: e => { e.preventDefault(); addCustomRow(); } }, '+ Add custom field')),
      ));
    bodyWrap.collectCustom = () => {
      const out = {};
      for (const row of customRows.children) {
        const [k, v] = row.getKV();
        if (k) out[k] = v;
      }
      return out;
    };
  }

  buildForm();
  m = openModal(existing ? 'Edit item' : 'Add item', bodyWrap, [
    h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: async () => {
      if (!item.title.trim()) { toast('A title is required.', true); return; }
      item.custom = bodyWrap.collectCustom();
      item.updatedAt = new Date().toISOString();
      await store.putItem(item);
      const i = items.findIndex(x => x.id === item.id);
      if (i >= 0) items[i] = item; else items.push(item);
      m.close(); toast(existing ? 'Saved.' : 'Added to your vault.'); renderAll();
    } }, existing ? 'Save' : 'Add'),
  ], { wide: true });
}

// ---------- external lookup ----------

function openLookup(typeId, initialQuery, onPick) {
  const lookup = LOOKUP[typeId];
  if (!lookup) return;
  const input = h('input', { value: initialQuery || '', placeholder: `Search ${lookup.name}…` });
  const resultsBox = h('div', { class: 'results' });
  const status = h('div', { class: 'hint' }, lookup.keyless ? '' : 'Uses your API key from Settings.');

  async function run() {
    const q = input.value.trim();
    if (!q) return;
    resultsBox.replaceChildren(h('div', { class: 'muted' }, h('span', { class: 'spin' }), ' Searching…'));
    try {
      const results = await lookup.search(q);
      resultsBox.replaceChildren();
      if (!results.length) { resultsBox.append(h('div', { class: 'muted' }, 'No results.')); return; }
      for (const r of results) {
        resultsBox.append(h('button', { class: 'result', onclick: () => { m.close(); onPick(r); } },
          r.thumb ? h('img', { src: r.thumb, alt: '', loading: 'lazy' }) : h('div', { class: 'noimg' }, TYPES[typeId].icon),
          h('div', {},
            h('div', { class: 't' }, r.title, r.year ? h('span', { class: 'muted' }, ` (${r.year})`) : ''),
            h('div', { class: 's' }, r.subtitle || ''))));
      }
    } catch (err) {
      resultsBox.replaceChildren();
      if (err instanceof NeedsKeyError) {
        resultsBox.append(h('div', { class: 'notice' },
          `${err.service} requires a free API key. `,
          h('a', { href: err.signupUrl, target: '_blank', rel: 'noopener' }, 'Get one here ↗'),
          ' then paste it into ', h('a', { href: '#', onclick: e => { e.preventDefault(); m.close(); openSettings(); } }, 'Settings'), '.'));
      } else {
        resultsBox.append(h('div', { class: 'notice' }, `Lookup failed: ${err.message}. If this keeps happening, check your connection or the CORS proxy in Settings.`));
      }
    }
  }

  input.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
  const m = openModal(`Search ${lookup.name}`, h('div', {},
    h('div', { class: 'kvrow' }, input, h('button', { class: 'btn primary', onclick: run }, 'Search')),
    status, h('div', { style: 'height:10px' }), resultsBox));
  if (initialQuery) run(); else input.focus();
}

// ---------- CSV / Sheets import ----------

function openImport() {
  const fileInput = h('input', { type: 'file', accept: '.csv,.tsv,text/csv,text/tab-separated-values' });
  const urlInput = h('input', { placeholder: 'Paste a Google Sheets link (shared: “anyone with the link”)' });
  const typeSel = h('select', {}, ...TYPE_ORDER.map(id => h('option', { value: id }, `${TYPES[id].icon} ${TYPES[id].label}`)));
  if (filters.type !== 'all') typeSel.value = filters.type;

  const m = openModal('Import a spreadsheet', h('div', {},
    h('div', { class: 'field' }, h('label', {}, 'Which collection is this?'), typeSel),
    h('div', { class: 'field', style: 'margin-top:12px' }, h('label', {}, 'CSV / TSV file'), fileInput),
    h('div', { class: 'muted', style: 'text-align:center;margin:10px 0' }, '— or —'),
    h('div', { class: 'field' }, h('label', {}, 'Google Sheets link'), urlInput,
      h('div', { class: 'hint' }, 'The sheet must be shared as “Anyone with the link can view”. The link is remembered so you can re-sync later.')),
    h('div', { style: 'margin-top:14px' },
      h('div', { class: 'sectionlabel', style: 'margin-bottom:8px' }, 'Full backup'),
      h('button', { class: 'btn small', onclick: () => importJSONBackup(m) }, 'Restore JSON backup…')),
  ), [
    h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: async () => {
      const type = typeSel.value;
      try {
        if (fileInput.files[0]) {
          const text = await fileInput.files[0].text();
          m.close();
          openMapper(text, type, { name: fileInput.files[0].name });
        } else if (urlInput.value.trim()) {
          const csvUrl = sheetsCsvUrl(urlInput.value);
          if (!csvUrl) { toast('That doesn’t look like a Google Sheets link.', true); return; }
          const res = await fetch(csvUrl);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const text = await res.text();
          if (/^\s*</.test(text)) throw new Error('Sheet is not shared publicly');
          m.close();
          openMapper(text, type, { name: 'Google Sheet', sheetUrl: urlInput.value.trim() });
        } else {
          toast('Choose a file or paste a Sheets link first.', true);
        }
      } catch (err) {
        toast(`Couldn't read the sheet: ${err.message}. Make sure it's shared as "Anyone with the link".`, true, 6000);
      }
    } }, 'Next →'),
  ]);

  // Offer saved sheet links for one-click re-sync
  store.getMeta('linkedSheets', []).then(saved => {
    if (!saved.length) return;
    const box = h('div', { style: 'margin-top:14px' },
      h('div', { class: 'sectionlabel', style: 'margin-bottom:8px' }, 'Linked sheets (re-sync)'),
      ...saved.map(s => h('div', { class: 'kvrow' },
        h('button', { class: 'btn small', style: 'flex:1;text-align:left', onclick: () => { m.close(); resyncSheet(s); } },
          `↻ ${s.name || 'Sheet'} → ${TYPES[s.type]?.label || s.type}`),
        h('button', { class: 'btn small', title: 'Forget this link', onclick: async e => {
          e.target.closest('.kvrow').remove();
          await store.setMeta('linkedSheets', (await store.getMeta('linkedSheets', [])).filter(x => x.url !== s.url));
        } }, '✕'))));
    m.overlay.querySelector('.body').append(box);
  });
}

async function resyncSheet(s) {
  try {
    const res = await fetch(sheetsCsvUrl(s.url));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    openMapper(text, s.type, { name: s.name || 'Google Sheet', sheetUrl: s.url, savedMapping: s.mapping });
  } catch (err) {
    toast(`Re-sync failed: ${err.message}`, true, 6000);
  }
}

function fieldChoicesFor(type) {
  // [value, label] pairs the mapper can target.
  const base = [
    ['', '— skip —'], ['title', 'Title'], ['tags', 'Tags'], ['status', 'Status'],
    ['rating', 'My rating'], ['notes', 'Notes'], ['imageUrl', 'Image URL'], ['link', 'Link'],
  ];
  const typed = typeFields(type).map(f => ['f:' + f.key, f.label]);
  return [...base, ...typed, ['custom', 'Custom field (keep column name)']];
}

function guessField(header, type) {
  const hNorm = header.trim().toLowerCase();
  if (!hNorm) return '';
  for (const [key, aliases] of Object.entries(BASE_ALIASES)) {
    if (aliases.includes(hNorm)) return key;
  }
  for (const f of typeFields(type)) {
    if ((f.aliases || []).includes(hNorm) || f.label.toLowerCase() === hNorm) return 'f:' + f.key;
  }
  return 'custom';
}

function openMapper(text, type, { name = 'file', sheetUrl = null, savedMapping = null } = {}) {
  const rows = parseCSV(text, sniffDelimiter(text));
  if (rows.length < 2) { toast('That file has no data rows.', true); return; }
  const headers = rows[0];
  const dataRows = rows.slice(1);
  const sample = dataRows[0] || [];

  const selects = headers.map((hd, i) => h('select', {},
    ...fieldChoicesFor(type).map(([v, l]) =>
      h('option', { value: v, selected: (savedMapping?.[i] ?? guessField(hd, type)) === v || null }, l))));

  const skipDups = h('input', { type: 'checkbox', checked: true, style: 'width:auto' });
  const rememberLink = sheetUrl ? h('input', { type: 'checkbox', checked: true, style: 'width:auto' }) : null;

  const m = openModal(`Map columns — ${name}`, h('div', {},
    h('p', { class: 'muted' }, `${dataRows.length} rows → ${TYPES[type].label}. Match each spreadsheet column to a field:`),
    h('div', { class: 'listwrap' }, h('table', { class: 'maptable' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Column'), h('th', {}, 'First row'), h('th', {}, 'Import as'))),
      h('tbody', {}, ...headers.map((hd, i) => h('tr', {},
        h('td', {}, h('strong', {}, hd || `(col ${i + 1})`)),
        h('td', {}, h('span', { class: 'sample' }, sample[i] || '')),
        h('td', {}, selects[i])))))),
    h('label', { style: 'display:flex;gap:8px;align-items:center;margin-top:12px;cursor:pointer' },
      skipDups, 'Skip rows whose title already exists in this collection'),
    rememberLink ? h('label', { style: 'display:flex;gap:8px;align-items:center;margin-top:6px;cursor:pointer' },
      rememberLink, 'Remember this sheet for one-click re-sync') : null,
  ), [
    h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: async () => {
      const mapping = selects.map(s => s.value);
      if (!mapping.includes('title')) { toast('Map one column to Title first.', true); return; }
      const existingTitles = new Set(items.filter(i => i.type === type).map(i => i.title.trim().toLowerCase()));
      const created = [];
      let skipped = 0;
      for (const row of dataRows) {
        const it = newItem(type);
        for (let i = 0; i < headers.length; i++) {
          const target = mapping[i];
          const raw = (row[i] ?? '').trim();
          if (!target || !raw) continue;
          if (target === 'title') it.title = raw;
          else if (target === 'tags') it.tags = raw.split(/[,;|]/).map(s => s.trim()).filter(Boolean);
          else if (target === 'status') it.status = STATUSES.find(s => s.toLowerCase() === raw.toLowerCase()) || it.status;
          else if (target === 'rating') { const n = parseFloat(raw); if (!isNaN(n)) it.rating = Math.min(5, n > 5 ? n / 2 : n); }
          else if (target === 'notes') it.notes = it.notes ? it.notes + '\n' + raw : raw;
          else if (target === 'imageUrl') it.imageUrl = raw;
          else if (target === 'link') it.link = raw;
          else if (target.startsWith('f:')) it.fields[target.slice(2)] = raw;
          else if (target === 'custom') it.custom[headers[i] || `col${i + 1}`] = raw;
        }
        if (!it.title.trim()) { skipped++; continue; }
        if (skipDups.checked && existingTitles.has(it.title.trim().toLowerCase())) { skipped++; continue; }
        existingTitles.add(it.title.trim().toLowerCase());
        created.push(it);
      }
      await store.putItems(created);
      items.push(...created);
      if (sheetUrl && rememberLink?.checked) {
        const saved = (await store.getMeta('linkedSheets', [])).filter(x => x.url !== sheetUrl);
        saved.push({ url: sheetUrl, type, name, mapping, lastSync: new Date().toISOString() });
        await store.setMeta('linkedSheets', saved);
      }
      m.close();
      toast(`Imported ${created.length} item(s)${skipped ? `, skipped ${skipped} (duplicate or untitled)` : ''}.`, false, 5000);
      filters.type = type;
      renderAll();
    } }, 'Import'),
  ], { wide: true });
}

// ---------- export / backup ----------

function download(filename, mime, content) {
  const a = h('a', { href: URL.createObjectURL(new Blob([content], { type: mime })), download: filename });
  document.body.append(a); a.click(); a.remove();
}

function exportCurrentCSV() {
  const list = filteredItems();
  if (!list.length) { toast('Nothing to export in this view.', true); return; }
  const fieldKeys = [...new Set(list.flatMap(it => Object.keys(it.fields || {})))];
  const customKeys = [...new Set(list.flatMap(it => Object.keys(it.custom || {})))];
  const fieldLabel = k => {
    for (const id of TYPE_ORDER) { const f = typeFields(id).find(x => x.key === k); if (f) return f.label; }
    return k;
  };
  const headers = ['Type', 'Title', 'Tags', 'Status', 'My rating', 'Image URL', 'Link', 'Notes',
    ...fieldKeys.map(fieldLabel), ...customKeys];
  const rows = list.map(it => [
    TYPES[it.type]?.singular || it.type, it.title, (it.tags || []).join(', '), it.status,
    it.rating ?? '', it.imageUrl, it.link, it.notes,
    ...fieldKeys.map(k => it.fields?.[k] ?? ''),
    ...customKeys.map(k => it.custom?.[k] ?? ''),
  ]);
  const scope = filters.type === 'all' ? 'collection' : TYPES[filters.type].label.toLowerCase().replace(/\W+/g, '-');
  download(`vault-${scope}-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv', toCSV(headers, rows));
  toast(`Exported ${list.length} item(s) as CSV.`);
}

async function exportJSONBackup() {
  const backup = {
    app: 'hypercube-vault', version: 1, exportedAt: new Date().toISOString(),
    items, linkedSheets: await store.getMeta('linkedSheets', []),
  };
  download(`vault-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json', JSON.stringify(backup, null, 2));
  toast('Backup downloaded.');
}

function importJSONBackup(parentModal) {
  const input = h('input', { type: 'file', accept: '.json,application/json' });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = Array.isArray(data) ? data : data.items;
      if (!Array.isArray(incoming)) throw new Error('Not a Vault backup file');
      const byId = new Map(items.map(i => [i.id, i]));
      let added = 0, updated = 0;
      const toPut = [];
      for (const raw of incoming) {
        if (!raw?.id || !raw?.title) continue;
        if (byId.has(raw.id)) updated++; else added++;
        toPut.push(raw);
      }
      await store.putItems(toPut);
      if (data.linkedSheets?.length) {
        const saved = await store.getMeta('linkedSheets', []);
        const merged = [...saved.filter(s => !data.linkedSheets.some(x => x.url === s.url)), ...data.linkedSheets];
        await store.setMeta('linkedSheets', merged);
      }
      items = await store.getAllItems();
      parentModal?.close();
      toast(`Restored: ${added} added, ${updated} updated.`, false, 5000);
      renderAll();
    } catch (err) {
      toast(`Restore failed: ${err.message}`, true, 6000);
    }
  });
  input.click();
}

// ---------- stats ----------

function openStats() {
  const owned = items.filter(i => !['Sold', 'Given Away'].includes(i.status));
  const totalValue = owned.reduce((s, i) => s + (+(i.fields?.currentValue) || 0) * (+(i.fields?.quantity) || 1), 0);
  const totalPaid = owned.reduce((s, i) => s + (+(i.fields?.purchasePrice) || 0) * (+(i.fields?.quantity) || 1), 0);
  const wishlist = items.filter(i => i.status === 'Wishlist').length;
  const onLoan = items.filter(i => i.status === 'On Loan');

  const typeCounts = TYPE_ORDER.map(id => [TYPES[id].icon + ' ' + TYPES[id].label, items.filter(i => i.type === id).length]).filter(x => x[1]);
  const maxType = Math.max(1, ...typeCounts.map(x => x[1]));
  const tagCounts = {};
  for (const it of items) for (const t of it.tags || []) tagCounts[t] = (tagCounts[t] || 0) + 1;
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxTag = Math.max(1, ...topTags.map(x => x[1]));

  const bar = (label, n, max, valText) => h('div', { class: 'bar' },
    h('span', { class: 'lbl', title: label }, label),
    h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${Math.round(n / max * 100)}%` })),
    h('span', { class: 'val' }, valText ?? String(n)));

  openModal('📊 Collection stats', h('div', {},
    h('div', { class: 'statgrid' },
      h('div', { class: 'stat' }, h('div', { class: 'n' }, String(items.length)), h('div', { class: 'l' }, 'Items tracked')),
      h('div', { class: 'stat' }, h('div', { class: 'n' }, fmtMoney(totalValue) || '$0'), h('div', { class: 'l' }, 'Est. value (owned)')),
      h('div', { class: 'stat' }, h('div', { class: 'n' }, fmtMoney(totalPaid) || '$0'), h('div', { class: 'l' }, 'Total spent')),
      h('div', { class: 'stat' }, h('div', { class: 'n' }, String(wishlist)), h('div', { class: 'l' }, 'On wishlist')),
      h('div', { class: 'stat' }, h('div', { class: 'n' }, String(onLoan.length)), h('div', { class: 'l' }, 'Out on loan'))),
    typeCounts.length ? h('div', {}, h('h3', { style: 'margin:4px 0 8px;font-size:14px' }, 'By collection'),
      ...typeCounts.map(([l, n]) => bar(l, n, maxType))) : null,
    topTags.length ? h('div', {}, h('h3', { style: 'margin:16px 0 8px;font-size:14px' }, 'Top tags'),
      ...topTags.map(([l, n]) => bar('#' + l, n, maxTag))) : null,
    onLoan.length ? h('div', {}, h('h3', { style: 'margin:16px 0 8px;font-size:14px' }, 'Loaned out'),
      h('ul', { style: 'margin:0;padding-left:20px' }, ...onLoan.map(i =>
        h('li', {}, h('strong', {}, i.title), i.fields?.loanedTo ? ` — with ${i.fields.loanedTo}` : '')))) : null,
  ), [], { wide: true });
}

// ---------- settings ----------

function openSettings() {
  const s = getSettings();
  const keyField = (label, key, url, hint) => {
    const input = h('input', { value: s[key] || '', placeholder: 'paste API key', autocomplete: 'off' });
    input.dataset.key = key;
    return h('div', { class: 'field full' },
      h('label', {}, label, ' — ', h('a', { href: url, target: '_blank', rel: 'noopener' }, 'get a free key ↗')),
      input, hint ? h('div', { class: 'hint' }, hint) : null);
  };
  const proxyInput = h('input', { value: s.corsProxy, placeholder: 'https://corsproxy.io/?url={url}' });

  const body = h('div', { class: 'formgrid' },
    h('div', { class: 'sectionlabel' }, 'Database API keys (stored only in this browser)'),
    h('div', { class: 'notice full' }, 'BoardGameGeek and Open Library / Google Books need no key — they just work. The three below each take ~2 minutes to sign up for, and unlock lookups for that collection.'),
    keyField('TMDB (Movies & TV)', 'tmdbKey', 'https://www.themoviedb.org/settings/api'),
    keyField('RAWG (Video Games)', 'rawgKey', 'https://rawg.io/apidocs'),
    keyField('Comic Vine (Comics)', 'comicVineKey', 'https://comicvine.gamespot.com/api/'),
    h('div', { class: 'sectionlabel' }, 'Advanced'),
    h('div', { class: 'field full' }, h('label', {}, 'CORS proxy (used for BoardGameGeek & Comic Vine; {url} is replaced)'), proxyInput),
    h('div', { class: 'sectionlabel' }, 'Your data'),
    h('div', { class: 'full', style: 'display:flex;gap:8px;flex-wrap:wrap' },
      h('button', { class: 'btn', onclick: exportJSONBackup }, '⇩ Download JSON backup'),
      h('button', { class: 'btn', onclick: () => importJSONBackup(m) }, '⇧ Restore backup'),
      h('button', { class: 'btn danger', onclick: async () => {
        if (!await confirmDlg(`Delete ALL ${items.length} items from this browser? Export a backup first!`, 'Delete everything')) return;
        await store.clearItems(); items = []; m.close(); toast('Vault emptied.'); renderAll();
      } }, 'Delete all data')),
    h('div', { class: 'hint full' }, 'Data lives in this browser only (IndexedDB). Cloud sync across devices is on the roadmap — until then, move data between devices with JSON backups, and add this page to your phone’s home screen for an app-like experience.'),
  );

  const m = openModal('⚙︎ Settings', body, [
    h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: () => {
      const patch = { corsProxy: proxyInput.value.trim() || 'https://corsproxy.io/?url={url}' };
      body.querySelectorAll('input[data-key]').forEach(i => patch[i.dataset.key] = i.value.trim());
      saveSettings(patch);
      m.close(); toast('Settings saved.');
    } }, 'Save'),
  ], { wide: true });
}

// ---------- misc actions ----------

function randomPick() {
  const list = filteredItems();
  if (!list.length) { toast('Nothing to pick from.', true); return; }
  openDetail(list[Math.floor(Math.random() * list.length)]);
}

function openAdd() {
  // Add flow: for types with a database, offer lookup-first; otherwise straight to the editor.
  const typeSel = h('select', {}, ...TYPE_ORDER.map(id => h('option', { value: id }, `${TYPES[id].icon} ${TYPES[id].singular}`)));
  if (filters.type !== 'all') typeSel.value = filters.type;
  const q = h('input', { placeholder: 'Title (or ISBN for books)…' });
  const m = openModal('Add item', h('div', {},
    h('div', { class: 'field' }, h('label', {}, 'Type'), typeSel),
    h('div', { class: 'field', style: 'margin-top:10px' }, h('label', {}, 'Search the database (optional)'), q,
      h('div', { class: 'hint' }, 'Search fills in details, cover art, and a link automatically. Or skip straight to manual entry.')),
  ), [
    h('button', { class: 'btn', onclick: () => { m.close(); openEditor(null, { type: typeSel.value }); } }, 'Enter manually'),
    h('button', { class: 'btn primary', onclick: () => {
      const type = typeSel.value;
      if (!LOOKUP[type]) { m.close(); openEditor(null, { type }); return; }
      m.close();
      openLookup(type, q.value.trim(), picked => openEditor(null, { type, ...picked }));
    } }, '⌕ Search'),
  ]);
  q.addEventListener('keydown', e => { if (e.key === 'Enter') m.overlay.querySelector('.btn.primary').click(); });
  q.focus();
}

// ---------- init ----------

async function init() {
  items = await store.getAllItems();

  document.getElementById('btn-add').addEventListener('click', openAdd);
  document.getElementById('btn-import').addEventListener('click', openImport);
  document.getElementById('btn-stats').addEventListener('click', openStats);
  document.getElementById('btn-settings').addEventListener('click', openSettings);

  const search = document.getElementById('search');
  let debounce;
  search.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { query = search.value; renderItems(); renderToolbar(); }, 120);
  });

  document.addEventListener('keydown', e => {
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) {
      e.preventDefault(); search.focus();
    }
    if (e.key === 'Escape') document.querySelector('.overlay:last-child')?.querySelector('.x')?.click();
  });

  renderAll();
}

init();
