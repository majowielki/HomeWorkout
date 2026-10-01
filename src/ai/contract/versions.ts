/**
 * Version of the request / response shapes shared by the app and the
 * Worker. Both sides send it and check it, so a Worker deployed ahead of an
 * old app (or the other way round) fails with a typed "update the app"
 * error instead of a Zod issue list. Bump it for any change a peer running
 * the previous version cannot parse. See Documents/AI-INTEGRACJA.md §4.4.
 */
export const CONTRACT_VERSION = 1;
