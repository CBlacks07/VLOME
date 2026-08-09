"use strict";
/* =========================================================
   @vlome/engine — Moteur de tournoi Survival Challonge (TS)
   Logique pure, sans dépendance : réutilisable web + API.
   Portage TypeScript du moteur éprouvé de Survival Challonge.
   ========================================================= */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_BR_POINTS = exports.DEFAULT_STREAK_LENGTH = exports.BYE = void 0;
exports.uid = uid;
exports.newTournament = newTournament;
exports.swissRoundCount = swissRoundCount;
exports.parseEntry = parseEntry;
exports.setPlayers = setPlayers;
exports.addPlayer = addPlayer;
exports.removePlayer = removePlayer;
exports.renamePlayer = renamePlayer;
exports.setPlayerClub = setPlayerClub;
exports.playerName = playerName;
exports.undo = undo;
exports.resetTournament = resetTournament;
exports.scoringBounds = scoringBounds;
exports.recomputePoints = recomputePoints;
exports.setScoring = setScoring;
exports.manualAdjust = manualAdjust;
exports.balancedSizes = balancedSizes;
exports.distributePools = distributePools;
exports.shuffleOrder = shuffleOrder;
exports.moveInOrder = moveInOrder;
exports.launch = launch;
exports.launchTournament = launchTournament;
exports.buildBracket = buildBracket;
exports.propagateBracket = propagateBracket;
exports.bracketChampion = bracketChampion;
exports.nextBracketMatch = nextBracketMatch;
exports.currentMatch = currentMatch;
exports.reportResult = reportResult;
exports.allPoolsDone = allPoolsDone;
exports.qualifiers = qualifiers;
exports.rrRanking = rrRanking;
exports.startFinals = startFinals;
exports.allFinalsMatches = allFinalsMatches;
exports.findFinalsMatch = findFinalsMatch;
exports.reportFinals = reportFinals;
exports.swissStandings = swissStandings;
exports.reportSwiss = reportSwiss;
exports.reportBattleRoyale = reportBattleRoyale;
exports.disqualifyPlayer = disqualifyPlayer;
exports.cagnotte = cagnotte;
exports.autoFitScoring = autoFitScoring;
exports.distributed = distributed;
exports.overallRanking = overallRanking;
exports.ratings = ratings;
exports.BYE = '__bye__';
exports.DEFAULT_STREAK_LENGTH = 5;
const POOL_NAMES = 'ABCDEFGHIJKL'.split('');
const MAX_UNDO = 25;
function uid() {
    return 'id' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}
