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
let me, enemy, myTurn, over, stats;

function newBattle(keepMine = false) {
  if (!keepMine || !me) me = placeFleet();
  enemy = placeFleet();
  hunter.queue = [];
  myTurn = true;
  over = false;
  stats = { shots: 0, hits: 0, aiShots: 0, aiHits: 0 };
  $('overlay').hidden = true;
  $('shuffle').disabled = false;
  setStatus('Your fleet is ready. Fire at the enemy waters.');
  render();
}

function buildGrid(el, interactive) {
  el.replaceChildren(
    ...Array.from({ length: N * N }, (_, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cell';
      b.dataset.i = i;
      b.setAttribute('role', 'gridcell');
      if (interactive) b.tabIndex = i === 0 ? 0 : -1;
      else b.tabIndex = -1;
      return b;
    }),
  );
}

function render() {
  const showHeat = $('heat').checked && $('mode').value === 'prob' && !over;
  const heat = showHeat ? heatmap(me) : null;
  const maxHeat = heat ? Math.max(1, ...heat) : 1;
  const sunkMine = new Set(me.ships.filter((s) => s.hits === s.len).flatMap((s) => s.cells));
  const sunkEnemy = new Set(enemy.ships.filter((s) => s.hits === s.len).flatMap((s) => s.cells));

  [...$('mine').children].forEach((b, i) => {
    const shot = me.shots[i];
    b.className = 'cell' + (me.owner[i] >= 0 ? ' ship' : '') + (shot === 1 ? ' miss' : '') + (shot === 2 ? ' hit' : '') + (sunkMine.has(i) ? ' sunk' : '');
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
    b.className = 'cell' + (shot === 1 ? ' miss' : '') + (shot === 2 ? ' hit' : '') + (sunkEnemy.has(i) ? ' sunk' : '') + (reveal ? ' ship' : '');
    b.disabled = over || !!shot;
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
  if (!myTurn || over) return;
  const res = fire(enemy, i);
  if (!res) return;
  $('shuffle').disabled = true;
  stats.shots++;
  if (res.hit) stats.hits++;
  setStatus(res.hit ? (res.sunk ? `${cellName(i)}: hit — you sank their ${res.ship.name}!` : `${cellName(i)}: hit!`) : `${cellName(i)}: miss.`);
  render();
  if (allSunk(enemy)) return finish(true);
  myTurn = false;
  setTimeout(aiTurn, 550);
}

function aiTurn() {
  if (over) return;
  const mode = $('mode').value;
  const i = aiChoose(me, mode);
  const res = fire(me, i);
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
  setStatus(msg + ' Your turn.');
  myTurn = true;
}

/* ---------------- Events ---------------- */
buildGrid($('mine'), false);
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

$('new').addEventListener('click', () => newBattle(false));
$('again').addEventListener('click', () => newBattle(false));
$('shuffle').addEventListener('click', () => {
  me = placeFleet();
  render();
  setStatus('Fleet shuffled. Fire when ready.');
});
$('heat').addEventListener('change', render);
$('mode').addEventListener('change', render);

newBattle();
window.__fleet = { placeFleet, fire, aiChoose, allSunk };
