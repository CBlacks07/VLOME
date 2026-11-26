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

test('Poules en double élimination : un maximum de joueurs alignés au 1er tour du bracket vainqueurs, jusqu\'à la fin de la poule', () => {
  const strategies = [(m) => m.a, (m) => m.b, (m, g) => (g % 3 === 0 ? m.b : m.a)];
  for (const pick of strategies) {
    for (let n = 3; n <= 20; n++) {
      const t = E.newTournament({ format: 'survival', nbPools: 1, poolFormat: 'double' });
      for (let i = 0; i < n; i++) E.addPlayer(t, 'D' + i);
      E.distributePools(t);
      E.launchTournament(t);
      const pool = t.pools[0];
      const round0 = pool.dbracket.wb[0];
      const real = round0.filter((m) => !m.bye && !isBye(m.a) && !isBye(m.b)).length;
      assert.equal(real, Math.floor(n / 2), `n=${n} : ${Math.floor(n / 2)} duels au 1er tour`);
      assert.equal(round0.filter((m) => m.bye).length, n % 2, `n=${n} : exempt seulement si l'effectif est impair`);
      const inR0 = new Set(round0.flatMap((m) => [m.a, m.b]).filter((id) => !isBye(id)));
      assert.equal(inR0.size, n, `n=${n} : tous les joueurs sont alignés au 1er tour`);
      for (let g = 0; g < 500 && pool.phase !== 'done'; g++) {
        const m = E.currentMatch(pool);
        assert.ok(m && !isBye(m.a) && !isBye(m.b), `n=${n} : jamais de match contre un exempt`);
        E.reportResult(t, pool.id, pick(m, g), 2, 0);
      }
      assert.equal(pool.phase, 'done', `n=${n} : la poule doit se terminer`);
      assert.ok(pool.top1 && pool.top2 && pool.top1 !== pool.top2, `n=${n} : deux finalistes distincts`);
    }
  }
});

test('Poules en double élimination : le barème ne programme jamais plus que la cagnotte disponible', () => {
  for (let n = 6; n <= 24; n += 2) {
    for (const finalsFormat of ['single', 'double']) {
      const t = E.newTournament({ format: 'survival', nbPools: 2, poolFormat: 'double', qualifyPerPool: 2, finalsFormat });
      for (let i = 0; i < n; i++) E.addPlayer(t, 'C' + i);
      E.distributePools(t);
      E.launchTournament(t);
      playPools(t);
      assert.ok(t.pools.every((p) => p.phase === 'done'), `n=${n} : poules terminées`);
      E.startFinals(t, finalsFormat);
      // Avant le dernier match (donc avant la redistribution du reliquat, voir le test suivant) :
      // le barème lui-même ne doit jamais pouvoir dépasser le budget, peu importe l'arbre réel.
      const { total, programmed } = E.cagnotte(t);
      assert.ok(programmed <= total + 0.01, `n=${n} finale ${finalsFormat} : prévu ${programmed} <= cagnotte ${total}`);
      playAll(t, (m, i) => (i % 3 === 0 ? m.b : m.a));
      assert.equal(t.status, 'finished', `n=${n} finale ${finalsFormat} : terminé`);
    }
  }
});

test('Poules en double élimination : le reliquat de cagnotte est intégralement redistribué au prorata à la fin', () => {
  for (let n = 6; n <= 24; n += 2) {
    for (const finalsFormat of ['single', 'double']) {
      const t = E.newTournament({ format: 'survival', nbPools: 2, poolFormat: 'double', qualifyPerPool: 2, finalsFormat });
      for (let i = 0; i < n; i++) E.addPlayer(t, 'C' + i);
      E.distributePools(t);
      E.launchTournament(t);
      playPools(t);
      E.startFinals(t, finalsFormat);
      playAll(t, (m, i) => (i % 3 === 0 ? m.b : m.a));
      assert.equal(t.status, 'finished', `n=${n} finale ${finalsFormat} : terminé`);
      const distributed = Object.values(t.points).reduce((a, b) => a + b, 0);
      const total = n * t.pointsPerPlayer;
      assert.ok(Math.abs(distributed - total) < 0.02, `n=${n} finale ${finalsFormat} : distribué ${distributed} ≈ cagnotte ${total} (reliquat reversé)`);
      // Personne qui a marqué au moins un point avant le reliquat (donc qui a joué) ne finit à 0.
      assert.ok(t.players.every((p) => (t.points[p.id] || 0) > 0), `n=${n} finale ${finalsFormat} : aucun joueur à 0 point`);
    }
  }
});