function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
/* ---------- Création ---------- */
function newTournament(cfg = {}) {
    return {
        id: uid(), createdAt: Date.now(),
        name: cfg.name || 'Tournoi sans nom',
        game: cfg.game || '', date: cfg.date || '', place: cfg.place || '',
        pointsPerPlayer: cfg.pointsPerPlayer || 5,
        nbPools: cfg.nbPools || 2,
        format: cfg.format || 'survival',
        players: [],
        disqualified: [],
        scoring: cfg.scoring || { survWin: 1, loserWin: 0.5, poolFinalWin: 1.5, finalsWin: 2, championBonus: 3, streakBonus: 0 },
        pools: [],
        poolFormat: cfg.poolFormat || 'survival',
        streakLength: cfg.streakLength || exports.DEFAULT_STREAK_LENGTH,
        status: 'setup', log: [], points: {}, finals: null,
        finalsFormat: cfg.finalsFormat || 'single',
        champion: null, _undo: [],
    };
}
/** Nombre de rondes Swiss standard pour n joueurs (assez pour départager, sans exploser la durée). */
function swissRoundCount(nPlayers) {
    return Math.max(3, Math.ceil(Math.log2(Math.max(2, nPlayers))));
}
exports.DEFAULT_BR_POINTS = [15, 12, 10, 8, 6, 4, 2, 1];
function parseEntry(raw) {
    let name = String(raw).trim(), club = '';
    const at = name.lastIndexOf('@');
    if (at > 0) {
        club = name.slice(at + 1).trim();
        name = name.slice(0, at).trim();
    }
    return { name, club };
}
function setPlayers(t, names) {
    const seen = {};
    t.players = [];
    names.forEach(raw => {
        const { name, club } = parseEntry(raw);
        if (!name)
            return;
        const k = name.toLowerCase();
        if (seen[k])
            return;
        seen[k] = true;
        t.players.push({ id: uid(), name, club });
    });
}
/** Ajoute un joueur — uniquement avant le lancement (les poules ne sont pas encore figées). */
function addPlayer(t, raw) {
    if (t.status !== 'setup')
        return null;
    const { name, club } = parseEntry(raw);
    if (!name)
        return null;
    if (t.players.some(p => p.name.toLowerCase() === name.toLowerCase()))
        return null;
    const p = { id: uid(), name, club };
    t.players.push(p);
    return p;
}
/** Retire un joueur — uniquement avant le lancement. */
function removePlayer(t, playerId) {
    if (t.status !== 'setup')
        return false;
    const before = t.players.length;
    t.players = t.players.filter(p => p.id !== playerId);
    return t.players.length < before;
}
/** Renomme un joueur — à tout moment (y compris en direct : coquille repérée pendant le tournoi). */
function renamePlayer(t, id, newName) {
    const p = t.players.find(x => x.id === id);
    if (!p)
        return false;
    const nm = String(newName).trim();
    if (!nm)
        return false;
    p.name = nm;
    return true;
}
/** Modifie le club affiché d'un joueur — à tout moment. */
function setPlayerClub(t, id, club) {
    const p = t.players.find(x => x.id === id);
    if (!p)
        return false;
    p.club = String(club).trim();
    return true;
}
function playerName(t, id) {
    const p = t.players.find(x => x.id === id);
    return p ? p.name : '?';
}
/* ---------- Historique (annuler) ---------- */
/** Empile un instantané de l'état courant (hors pile elle-même) avant une action mutante. */
function snapshot(t) {
    const stack = t._undo || (t._undo = []);
    t._undo = [];
    const snap = JSON.stringify(t);
    t._undo = stack;
    t._undo.push(snap);
    if (t._undo.length > MAX_UNDO)
        t._undo.shift();
}
/** Restaure l'état précédent (dernier résultat, ajustement, changement de barème…) — l'appelant doit remplacer sa référence par la valeur retournée. */
function undo(t) {
    if (!t._undo || !t._undo.length)
        return null;
    const snap = JSON.parse(t._undo.pop());
    snap._undo = t._undo;
    return snap;
}
/** Remet le tournoi à l'état "à lancer" (garde joueurs, config des poules et barème). */
function resetTournament(t) {
    snapshot(t);
    t.pools = [];
    t.finals = null;
    t.champion = null;
    t.log = [];
    t.points = {};
    t.disqualified = [];
    t.status = 'setup';
    delete t.finishedAt;
}
/* ---------- Barème (déplafonné) ---------- */
function scoringBounds(key) {
    return key === 'championBonus' || key === 'streakBonus' ? { min: 0, max: 999 } : { min: 0.25, max: 999 };
}
/** Resynchronise tous les points déjà attribués avec le barème courant (après setScoring, ou pour rattraper une correction). */
function recomputePoints(t) {
    const pts = {};
    t.log.forEach(l => {
        let p;
        if (l.stage === 'adjust')
            p = l.pts;
        else if (l.stage === 'championBonus') {
            p = t.scoring.championBonus;
            l.pts = p;
        }
        else if (l.stage === 'streakBonus') {
            p = t.scoring.streakBonus;
            l.pts = p;
        }
        else {
            p = stagePoints(t, l.stage);
            l.pts = p;
        }
        pts[l.winner] = Math.round(((pts[l.winner] || 0) + p) * 100) / 100;
    });
    t.players.forEach(pl => { if (pts[pl.id] === undefined)
        pts[pl.id] = 0; });
    t.points = pts;
}
/** Modifie une valeur du barème (à tout moment) puis resynchronise les points déjà distribués. */
function setScoring(t, key, value) {
    if (!(key in t.scoring))
        return false;
    snapshot(t);
    const b = scoringBounds(key);
    t.scoring[key] = Math.min(b.max, Math.max(b.min, Number(value) || b.min));
    recomputePoints(t);
    return true;
}
/** Bonus/pénalité manuel (peut être négatif), tracé dans le journal avec un motif. */
function manualAdjust(t, playerId, delta, reason) {
    if (!t.players.some(p => p.id === playerId))
        return false;
    const d = Math.round((Number(delta) || 0) * 100) / 100;
    if (!d)
        return false;
    snapshot(t);
    t.log.push({ id: uid(), poolId: 'admin', stage: 'adjust', a: playerId, b: null, winner: playerId, pts: d, ts: Date.now(), reason: reason || '' });
    recomputePoints(t);
    return true;
}
/* ---------- Poules ---------- */
function balancedSizes(nPlayers, nbPools) {
    const nb = Math.max(1, Math.min(nbPools, Math.max(nPlayers, 1)));
    const base = Math.floor(nPlayers / nb), extra = nPlayers % nb;
    return Array.from({ length: nb }, (_, i) => base + (i < extra ? 1 : 0));
}
function distributePools(t) {
    const nb = Math.max(1, Math.min(t.nbPools, t.players.length));
    const mixed = shuffle(t.players.map(p => p.id));
    const pools = [];
    for (let i = 0; i < nb; i++) {
        pools.push({
            id: uid(), name: 'Poule ' + POOL_NAMES[i], playerIds: [], order: [], phase: 'pending',
            wSurvivor: null, wIndex: 0, wLosers: [], wChampion: null, wStreak: 0, wBestStreak: {},
            lBracket: null, lChampion: null, top1: null, top2: null,
            dbracket: null, streaks: {}, streakAwarded: {},
        });
    }
    mixed.forEach((pid, i) => pools[i % nb].playerIds.push(pid));
    t.pools = pools;
}
/** Rebrasse l'ordre de passage d'une poule (avant lancement). */
function shuffleOrder(pool) {
    pool.order = shuffle(pool.playerIds);
}
/** Déplace un joueur dans l'ordre de passage d'une poule (avant lancement) : dir = -1 (monte) ou +1 (descend). */
function moveInOrder(pool, index, dir) {
    const j = index + dir;
    if (index < 0 || index >= pool.order.length || j < 0 || j >= pool.order.length)
        return false;
    [pool.order[index], pool.order[j]] = [pool.order[j], pool.order[index]];
    return true;
}
function launch(t) {
    t.pools.forEach(p => {
        if (!p.order.length)
            p.order = shuffle(p.playerIds);
        if (t.poolFormat === 'double')
            initPoolDouble(p);
        else
            initSurvival(p);
    });
    t.players.forEach(p => { t.points[p.id] = t.points[p.id] || 0; });
    t.status = 'live';
}
/** Lance une poule en mini-bracket double élimination (poolFormat 'double') — mêmes primitives que la phase finale. */
function initPoolDouble(pool) {
    if (pool.order.length < 2) {
        pool.top1 = pool.order[0] || null;
        pool.phase = 'done';
        return;
    }
    pool.dbracket = buildDoubleElim(pool.order);
    pool.phase = 'double';
    checkPoolDoubleChampion(pool); // couronne immédiatement les cas triviaux (2 joueurs : grande finale déjà en bye)
}
/** Détecte la fin du mini-bracket double élim d'une poule (avec reset éventuel) et pose top1/top2. */
function checkPoolDoubleChampion(pool) {
    const f = pool.dbracket;
    if (!f || pool.phase !== 'double' || !f.gf.winner)
        return;
    if (f.gf.winner === f.gf.a) {
        pool.top1 = f.gf.a;
        pool.top2 = f.gf.b;
        pool.phase = 'done';
    }
    else if (f.gf2 && f.gf2.winner) {
        pool.top1 = f.gf2.winner;
        pool.top2 = f.gf2.winner === f.gf2.a ? f.gf2.b : f.gf2.a;
        pool.phase = 'done';
    }
    else if (!f.gf2)
        f.gf2 = { id: uid(), a: f.gf.a, b: f.gf.b, winner: null, bye: false };
}
function initSurvival(pool) {
    if (pool.order.length < 2) {
        pool.top1 = pool.order[0] || null;
        pool.phase = 'done';
        return;
    }
    pool.phase = 'survival';
    pool.wSurvivor = pool.order[0];
    pool.wIndex = 1;
    pool.wStreak = 0;
}
/**
 * Point d'entrée unique du lancement, quel que soit le format. Le format survival garde
 * exactement le comportement historique (poules). Les autres formats n'ont pas de poules :
 * le tournoi entier est directement la structure de compétition (bracket, rondes Swiss, parties BR).
 */
