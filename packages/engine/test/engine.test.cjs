// Tests de non-régression du moteur de tournoi. Lancés par `pnpm --filter @vlome/engine test`, qui compile d'abord
// le moteur dans .test-dist (le dossier dist commité n'est jamais touché par les tests).
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../.test-dist/index.js');

// Valeur exacte de l'exempt (les identifiants de joueurs sont aléatoires et peuvent contenir « bye » par hasard).
const BYE = '__bye__';
const isBye = (id) => !id || id === BYE;

/** Tournoi à élimination directe/double, sans poules, avec n joueurs, lancé. */
function launched(format, n) {
  const t = E.newTournament({ format, nbPools: 1 });
  for (let i = 0; i < n; i++) E.addPlayer(t, 'P' + i);
  E.launchTournament(t);
  return t;
}

/** Joue tous les matchs jouables jusqu'au champion ; pick décide du vainqueur. Renvoie le nombre de matchs joués. */
function playAll(t, pick) {
  let played = 0;
  for (let guard = 0; guard < 2000 && t.status !== 'finished'; guard++) {
    const m = E.allFinalsMatches(t).find((x) => !x.winner && !x.bye && x.a && x.b && !isBye(x.a) && !isBye(x.b));
    if (!m) break;
    const winner = pick(m, played);
    E.reportFinals(t, m.id, winner, winner === m.a ? 1 : 0, winner === m.a ? 0 : 1);
    played++;
  }
  return played;
}

// Trois façons de départager : toujours le joueur A, toujours le B, et un pseudo-aléatoire reproductible.
const strategies = {
  'toujours A': (m) => m.a,
  'toujours B': (m) => m.b,
  'alterné': (m, i) => (i % 3 === 0 ? m.b : m.a),
};

for (const [name, pick] of Object.entries(strategies)) {
  test(`double élimination compacte : de 2 à 40 joueurs, un champion est toujours désigné (${name})`, () => {
    for (let n = 2; n <= 40; n++) {
      const t = launched('double', n);
      playAll(t, pick);
      assert.equal(t.status, 'finished', `n=${n} : le tournoi devrait être terminé`);
      assert.ok(t.champion, `n=${n} : un champion doit être désigné`);
    }
  });

  test(`bracket simple compact : de 2 à 40 joueurs, un champion est toujours désigné (${name})`, () => {
    for (let n = 2; n <= 40; n++) {
      const t = launched('single', n);
      playAll(t, pick);
      assert.equal(t.status, 'finished', `n=${n} : le tournoi devrait être terminé`);
      assert.ok(t.champion, `n=${n} : un champion doit être désigné`);
    }
  });
}

test('double élimination compacte : 21 joueurs = 10 duels au premier tour et un seul exempt', () => {
  const t = launched('double', 21);
  const round0 = t.finals.wb[0];
  const duels = round0.filter((m) => m.a && m.b && !isBye(m.a) && !isBye(m.b));
  const exempts = round0.filter((m) => m.bye);
  assert.equal(duels.length, 10);
  assert.equal(exempts.length, 1);
  assert.equal(round0.length, 11);
});

test('double élimination compacte : nombre total de matchs joués = 2(n-1) quand le vainqueur des winners gagne la finale', () => {
  for (const n of [3, 5, 8, 13, 21, 32]) {
    const t = launched('double', n);
    // Le joueur au meilleur classement initial (P0) gagne toujours : il n'a jamais à rejouer de finale.
    const rank = (id) => Number(String(E.playerName(t, id)).slice(1));
    const played = playAll(t, (m) => (rank(m.a) <= rank(m.b) ? m.a : m.b));
    assert.equal(played, 2 * (n - 1), `n=${n}`);
    assert.equal(E.playerName(t, t.champion), 'P0');
  }
});

test('un joueur ne peut pas apparaître deux fois dans le même match', () => {
  for (const n of [3, 7, 12, 21]) {
    const t = launched('double', n);
    playAll(t, (m, i) => (i % 2 ? m.a : m.b));
    for (const m of E.allFinalsMatches(t)) {
      if (m.a && m.b && !isBye(m.a) && !isBye(m.b)) assert.notEqual(m.a, m.b, `n=${n} : match contre soi-même`);
    }
  }
});

test('Battle Royale : points = palier de classement + bonus par élimination', () => {
  const t = E.newTournament({ format: 'battle_royale', nbPools: 1, brPointsTable: [10, 6, 3], brKillPoints: 2 });
  for (const n of ['A', 'B', 'C']) E.addPlayer(t, n);
  E.launchTournament(t);
  const games = t.finals.games;
  assert.ok(games.length >= 1);
  const ids = Object.fromEntries(t.players.map((p) => [p.name, p.id]));
  // A gagne la partie avec 4 éliminations, B est 2e avec 1, C dernier sans élimination.
  const res = E.reportBattleRoyale(t, games[0].id, [ids.A, ids.B, ids.C], { [ids.A]: 4, [ids.B]: 1 });
  assert.equal(res.ok, true);
  const pts = (name) => games.reduce((s, g) => {
    if (!g.ranking) return s;
    const rank = g.ranking.indexOf(ids[name]);
    if (rank < 0) return s;
    return s + (t.finals.pointsTable[rank] ?? 0) + t.finals.killPoints * ((g.kills && g.kills[ids[name]]) || 0);
  }, 0);
  assert.equal(pts('A'), 10 + 2 * 4);
  assert.equal(pts('B'), 6 + 2 * 1);
  assert.equal(pts('C'), 3);
});

test('les identifiants de match sont uniques dans un bracket', () => {
  const t = launched('double', 21);
  const ids = E.allFinalsMatches(t).map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
});

