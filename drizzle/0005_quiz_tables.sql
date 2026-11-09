CREATE TABLE "quiz_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"learner_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"recall_item_id" uuid,
	"study_day" date NOT NULL,
	"chosen_index" integer,
	"answer_text" text,
	"reason_text" text,
	"dont_know" boolean DEFAULT false NOT NULL,
	"confidence" text,
	"hint_used" boolean DEFAULT false NOT NULL,
	"is_correct" boolean,
	"grading" text,
	"grading_reason" text,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"app_version" text NOT NULL,
	CONSTRAINT "quiz_attempts_confidence_check" CHECK ("quiz_attempts"."confidence" in ('sure', 'unsure', 'guess')),
	CONSTRAINT "quiz_attempts_grading_check" CHECK ("quiz_attempts"."grading" in ('correct', 'partial', 'wrong')),
	CONSTRAINT "quiz_attempts_dont_know_check" CHECK (not "quiz_attempts"."dont_know" or ("quiz_attempts"."reason_text" is null and "quiz_attempts"."confidence" is null))
);
--> statement-breakpoint
CREATE TABLE "quiz_problems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid,
	"concept_id" text NOT NULL,
	"source_question_id" uuid,
	"format" text NOT NULL,
	"stem" text NOT NULL,
	"code" text,
	"answer" jsonb NOT NULL,
	"hint" text NOT NULL,
	"explanation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "quiz_problems_format_check" CHECK ("quiz_problems"."format" in ('mcq', 'blank', 'free')),
	CONSTRAINT "quiz_problems_source_question_check" CHECK ("quiz_problems"."source_question_id" is null or "quiz_problems"."learner_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "recall_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"reason" text NOT NULL,
	"source_question_id" uuid,
	"problem_id" uuid NOT NULL,
	"opened_section_at" timestamp with time zone,
	CONSTRAINT "recall_items_id_problem_id_unique" UNIQUE("id","problem_id"),
	CONSTRAINT "recall_items_position_check" CHECK ("recall_items"."position" >= 1),
	CONSTRAINT "recall_items_reason_check" CHECK ("recall_items"."reason" in ('read_no_question', 'asked', 'quiz')),
	CONSTRAINT "recall_items_source_question_check" CHECK (("recall_items"."reason" = 'asked') = ("recall_items"."source_question_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "recall_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"source_study_day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"shown_at" timestamp with time zone,
	"postponed_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "section_views" (
	"learner_id" uuid NOT NULL,
	"concept_id" text NOT NULL,
	"study_day" date NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dwell_sec" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "section_views_learner_id_concept_id_study_day_pk" PRIMARY KEY("learner_id","concept_id","study_day"),
	CONSTRAINT "section_views_dwell_sec_check" CHECK ("section_views"."dwell_sec" >= 0)
);
--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_problem_id_quiz_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."quiz_problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_recall_item_problem_fk" FOREIGN KEY ("recall_item_id","problem_id") REFERENCES "public"."recall_items"("id","problem_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_problems" ADD CONSTRAINT "quiz_problems_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_problems" ADD CONSTRAINT "quiz_problems_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_problems" ADD CONSTRAINT "quiz_problems_source_question_id_questions_id_fk" FOREIGN KEY ("source_question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_items" ADD CONSTRAINT "recall_items_set_id_recall_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."recall_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_items" ADD CONSTRAINT "recall_items_source_question_id_questions_id_fk" FOREIGN KEY ("source_question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_items" ADD CONSTRAINT "recall_items_problem_id_quiz_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."quiz_problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_sets" ADD CONSTRAINT "recall_sets_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_views" ADD CONSTRAINT "section_views_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_views" ADD CONSTRAINT "section_views_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quiz_attempts_learner_id_idx" ON "quiz_attempts" USING btree ("learner_id");--> statement-breakpoint
CREATE INDEX "quiz_attempts_problem_id_idx" ON "quiz_attempts" USING btree ("problem_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_attempts_recall_item_id_idx" ON "quiz_attempts" USING btree ("recall_item_id");--> statement-breakpoint
CREATE INDEX "quiz_problems_learner_id_idx" ON "quiz_problems" USING btree ("learner_id");--> statement-breakpoint
CREATE INDEX "quiz_problems_concept_id_idx" ON "quiz_problems" USING btree ("concept_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recall_items_set_position_idx" ON "recall_items" USING btree ("set_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "recall_sets_learner_source_day_idx" ON "recall_sets" USING btree ("learner_id","source_study_day");