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