test('bracket simple : la petite finale n\'existe que si elle peut réellement se jouer (jamais de match fantôme)', () => {
  for (let n = 2; n <= 40; n++) {
    const t = launched('single', n);
    playAll(t, (m) => m.a);
    assert.equal(t.status, 'finished', `n=${n} : terminé`);
    const tp = t.finals.bracket.thirdPlace;
    if (!tp) continue;
    assert.ok(!isBye(tp.a) && !isBye(tp.b), `n=${n} : la petite finale doit opposer deux vrais joueurs`);
    assert.ok(t.finals.bracket.thirdPlace.winner, `n=${n} : la petite finale est jouée avant la clôture`);
  }
  // 12 joueurs : le tour 3 contient un exempt, donc un seul perdant de demi-finale -> pas de petite finale.
  for (const n of [3, 5, 6, 10, 12]) assert.equal(launched('single', n).finals.bracket.thirdPlace, null, `n=${n} : pas de petite finale`);
  // Effectifs dont les deux demi-finales sont de vrais matchs : la petite finale reste proposée.
  for (const n of [4, 7, 8, 16]) assert.ok(launched('single', n).finals.bracket.thirdPlace, `n=${n} : petite finale conservée`);
});

test('phase finale en bracket simple après 2 poules de 6 qualifiés : 11 matchs, pas de petite finale, champion couronné', () => {
  const t = E.newTournament({ format: 'survival', nbPools: 2, poolFormat: 'survival', qualifyPerPool: 6, finalsFormat: 'single' });
  for (let i = 0; i < 24; i++) E.addPlayer(t, 'F' + i);
  E.distributePools(t);
  E.launchTournament(t);
  playPools(t);
  E.startFinals(t, 'single');
  assert.equal(E.qualifiers(t).length, 12);
  assert.equal(t.finals.bracket.thirdPlace, null);
  assert.equal(t.finals.bracket.rounds[0].filter((m) => !m.bye).length, 6, 'six duels au 1er tour');
  const played = playAll(t, (m) => m.a);
  assert.equal(played, 11);
  assert.ok(t.champion);
});

// Formats Double élim / Bracket simple avec plusieurs poules : chaque poule est jouée (round robin ou mini-bracket
// dans le format principal) AVANT la phase finale — plus jamais de saut direct vers le bracket final.
for (const [format, poolFormat] of [['double', 'roundrobin'], ['double', 'double'], ['single', 'roundrobin'], ['single', 'single']]) {
  for (const [n, nbPools, qualifyPerPool] of [[8, 2, 2], [16, 4, 2], [32, 4, 4], [13, 3, 2]]) {
    test(`${format} + poules ${poolFormat} (${n} joueurs, ${nbPools} poules, ${qualifyPerPool} qualifiés) : poules jouées d'abord, puis phase finale`, () => {
      const t = E.newTournament({ format, nbPools, poolFormat, qualifyPerPool, finalsFormat: format });
      for (let i = 0; i < n; i++) E.addPlayer(t, 'Z' + i);
      E.distributePools(t);
      E.launchTournament(t);
      // Les poules existent et la phase finale n'est PAS encore créée.
      assert.equal(t.pools.length, nbPools, 'les poules sont conservées au lancement');
      assert.equal(t.finals, null, 'pas de bracket final avant la fin des poules');
      assert.equal(t.status, 'live');
      for (const p of t.pools) {
        assert.equal(p.phase, poolFormat === 'roundrobin' ? 'roundrobin' : poolFormat, `phase de poule ${poolFormat}`);
      }
      playPools(t);
      assert.ok(E.allPoolsDone(t), 'toutes les poules terminées');
      for (const p of t.pools) {
        assert.ok(p.top1, 'chaque poule désigne un vainqueur');
        assert.equal(E.poolQualified(t, p).length, Math.min(qualifyPerPool, p.playerIds.length), 'qualifiés par poule respectés');
      }
      E.startFinals(t);
      assert.equal(t.finals.format, format, 'phase finale dans le format principal');
      playAll(t, (m) => m.a);
      assert.equal(t.status, 'finished', 'tournoi terminé');
      assert.ok(t.champion, 'un champion est désigné');
      const distributed = Object.values(t.points).reduce((a, b) => a + b, 0);
      assert.ok(distributed <= E.cagnotte(t).programmed + 0.01, `distribué ${distributed} <= prévu ${E.cagnotte(t).programmed}`);
    });
  }
}