/** Joue toutes les poules jusqu'au bout (le gagnant alterne pour ne pas avoir un scénario trop uniforme). */
function playPools(t) {
  for (const pool of t.pools) {
    for (let g = 0; g < 500; g++) {
      const m = E.currentMatch(pool);
      if (!m) break;
      E.reportResult(t, pool.id, g % 3 === 0 ? m.b : m.a, 2, 0);
    }
  }
}

for (const poolFormat of ['survival', 'double']) {
  test(`poules ${poolFormat} : plus de 2 qualifiés par poule (2 poules de 10, 5 qualifiés)`, () => {
    const t = E.newTournament({ format: 'survival', nbPools: 2, poolFormat, qualifyPerPool: 5, finalsFormat: 'single' });
    for (let i = 0; i < 20; i++) E.addPlayer(t, 'S' + i);
    E.distributePools(t);
    E.launchTournament(t);
    playPools(t);
    assert.ok(t.pools.every((p) => p.phase === 'done'));
    for (const p of t.pools) {
      const q = E.poolQualified(t, p);
      assert.equal(q.length, 5, 'cinq qualifiés par poule, pas deux');
      assert.deepEqual(q.slice(0, 2), [p.top1, p.top2], 'les deux finalistes sont en tête');
      assert.equal(new Set(q).size, 5);
      assert.ok(q.every((id) => p.playerIds.includes(id)));
    }
    assert.equal(E.qualifiers(t).length, 10);
    E.startFinals(t, 'single');
    playAll(t, (m) => m.a);
    assert.equal(t.status, 'finished');
  });
}

test('qualifiés par poule : jamais plus que l\'effectif de la poule, et un disqualifié est remplacé par le suivant', () => {
  const t = E.newTournament({ format: 'survival', nbPools: 2, poolFormat: 'survival', qualifyPerPool: 50, finalsFormat: 'single' });
  for (let i = 0; i < 8; i++) E.addPlayer(t, 'Q' + i);
  E.distributePools(t);
  E.launchTournament(t);
  playPools(t);
  assert.equal(E.qualifiers(t).length, 8, 'poules de 4 : au plus 4 qualifiés chacune');
  t.qualifyPerPool = 3;
  const p = t.pools[0];
  const before = E.poolQualified(t, p);
  t.disqualified.push(before[0]);
  const after = E.poolQualified(t, p);
  assert.equal(after.length, 3);
  assert.ok(!after.includes(before[0]));
});

test('finale double élimination scindée : fonctionne aussi avec des poules Survival classique à 4 qualifiés', () => {
  const t = E.newTournament({ format: 'survival', nbPools: 4, poolFormat: 'survival', qualifyPerPool: 4, finalsFormat: 'double' });
  for (let i = 0; i < 24; i++) E.addPlayer(t, 'D' + i);
  E.distributePools(t);
  E.launchTournament(t);
  playPools(t);
  const { top, bottom } = E.qualifiersSplit(t);
  assert.equal(top.length, 8);
  assert.equal(bottom.length, 8);
  E.startFinals(t, 'double');
  playAll(t, (m) => m.a);
  assert.equal(t.status, 'finished');
});

test('Survival classique : le repêchage aligne un maximum de joueurs dès le 1er tour (pas d\'exempt si l\'effectif est pair)', () => {
  for (let n = 3; n <= 20; n++) {
    const t = E.newTournament({ format: 'survival', nbPools: 1, poolFormat: 'survival' });
    for (let i = 0; i < n; i++) E.addPlayer(t, 'R' + i);
    E.distributePools(t);
    E.launchTournament(t);
    const pool = t.pools[0];
    // Phase Survival (le survivant enchaîne les challengers) jusqu'au passage au repêchage.
    for (let g = 0; g < 200 && pool.phase === 'survival'; g++) {
      const m = E.currentMatch(pool);
      E.reportResult(t, pool.id, g % 3 === 0 ? m.b : m.a, 2, 0);
    }
    const losers = n - 1; // tous les battus du bracket Survival
    if (losers < 2) continue;
    assert.equal(pool.phase, 'losers', `n=${n} : la poule doit être en repêchage`);
    const round0 = pool.lBracket.rounds[0];
    const real = round0.filter((m) => !m.bye).length;
    const byes = round0.filter((m) => m.bye).length;
    assert.equal(real, Math.floor(losers / 2), `n=${n} (${losers} perdants) : ${Math.floor(losers / 2)} duels au 1er tour`);
    assert.equal(byes, losers % 2, `n=${n} (${losers} perdants) : exempt seulement si l'effectif est impair`);
    const inR0 = new Set(round0.flatMap((m) => [m.a, m.b]).filter((id) => id && id !== BYE));
    assert.equal(inR0.size, losers, `n=${n} : tous les perdants sont alignés au 1er tour`);
    // Le repêchage se joue jusqu'au bout : n-1 perdants => losers-1 matchs, puis la finale de poule.
    let played = 0;
    for (let g = 0; g < 200 && pool.phase === 'losers'; g++) {
      const m = E.currentMatch(pool);
      assert.ok(m && !isBye(m.a) && !isBye(m.b), `n=${n} : jamais de match contre un exempt`);
      E.reportResult(t, pool.id, g % 2 ? m.b : m.a, 2, 0);
      played++;
    }
    assert.equal(played, losers - 1, `n=${n} : ${losers - 1} matchs de repêchage`);
    assert.equal(pool.phase, 'poolFinal', `n=${n} : on passe à la finale de poule`);
    const fin = E.currentMatch(pool);
    E.reportResult(t, pool.id, fin.a, 2, 0);
    assert.equal(pool.phase, 'done', `n=${n} : poule terminée`);
  }
});
