// Fleet Grid AI — original naval grid game with a probability-heatmap opponent.

const N = 10;
const SHIPS = [
  { name: 'Flagship', len: 5 },
  { name: 'Cruiser', len: 4 },
  { name: 'Frigate', len: 3 },
  { name: 'Corvette', len: 3 },
  { name: 'Scout', len: 2 },
];
const $ = (id) => document.getElementById(id);
const cellName = (i) => 'ABCDEFGHIJ'[i % N] + (Math.floor(i / N) + 1);

/* ---------------- Board model ---------------- */
// Both sides always get the same fleet (SHIPS): 5 ships, 17 squares. Ships may not touch, not even at the corners.
function shipCells(len, start, across) {
  const r = Math.floor(start / N), c = start % N;
  if (across ? c + len > N : r + len > N) return null;
  return Array.from({ length: len }, (_, k) => (across ? start + k : start + k * N));
}
function touchesOther(cells, owner, self) {
  return cells.some((i) => {
    const r0 = Math.floor(i / N), c0 = i % N;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r0 + dr, cc = c0 + dc;
        if (rr >= 0 && rr < N && cc >= 0 && cc < N && owner[rr * N + cc] !== -1 && owner[rr * N + cc] !== self) return true;
      }
    return false;
  });
}
function boardFrom(layout) {
  const owner = new Array(N * N).fill(-1);
  const ships = SHIPS.map((s, id) => {
    layout[id].forEach((i) => (owner[i] = id));
    return { ...s, id, cells: layout[id].slice(), hits: 0 };
  });
  return { owner, ships, shots: new Array(N * N).fill(0) };
}
function placeFleet() {
  const owner = new Array(N * N).fill(-1);
  const ships = SHIPS.map((s, id) => {
    for (;;) {
      const across = Math.random() < 0.5;
      const r = Math.floor(Math.random() * (across ? N : N - s.len + 1));
      const c = Math.floor(Math.random() * (across ? N - s.len + 1 : N));
      const cells = Array.from({ length: s.len }, (_, k) => (across ? r * N + c + k : (r + k) * N + c));
      // Ships may not touch each other, not even at the corners.
      const clear = cells.every((i) => {
        const r0 = Math.floor(i / N), c0 = i % N;
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r0 + dr, cc = c0 + dc;
            if (rr >= 0 && rr < N && cc >= 0 && cc < N && owner[rr * N + cc] !== -1) return false;
          }
        return true;
      });
      if (clear) {
        cells.forEach((i) => (owner[i] = id));
        return { ...s, id, cells, hits: 0 };
      }
    }
  });
  return { owner, ships, shots: new Array(N * N).fill(0) }; // 0 = unknown, 1 = miss, 2 = hit
}

function fire(board, i) {
  if (board.shots[i]) return null;
  const id = board.owner[i];
  if (id < 0) {
    board.shots[i] = 1;
    return { hit: false };
  }
  board.shots[i] = 2;
  const ship = board.ships[id];
  ship.hits++;
  return { hit: true, ship, sunk: ship.hits === ship.len };
}
const allSunk = (b) => b.ships.every((s) => s.hits === s.len);

/* ---------------- AI ---------------- */
// What the AI is allowed to know: its shot results and which ships it has sunk.
function heatmap(board) {
  const heat = new Array(N * N).fill(0);
  const sunkCells = new Set(board.ships.filter((s) => s.hits === s.len).flatMap((s) => s.cells));
  const openHits = [];
  for (let i = 0; i < N * N; i++) if (board.shots[i] === 2 && !sunkCells.has(i)) openHits.push(i);
  const alive = board.ships.filter((s) => s.hits < s.len);
  for (const s of alive) {
    for (const across of [true, false]) {
      for (let r = 0; r < (across ? N : N - s.len + 1); r++)
        for (let c = 0; c < (across ? N - s.len + 1 : N); c++) {
          const cells = Array.from({ length: s.len }, (_, k) => (across ? r * N + c + k : (r + k) * N + c));
          if (cells.some((i) => board.shots[i] === 1 || sunkCells.has(i))) continue;
          const covered = cells.filter((i) => board.shots[i] === 2).length;
          const weight = covered ? 1 + 40 * covered : 1; // positions through open hits are much more likely
          if (openHits.length && !covered) continue; // target mode: only chase the hits
          for (const i of cells) if (board.shots[i] === 0) heat[i] += weight;
        }
    }
  }
  return heat;
}

