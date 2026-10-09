import { compileInput, exposure, set } from '@/domain/__tests__/compileFixtures';
import { compileSession, type ExposureSpec, type SetSpec } from '@/domain/plan/compile';
import { buildSessionSteps } from '@/domain/session/progress';

export function loggerStep(recipe: Partial<ExposureSpec> = {}, target: Partial<SetSpec> = {}) {
  return buildSessionSteps(
    compileSession(
      compileInput([
        exposure('a', {
          ...recipe,
          sets: [set(target), set(target)],
        }),
      ]),
    ),
    new Map(),
  )[0]!;
}