test('poule en bracket simple : un joueur par poule seul qualifié d\'office, poule de 2 = un seul match', () => {
  const t = E.newTournament({ format: 'single', nbPools: 2, poolFormat: 'single', qualifyPerPool: 1, finalsFormat: 'single' });
  for (let i = 0; i < 4; i++) E.addPlayer(t, 'Y' + i);
  E.distributePools(t);
  E.launchTournament(t);
  for (const p of t.pools) {
    assert.equal(p.playerIds.length, 2);
    const m = E.currentMatch(p);
    assert.ok(m, 'un match à jouer');
    E.reportResult(t, p.id, m.a, 1, 0);
    assert.equal(p.phase, 'done');
    assert.equal(p.top1, m.a);
    assert.equal(p.top2, m.b);
    assert.equal(E.currentMatch(p), null);
  }
  assert.ok(E.allPoolsDone(t));
});

/** Phase finale Round Robin minimale à 3 joueurs : A, B, C ont chacun 1 victoire (cycle A>B>C>A), seuls les scores les séparent. */
function cyclicRR(extra) {
  const t = E.newTournament({ format: 'roundrobin', ...extra });
  t.finals = {
    format: 'roundrobin', players: ['A', 'B', 'C'], champion: null,
    matches: [
      { id: 'm1', a: 'A', b: 'B', winner: 'A', sa: 3, sb: 0 },
      { id: 'm2', a: 'B', b: 'C', winner: 'B', sa: 2, sb: 1 },
      { id: 'm3', a: 'C', b: 'A', winner: 'C', sa: 1, sb: 0 },
    ],
  };
  return t;
}
test('départage : par défaut différence de buts puis marqués (comportement historique)', () => {
  const t = cyclicRR({});
  assert.deepEqual(E.effectiveTiebreakers(t), ['gd', 'gf', 'h2h']);
  // A : +2 (3-0, 0-1), B : -2... A=+2, B=-1+... A: 3-0 puis 0-1 => +2 ; B: 0-3 puis 2-1 => -2 ; C: 1-2 puis 1-0 => 0
  assert.deepEqual(E.rrRanking(t).map((r) => r.id), ['A', 'C', 'B']);
});
test('départage : liste vide = seules les victoires comptent (ordre initial conservé)', () => {
  const t = cyclicRR({ tiebreakers: [] });
  assert.equal(t.countGoalDiff, false);
  assert.deepEqual(E.rrRanking(t).map((r) => r.id), ['A', 'B', 'C']);
});
test('départage : buts encaissés (moins = mieux) et ordre des critères respecté', () => {
  // encaissés : A 0+1=1, B 3+1=4, C 2+0=2  => A, C, B
  assert.deepEqual(E.rrRanking(cyclicRR({ tiebreakers: ['ga'] })).map((r) => r.id), ['A', 'C', 'B']);
  // marqués : A 3+0=3, B 0+2=2, C 1+1=2 => A devant, B/C égalité (ordre initial)
  assert.equal(E.rrRanking(cyclicRR({ tiebreakers: ['gf'] }))[0].id, 'A');
});
test('départage : liste nettoyée (inconnus et doublons ignorés), confrontation directe seule ne montre pas la colonne Diff.', () => {
  assert.deepEqual(E.normalizeTiebreakers(['gd', 'x', 'gd', 'h2h']), ['gd', 'h2h']);
  assert.equal(E.newTournament({ tiebreakers: ['h2h'] }).countGoalDiff, false);
  assert.equal(E.newTournament({ tiebreakers: ['h2h', 'gd'] }).countGoalDiff, true);
});

/* ---------- Matchs nuls et classements hors Survival ---------- */

function league(names, cfg = {}) {
  const t = E.newTournament({ format: 'roundrobin', nbPools: 1, ...cfg });
  E.setPlayers(t, names);
  E.launchTournament(t);
  return t;
}
const rrMatches = (t) => (t.pools.length ? t.pools[0].rrmatches : t.finals.matches);
function play(t, m, sa, sb) {
  const winner = sa === sb ? E.DRAW : sa > sb ? m.a : m.b;
  return t.pools.length ? E.reportResult(t, t.pools[0].id, winner, sa, sb) : E.reportFinals(t, m.id, winner, sa, sb);
}

