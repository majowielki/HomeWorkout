import { nextTemplateId } from '../session/schedule';

const templates = [
  { id: 'fbw-a', sortOrder: 0 },
  { id: 'fbw-b', sortOrder: 1 },
];

describe('nextTemplateId', () => {
  it('starts with the first template when there is no history', () => {
    expect(nextTemplateId(templates, null)).toBe('fbw-a');
  });

  it('alternates forward', () => {
    expect(nextTemplateId(templates, 'fbw-a')).toBe('fbw-b');
  });

  it('wraps back to the first after the last', () => {
    expect(nextTemplateId(templates, 'fbw-b')).toBe('fbw-a');
  });

  it('falls back to the first template if the previous one no longer exists', () => {
    expect(nextTemplateId(templates, 'archived-template')).toBe('fbw-a');
  });

  it('returns null when there are no templates at all', () => {
    expect(nextTemplateId([], 'fbw-a')).toBeNull();
  });

  it('is independent of input order — sorts by sortOrder itself', () => {
    const reversed = [templates[1]!, templates[0]!];
    expect(nextTemplateId(reversed, 'fbw-a')).toBe('fbw-b');
  });

  it('handles a single template by repeating it', () => {
    const solo = [{ id: 'only', sortOrder: 0 }];
    expect(nextTemplateId(solo, 'only')).toBe('only');
  });
});
