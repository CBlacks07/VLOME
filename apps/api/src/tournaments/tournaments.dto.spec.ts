/** Verrouille les limites de longueur des champs texte libres (name/game/place/date) — ajoutées après
 *  avoir constaté que `game`, `place` et `date` n'en avaient aucune, contrairement à tous les autres
 *  champs texte du DTO (name/imageUrl/rules/prize). Sans borne, un champ libre peut recevoir un texte
 *  de n'importe quelle taille (requête volumineuse, affichage cassé…). */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTournamentDto, UpdateTournamentDto } from './tournaments.dto';

describe('CreateTournamentDto — limites de longueur', () => {
  const base = { name: 'Survival Cup' };

  it.each([
    ['game', 121],
    ['place', 161],
    ['date', 41],
  ])('rejette %s au-delà de sa limite', async (field, overLength) => {
    const dto = plainToInstance(CreateTournamentDto, { ...base, [field]: 'x'.repeat(overLength) });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === field)).toBe(true);
  });

  it.each([
    ['game', 120],
    ['place', 160],
    ['date', 40],
  ])('accepte %s pile à sa limite', async (field, exactLength) => {
    const dto = plainToInstance(CreateTournamentDto, { ...base, [field]: 'x'.repeat(exactLength) });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === field)).toBe(false);
  });

  it('rejette un nom vide ou trop long', async () => {
    const tooLong = plainToInstance(CreateTournamentDto, { name: 'x'.repeat(121) });
    expect((await validate(tooLong)).some((e) => e.property === 'name')).toBe(true);
  });
});

describe('UpdateTournamentDto — mêmes limites sur le chemin de modification', () => {
  it.each([
    ['game', 121],
    ['place', 161],
    ['date', 41],
  ])('rejette %s au-delà de sa limite', async (field, overLength) => {
    const dto = plainToInstance(UpdateTournamentDto, { [field]: 'x'.repeat(overLength) });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === field)).toBe(true);
  });
});
