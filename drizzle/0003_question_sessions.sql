CREATE TABLE "question_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"learner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "session_id" uuid;--> statement-breakpoint
-- 세션이 생기기 전의 질문은 학습자마다 한 대화로 묶는다.
INSERT INTO "question_sessions" ("id", "learner_id", "created_at")
SELECT gen_random_uuid(), "learner_id", min("asked_at") FROM "questions" GROUP BY "learner_id";--> statement-breakpoint
UPDATE "questions" SET "session_id" = "question_sessions"."id"
FROM "question_sessions" WHERE "question_sessions"."learner_id" = "questions"."learner_id";--> statement-breakpoint
ALTER TABLE "questions" ALTER COLUMN "session_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "question_sessions" ADD CONSTRAINT "question_sessions_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "question_sessions_learner_id_idx" ON "question_sessions" USING btree ("learner_id");--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_session_id_question_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."question_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "questions_session_id_idx" ON "questions" USING btree ("session_id");