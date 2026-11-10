import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { DIRECT_SOURCE } from "@/lib/source";

export const QUESTION_STATUSES = ["pending", "ok", "error"] as const;
export const MESSAGE_ROLES = ["user", "assistant"] as const;
export const QUIZ_FORMATS = ["mcq", "blank", "free"] as const;
export type QuizFormat = (typeof QUIZ_FORMATS)[number];
// 새 문제는 이 포맷으로만 낸다. 서술형은 채점이 엄격하고 느려서 내지 않지만, 이미 저장된 서술형 문제와 풀이는 그대로 읽는다.
export const ISSUED_QUIZ_FORMATS = ["mcq", "blank"] as const satisfies readonly QuizFormat[];
export const CONFIDENCES = ["sure", "unsure", "guess"] as const;
export const RECALL_REASONS = ["read_no_question", "asked", "quiz"] as const;

// format 컬럼이 어느 모양인지 정한다. DB는 내용을 검증하지 않으므로 저장 전에 서버가 검증한다.
export type QuizAnswer =
  | { choices: { text: string }[]; answerIndex: number }
  | { accepted: string[] }
  | { modelAnswer: string; keyPoints: string[] };

function oneOf(values: readonly string[]) {
  return sql.raw(values.map((value) => `'${value}'`).join(", "));
}

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
};

export const learner = pgTable("learners", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  consentedAt: timestamp("consented_at", { withTimezone: true }),
  examDate: date("exam_date"),
  source: text("source").default(DIRECT_SOURCE).notNull(),
  isTest: boolean("is_test").default(false).notNull(),
  ...timestamps,
});

export const account = pgTable(
  "account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerId: text("provider_id").notNull(),
    accountId: text("account_id").notNull(),
    userId: uuid("learner_id")
      .notNull()
      .references(() => learner.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("account_provider_account_idx").on(table.providerId, table.accountId),
    index("account_learner_id_idx").on(table.userId),
  ],
);

export const session = pgTable(
  "session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("learner_id")
      .notNull()
      .references(() => learner.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (table) => [index("session_learner_id_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

// 단원과 개념 ID는 한 번 넣으면 바꾸지 않는다. 바꾸면 기존 질문이 다른 단원과 개념을 가리킨다.
export const unit = pgTable("units", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
});

export const concept = pgTable("concepts", {
  id: text("id").primaryKey(),
  unitId: text("unit_id")
    .notNull()
    .references(() => unit.id),
  title: text("title").notNull(),
});

// 질문 창의 대화 하나다. 클라이언트가 ID를 만들고, 그 대화의 첫 질문을 저장할 때 함께 저장한다.
export const questionSession = pgTable(
  "question_sessions",
  {
    id: uuid("id").primaryKey(),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => learner.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("question_sessions_learner_id_idx").on(table.learnerId)],
);

// 질문 내역은 지우지 않으므로 학습자를 지워도 함께 지우지 않는다.
export const question = pgTable(
  "questions",
  {
    // 클라이언트가 만들어 보낸다. 같은 ID로 다시 오면 한 건만 남긴다.
    id: uuid("id").primaryKey(),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => learner.id),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => questionSession.id),
    unitId: text("unit_id").references(() => unit.id),
    askedAt: timestamp("asked_at", { withTimezone: true }).defaultNow().notNull(),
    studyDay: date("study_day").notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    status: text("status", { enum: QUESTION_STATUSES }).default("pending").notNull(),
    appVersion: text("app_version").notNull(),
    summary: text("summary"),
    keywords: text("keywords").array(),
    summarizedAt: timestamp("summarized_at", { withTimezone: true }),
  },
  (table) => [
    index("questions_learner_id_idx").on(table.learnerId),
    index("questions_session_id_idx").on(table.sessionId),
    check("questions_status_check", sql`${table.status} in (${oneOf(QUESTION_STATUSES)})`),
  ],
);

export const questionConcept = pgTable(
  "question_concepts",
  {
    questionId: uuid("question_id")
      .notNull()
      .references(() => question.id),
    conceptId: text("concept_id")
      .notNull()
      .references(() => concept.id),
  },
  (table) => [
    primaryKey({ columns: [table.questionId, table.conceptId] }),
    index("question_concepts_concept_id_idx").on(table.conceptId),
  ],
);

export const message = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => question.id),
    seq: integer("seq").notNull(),
    role: text("role", { enum: MESSAGE_ROLES }).notNull(),
    content: text("content").notNull(),
    // 본문에서 드래그해 물어본 문장이다. 학습자 메시지에만 있고, content에는 메뉴의 질문 문구가 들어간다.
    selectedText: text("selected_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("messages_question_seq_idx").on(table.questionId, table.seq),
    check("messages_seq_check", sql`${table.seq} >= 1`),
    check("messages_role_check", sql`${table.role} in (${oneOf(MESSAGE_ROLES)})`),
  ],
);

