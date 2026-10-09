/**
 * The answers to the questions a prescription asks (engine, 13 §12, P5.4).
 *
 * "Ostatnie dwa treningi bez zmian w podpowiedziach. Podnosimy do 6 kg?" — [Tak] / [Jeszcze nie].
 * The answer is a command with a `commandId`, like a set: a lost reply and a second tap write once.
 * It is given about the newest exposure of the key; once a newer one exists the answer no longer
 * applies, so a "yes" cannot go on approving every later step up.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { CommandResult } from '@/domain/commands/result';
import { compareCodePoints } from '@/domain/fingerprint';
import type { IsoDate } from '@/domain/observations/date';
import type { ExposureRecord } from '@/domain/observations/exposure';
import { type Executor, type Tx } from '../client';
import { prescriptionAnswers, workouts } from '../schema';
import { readNormalizedHistory } from './history';
import { bumpRevision, recordCommand } from './ledger';
import { sessionCommandStore } from './sessions';

export type PrescriptionAnswers = Record<
  string,
  { stepUp?: 'yes' | 'no'; variantDownDeferredAt?: IsoDate }
>;

/** The newest primary exposure of each comparison key. */
export function newestExposures(records: readonly ExposureRecord[]): Map<string, ExposureRecord> {
  const newest = new Map<string, ExposureRecord>();
  for (const r of records) {
    if (r.progressionScope !== 'primary') continue;
    const known = newest.get(r.comparisonKey);
    if (
      known === undefined ||
      compareCodePoints(
        `${known.trainingDate}|${known.exposureId}`,
        `${r.trainingDate}|${r.exposureId}`,
      ) < 0
    )
      newest.set(r.comparisonKey, r);
  }
  return newest;
}

/** The answers that still apply, in the shape the planner reads. */
export function readAnswers(tx: Executor, records: readonly ExposureRecord[]): PrescriptionAnswers {
  const newest = newestExposures(records);
  const out: PrescriptionAnswers = {};
  for (const row of tx.select().from(prescriptionAnswers).all()) {
    const entry = (out[row.comparisonKey] ??= {});
    if (row.kind === 'step_up') {
      if (newest.get(row.comparisonKey)?.exposureId === row.afterExposureId)
        entry.stepUp = row.answer;
    } else if (row.answer === 'no') {
      entry.variantDownDeferredAt = row.answeredOn;
    }
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => Object.keys(v).length > 0));
}

export interface AnswerPrescriptionCommand {
  commandId: string;
  comparisonKey: string;
  kind: 'step_up' | 'variant_down';
  answer: 'yes' | 'no';
  /** The newest exposure of the key the question was shown after; a newer one makes the question stale. */
  afterExposureId: string;
  /** The training day of the answer. */
  on: IsoDate;
}

export function answerPrescription(
  cmd: AnswerPrescriptionCommand,
  now: Date = new Date(),
): CommandResult<{ stored: true }> {
  return sessionCommandStore.transact(cmd.commandId, (tx: Tx) => {
    const again = sessionCommandStore.replay<{ stored: true }>(tx, cmd.commandId);
    if (again) return again;
    if (cmd.comparisonKey === '' || cmd.afterExposureId === '' || cmd.on === '') {
      return {
        kind: 'rejected',
        code: 'INVALID_COMMAND',
        detail: 'the answer says what it is about',
      };
    }
    if (cmd.kind === 'step_up') {
      // A step up is answered about the exposure it was asked after; a newer one makes the question stale.
      const history = readNormalizedHistory(
        tx,
        tx.select().from(workouts).orderBy(asc(workouts.trainingDate), asc(workouts.id)).all(),
      );
      if (
        newestExposures(history.records).get(cmd.comparisonKey)?.exposureId !== cmd.afterExposureId
      ) {
        return { kind: 'conflict', code: 'STALE_INPUT', actualRevision: null };
      }
    }
    const where = and(
      eq(prescriptionAnswers.comparisonKey, cmd.comparisonKey),
      eq(prescriptionAnswers.kind, cmd.kind),
    );
    const row = tx.select().from(prescriptionAnswers).where(where).get();
    const values = {
      answer: cmd.answer,
      afterExposureId: cmd.afterExposureId,
      answeredOn: cmd.on,
      commandId: cmd.commandId,
      answeredAt: now.toISOString(),
    };
    if (row === undefined) {
      tx.insert(prescriptionAnswers)
        .values({ comparisonKey: cmd.comparisonKey, kind: cmd.kind, ...values })
        .run();
    } else {
      tx.update(prescriptionAnswers).set(values).where(where).run();
    }
    // What the next prescription is made from has changed: a preview made before is out of date.
    const revision = bumpRevision(tx, 'history');
    recordCommand(
      tx,
      {
        commandId: cmd.commandId,
        kind: 'answer_prescription',
        workoutId: null,
        result: { result: { stored: true }, sessionRevision: revision },
      },
      now,
    );
    return { kind: 'committed', result: { stored: true }, sessionRevision: revision };
  });
}