const hunter = { queue: [] };
function aiChoose(board, mode) {
  const free = [];
  for (let i = 0; i < N * N; i++) if (!board.shots[i]) free.push(i);
  if (mode === 'random') return free[Math.floor(Math.random() * free.length)];
  if (mode === 'hunt') {
    while (hunter.queue.length) {
      const i = hunter.queue.shift();
      if (!board.shots[i]) return i;
    }
    const parity = free.filter((i) => (Math.floor(i / N) + (i % N)) % 2 === 0);
    const pool = parity.length ? parity : free;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  const heat = heatmap(board);
  let best = -1, bestV = -1;
  for (const i of free) if (heat[i] > bestV || (heat[i] === bestV && Math.random() < 0.3)) { bestV = heat[i]; best = i; }
  return best;
}
function neighbours(i) {
  const r = Math.floor(i / N), c = i % N, out = [];
  if (r > 0) out.push(i - N);
  if (r < N - 1) out.push(i + N);
  if (c > 0) out.push(i - 1);
  if (c < N - 1) out.push(i + 1);
  return out;
}

/* ---------------- Game state + UI ---------------- */
let me, enemy, myTurn, over, stats, phase = 'setup';
let layout = SHIPS.map(() => null); // your ship positions while you set up (cell lists)
let chosen = 0, across = true, hoverAt = -1, lastMine = -1, lastEnemy = -1;

function layoutOwner(skip = -1) {
  const owner = new Array(N * N).fill(-1);
  layout.forEach((cells, id) => id !== skip && cells && cells.forEach((i) => (owner[i] = id)));
  return owner;
}
function previewCells(at) {
  if (at < 0 || chosen < 0) return null;
  const cells = shipCells(SHIPS[chosen].len, at, across);
  if (!cells) {
    // near the edge: show the part that fits, marked as not allowed
    const r = Math.floor(at / N), c = at % N;
    const part = Array.from({ length: SHIPS[chosen].len }, (_, k) => (across ? (c + k < N ? at + k : -1) : (r + k < N ? at + k * N : -1)));
    return { cells: part.filter((i) => i >= 0), ok: false };
  }
  return { cells, ok: !touchesOther(cells, layoutOwner(chosen), chosen) };
}
function nextUnplaced(from = 0) {
  for (let k = 0; k < SHIPS.length; k++) {
    const id = (from + k) % SHIPS.length;
    if (!layout[id]) return id;
  }
  return -1;
}
function shipIsAcross(cells) {
  return cells.length < 2 || cells[1] - cells[0] === 1;
}
function placeAt(at) {
  if (phase !== 'setup') return;
  const owner = layoutOwner();
  if (owner[at] !== -1) {
    // clicked a ship you already placed: pick it up to move it
    chosen = owner[at];
    across = shipIsAcross(layout[chosen]);
    layout[chosen] = null;
    syncRotate();
    setStatus(`${SHIPS[chosen].name} picked up. Click where it should go (R rotates).`);
    return render();
  }
  if (chosen < 0) {
    setStatus('All ships are placed. Click a ship to move it, or press Start battle.');
    return;
  }
  const pv = previewCells(at);
  if (!pv || !pv.ok) {
    setStatus("That spot doesn't work: ships must fit on the board and may not touch each other, not even at the corners.");
    return;
  }
  layout[chosen] = pv.cells;
  const placed = SHIPS[chosen].name;
  chosen = nextUnplaced(chosen + 1);
  setStatus(chosen < 0 ? 'All 5 ships placed. Choose who fires first, then press Start battle.' : `${placed} placed. Now place your ${SHIPS[chosen].name} (${SHIPS[chosen].len} squares).`);
  render();
}
function randomLayout() {
  const b = placeFleet();
  layout = b.ships.map((sh) => sh.cells.slice());
  chosen = -1;
  setStatus('Random fleet placed. Click a ship to move it, or press Start battle.');
  render();
}
function clearLayout() {
  layout = SHIPS.map(() => null);
  chosen = 0;
  across = true;
  syncRotate();
  setStatus(`Place your ${SHIPS[0].name} (${SHIPS[0].len} squares). R or the Rotate button turns it.`);
  render();
}
function syncRotate() {
  $('rotate').textContent = across ? 'Rotate (now across)' : 'Rotate (now down)';
}
function rotate() {
  if (phase !== 'setup') return;
  across = !across;
  syncRotate();
  render();
}

function newBattle() {
  // a new battle starts with set-up; your last layout is kept so you can reuse or change it
  phase = 'setup';
  over = false;
  myTurn = false;
  lastMine = lastEnemy = -1;
  chosen = nextUnplaced(0);
  stats = { shots: 0, hits: 0, aiShots: 0, aiHits: 0 };
  $('overlay').hidden = true;
  setStatus(chosen < 0 ? 'Your last fleet layout is ready. Change it if you like, then press Start battle.' : `Set up your fleet: place your ${SHIPS[chosen].name} (${SHIPS[chosen].len} squares). R or the Rotate button turns it.`);
  render();
}
function startBattle() {
  if (layout.some((c) => !c)) return;
  me = boardFrom(layout);
  enemy = placeFleet();
  hunter.queue = [];
  phase = 'battle';
  over = false;
  const choice = $('first').value;
  const first = choice === 'random' ? (Math.random() < 0.5 ? 'you' : 'cpu') : choice;
  myTurn = first === 'you';
  render();
  if (myTurn) setStatus('Battle! You fire first. Choose a square in the enemy waters.');
  else {
    setStatus('Battle! The computer fires first…');
    setTimeout(aiTurn, 700);
  }
}

function buildGrid(el, interactive) {
  el.replaceChildren(
    ...Array.from({ length: N * N }, (_, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cell';
      b.dataset.i = i;
      b.tabIndex = interactive && i === 0 ? 0 : -1;
      return b;
    }),
  );
}

function renderSetup() {
  const pv = previewCells(hoverAt);
  const owner = layoutOwner();
  [...$('mine').children].forEach((b, i) => {
    const inPv = pv && pv.cells.includes(i);
    b.className = 'cell' + (owner[i] >= 0 ? ' ship' : '') + (inPv ? (pv.ok ? ' pv-ok' : ' pv-bad') : '');
    b.disabled = false;
    b.replaceChildren();
    const what = owner[i] >= 0 ? `, your ${SHIPS[owner[i]].name} (click to move it)` : chosen >= 0 ? `, empty: place your ${SHIPS[chosen].name} here` : ', empty';
    b.setAttribute('aria-label', cellName(i) + what);
  });
  [...$('enemy').children].forEach((b) => {
    b.className = 'cell';
    b.disabled = true;
    b.setAttribute('aria-label', 'Enemy waters (the battle has not started)');
  });
  $('ship-pick').replaceChildren(
    ...SHIPS.map((sh, id) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pick' + (layout[id] ? ' done' : '');
      btn.dataset.ship = id;
      btn.setAttribute('aria-pressed', String(id === chosen));
      btn.innerHTML = `<span>${sh.name}</span><span class="pick__len" aria-hidden="true">${'<i></i>'.repeat(sh.len)}</span><span class="visually-hidden">, ${sh.len} squares${layout[id] ? ', placed' : ''}</span>`;
      return btn;
    }),
  );
  $('start').disabled = !layout.every(Boolean);
  $('placed').textContent = `${layout.filter(Boolean).length} of ${SHIPS.length} ships placed`;
  const fleetList = (el, done) =>
    el.replaceChildren(
      ...SHIPS.map((sh, id) => {
        const li = document.createElement('li');
        li.title = `${sh.name} (${sh.len})`;
        li.setAttribute('aria-label', li.title);
        if (!done(id)) li.className = 'unplaced';
        li.append(...Array.from({ length: sh.len }, () => document.createElement('i')));
        return li;
      }),
    );
  fleetList($('my-fleet'), (id) => !!layout[id]);
  fleetList($('enemy-fleet'), () => true);
  $('s-shots').textContent = 0;
  $('s-acc').textContent = '0%';
  $('s-ai-shots').textContent = 0;
  $('s-ai-acc').textContent = '0%';
}

