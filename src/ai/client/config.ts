export interface CoachConfig {
  /** No trailing slash. */
  baseUrl: string;
  secret: string;
}

/** Hosts where plain http is acceptable: the emulator's view of the host machine, and loopback. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '10.0.2.2', '[::1]']);

/**
 * Turns the two build-time settings into a usable config, or null.
 *
 * The secret travels in a header on every call, so a remote server must be
 * reached over https; plain http is allowed only to a machine you are
 * sitting next to, for development. A URL that fails either rule is the
 * same as no URL: the feature reports itself as not configured instead of
 * sending a secret somewhere it could be read.
 */
export function normalizeCoachConfig(input: {
  url: string | undefined;
  secret: string | undefined;
}): CoachConfig | null {
  const raw = input.url?.trim();
  const secret = input.secret?.trim();
  if (!raw || !secret) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol === 'http:' ? !LOCAL_HOSTS.has(url.hostname) : url.protocol !== 'https:') {
    return null;
  }
  return { baseUrl: `${url.origin}${url.pathname.replace(/\/+$/, '')}`, secret };
}