function launchTournament(t) {
    if (t.format === 'survival' || !t.format) {
        launch(t);
        return;
    }
    snapshot(t);
    t.pools = []; // pas de poules hors survival — efface une éventuelle répartition prévisualisée avant le lancement
    const ids = t.players.map(p => p.id);
    t.players.forEach(p => { t.points[p.id] = t.points[p.id] || 0; });
    // Posé AVANT le montage du format : un format qui se termine immédiatement (ex. Swiss à
    // effectif impair réduit à des exempts) doit pouvoir écraser ce 'live' par 'finished' via
    // finishFinals — pas l'inverse.
    t.status = 'live';
    if (t.format === 'swiss') {
        t.finals = { format: 'swiss', rounds: [], roundCount: swissRoundCount(ids.length) };
        generateSwissRound(t); // peut déjà couronner le champion (cascade interne) pour un très petit effectif
    }
    else if (t.format === 'battle_royale') {
        const nGames = Math.max(1, t.nbPools || 3); // réutilise nbPools comme "nombre de parties" pour ce format (pas de poules ici)
        t.finals = { format: 'battle_royale', games: Array.from({ length: nGames }, () => ({ id: uid(), ranking: null })), pointsTable: exports.DEFAULT_BR_POINTS };
    }
    else if (t.format === 'roundrobin') {
        const rr = buildRoundRobin(ids);
        t.finals = { format: 'roundrobin', players: rr.players, matches: rr.matches };
        checkFinalsChampion(t); // couronne immédiatement les cas triviaux (0-1 match, ex. 1-2 joueurs)
    }
    else if (t.format === 'double') {
        t.finals = buildDoubleElim(ids);
        checkFinalsChampion(t);
    }
    else {
        t.finals = { format: 'single', bracket: buildBracket(ids) };
        checkFinalsChampion(t);
    }
}
/* ---------- Bracket générique (élimination directe) ---------- */
function nextPow2(n) { let p = 1; while (p < n)
    p *= 2; return p; }