function render() {
  document.body.dataset.phase = phase;
  $('setup').hidden = phase !== 'setup';
  if (phase === 'setup') return renderSetup();
  const showHeat = $('heat').checked && $('mode').value === 'prob' && !over;
  const heat = showHeat ? heatmap(me) : null;
  const maxHeat = heat ? Math.max(1, ...heat) : 1;
  const sunkMine = new Set(me.ships.filter((s) => s.hits === s.len).flatMap((s) => s.cells));
  const sunkEnemy = new Set(enemy.ships.filter((s) => s.hits === s.len).flatMap((s) => s.cells));

  [...$('mine').children].forEach((b, i) => {
    const shot = me.shots[i];
    b.className = 'cell' + (me.owner[i] >= 0 ? ' ship' : '') + (shot === 1 ? ' miss' : '') + (shot === 2 ? ' hit' : '') + (sunkMine.has(i) ? ' sunk' : '') + (i === lastMine ? ' last' : '');
    b.disabled = true;
    b.replaceChildren();
    if (heat && !shot && heat[i]) {
      const h = document.createElement('span');
      h.className = 'heat';
      h.style.background = `rgba(242,195,91,${(0.08 + 0.75 * (heat[i] / maxHeat)).toFixed(2)})`;
      b.append(h);
    }
    b.setAttribute('aria-label', `${cellName(i)}${me.owner[i] >= 0 ? ', your ship' : ''}${shot === 1 ? ', missed' : shot === 2 ? ', hit' : ''}`);
  });

  [...$('enemy').children].forEach((b, i) => {
    const shot = enemy.shots[i];
    const reveal = over && enemy.owner[i] >= 0 && !shot;
    b.className = 'cell' + (shot === 1 ? ' miss' : '') + (shot === 2 ? ' hit' : '') + (sunkEnemy.has(i) ? ' sunk' : '') + (reveal ? ' ship' : '') + (i === lastEnemy ? ' last' : '');
    b.disabled = over || !!shot || !myTurn;
    b.setAttribute('aria-label', `${cellName(i)}${shot === 1 ? ', miss' : shot === 2 ? (sunkEnemy.has(i) ? ', sunk' : ', hit') : ', not fired'}`);
  });

  const fleet = (board, el) =>
    el.replaceChildren(
      ...board.ships.map((s) => {
        const li = document.createElement('li');
        li.className = s.hits === s.len ? 'sunk' : '';
        li.title = `${s.name} (${s.len})${s.hits === s.len ? ' – sunk' : ''}`;
        li.setAttribute('aria-label', li.title);
        li.append(...Array.from({ length: s.len }, () => document.createElement('i')));
        return li;
      }),
    );
  fleet(me, $('my-fleet'));
  fleet(enemy, $('enemy-fleet'));

  $('s-shots').textContent = stats.shots;
  $('s-acc').textContent = stats.shots ? Math.round((stats.hits / stats.shots) * 100) + '%' : '0%';
  $('s-ai-shots').textContent = stats.aiShots;
  $('s-ai-acc').textContent = stats.aiShots ? Math.round((stats.aiHits / stats.aiShots) * 100) + '%' : '0%';
}

