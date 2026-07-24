"use strict";
/* =========================================================
   @vlome/engine — Moteur de tournoi Survival Challonge (TS)
   Logique pure, sans dépendance : réutilisable web + API.
   Portage TypeScript du moteur éprouvé de Survival Challonge.
   ========================================================= */
Object.defineProperty(exports, "__esModule", { value: true });
exports.uid = uid;
exports.newTournament = newTournament;
exports.parseEntry = parseEntry;
exports.setPlayers = setPlayers;
exports.addPlayer = addPlayer;
exports.removePlayer = removePlayer;
exports.playerName = playerName;
exports.scoringBounds = scoringBounds;
exports.balancedSizes = balancedSizes;
exports.distributePools = distributePools;
exports.launch = launch;
exports.buildBracket = buildBracket;
exports.propagateBracket = propagateBracket;
exports.bracketChampion = bracketChampion;
exports.nextBracketMatch = nextBracketMatch;
exports.currentMatch = currentMatch;
exports.reportResult = reportResult;
exports.allPoolsDone = allPoolsDone;
exports.qualifiers = qualifiers;
exports.startFinals = startFinals;
exports.reportFinals = reportFinals;
exports.disqualifyPlayer = disqualifyPlayer;
exports.cagnotte = cagnotte;
exports.distributed = distributed;
exports.overallRanking = overallRanking;
exports.ratings = ratings;
const POOL_NAMES = 'ABCDEFGHIJKL'.split('');
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
        players: [],
        disqualified: [],
        scoring: cfg.scoring || { survWin: 1, loserWin: 0.5, poolFinalWin: 1.5, finalsWin: 2, championBonus: 3 },
        pools: [], status: 'setup', log: [], points: {}, finals: null, champion: null,
    };
}
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
function playerName(t, id) {
    const p = t.players.find(x => x.id === id);
    return p ? p.name : '?';
}
/* ---------- Barème (déplafonné) ---------- */
function scoringBounds(key) {
    return key === 'championBonus' ? { min: 0, max: 999 } : { min: 0.25, max: 999 };
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
        });
    }
    mixed.forEach((pid, i) => pools[i % nb].playerIds.push(pid));
    t.pools = pools;
}
function launch(t) {
    t.pools.forEach(p => {
        if (!p.order.length)
            p.order = shuffle(p.playerIds);
        initSurvival(p);
    });
    t.players.forEach(p => { t.points[p.id] = t.points[p.id] || 0; });
    t.status = 'live';
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
    const loserId = winnerId === m.a ? m.b : m.a;
    const pts = stagePoints(t, m.stage);
    award(t, winnerId, pts);
    t.log.push({ id: uid(), poolId, stage: m.stage, a: m.a, b: m.b, winner: winnerId, pts, ts: Date.now(), sa, sb, ...(reason ? { reason } : {}) });
    if (m.stage === 'survival') {
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
/* ---------- Phase finale (élimination directe) ---------- */
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
function startFinals(t) {
    t.finals = buildBracket(qualifiers(t));
}
function reportFinals(t, matchId, winnerId, sa = 0, sb = 0, reason) {
    if (!t.finals)
        return null;
    for (const round of t.finals.rounds) {
        const m = round.find(x => x.id === matchId);
        if (!m)
            continue;
        if (m.bye || m.winner || !m.a || !m.b)
            return null;
        if (sa || sb)
            winnerId = sa >= sb ? m.a : m.b;
        if (winnerId !== m.a && winnerId !== m.b)
            return null;
        m.winner = winnerId;
        const pts = t.scoring.finalsWin;
        award(t, winnerId, pts);
        t.log.push({ id: uid(), poolId: 'finals', stage: 'finals', a: m.a, b: m.b, winner: winnerId, pts, ts: Date.now(), sa, sb, ...(reason ? { reason } : {}) });
        propagateBracket(t.finals);
        const champ = bracketChampion(t.finals);
        if (champ) {
            t.champion = champ;
            award(t, champ, t.scoring.championBonus);
            t.log.push({ id: uid(), poolId: 'finals', stage: 'championBonus', a: champ, b: null, winner: champ, pts: t.scoring.championBonus, ts: Date.now() });
            t.status = 'finished';
            t.finishedAt = Date.now();
        }
        return { winnerId, pts };
    }
    return null;
}
/* ---------- Disqualification (en direct) ---------- */
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
        if (t.finals) {
            const nm = nextBracketMatch(t.finals);
            if (nm && (nm.match.a === playerId || nm.match.b === playerId)) {
                const winner = (nm.match.a === playerId ? nm.match.b : nm.match.a);
                reportFinals(t, nm.match.id, winner, 0, 0, 'forfeit');
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
function cagnotte(t) {
    const total = t.players.length * t.pointsPerPlayer;
    const s = t.scoring;
    let surv = 0, los = 0, pf = 0;
    const sizes = t.pools.length ? t.pools.map(p => p.playerIds.length) : balancedSizes(t.players.length, t.nbPools);
    sizes.forEach(n => { if (n >= 2) {
        surv += n - 1;
        los += Math.max(0, n - 2);
        pf += 1;
    } });
    const q = sizes.filter(n => n >= 2).length * 2 + sizes.filter(n => n === 1).length;
    const finalsMatches = Math.max(0, q - 1);
    const programmed = Math.round((surv * s.survWin + los * s.loserWin + pf * s.poolFinalWin + finalsMatches * s.finalsWin + s.championBonus) * 100) / 100;
    return { total, programmed, gap: Math.round((total - programmed) * 100) / 100, valid: programmed <= total };
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