function buildBracket(ids) {
    const q = ids.slice();
    const P = nextPow2(q.length);
    const round0 = [];
    for (let i = 0; i < P / 2; i++) {
        const a = q[i] || null;
        const b = q[P - 1 - i] !== undefined ? q[P - 1 - i] : null;
        const m = { id: uid(), a, b, winner: null, bye: !a || !b };
        if (m.bye)
            m.winner = a || b;
        round0.push(m);
    }
    const rounds = [round0];
    let size = P / 2;
    while (size > 1) {
        size = size / 2;
        rounds.push(Array.from({ length: size }, () => ({ id: uid(), a: null, b: null, winner: null, bye: false })));
    }
    const bracket = { rounds };
    propagateBracket(bracket);
    return bracket;
}
function propagateBracket(bracket) {
    const rounds = bracket.rounds;
    for (let r = 0; r < rounds.length - 1; r++) {
        rounds[r].forEach((m, i) => {
            if (m.winner) {
                const target = rounds[r + 1][Math.floor(i / 2)];
                if (i % 2 === 0)
                    target.a = m.winner;
                else
                    target.b = m.winner;
            }
        });
    }
}
function bracketChampion(bracket) {
    if (!bracket || !bracket.rounds.length)
        return null;
    const last = bracket.rounds[bracket.rounds.length - 1][0];
    return last.winner || null;
}
function nextBracketMatch(bracket) {
    if (!bracket)
        return null;
    for (const round of bracket.rounds)
        for (const m of round)
            if (m.a && m.b && !m.winner && !m.bye)
                return { match: m };
    return null;
}
function currentMatch(pool) {
    if (pool.phase === 'survival')
        return { a: pool.wSurvivor, b: pool.order[pool.wIndex], stage: 'survival', streak: pool.wStreak };
    if (pool.phase === 'losers') {
        const nm = nextBracketMatch(pool.lBracket);
        return nm ? { a: nm.match.a, b: nm.match.b, stage: 'losers', streak: 0, matchId: nm.match.id } : null;
    }
    if (pool.phase === 'poolFinal')
        return { a: pool.wChampion, b: pool.lChampion, stage: 'poolFinal', streak: 0 };
    if (pool.phase === 'double') {
        const f = pool.dbracket;
        if (!f)
            return null;
        const playable = (arr) => arr.find(x => x.a && x.b && !x.winner && !x.bye && x.a !== exports.BYE && x.b !== exports.BYE);
        // Bracket vainqueurs → survWin, bracket perdants → loserWin, grande finale (+ reset) → poolFinalWin : mêmes catégories que le mode Survival classique.
        let m = playable(f.wb.flat());
        let stage = 'survival';
        if (!m) {
            m = playable(f.lb.flat());
            stage = 'losers';
        }
        if (!m) {
            m = playable(f.gf2 ? [f.gf, f.gf2] : [f.gf]);
            stage = 'poolFinal';
        }
        return m ? { a: m.a, b: m.b, stage, streak: pool.streaks[m.a] || 0, matchId: m.id } : null;
    }
    return null;
}
function stagePoints(t, stage) {
    const s = t.scoring;
    return { survival: s.survWin, losers: s.loserWin, poolFinal: s.poolFinalWin, finals: s.finalsWin }[stage] || 0;
}
function award(t, playerId, pts) {
    t.points[playerId] = Math.round(((t.points[playerId] || 0) + pts) * 100) / 100;
}
/* ---------- Résultat (poules) ---------- */
function reportResult(t, poolId, winnerId, sa = 0, sb = 0, reason) {
    const pool = t.pools.find(p => p.id === poolId);
    if (!pool)
        return null;
    const m = currentMatch(pool);
    if (!m)
        return null;
    // Scores FT : le vainqueur est le côté avec le plus de manches.
    if (sa || sb)
        winnerId = sa >= sb ? m.a : m.b;
    if (winnerId !== m.a && winnerId !== m.b)
        return null;
    snapshot(t);
    const loserId = winnerId === m.a ? m.b : m.a;
    const pts = stagePoints(t, m.stage);
    award(t, winnerId, pts);
    t.log.push({ id: uid(), poolId, stage: m.stage, a: m.a, b: m.b, winner: winnerId, pts, ts: Date.now(), sa, sb, ...(reason ? { reason } : {}) });
    // Bonus striker : série de t.streakLength (3 OU 5, un seul palier actif par tournoi) victoires
    // d'affilée sur le "bracket vainqueurs" de la poule (stage 'survival', que la poule soit en mode
    // classique ou double élim) — une seule fois par joueur dans la poule.
    if (m.stage === 'survival') {
        pool.streaks[winnerId] = (pool.streaks[winnerId] || 0) + 1;
        pool.streaks[loserId] = 0;
        const streak = pool.streaks[winnerId];
        const streakLength = t.streakLength || exports.DEFAULT_STREAK_LENGTH;
        if (streak >= streakLength && t.scoring.streakBonus > 0 && !pool.streakAwarded[winnerId]) {
            pool.streakAwarded[winnerId] = true;
            award(t, winnerId, t.scoring.streakBonus);
            t.log.push({ id: uid(), poolId, stage: 'streakBonus', a: winnerId, b: null, winner: winnerId, pts: t.scoring.streakBonus, ts: Date.now(), reason: `Série de ${streakLength} victoires` });
        }
    }
    if (pool.phase === 'double') {
        const f = pool.dbracket;
        const match = [].concat(f.wb.flat(), f.lb.flat(), [f.gf], f.gf2 ? [f.gf2] : []).find(x => x.id === m.matchId);
        if (match) {
            match.winner = winnerId;
            if (sa || sb) {
                match.sa = sa;
                match.sb = sb;
            }
            propagateDouble(f);
        }
        checkPoolDoubleChampion(pool);
    }
    else if (m.stage === 'survival') {
        pool.wLosers.push(loserId);
        if (winnerId === pool.wSurvivor)
            pool.wStreak++;
        else {
            pool.wSurvivor = winnerId;
            pool.wStreak = 1;
        }
        pool.wBestStreak[winnerId] = Math.max(pool.wBestStreak[winnerId] || 0, pool.wStreak);
        pool.wIndex++;
        if (pool.wIndex >= pool.order.length) {
            pool.wChampion = pool.wSurvivor;
            startLosers(pool);
        }
    }
    else if (m.stage === 'losers') {
        const nm = nextBracketMatch(pool.lBracket);
        if (nm) {
            nm.match.winner = winnerId;
            propagateBracket(pool.lBracket);
        }
        const champ = bracketChampion(pool.lBracket);
        if (champ) {
            pool.lChampion = champ;
            pool.phase = 'poolFinal';
        }
    }
    else if (m.stage === 'poolFinal') {
        pool.top1 = winnerId;
        pool.top2 = loserId;
        pool.phase = 'done';
    }
    return { winnerId, loserId, pts, stage: m.stage };
}
function startLosers(pool) {
    const losers = pool.wLosers.slice();
    if (losers.length === 0) {
        pool.top1 = pool.wChampion;
        pool.phase = 'done';
    }
    else if (losers.length === 1) {
        pool.lChampion = losers[0];
        pool.phase = 'poolFinal';
    }
    else {
        pool.phase = 'losers';
        pool.lBracket = buildBracket(losers);
        const champ = bracketChampion(pool.lBracket);
        if (champ) {
            pool.lChampion = champ;
            pool.phase = 'poolFinal';
        }
    }
}
/* ---------- Phase finale (3 formats) ---------- */
function allPoolsDone(t) {
    return t.pools.length > 0 && t.pools.every(p => p.phase === 'done');
}
function qualifiers(t) {
    const top1s = t.pools.map(p => p.top1).filter(Boolean);
    const top2s = t.pools.map(p => p.top2).filter(Boolean).reverse();
    // Un joueur disqualifié ne doit jamais accéder à la phase finale, même s'il a
    // terminé top1/top2 de sa poule via un forfait adverse antérieur.
    return top1s.concat(top2s).filter(id => !t.disqualified.includes(id));
}
function buildRoundRobin(ids) {
    const matches = [];
    for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++)
            matches.push({ id: uid(), a: ids[i], b: ids[j], winner: null, bye: false });
    return { players: ids.slice(), matches };
}
/** Classement round robin : victoires puis différence de manches puis points. */
function rrRanking(t) {
    if (!t.finals || t.finals.format !== 'roundrobin')
        return [];
    const rr = t.finals;
    const wins = {}, gd = {};
    rr.players.forEach(id => { wins[id] = 0; gd[id] = 0; });
    rr.matches.forEach(m => {
        if (!m.winner || !m.a || !m.b)
            return;
        wins[m.winner] = (wins[m.winner] || 0) + 1;
        if (m.sa != null && m.sb != null) {
            gd[m.a] = (gd[m.a] || 0) + (m.sa - m.sb);
            gd[m.b] = (gd[m.b] || 0) + (m.sb - m.sa);
        }
    });
    return rr.players.slice()
        .sort((x, y) => wins[y] - wins[x] || gd[y] - gd[x] || (t.points[y] || 0) - (t.points[x] || 0))
        .map(id => ({ id, wins: wins[id], gd: gd[id] }));
}
function placeSlot(m, slot, val) {
    const key = slot ? 'b' : 'a';
    if (m[key] == null && val != null) {
        m[key] = val;
        return true;
    }
    return false;
}
function resolveBye(m) {
    if (m.winner)
        return false;
    const aB = m.a === exports.BYE, bB = m.b === exports.BYE;
    const aR = !!m.a && !aB, bR = !!m.b && !bB;
    if (aR && bB) {
        m.winner = m.a;
        m.bye = true;
        return true;
    }
    if (bR && aB) {
        m.winner = m.b;
        m.bye = true;
        return true;
    }
    if (aB && bB) {
        m.winner = exports.BYE;
        m.bye = true;
        return true;
    }
    return false;
}
function buildDoubleElim(ids) {
    const P = Math.max(2, nextPow2(ids.length));
    const seeds = ids.slice();
    while (seeds.length < P)
        seeds.push(exports.BYE);
    const R = Math.round(Math.log2(P));
    const mk = () => ({ id: uid(), a: null, b: null, winner: null, bye: false });
    const wb = [];
    const r0 = [];
    for (let i = 0; i < P / 2; i++)
        r0.push({ id: uid(), a: seeds[i], b: seeds[P - 1 - i], winner: null, bye: false });
    wb.push(r0);
    let size = P / 2;
    for (let r = 1; r < R; r++) {
        size = size / 2;
        wb.push(Array.from({ length: size }, mk));
    }
    const lb = [];
    const lbCount = Math.max(0, 2 * R - 2);
    for (let e = 0; e < lbCount; e++) {
        const k = Math.floor(e / 2);
        const s = Math.max(1, P / Math.pow(2, k + 2));
        lb.push(Array.from({ length: s }, mk));
    }
    const fin = { format: 'double', wb, lb, gf: mk(), gf2: null, wbChampion: null, lbChampion: null };
    propagateDouble(fin);
    return fin;
}
function propagateDouble(fin) {
    let changed = true, guard = 0;
    while (changed && guard++ < 1000) {
        changed = false;
        for (let r = 0; r < fin.wb.length; r++) {
            fin.wb[r].forEach((m, i) => {
                if (resolveBye(m))
                    changed = true;
                if (!m.winner)
                    return;
                if (r + 1 < fin.wb.length) {
                    if (placeSlot(fin.wb[r + 1][Math.floor(i / 2)], (i % 2), m.winner))
                        changed = true;
                }
                else if (fin.wbChampion !== m.winner && m.winner !== exports.BYE) {
                    fin.wbChampion = m.winner;
                    changed = true;
                }
                let drop;
                if (m.winner === exports.BYE)
                    drop = exports.BYE;
                else {
                    const loser = m.winner === m.a ? m.b : m.a;
                    drop = loser ?? null;
                }
                if (drop != null && fin.lb.length) {
                    if (r === 0) {
                        if (placeSlot(fin.lb[0][Math.floor(i / 2)], (i % 2), drop))
                            changed = true;
                    }
                    else if (2 * r - 1 < fin.lb.length) {
                        if (placeSlot(fin.lb[2 * r - 1][i], 1, drop))
                            changed = true;
                    }
                }
            });
        }
        for (let e = 0; e < fin.lb.length; e++) {
            fin.lb[e].forEach((m, i) => {
                if (resolveBye(m))
                    changed = true;
                if (!m.winner)
                    return;
                if (e + 1 < fin.lb.length) {
                    if (e % 2 === 0) {
                        if (placeSlot(fin.lb[e + 1][i], 0, m.winner))
                            changed = true;
                    }
                    else {
                        if (placeSlot(fin.lb[e + 1][Math.floor(i / 2)], (i % 2), m.winner))
                            changed = true;
                    }
                }
                else if (fin.lbChampion !== m.winner && m.winner !== exports.BYE) {
                    fin.lbChampion = m.winner;
                    changed = true;
                }
            });
        }
        if (fin.wbChampion && placeSlot(fin.gf, 0, fin.wbChampion))
            changed = true;
        if (fin.lbChampion && placeSlot(fin.gf, 1, fin.lbChampion))
            changed = true;
        // cas dégénéré : pas de losers bracket (≤2 qualifiés)
        if (!fin.lb.length && fin.wbChampion && placeSlot(fin.gf, 1, exports.BYE))
            changed = true;
        // La grande finale elle-même peut être un bye (1-2 joueurs au total) — sans quoi elle ne se résout jamais.
        if (resolveBye(fin.gf))
            changed = true;
        if (fin.gf2 && resolveBye(fin.gf2))
            changed = true;
    }
}
function startFinals(t, format) {
    snapshot(t);
    const q = qualifiers(t);
    const fmt = format || t.finalsFormat || 'single';
    t.finalsFormat = fmt;
    if (fmt === 'roundrobin') {
        const rr = buildRoundRobin(q);
        t.finals = { format: 'roundrobin', players: rr.players, matches: rr.matches };
    }
    else if (fmt === 'double') {
        t.finals = buildDoubleElim(q);
    }
    else {
        t.finals = { format: 'single', bracket: buildBracket(q) };
    }
    checkFinalsChampion(t);
}
/** Toutes les rencontres de la phase finale, quel que soit le format — pour recherche/affichage générique. */
function allFinalsMatches(t) {
    const f = t.finals;
    if (!f)
        return [];
    if (f.format === 'roundrobin')
        return f.matches;
    if (f.format === 'single')
        return f.bracket.rounds.flat();
    if (f.format === 'double')
        return [].concat(f.wb.flat(), f.lb.flat(), [f.gf], f.gf2 ? [f.gf2] : []);
    if (f.format === 'swiss')
        return f.rounds.flat();
    return []; // battle_royale : pas de duels 1v1, se pilote via reportBattleRoyale (classement de partie)
}
function findFinalsMatch(t, matchId) {
    return allFinalsMatches(t).find(m => m.id === matchId) || null;
}
function reportFinals(t, matchId, winnerId, sa = 0, sb = 0, reason) {
    const f = t.finals;
    if (!f)
        return null;
    const match = findFinalsMatch(t, matchId);
    if (!match)
        return null;
    if (match.bye || match.winner || !match.a || !match.b || match.a === exports.BYE || match.b === exports.BYE)
        return null;
    if (sa || sb)
        winnerId = sa >= sb ? match.a : match.b;
    if (winnerId !== match.a && winnerId !== match.b)
        return null;
    snapshot(t);
    match.winner = winnerId;
    if (sa || sb) {
        match.sa = sa;
        match.sb = sb;
    }
    const pts = t.scoring.finalsWin;
    award(t, winnerId, pts);
    t.log.push({ id: uid(), poolId: 'finals', stage: 'finals', a: match.a, b: match.b, winner: winnerId, pts, ts: Date.now(), sa, sb, ...(reason ? { reason } : {}) });
    if (f.format === 'single')
        propagateBracket(f.bracket);
    else if (f.format === 'double')
        propagateDouble(f);
    checkFinalsChampion(t);
    return { winnerId, pts };
}
function finishFinals(t, champId) {
    if (!champId || t.status === 'finished')
        return;
    t.champion = champId;
    award(t, champId, t.scoring.championBonus);
    t.log.push({ id: uid(), poolId: 'finals', stage: 'championBonus', a: champId, b: null, winner: champId, pts: t.scoring.championBonus, ts: Date.now() });
    t.status = 'finished';
    t.finishedAt = Date.now();
}
/** Détecte la fin de la phase finale (tous formats) et couronne le champion. */
function checkFinalsChampion(t) {
    const f = t.finals;
    if (!f || t.status === 'finished')
        return;
    if (f.format === 'single') {
        finishFinals(t, bracketChampion(f.bracket));
    }
    else if (f.format === 'double') {
        if (f.gf.winner) {
            // Bracket reset : si le finaliste du losers bracket gagne la 1re grande finale,
            // on rejoue une 2e grande finale (chacun a alors une défaite).
            if (f.gf.winner === f.gf.a)
                finishFinals(t, f.gf.a);
            else if (f.gf2 && f.gf2.winner)
                finishFinals(t, f.gf2.winner);
            else if (!f.gf2)
                f.gf2 = { id: uid(), a: f.gf.a, b: f.gf.b, winner: null, bye: false };
        }
    }
    else if (f.format === 'roundrobin') {
        if (f.matches.every(m => m.winner)) {
            const rk = rrRanking(t);
            if (rk.length)
                finishFinals(t, rk[0].id);
        }
    }
}
/* ---------- Format Swiss (rondes appariées par classement, sans poules) ---------- */
function pairKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
/** Classement Swiss courant : victoires puis Buchholz (somme des victoires des adversaires affrontés) puis points. */
function swissStandings(t) {
    const f = t.finals;
    if (!f || f.format !== 'swiss')
        return [];
    const wins = {};
    const opponents = {};
    t.players.forEach(p => { wins[p.id] = 0; opponents[p.id] = []; });
    f.rounds.forEach(round => round.forEach(m => {
        if (!m.a)
            return;
        if (m.b) {
            opponents[m.a] = (opponents[m.a] || []).concat(m.b);
            opponents[m.b] = (opponents[m.b] || []).concat(m.a);
        }
        if (m.winner)
            wins[m.winner] = (wins[m.winner] || 0) + 1;
    }));
    const buchholz = (id) => (opponents[id] || []).reduce((s, oid) => s + (wins[oid] || 0), 0);
    return t.players.slice()
        .sort((a, b) => (wins[b.id] || 0) - (wins[a.id] || 0) || buchholz(b.id) - buchholz(a.id) || (t.points[b.id] || 0) - (t.points[a.id] || 0))
        .map(p => ({ id: p.id, wins: wins[p.id] || 0, buchholz: buchholz(p.id) }));
}
/** Génère la ronde Swiss suivante : apparie par classement courant, évite les rematchs quand c'est possible, exempte le surnombre. */
function generateSwissRound(t) {
    const f = t.finals;
    if (!f || f.format !== 'swiss')
        return;
    const ids = t.players.map(p => p.id).filter(id => !t.disqualified.includes(id));
    const standing = swissStandings(t);
    const order = standing.map(s => s.id).filter(id => ids.includes(id));
    const played = new Set();
    f.rounds.forEach(round => round.forEach(m => { if (m.a && m.b)
        played.add(pairKey(m.a, m.b)); }));
    const used = new Set();
    const matches = [];
    for (let i = 0; i < order.length; i++) {
        const a = order[i];
        if (used.has(a))
            continue;
        used.add(a);
        let opp = null;
        for (let j = i + 1; j < order.length; j++) {
            const b = order[j];
            if (!used.has(b) && !played.has(pairKey(a, b))) {
                opp = b;
                break;
            }
        }
        if (!opp)
            for (let j = i + 1; j < order.length; j++) {
                const b = order[j];
                if (!used.has(b)) {
                    opp = b;
                    break;
                }
            } // repli : rematch si inévitable (petit effectif)
        if (opp) {
            used.add(opp);
            matches.push({ id: uid(), a, b: opp, winner: null, bye: false });
        }
        else
            matches.push({ id: uid(), a, b: null, winner: a, bye: true }); // nombre impair : exempt, victoire automatique
    }
    f.rounds.push(matches);
    matches.forEach(m => {
        if (m.bye && m.winner) {
            const pts = t.scoring.finalsWin;
            award(t, m.winner, pts);
            t.log.push({ id: uid(), poolId: 'finals', stage: 'finals', a: m.a, b: null, winner: m.winner, pts, ts: Date.now(), reason: 'bye' });
        }
    });
    advanceSwissIfRoundDone(t); // effectif impair au point de n'avoir que des exempts : la ronde est déjà "jouée", il faut enchaîner tout de suite
}
/** Une fois toutes les rencontres de la ronde décidées : ronde suivante, ou couronnement si c'était la dernière. */
function advanceSwissIfRoundDone(t) {
    const f = t.finals;
    if (!f || f.format !== 'swiss')
        return;
    const round = f.rounds[f.rounds.length - 1];
    if (!round.length || !round.every(m => m.winner))
        return;
    if (f.rounds.length < f.roundCount)
        generateSwissRound(t);
    else {
        const st = swissStandings(t);
        finishFinals(t, st[0]?.id || null);
    }
}
/** Rapporte le résultat d'un match Swiss de la ronde en cours ; enchaîne la ronde suivante ou couronne le champion. */
function reportSwiss(t, matchId, winnerId, sa = 0, sb = 0, reason) {
    const f = t.finals;
    if (!f || f.format !== 'swiss')
        return null;
    const round = f.rounds[f.rounds.length - 1];
    const match = round && round.find(m => m.id === matchId);
    if (!match || match.winner || match.bye || !match.a || !match.b)
        return null;
    if (sa || sb)
        winnerId = sa >= sb ? match.a : match.b;
    if (winnerId !== match.a && winnerId !== match.b)
        return null;
    snapshot(t);
    match.winner = winnerId;
    if (sa || sb) {
        match.sa = sa;
        match.sb = sb;
    }
    const pts = t.scoring.finalsWin;
    award(t, winnerId, pts);
    t.log.push({ id: uid(), poolId: 'finals', stage: 'finals', a: match.a, b: match.b, winner: winnerId, pts, ts: Date.now(), sa, sb, ...(reason ? { reason } : {}) });
    advanceSwissIfRoundDone(t);
    return { winnerId, pts };
}
/* ---------- Format Battle Royale (parties à N joueurs, classement par palier de points) ---------- */
/** Rapporte le classement complet d'une partie Battle Royale (ids du 1er au dernier) ; enchaîne ou couronne le champion après la dernière partie. */
function reportBattleRoyale(t, gameId, ranking) {
    const f = t.finals;
    if (!f || f.format !== 'battle_royale')
        return { ok: false };
    const game = f.games.find(g => g.id === gameId);
    if (!game || game.ranking)
        return { ok: false };
    const validIds = new Set(t.players.map(p => p.id));
    const clean = ranking.filter(id => validIds.has(id));
    if (!clean.length)
        return { ok: false };
    snapshot(t);
    game.ranking = clean;
    clean.forEach((pid, i) => {
        const pts = f.pointsTable[i] ?? f.pointsTable[f.pointsTable.length - 1] ?? 0;
        if (pts > 0) {
            award(t, pid, pts);
            t.log.push({ id: uid(), poolId: 'finals', stage: 'finals', a: pid, b: null, winner: pid, pts, ts: Date.now() });
        }
    });
    if (f.games.every(g => g.ranking)) {
        const top = t.players.slice().sort((a, b) => (t.points[b.id] || 0) - (t.points[a.id] || 0))[0];
        finishFinals(t, top ? top.id : null);
    }
    return { ok: true };
}
/* ---------- Disqualification (en direct) ---------- */
/** Le match en cours (poule ou finale, tous formats) impliquant ce joueur, s'il y en a un. */
function pendingFinalsMatchFor(t, playerId) {
    const f = t.finals;
    if (!f)
        return null;
    if (f.format === 'single') {
        const nm = nextBracketMatch(f.bracket);
        return nm && (nm.match.a === playerId || nm.match.b === playerId) ? nm.match : null;
    }
    // Double élim / round robin : plusieurs matchs peuvent être « prêts » en parallèle.
    return allFinalsMatches(t).find(m => !m.winner && !m.bye && m.a && m.b && m.a !== exports.BYE && m.b !== exports.BYE && (m.a === playerId || m.b === playerId)) || null;
}
/**
 * Disqualifie un joueur en cours de tournoi : forfait immédiat sur son match en
 * cours (s'il y en a un, poule ou finale — l'adversaire est déclaré vainqueur via
 * la machine à états existante, ce qui fait avancer poule/bracket normalement) et
 * retrait des files d'attente pas encore atteintes (poule Survival, perdants pas
 * encore engagés dans le bracket de repêchage).
 */