// learner_id가 비어 있으면 절마다 미리 만든 기본 문제다.
// 문제는 고치지 않는다. 오류가 있으면 retired_at을 채우고 새 행을 넣는다.
export const quizProblem = pgTable(
  "quiz_problems",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    learnerId: uuid("learner_id").references(() => learner.id),
    conceptId: text("concept_id")
      .notNull()
      .references(() => concept.id),
    sourceQuestionId: uuid("source_question_id").references(() => question.id),
    format: text("format", { enum: QUIZ_FORMATS }).notNull(),
    stem: text("stem").notNull(),
    answer: jsonb("answer").$type<QuizAnswer>().notNull(),
    hint: text("hint").notNull(),
    explanation: text("explanation").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
  },
  (table) => [
    index("quiz_problems_learner_id_idx").on(table.learnerId),
    index("quiz_problems_concept_id_idx").on(table.conceptId),
    check("quiz_problems_format_check", sql`${table.format} in (${oneOf(QUIZ_FORMATS)})`),
    check(
      "quiz_problems_source_question_check",
      sql`${table.sourceQuestionId} is null or ${table.learnerId} is not null`,
    ),
  ],
);

// 꺼내 보기 한 번이다. 상태는 시각 컬럼 중 채워진 마지막 것으로 계산한다.
export const recallSet = pgTable(
  "recall_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => learner.id),
    sourceStudyDay: date("source_study_day").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    shownAt: timestamp("shown_at", { withTimezone: true }),
    postponedAt: timestamp("postponed_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("recall_sets_learner_source_day_idx").on(table.learnerId, table.sourceStudyDay),
  ],
);

// 문항은 만든 뒤 고치지 않는다. 절은 문제의 concept_id로 구한다.
export const recallItem = pgTable(
  "recall_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    setId: uuid("set_id")
      .notNull()
      .references(() => recallSet.id),
    position: integer("position").notNull(),
    reason: text("reason", { enum: RECALL_REASONS }).notNull(),
    sourceQuestionId: uuid("source_question_id").references(() => question.id),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => quizProblem.id),
    openedSectionAt: timestamp("opened_section_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("recall_items_set_position_idx").on(table.setId, table.position),
    // quiz_attempts가 (recall_item_id, problem_id)로 참조할 수 있게 둔다.
    unique("recall_items_id_problem_id_unique").on(table.id, table.problemId),
    check("recall_items_position_check", sql`${table.position} >= 1`),
    check("recall_items_reason_check", sql`${table.reason} in (${oneOf(RECALL_REASONS)})`),
    check(
      "recall_items_source_question_check",
      sql`(${table.reason} = 'asked') = (${table.sourceQuestionId} is not null)`,
    ),
  ],
);

// recall_item_id가 비어 있으면 퀴즈 탭에서 푼 기록이다.
export const quizAttempt = pgTable(
  "quiz_attempts",
  {
    // 클라이언트가 만들어 보낸다. 같은 ID로 다시 오면 한 건만 남긴다.
    id: uuid("id").primaryKey(),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => learner.id),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => quizProblem.id),
    recallItemId: uuid("recall_item_id"),
    studyDay: date("study_day").notNull(),
    chosenIndex: integer("chosen_index"),
    answerText: text("answer_text"),
    reasonText: text("reason_text"),
    confidence: text("confidence", { enum: CONFIDENCES }).notNull(),
    hintUsed: boolean("hint_used").default(false).notNull(),
    // 서술형 AI 채점이 실패했을 때만 비어 있다.
    isCorrect: boolean("is_correct"),
    answeredAt: timestamp("answered_at", { withTimezone: true }).defaultNow().notNull(),
    appVersion: text("app_version").notNull(),
  },
  (table) => [
    index("quiz_attempts_learner_id_idx").on(table.learnerId),
    index("quiz_attempts_problem_id_idx").on(table.problemId),
    uniqueIndex("quiz_attempts_recall_item_id_idx").on(table.recallItemId),
    // 꺼내 보기 풀이는 출제 대상이 가리키는 문제와 같은 문제여야 한다. recall_item_id가 비면 검사하지 않는다.
    foreignKey({
      name: "quiz_attempts_recall_item_problem_fk",
      columns: [table.recallItemId, table.problemId],
      foreignColumns: [recallItem.id, recallItem.problemId],
    }),
    check("quiz_attempts_confidence_check", sql`${table.confidence} in (${oneOf(CONFIDENCES)})`),
  ],
);

// 본 절이다. 절 소제목이 화면 맨 위에 닿으면 기록하고, 절마다 하루 한 줄이다.
export const sectionView = pgTable(
  "section_views",
  {
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => learner.id),
    conceptId: text("concept_id")
      .notNull()
      .references(() => concept.id),
    studyDay: date("study_day").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    dwellSec: integer("dwell_sec").default(0).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.learnerId, table.conceptId, table.studyDay] }),
    check("section_views_dwell_sec_check", sql`${table.dwellSec} >= 0`),
  ],
);
