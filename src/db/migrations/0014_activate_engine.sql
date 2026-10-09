-- Preserve titles of historical template sessions before removing the template catalogue.
UPDATE workouts SET plan = json_object('regions', json('[]'), 'title',
  (SELECT name FROM workout_templates WHERE id = workouts.template_id))
WHERE plan IS NULL AND template_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM workout_templates WHERE id = workouts.template_id);
--> statement-breakpoint
-- Historical sessions cannot be resumed by the current runner. All sets stay in history.
UPDATE workouts SET status = 'abandoned', finished_at = COALESCE(finished_at, started_at)
WHERE plan_schema = 1 AND status = 'in_progress';
--> statement-breakpoint
-- Rebuild the parent without its template FK. The migrator runs in a transaction
-- with foreign keys enabled, so retain every cascading child before dropping it.
CREATE TEMP TABLE p6_set_logs AS SELECT * FROM set_logs;
--> statement-breakpoint
CREATE TEMP TABLE p6_set_log_revisions AS SELECT * FROM set_log_revisions;
--> statement-breakpoint
CREATE TEMP TABLE p6_set_dispositions AS SELECT * FROM set_dispositions;
--> statement-breakpoint
CREATE TEMP TABLE p6_exposure_outcomes AS SELECT * FROM exposure_outcomes;
--> statement-breakpoint
CREATE TEMP TABLE p6_session_plan_revisions AS SELECT * FROM session_plan_revisions;
--> statement-breakpoint
CREATE TEMP TABLE p6_feel_reports AS SELECT * FROM feel_reports;
--> statement-breakpoint
CREATE TEMP TABLE p6_cardio_logs AS SELECT * FROM cardio_logs;
--> statement-breakpoint
DROP TABLE planned_days;
--> statement-breakpoint
CREATE TABLE p6_workouts (
  id text PRIMARY KEY NOT NULL,
  training_date text NOT NULL,
  started_at text NOT NULL,
  finished_at text,
  status text NOT NULL,
  session_rpe integer,
  notes text,
  plan text,
  plan_schema integer DEFAULT 1 NOT NULL,
  session_plan text,
  plan_revision integer DEFAULT 1 NOT NULL,
  revision integer DEFAULT 0 NOT NULL,
  time_zone text
);
--> statement-breakpoint
INSERT INTO p6_workouts SELECT id, training_date, started_at, finished_at, status,
  session_rpe, notes, plan, plan_schema, plan_v2, plan_revision, revision, time_zone FROM workouts;
--> statement-breakpoint
DROP TABLE workouts;
--> statement-breakpoint
ALTER TABLE p6_workouts RENAME TO workouts;
--> statement-breakpoint
CREATE INDEX workouts_date_idx ON workouts (training_date);
--> statement-breakpoint
CREATE INDEX workouts_status_idx ON workouts (status);
--> statement-breakpoint
-- With FK enforcement off, DROP leaves children intact; replace them in either mode.
DELETE FROM set_logs;
--> statement-breakpoint
DELETE FROM set_log_revisions;
--> statement-breakpoint
DELETE FROM set_dispositions;
--> statement-breakpoint
DELETE FROM exposure_outcomes;
--> statement-breakpoint
DELETE FROM session_plan_revisions;
--> statement-breakpoint
DELETE FROM feel_reports;
--> statement-breakpoint
DELETE FROM cardio_logs;
--> statement-breakpoint
INSERT INTO set_logs SELECT * FROM p6_set_logs;
--> statement-breakpoint
INSERT INTO set_log_revisions SELECT * FROM p6_set_log_revisions;
--> statement-breakpoint
INSERT INTO set_dispositions SELECT * FROM p6_set_dispositions;
--> statement-breakpoint
INSERT INTO exposure_outcomes SELECT * FROM p6_exposure_outcomes;
--> statement-breakpoint
INSERT INTO session_plan_revisions SELECT * FROM p6_session_plan_revisions;
--> statement-breakpoint
INSERT INTO feel_reports SELECT * FROM p6_feel_reports;
--> statement-breakpoint
INSERT INTO cardio_logs SELECT * FROM p6_cardio_logs;
--> statement-breakpoint
DROP TABLE p6_set_logs;
--> statement-breakpoint
DROP TABLE p6_set_log_revisions;
--> statement-breakpoint
DROP TABLE p6_set_dispositions;
--> statement-breakpoint
DROP TABLE p6_exposure_outcomes;
--> statement-breakpoint
DROP TABLE p6_session_plan_revisions;
--> statement-breakpoint
DROP TABLE p6_feel_reports;
--> statement-breakpoint
DROP TABLE p6_cardio_logs;
--> statement-breakpoint
DROP TABLE workout_templates;
--> statement-breakpoint
DROP TABLE plan_generations;
--> statement-breakpoint
DROP TABLE app_state;
--> statement-breakpoint
ALTER TABLE planned_days_v2 RENAME TO planned_days;
--> statement-breakpoint
ALTER TABLE plan_generations_v2 RENAME TO plan_generations;
--> statement-breakpoint
DROP INDEX plan_generations_v2_created_idx;
--> statement-breakpoint
CREATE INDEX plan_generations_created_idx ON plan_generations (created_at);