function disqualifyPlayer(t, playerId) {
    if (t.status !== 'live')
        return { ok: false, reason: 'not-live' };
    if (!t.players.some(p => p.id === playerId))
        return { ok: false, reason: 'not-found' };
    if (t.disqualified.includes(playerId))
        return { ok: false, reason: 'already-disqualified' };
    for (const pool of t.pools) {
        if (pool.phase === 'survival') {
            const idx = pool.order.indexOf(playerId);
            if (idx > pool.wIndex)
                pool.order.splice(idx, 1);
        }
        pool.wLosers = pool.wLosers.filter(id => id !== playerId);
    }
    // Force la défaite tant que le joueur est partie prenante d'un match courant
    // (poule ou finale) — reportResult/reportFinals gèrent toutes les transitions.
    let guard = 0;
    while (guard++ < 200) {
        let acted = false;
        for (const pool of t.pools) {
            const cur = currentMatch(pool);
            if (cur && (cur.a === playerId || cur.b === playerId)) {
                const winner = cur.a === playerId ? cur.b : cur.a;
                reportResult(t, pool.id, winner, 0, 0, 'forfeit');
                acted = true;
            }
        }
        if (t.finals && t.finals.format === 'swiss') {
            const round = t.finals.rounds[t.finals.rounds.length - 1];
            const m = round && round.find(x => !x.winner && !x.bye && x.a && x.b && (x.a === playerId || x.b === playerId));
            if (m) {
                const winner = (m.a === playerId ? m.b : m.a);
                reportSwiss(t, m.id, winner, 0, 0, 'forfeit');
                acted = true;
            }
        }
        else {
            const fm = pendingFinalsMatchFor(t, playerId);
            if (fm) {
                const winner = (fm.a === playerId ? fm.b : fm.a);
                reportFinals(t, fm.id, winner, 0, 0, 'forfeit');
                acted = true;
            }
        }
        if (!acted)
            break;
    }
    t.disqualified.push(playerId);
    return { ok: true };
}
/* ---------- Cagnotte ---------- */
/** Nombre de rencontres réelles (hors bye) qui distribuent un `finalsWin`, pour `q` qualifiés selon le
 * format de phase finale — utilisé par cagnotte() pour un budget qui ne se trompe pas de format.
 * 'double' est compté via une vraie simulation de bracket (buildDoubleElim), + la 2e petite finale
 * possible (bracket reset) : jamais de sous-estimation, même si elle ne se joue pas toujours en pratique.
 * 'single' reste `q - 1`, un invariant mathématique vrai quel que soit le nombre de byes. */
