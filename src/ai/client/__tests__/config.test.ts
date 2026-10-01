import { normalizeCoachConfig } from '../config';

const config = (url: string | undefined, secret: string | undefined = 's3cret') =>
  normalizeCoachConfig({ url, secret });

describe('normalizeCoachConfig', () => {
  it('accepts an https URL and keeps its origin and path', () => {
    expect(config('https://coach.example.workers.dev')).toEqual({
      baseUrl: 'https://coach.example.workers.dev',
      secret: 's3cret',
    });
  });

  it('drops trailing slashes and surrounding spaces', () => {
    expect(config('  https://coach.example.dev/api//  ')?.baseUrl).toBe(
      'https://coach.example.dev/api',
    );
    expect(config('https://coach.example.dev/')?.baseUrl).toBe('https://coach.example.dev');
    expect(config('https://coach.example.dev', '  padded  ')?.secret).toBe('padded');
  });

  it.each([
    'http://localhost:8787',
    'http://127.0.0.1:8787',
    'http://10.0.2.2:8787',
    'http://[::1]:8787',
  ])('allows plain http to a machine you are sitting next to: %s', (url) => {
    expect(config(url)).not.toBeNull();
  });

  it.each([
    'http://coach.example.dev',
    'http://192.168.1.20:8787',
    'ftp://coach.example.dev',
    'coach.example.dev',
    'not a url',
    '',
  ])('refuses a URL that would put the secret on a readable wire: %j', (url) => {
    expect(config(url)).toBeNull();
  });

  it('is null when either setting is missing or blank', () => {
    expect(config(undefined)).toBeNull();
    expect(
      normalizeCoachConfig({ url: 'https://coach.example.dev', secret: undefined }),
    ).toBeNull();
    expect(config('https://coach.example.dev', '   ')).toBeNull();
  });
});