function setStatus(t) {
  $('status').textContent = t;
}

function finish(won) {
  over = true;
  render();
  $('ov-title').textContent = won ? 'Victory' : 'Defeat';
  $('ov-text').textContent = won
    ? `You sank the whole enemy fleet in ${stats.shots} shots (${Math.round((stats.hits / stats.shots) * 100)}% accuracy).`
    : `The AI sank your fleet in ${stats.aiShots} shots. Try again, or switch to an easier computer.`;
  $('overlay').hidden = false;
  $('again').focus();
}

function playerFire(i) {
  if (phase !== 'battle' || !myTurn || over) return;
  const res = fire(enemy, i);
  if (!res) return;
  lastEnemy = i;
  stats.shots++;
  if (res.hit) stats.hits++;
  setStatus(res.hit ? (res.sunk ? `${cellName(i)}: hit — you sank their ${res.ship.name}!` : `${cellName(i)}: hit!`) : `${cellName(i)}: miss.`);
  render();
  if (allSunk(enemy)) return finish(true);
  myTurn = false;
  render();
  setTimeout(aiTurn, 550);
}

function aiTurn() {
  if (over) return;
  const mode = $('mode').value;
  const i = aiChoose(me, mode);
  const res = fire(me, i);
  lastMine = i;
  stats.aiShots++;
  if (res.hit) {
    stats.aiHits++;
    if (mode === 'hunt' && !res.sunk) hunter.queue.push(...neighbours(i));
    if (res.sunk) hunter.queue = [];
  }
  render();
  const msg = res.hit ? (res.sunk ? `The AI fired at ${cellName(i)} and sank your ${res.ship.name}.` : `The AI fired at ${cellName(i)}: hit.`) : `The AI fired at ${cellName(i)}: miss.`;
  if (allSunk(me)) {
    setStatus(msg);
    return finish(false);
  }
  myTurn = true;
  setStatus(msg + ' Your turn.');
  render();
}

