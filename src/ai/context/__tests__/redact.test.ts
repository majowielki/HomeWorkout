import { cleanText, redactNotes, type RawNote } from '../redact';

const note = (text: string, date = '2026-09-30'): RawNote => ({ date, source: 'daily', text });

describe('cleanText', () => {
  it('collapses whitespace and trims', () => {
    expect(cleanText('  dobry \n\n trening\t ')).toBe('dobry trening');
  });

  it('removes invisible and bidirectional control characters', () => {
    const zeroWidth = String.fromCharCode(0x200b);
    const rtlOverride = String.fromCharCode(0x202e);
    const bom = String.fromCharCode(0xfeff);
    expect(cleanText(`ig${zeroWidth}nore${rtlOverride} this${bom}`)).toBe('ignore this');
  });

  it('turns control characters into spaces', () => {
    expect(cleanText('a\u0000b\u007fc')).toBe('a b c');
  });
});

describe('redactNotes', () => {
  it('keeps an ordinary note and a soreness note', () => {
    const { kept, omissions } = redactNotes([note('dobry trening'), note('zakwasy w udach')]);
    expect(kept.map((n) => n.text)).toEqual(['dobry trening', 'zakwasy w udach']);
    expect(omissions).toEqual({ medicalNotes: 0, outOfScopeNotes: 0 });
  });

  it('withholds and counts injury notes', () => {
    const { kept, omissions } = redactNotes([
      note('kolano strzyka przy schodzeniu'),
      note('boli mnie bark'),
      note('wszystko ok'),
    ]);
    expect(kept.map((n) => n.text)).toEqual(['wszystko ok']);
    expect(omissions).toEqual({ medicalNotes: 2, outOfScopeNotes: 0 });
  });

  it('withholds and counts notes about diet or medication', () => {
    const { kept, omissions } = redactNotes([
      note('ile kalorii dziś'),
      note('zwiększyłem dawkę'),
      note('rower 20 min'),
    ]);
    expect(kept.map((n) => n.text)).toEqual(['rower 20 min']);
    expect(omissions).toEqual({ medicalNotes: 0, outOfScopeNotes: 2 });
  });

  it('judges a note before shortening it', () => {
    // The injury word sits past the cut-off; truncating first would hide it.
    const text = `${'spokojny dzień '.repeat(25)}a potem kolano strzyka`;
    const { kept, omissions } = redactNotes([note(text)]);
    expect(kept).toEqual([]);
    expect(omissions.medicalNotes).toBe(1);
  });

  it('shortens a long note to the cap, ending in an ellipsis', () => {
    const { kept } = redactNotes([note('dobry trening '.repeat(40))]);
    expect(kept[0]!.text.length).toBeLessThanOrEqual(280);
    expect(kept[0]!.text.endsWith('…')).toBe(true);
  });

  it('never cuts inside a surrogate pair', () => {
    const { kept } = redactNotes([note('💪'.repeat(300))]);
    const text = kept[0]!.text;
    expect(text.length).toBeLessThanOrEqual(280);
    expect(text.slice(0, -1)).toMatch(/^(?:💪)+$/u);
  });

  it('leaves a note at exactly the cap alone', () => {
    const text = 'a'.repeat(280);
    expect(redactNotes([note(text)]).kept[0]!.text).toBe(text);
  });

  it('drops notes that are empty once cleaned', () => {
    const invisible = String.fromCharCode(0x200b, 0x200b);
    const { kept, omissions } = redactNotes([note('   '), note(invisible)]);
    expect(kept).toEqual([]);
    expect(omissions).toEqual({ medicalNotes: 0, outOfScopeNotes: 0 });
  });

  it('keeps the newest notes when there are too many, oldest first', () => {
    const notes = Array.from({ length: 11 }, (_, i) =>
      note(`wpis ${i}`, `2026-09-${String(10 + i).padStart(2, '0')}`),
    );
    const { kept } = redactNotes(notes);
    expect(kept).toHaveLength(8);
    expect(kept[0]!.text).toBe('wpis 3');
    expect(kept[7]!.text).toBe('wpis 10');
  });

  it('does not let withheld notes use up the quota', () => {
    const notes = [
      ...Array.from({ length: 8 }, (_, i) => note(`wpis ${i}`, `2026-09-0${i + 1}`)),
      note('kolano strzyka', '2026-09-20'),
    ];
    expect(redactNotes(notes).kept).toHaveLength(8);
  });
});
