ALTER TABLE "quiz_attempts" DROP CONSTRAINT "quiz_attempts_grading_check";--> statement-breakpoint
ALTER TABLE "quiz_attempts" DROP CONSTRAINT "quiz_attempts_dont_know_check";--> statement-breakpoint
UPDATE "quiz_attempts" SET "is_correct" = ("grading" = 'correct') WHERE "grading" IS NOT NULL;--> statement-breakpoint
UPDATE "quiz_attempts" SET "confidence" = 'guess', "is_correct" = false WHERE "dont_know";--> statement-breakpoint
UPDATE "quiz_problems" SET "stem" = "stem" || E'\n\n```\n' || "code" || E'\n```' WHERE "code" IS NOT NULL AND "code" <> '';--> statement-breakpoint
ALTER TABLE "quiz_attempts" ALTER COLUMN "confidence" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz_attempts" DROP COLUMN "dont_know";--> statement-breakpoint
ALTER TABLE "quiz_attempts" DROP COLUMN "grading";--> statement-breakpoint
ALTER TABLE "quiz_attempts" DROP COLUMN "grading_reason";--> statement-breakpoint
ALTER TABLE "quiz_problems" DROP COLUMN "code";