function finalsMatchCount(q, format) {
    if (q < 2)
        return 0;
    if (format === 'roundrobin')
        return (q * (q - 1)) / 2;
    if (format === 'double') {
        const ids = Array.from({ length: q }, (_, i) => 'q' + i);
        const f = buildDoubleElim(ids);
        const real = [].concat(f.wb.flat(), f.lb.flat()).filter(m => !m.bye).length;
        return real + (f.gf.bye ? 0 : 2); // grande finale + 2e petite finale (reset) possible
    }
    return q - 1;
}
/** Nombre de rencontres réelles (hors bye) d'un mini-bracket double élim de n joueurs, par catégorie —
 * simulé pour de vrai (comme finalsMatchCount) : jamais de sous-estimation, reset de grande finale inclus. */
function doublePoolMatchCounts(n) {
    if (n < 2)
        return { wb: 0, lb: 0, gf: 0 };
    const ids = Array.from({ length: n }, (_, i) => 'p' + i);
    const f = buildDoubleElim(ids);
    return {
        wb: f.wb.flat().filter(m => !m.bye).length,
        lb: f.lb.flat().filter(m => !m.bye).length,
        gf: f.gf.bye ? 0 : 2, // grande finale + 2e petite finale possible (reset)
    };
}
function cagnotte(t) {
    const total = t.players.length * t.pointsPerPlayer;
    const s = t.scoring;
    let surv = 0, los = 0, pf = 0, nRealPools = 0;
    const sizes = t.pools.length ? t.pools.map(p => p.playerIds.length) : balancedSizes(t.players.length, t.nbPools);
    sizes.forEach(n => {
        if (n < 2)
            return;
        nRealPools++;
        if (t.poolFormat === 'double') {
            const c = doublePoolMatchCounts(n);
            surv += c.wb;
            los += c.lb;
            pf += c.gf;
        }
        else {
            surv += n - 1;
            los += Math.max(0, n - 2);
            pf += 1;
        }
    });
    const q = sizes.filter(n => n >= 2).length * 2 + sizes.filter(n => n === 1).length;
    const finalsMatches = finalsMatchCount(q, t.finalsFormat);
    // Bonus striker : jamais garanti (dépend des performances), mais on budgète le pire cas réaliste —
    // au plus un joueur strikeur par poule — pour ne jamais sous-estimer la cagnotte nécessaire.
    const programmed = Math.round((surv * s.survWin + los * s.loserWin + pf * s.poolFinalWin + finalsMatches * s.finalsWin + s.championBonus + nRealPools * s.streakBonus) * 100) / 100;
    return { total, programmed, gap: Math.round((total - programmed) * 100) / 100, valid: programmed <= total };
}
/** Un passage de réduction proportionnelle (pas de 0.25, plancher à 0.25) — voir autoFitScoring. */
function autoFitScoringOnce(t) {
    const c = cagnotte(t);
    if (c.programmed <= 0)
        return;
    const scale = c.total / c.programmed;
    const clamp = (v) => Math.min(999, Math.max(0.25, Math.floor(v * scale * 4) / 4));
    const s = t.scoring;
    s.survWin = clamp(s.survWin);
    s.loserWin = clamp(s.loserWin);
    s.poolFinalWin = clamp(s.poolFinalWin);
    s.finalsWin = clamp(s.finalsWin);
    // le bonus champion n'est pas rogné automatiquement (choix de l'organisateur)
}
/** Ajuste proportionnellement le barème pour tenir dans la cagnotte. Un seul passage peut laisser
 * un léger dépassement résiduel (chaque catégorie a un plancher de 0.25, donc l'arrondi au pas
 * de 0.25 après mise à l'échelle ne garantit pas individuellement le budget) — on répète jusqu'à
 * rentrer dans la cagnotte ou jusqu'à ce qu'un passage supplémentaire ne change plus rien (toutes
 * les catégories réductibles sont au plancher : le dépassement restant vient alors du bonus champion
 * seul, volontairement non rogné). */
