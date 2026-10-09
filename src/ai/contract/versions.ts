/**
 * Version of the request / response shapes shared by the app and the
 * Worker. Both sides send it and check it, so a Worker deployed ahead of an
 * old app (or the other way round) fails with a typed "update the app"
 * error instead of a Zod issue list. Bump it for any change a peer running
 * the previous version cannot parse. See Documents/AI-INTEGRACJA.md §4.4.
 *
 * 2 (M7): the chat tool getPlanExplanation and the tool error no_plan.
 * 3 (E7): week reads and plan proposals that require local acceptance.
 * 4 (ADR 0006): composing days from the engine options (getDayOptions, proposeDayPlan),
 *   `composed` on a day summary, the tool error day_done.
 * 5 (voice): `POST /v1/voice-intent`, the fallback for a spoken command the phone did not understand.
 * 6 (shortfall): reported reasons on historical sets and per-exercise counts in recent sessions.
 * 7 (engine): the tools that consult the running session (getActiveSession, assessSessionChange,
 *   proposeSessionChange), the tool errors no_active_session and stale_assessment, and the decision
 *   codes of the engine among the reasons of a prescription.
 */
export const CONTRACT_VERSION = 7;