test('nul : accepté en championnat, 1 point chacun, aucune victoire ni défaite', () => {
  const t = league(['A', 'B', 'C']);
  const m = rrMatches(t)[0];
  assert.ok(play(t, m, 1, 1));
  assert.equal(m.winner, E.DRAW);
  assert.deepEqual([m.sa, m.sb], [1, 1]);
  const rows = (t.pools.length ? E.poolRRRanking(t, t.pools[0]) : E.rrRanking(t));
  const row = (id) => rows.find((r) => r.id === id);
  assert.deepEqual([row(m.a).pts, row(m.a).draws, row(m.a).wins], [1, 1, 0]);
  assert.equal(row(m.b).pts, 1);
  assert.equal(E.distributed(t), 0);
  assert.ok(E.overallRanking(t).every((r) => r.wins === 0 && r.losses === 0));
});

test('nul 0-0 : seulement s\'il est demandé explicitement ; un score égal avec un vainqueur désigné est refusé', () => {
  const t = league(['A', 'B', 'C']);
  const m = rrMatches(t)[0];
  assert.equal(E.reportFinals(t, m.id, m.a, 2, 2), null);
  assert.ok(E.reportFinals(t, m.id, E.DRAW, 0, 0));
  assert.deepEqual([m.winner, m.sa, m.sb], [E.DRAW, 0, 0]);
});

test('championnat : 3 points par victoire, deux nuls ne valent pas une victoire, le champion est le premier aux points', () => {
  const t = league(['A', 'B', 'C']);
  const id = (n) => t.players.find((p) => p.name === n).id;
  for (const m of [...rrMatches(t)]) {
    const pair = [m.a, m.b];
    if (pair.includes(id('A')) && pair.includes(id('B'))) play(t, m, m.a === id('A') ? 3 : 0, m.a === id('A') ? 0 : 3);
    else play(t, m, 1, 1);
  }
  const rows = E.rrRanking(t);
  assert.equal(t.status, 'finished');
  assert.equal(t.champion, id('A'));
  assert.deepEqual(rows.map((r) => r.pts), [4, 2, 1]);
});

test('nul refusé dans un arbre à élimination et en Survival', () => {
  const k = launched('single', 4);
  const m = E.allFinalsMatches(k).find((x) => x.a && x.b);
  assert.equal(E.reportFinals(k, m.id, E.DRAW, 1, 1), null);
  assert.equal(E.reportFinals(k, m.id, m.a, 1, 1), null);
  const s = E.newTournament({ format: 'survival', poolFormat: 'roundrobin', nbPools: 1 });
  E.setPlayers(s, ['A', 'B', 'C']);
  E.distributePools(s); s.pools.forEach((p) => (p.order = p.playerIds.slice())); E.launch(s);
  assert.equal(E.reportResult(s, s.pools[0].id, E.DRAW, 1, 1), null);
});

test('correction : un résultat peut devenir un nul', () => {
  const t = league(['A', 'B', 'C']);
  const m = rrMatches(t)[0];
  play(t, m, 2, 0);
  const fixed = E.correctResult(t, t.log[t.log.length - 1].id, E.DRAW, 1, 1);
  assert.ok(fixed);
  assert.equal(rrMatches(fixed)[0].winner, E.DRAW);
  assert.equal(E.distributed(fixed), 0);
});

test('classement du site hors Survival : rien en cours de route, puis des points selon la place', () => {
  const t = launched('single', 8);
  assert.deepEqual(E.rankingPoints(t), {});
  let guard = 0;
  while (t.status !== 'finished' && guard++ < 50) {
    const m = E.allFinalsMatches(t).find((x) => x.a && x.b && !x.winner && !x.bye && x.a !== E.BYE && x.b !== E.BYE);
    E.reportFinals(t, m.id, m.a, 2, 0);
  }
  const pts = E.rankingPoints(t);
  assert.equal(pts[t.champion], 10);
  const sorted = Object.values(pts).sort((a, b) => b - a);
  assert.equal(sorted[1], 7);
  assert.equal(sorted.length, 8);
  assert.equal(E.overallRanking(t)[0].id, t.champion);
});

test('barème de placement', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 8, 9].map(E.placementPoints), [10, 7, 5, 5, 3, 3, 1]);
});

/* ---------- Règles de championnat réglables ---------- */