function autoFitScoring(t) {
    snapshot(t);
    for (let i = 0; i < 8; i++) {
        const before = JSON.stringify(t.scoring);
        autoFitScoringOnce(t);
        if (cagnotte(t).valid || JSON.stringify(t.scoring) === before)
            break;
    }
    recomputePoints(t);
}
function distributed(t) {
    return Math.round(Object.values(t.points).reduce((a, b) => a + b, 0) * 100) / 100;
}
function overallRanking(t) {
    const wins = {}, losses = {};
    t.log.forEach(l => {
        if (l.stage === 'championBonus' || l.stage === 'adjust')
            return;
        const loser = l.winner === l.a ? l.b : l.a;
        wins[l.winner] = (wins[l.winner] || 0) + 1;
        if (loser)
            losses[loser] = (losses[loser] || 0) + 1;
    });
    return t.players.slice()
        .sort((x, y) => (t.points[y.id] || 0) - (t.points[x.id] || 0) || (wins[y.id] || 0) - (wins[x.id] || 0))
        .map(p => ({ id: p.id, name: p.name, pts: t.points[p.id] || 0, wins: wins[p.id] || 0, losses: losses[p.id] || 0 }));
}
/* ---------- Survival Rating (ELO) multi-tournois ---------- */
function ratings(tournaments) {
    const R = {};
    const BASE = 1000, K = 32;
    const get = (n) => { const k = n.toLowerCase(); if (R[k] === undefined)
        R[k] = BASE; return R[k]; };
    const matches = [];
    tournaments.forEach(t => t.log.forEach(l => {
        if (l.stage === 'adjust' || l.stage === 'championBonus')
            return;
        const loserId = l.winner === l.a ? l.b : l.a;
        if (!loserId)
            return;
        matches.push({ ts: l.ts || 0, w: playerName(t, l.winner), l: playerName(t, loserId) });
    }));
    matches.sort((a, b) => a.ts - b.ts);
    matches.forEach(m => {
        const rw = get(m.w), rl = get(m.l);
        const ew = 1 / (1 + Math.pow(10, (rl - rw) / 400));
        R[m.w.toLowerCase()] = rw + K * (1 - ew);
        R[m.l.toLowerCase()] = rl - K * (1 - ew);
    });
    Object.keys(R).forEach(k => R[k] = Math.round(R[k]));
    return R;
}
