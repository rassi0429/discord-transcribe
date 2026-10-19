const $ = id => document.getElementById(id);
const rows = new Map();
const nodes = new Map();

const feed = $('feed');
let following = true;

let frame = null;
const pendingRows = new Map();
const clock = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' });
function element(tag, className, text = '') { const e = document.createElement(tag); e.className = className; e.textContent = text; return e; }
function setText(node, text) { if (node.textContent !== text) node.textContent = text; }
// Ignore empty recognitions and punctuation-only fillers such as "..." / "…".
// Keep short actual utterances ("うん") and real error messages.
function visibleCaption(row) { return /[\p{L}\p{N}\p{S}]/u.test(row.text || '') || row.state === 'error'; }
function removeRow(id) { rows.delete(id); nodes.get(id)?.remove(); nodes.delete(id); }
function renderRow(row) {
  if (!visibleCaption(row)) { removeRow(row.id); return; }
  rows.set(row.id, row);
  let node = nodes.get(row.id);
  if (!node) {
    node = element('article', 'message');
    const tone = [...row.speaker.id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 4;
    const avatar = element('div', `avatar tone-${tone}`, [...row.speaker.name][0]);
    if (row.speaker.avatar && /^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\//.test(row.speaker.avatar)) {
      const img = document.createElement('img'); img.src = row.speaker.avatar; img.alt = ''; img.addEventListener('error', () => { img.remove(); avatar.textContent = [...row.speaker.name][0]; }); avatar.textContent = ''; avatar.append(img);
    }
    const content = element('div', 'content');
    const meta = element('div', 'meta'); meta.append(element('strong', 'name', row.speaker.name), element('time', 'time'), element('span', 'partial-label', '認識中'));
    content.append(meta, element('p', 'transcript'), element('p', 'translation'), element('p', 'error'));
    node.append(avatar, content); nodes.set(row.id, node);
  }
  setText(node.querySelector('time'), clock.format(new Date(row.startedAt)));
  setText(node.querySelector('.transcript'), row.text || '文字起こしできませんでした');
  node.querySelector('.partial-label').hidden = row.state !== 'partial';
  const translation = node.querySelector('.translation');
  setText(translation, row.translation || (row.translationState === 'pending' ? '英訳しています…' : row.translationError || ''));
  translation.classList.toggle('pending', row.translationState === 'pending'); translation.hidden = !translation.textContent;
  const error = node.querySelector('.error'); setText(error, row.error || ''); error.hidden = !row.error;
}
function flushRows() {
  frame = null;
  // Preserve the reading position when the user has scrolled away from the bottom.
  const top = feed.getBoundingClientRect().top;
  const anchor = following ? null : [...feed.children].find(node => node.classList.contains('message') && node.getBoundingClientRect().bottom > top);
  const anchorTop = anchor?.getBoundingClientRect().top;
  for (const row of pendingRows.values()) renderRow(row);
  pendingRows.clear();
  const ordered = [...rows.values()].sort((a, b) => a.startedAt - b.startedAt);
  while (ordered.length > 200) removeRow(ordered.shift().id);
  // Leave existing nodes attached. Only insert new rows or move a row whose order changed.
  let cursor = feed.firstElementChild;
  for (const item of ordered) {
    const node = nodes.get(item.id);
    if (node !== cursor) feed.insertBefore(node, cursor);
    cursor = node.nextElementSibling;
  }
  if (following) feed.scrollTop = feed.scrollHeight;
  else if (anchor?.isConnected) feed.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
}
function queueRow(row) {
  pendingRows.set(row.id, row);
  if (frame === null) frame = requestAnimationFrame(flushRows);
}
function reset() { if (frame !== null) cancelAnimationFrame(frame); frame = null; pendingRows.clear(); rows.clear(); for (const node of nodes.values()) node.remove(); nodes.clear(); }
const events = new EventSource('/events');
events.onmessage = message => {
  const event = JSON.parse(message.data);
  if (event.type === 'snapshot') {
    const ids = new Set(event.rows.map(row => row.id));
    for (const id of rows.keys()) if (!ids.has(id)) removeRow(id);
    pendingRows.clear(); event.rows.forEach(queueRow);
    if (frame === null) frame = requestAnimationFrame(flushRows);
  }
  if (event.type === 'row') queueRow(event.row);

  if (event.type === 'reset') reset();
};
// EventSource reconnects automatically; connection notices stay off the shared screen.
feed.addEventListener('scroll', () => { following = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 90; });
$('translation-toggle').onchange = event => {
  document.body.classList.toggle('hide-translations', !event.target.checked);
  if (following) feed.scrollTop = feed.scrollHeight;
};