test('barème personnalisé : points par victoire, nul et défaite', () => {
  const t = league(['A', 'B', 'C'], { league: { win: 2, draw: 1, loss: 0.5 } });
  const [m] = rrMatches(t);
  play(t, m, 3, 0);
  const rows = E.rrRanking(t);
  assert.equal(rows.find((r) => r.id === m.a).pts, 2);
  assert.equal(rows.find((r) => r.id === m.b).pts, 0.5);
});

test('aller-retour : chacun se rencontre deux fois, côtés inversés', () => {
  const t = league(['A', 'B', 'C'], { rrLegs: 2 });
  const ms = rrMatches(t);
  assert.equal(ms.length, 6);
  assert.deepEqual([...new Set(ms.map((m) => m.leg))], [1, 2]);
  const first = ms[0], back = ms.find((m) => m.leg === 2 && m.a === first.b && m.b === first.a);
  assert.ok(back);
});

test('plusieurs sets : le plus de sets gagne, ou le total en aller-retour', () => {
  const bySets = league(['A', 'B', 'C']);
  const m1 = rrMatches(bySets)[0];
  assert.ok(E.reportFinals(bySets, m1.id, m1.a, 0, 0, undefined, [[5, 0], [0, 1], [0, 1]]));
  assert.equal(m1.winner, m1.b);
  assert.deepEqual([m1.sa, m1.sb, m1.sets.length], [1, 2, 3]);
  const agg = league(['A', 'B', 'C'], { setsMode: 'aggregate' });
  const m2 = rrMatches(agg)[0];
  E.reportFinals(agg, m2.id, m2.a, 0, 0, undefined, [[5, 0], [0, 1], [0, 1]]);
  assert.equal(m2.winner, m2.a);
  assert.deepEqual([m2.sa, m2.sb], [5, 2]);
});

test('critère principal : différence de points avant les points de championnat', () => {
  const t = league(['A', 'B', 'C'], { rankBy: 'pointDiff' });
  const id = (n) => t.players.find((p) => p.name === n).id;
  const find = (x, y) => rrMatches(t).find((m) => [m.a, m.b].includes(id(x)) && [m.a, m.b].includes(id(y)));
  const beat = (x, y, w, l) => { const m = find(x, y); play(t, m, m.a === id(x) ? w : l, m.a === id(x) ? l : w); };
  beat('A', 'B', 1, 0); beat('A', 'C', 1, 0); beat('B', 'C', 9, 0);
  assert.equal(E.rrRanking(t)[0].id, id('B'));
});

test('départage manuel : à égalité parfaite, l\'organisateur tranche', () => {
  const t = league(['A', 'B', 'C'], { tiebreakers: [] });
  const id = (n) => t.players.find((p) => p.name === n).id;
  for (const m of [...rrMatches(t)]) play(t, m, 1, 1);
  assert.ok(E.adjustManualOrder(t, id('C'), 1));
  assert.equal(E.rrRanking(t)[0].id, id('C'));
});

test('swiss : nul autorisé et classement aux points avec exempt', () => {
  const t = E.newTournament({ format: 'swiss', nbPools: 1 });
  E.setPlayers(t, ['A', 'B', 'C', 'D']);
  E.launchTournament(t);
  const m = t.finals.rounds[0].find((x) => x.a && x.b);
  assert.ok(E.reportSwiss(t, m.id, E.DRAW, 1, 1));
  const rows = E.swissStandings(t);
  assert.equal(rows.find((r) => r.id === m.a).pts, 1);
});

test('matchs de classement : toutes les places sont départagées', () => {
  for (const [n, max] of [[8, 8], [16, 16], [6, 8], [11, 16], [32, 8], [5, 16]]) {
    const t = E.newTournament({ format: 'single', nbPools: 1, placementMax: max });
    for (let i = 0; i < n; i++) E.addPlayer(t, 'P' + i);
    E.launchTournament(t);
    playAll(t, (m) => m.a);
    assert.equal(t.status, 'finished', `${n} joueurs, jusqu'à la ${max}e`);
    assert.ok(E.allFinalsMatches(t).every((m) => m.winner || m.bye), `matchs restants (${n}/${max})`);
    const places = E.finalPlacements(t);
    assert.equal(places.flat().length, n);
    // Chaque place jusqu'à la limite est occupée par un seul joueur.
    for (let i = 0; i < Math.min(n, max); i++) assert.equal(places[i].length, 1, `place ${i + 1} (${n}/${max})`);
  }
});

test('sans matchs de classement, le tournoi se clôt à la finale', () => {
  const t = launched('single', 8);
  playAll(t, (m) => m.a);
  assert.equal(t.status, 'finished');
  assert.equal(t.finals.bracket.subs, undefined);
});