/* ---------------- Events ---------------- */
buildGrid($('mine'), true);
buildGrid($('enemy'), true);

$('enemy').addEventListener('click', (e) => {
  const b = e.target.closest('.cell');
  if (b) playerFire(+b.dataset.i);
});
// Roving focus with arrow keys on the enemy grid.
$('enemy').addEventListener('keydown', (e) => {
  const b = e.target.closest('.cell');
  if (!b) return;
  const i = +b.dataset.i;
  const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: N, ArrowUp: -N }[e.key];
  if (move === undefined) return;
  e.preventDefault();
  const j = i + move;
  if (j < 0 || j >= N * N || (Math.abs(move) === 1 && Math.floor(j / N) !== Math.floor(i / N))) return;
  b.tabIndex = -1;
  const next = $('enemy').children[j];
  next.tabIndex = 0;
  next.focus();
});

$('new').addEventListener('click', newBattle);
$('again').addEventListener('click', newBattle);
$('start').addEventListener('click', startBattle);
$('random').addEventListener('click', randomLayout);
$('clear').addEventListener('click', clearLayout);
$('rotate').addEventListener('click', rotate);
$('ship-pick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ship]');
  if (!b) return;
  const id = +b.dataset.ship;
  if (layout[id]) {
    across = shipIsAcross(layout[id]);
    layout[id] = null; // pick it up again
    syncRotate();
  }
  chosen = id;
  setStatus(`Place your ${SHIPS[id].name} (${SHIPS[id].len} squares). R or the Rotate button turns it.`);
  render();
});
$('mine').addEventListener('click', (e) => {
  const b = e.target.closest('.cell');
  if (b && phase === 'setup') placeAt(+b.dataset.i);
});
$('mine').addEventListener('pointerover', (e) => {
  const b = e.target.closest('.cell');
  if (!b || phase !== 'setup' || hoverAt === +b.dataset.i) return;
  hoverAt = +b.dataset.i;
  renderSetup();
});
$('mine').addEventListener('pointerleave', () => {
  hoverAt = -1;
  if (phase === 'setup') renderSetup();
});
$('mine').addEventListener('focusin', (e) => {
  const b = e.target.closest('.cell');
  if (!b || phase !== 'setup' || hoverAt === +b.dataset.i) return;
  hoverAt = +b.dataset.i;
  renderSetup();
});
// keyboard: arrows move around your grid during set-up, Enter places, R rotates
$('mine').addEventListener('keydown', (e) => {
  if (phase !== 'setup') return;
  const b = e.target.closest('.cell');
  if (!b) return;
  const i = +b.dataset.i;
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: N, ArrowUp: -N }[e.key];
  if (step === undefined) return;
  e.preventDefault();
  const j = i + step;
  if (j < 0 || j >= N * N || (Math.abs(step) === 1 && Math.floor(j / N) !== Math.floor(i / N))) return;
  b.tabIndex = -1;
  const next = $('mine').children[j];
  next.tabIndex = 0;
  next.focus();
});
document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'r' && phase === 'setup' && !e.target.closest('select')) rotate();
});
$('heat').addEventListener('change', render);
$('mode').addEventListener('change', render);

enemy = placeFleet();
newBattle();
window.__fleet = { placeFleet, fire, aiChoose, allSunk, shipCells, touchesOther, state: () => ({ phase, layout, me, enemy, myTurn, over }) };
