import {
  avoidNeedsClarification,
  notePrescribes,
  type RelativeRequest,
  requestFits,
  sorenessBlocksExtraWork,
  STRONG_DOMS_LEVEL,
  statesStrongDoms,
} from '../coach/intentGuards';

const avoid: RelativeRequest = {
  kind: 'avoid_muscle',
  muscles: ['quads'],
  fromDaysAhead: 0,
  days: 2,
  reason: 'doms',
  domsLevel: STRONG_DOMS_LEVEL,
};

describe('coach intent guards', () => {
  it.each([
    ['Weź 10 kg w następnej sesji.', true],
    ['Dwa kilogramy więcej', true],
    ['RIR 2 na koniec', true],
    ['Zrób 12 powtórzeń', true],
    ['Jedna seria mniej', true],
    ['Czerwona guma', true],
    ['Lżejsze hantle', true],
    ['Prośba o dzień wolny.', false],
    ['Silne zakwasy nóg.', false],
  ])('a request note that names a load is refused: %s', (note, expected) => {
    expect(notePrescribes(note)).toBe(expected);
  });

  it.each([
    ['Mam silne zakwasy nóg 4/5.', true],
    ['Mocne DOMS w łydkach', true],
    ['Zakwasy 5/5, nie da się chodzić po schodach', true],
    ['Mam lekkie zakwasy nóg.', false],
    ['Mam zakwasy nóg.', false],
    ['Mam zakwasy nóg 2/5.', false],
    ['Zakwasy nie silne, ale są', false],
    ['Mam silny ból mięśni 4/5.', false],
    ['Mam silny ból mięśni 4/5, to nie zakwasy.', false],
  ])('strong DOMS must be stated by the person: %s', (question, expected) => {
    expect(statesStrongDoms(question)).toBe(expected);
  });

  it.each([
    ['Mam silne zakwasy nóg 4/5. Daj dodatkowy trening nóg.', true],
    ['Mam zakwasy nóg. Daj dodatkowy trening.', true],
    ['Mam lekkie zakwasy nóg, daj dodatkowy trening rąk.', false],
    ['Chcę dodatkowy trening klatki.', false],
  ])('soreness of strong or unknown strength blocks extra work: %s', (question, expected) => {
    expect(sorenessBlocksExtraWork(question)).toBe(expected);
  });

  it('keeps a request inside the planned days, with muscles only for leaving muscles out', () => {
    expect(requestFits(avoid, 7)).toBe(true);
    expect(requestFits({ ...avoid, fromDaysAhead: 5, days: 3 }, 7)).toBe(false);
    expect(requestFits({ ...avoid, muscles: [] }, 7)).toBe(false);
    expect(requestFits({ ...avoid, kind: 'rest_day', muscles: [] }, 7)).toBe(true);
    expect(requestFits({ ...avoid, kind: 'lighter_day' }, 7)).toBe(false);
  });

  it('asks again unless the person stated strong DOMS and the model rated it strong', () => {
    const strong = 'Mam silne zakwasy nóg 4/5. Pomiń nogi.';
    expect(avoidNeedsClarification(avoid, strong)).toBe(false);
    expect(avoidNeedsClarification({ ...avoid, domsLevel: 3 }, strong)).toBe(true);
    expect(avoidNeedsClarification({ ...avoid, domsLevel: undefined }, strong)).toBe(true);
    expect(avoidNeedsClarification(avoid, 'Mam lekkie zakwasy nóg.')).toBe(true);
    // Soreness in the question cannot be relabelled as another reason.
    expect(avoidNeedsClarification({ ...avoid, reason: 'other' }, 'Mam zakwasy nóg.')).toBe(true);
    // A preference with no soreness in the words is not a soreness request.
    expect(
      avoidNeedsClarification({ ...avoid, reason: 'other' }, 'Nie lubię dziś nóg, pomiń je.'),
    ).toBe(false);
    expect(avoidNeedsClarification({ ...avoid, kind: 'rest_day', muscles: [] }, strong)).toBe(
      false,
    );
  });
});