test('free for all : chaque manche répartit tout le monde en séries', () => {
  const t = E.newTournament({ format: 'battle_royale', nbPools: 3, brHeatSize: 4 });
  for (let i = 0; i < 10; i++) E.addPlayer(t, 'P' + i);
  E.launchTournament(t);
  const games = t.finals.games;
  assert.equal(games.length, 9);
  for (const r of [1, 2, 3]) {
    const heats = games.filter((g) => g.round === r);
    assert.ok(heats.every((g) => g.playerIds.length >= 3 && g.playerIds.length <= 4));
    assert.equal(new Set(heats.flatMap((g) => g.playerIds)).size, 10);
  }
  // Un joueur absent de la série ne peut pas y être classé.
  const g = games[0];
  const outsider = t.players.find((p) => !g.playerIds.includes(p.id)).id;
  assert.ok(!E.reportBattleRoyale(t, g.id, [outsider]).ok);
  for (const x of games) assert.ok(E.reportBattleRoyale(t, x.id, x.playerIds).ok);
  assert.equal(t.status, 'finished');
  assert.equal(t.champion, E.brStandings(t)[0].id);
});

test('course : meilleur temps ou temps cumulé, un abandon passe derrière', () => {
  for (const [rank, expected] of [['best', 'A'], ['total', 'B']]) {
    const t = E.newTournament({ format: 'battle_royale', nbPools: 2, brRank: rank });
    E.setPlayers(t, ['A', 'B', 'C']);
    E.launchTournament(t);
    const id = (n) => t.players.find((p) => p.name === n).id;
    const [g1, g2] = t.finals.games;
    assert.ok(!E.reportBattleRoyale(t, g1.id, [id('A')]).ok, 'un temps est exigé');
    E.reportBattleRoyale(t, g1.id, [], undefined, { [id('A')]: 50, [id('B')]: 55, [id('C')]: 60 });
    assert.equal(E.overallRanking(t)[0].name, 'A');
    E.reportBattleRoyale(t, g2.id, [], undefined, { [id('A')]: 70, [id('B')]: 56 });
    assert.equal(t.status, 'finished');
    assert.equal(E.playerName(t, t.champion), expected, rank);
    assert.equal(E.playerName(t, E.finalPlacements(t)[2][0]), 'C', rank);
  }
});

test('poule finalisée à la main : classement imposé, qualifiés repris, annulable', () => {
  const t = E.newTournament({ format: 'roundrobin', nbPools: 2, qualifyPerPool: 2, finalsFormat: 'single' });
  E.setPlayers(t, ['A', 'B', 'C', 'D', 'E', 'F']);
  E.launchTournament(t);
  const [p1] = t.pools;
  const order = p1.playerIds.slice().reverse();
  assert.ok(!E.finalizePool(t, p1.id, order.slice(1)), 'classement incomplet refusé');
  assert.ok(E.finalizePool(t, p1.id, order));
  assert.equal(p1.phase, 'done');
  assert.deepEqual(E.poolQualified(t, p1), order.slice(0, 2));
  assert.deepEqual(E.poolRRRanking(t, p1).map((r) => r.id), order);
  assert.equal(E.currentMatch(p1), null);
  assert.ok(!E.finalizePool(t, p1.id, order), 'déjà terminée');
  const back = E.undo(t);
  assert.equal(back.pools[0].phase, 'roundrobin');
  assert.ok(E.finalizePool(back, back.pools[0].id, order));
  assert.ok(E.finalizePool(back, back.pools[1].id, back.pools[1].playerIds.slice()));
  E.startFinals(back);
  assert.ok(back.finals);
  assert.ok(!E.finalizePool(back, back.pools[0].id, order), 'phase finale lancée');
});

test('la petite finale se joue avant la clôture, même après la finale', () => {
  const t = launched('single', 4);
  const f = t.finals.bracket;
  for (const m of f.rounds[0]) E.reportFinals(t, m.id, m.a, 1, 0);
  const final = f.rounds[1][0];
  E.reportFinals(t, final.id, final.a, 1, 0);
  assert.equal(t.status, 'live');
  const third = t.finals.bracket.thirdPlace;
  assert.ok(E.reportFinals(t, third.id, third.a, 1, 0));
  assert.equal(t.status, 'finished');
  assert.equal(E.finalPlacements(t)[2].length, 1);
});
