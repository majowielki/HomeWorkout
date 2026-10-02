import * as reasons from '../plan/reasons';

describe('reason code lists', () => {
  const lists: [string, readonly string[]][] = Object.entries(reasons).flatMap(([name, value]) =>
    Array.isArray(value) ? [[name, value as readonly string[]] as [string, readonly string[]]] : [],
  );

  it('exist', () => {
    expect(lists.length).toBeGreaterThan(0);
  });

  it.each(lists)('%s has no duplicates and only SCREAMING_CASE codes', (_, codes) => {
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/);
  });
});
