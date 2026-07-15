import { Controller, Get } from '@nestjs/common';
import * as Engine from '@vlome/engine';

@Controller()
export class HealthController {
  @Get('health')
  health() {
    return { status: 'ok', service: 'vlome-api', ts: Date.now() };
  }

  // Démo : le moteur de tournoi (@vlome/engine) tourne côté serveur.
  @Get('engine/demo')
  engineDemo() {
    const t = Engine.newTournament({ name: 'Démo Survival', game: 'EA FC 26', nbPools: 2 });
    Engine.setPlayers(t, ['K9', 'Prince', 'Nadia', 'Sena', 'Ayi', 'Koffi']);
    Engine.distributePools(t);
    t.pools.forEach((p) => (p.order = p.playerIds.slice()));
    Engine.launch(t);
    // joue toutes les poules (le survivant en tête gagne) puis la finale
    let guard = 0;
    while (!Engine.allPoolsDone(t) && guard++ < 300) {
      for (const pool of t.pools) {
        const m = Engine.currentMatch(pool);
        if (m) {
          Engine.reportResult(t, pool.id, m.a);
          break;
        }
      }
    }
    Engine.startFinals(t);
    guard = 0;
    while (t.status !== 'finished' && guard++ < 60) {
      let acted = false;
      for (const round of t.finals!.rounds) {
        for (const m of round) {
          if (m.a && m.b && !m.winner && !m.bye) {
            Engine.reportFinals(t, m.id, m.a);
            acted = true;
          }
        }
      }
      if (!acted) break;
    }
    return {
      tournament: t.name,
      champion: t.champion ? Engine.playerName(t, t.champion) : null,
      standings: Engine.overallRanking(t).map((r) => ({ name: r.name, pts: r.pts, wins: r.wins, losses: r.losses })),
      cagnotte: Engine.cagnotte(t),
    };
  }
}
