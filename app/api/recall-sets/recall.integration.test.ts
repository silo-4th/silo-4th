import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as submitAttempt } from "@/app/api/quiz-attempts/route";
import { POST as openSection } from "@/app/api/recall-items/[itemId]/opened-section/route";
import { POST as recordEvent } from "@/app/api/recall-sets/[setId]/events/route";
import { POST as showToday } from "@/app/api/recall-sets/today/route";
import { deleteCreatedLearners, learnerWithEmail, loginWithGoogle, newProfile } from "@/lib/auth/google-login.testing";
import { getDb } from "@/lib/db";
import {
  concept,
  learner,
  type QuizAnswer,
  quizAttempt,
  quizProblem,
  recallItem,
  recallSet,
  unit,
} from "@/lib/db/schema";
import { env } from "@/lib/env";
import { studyDay } from "@/lib/study-day";

const ai = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: ai.create };
  },
}));

type Format = "mcq" | "blank" | "free";
type SetTimes = { shownAt?: Date; postponedAt?: Date; startedAt?: Date; completedAt?: Date };

const ANSWERS: Record<Format, QuizAnswer> = {
  mcq: {
    choices: [{ text: "새로 만든다" }, { text: "부모가 준다" }, { text: "React가 보관한다" }, { text: "전역에 둔다" }],
    answerIndex: 2,
  },
  blank: { accepted: ["useState"] },
  free: { modelAnswer: "상태가 바뀌면 다시 렌더링한다.", keyPoints: ["상태 변경", "다시 렌더링"] },
};
const DAY_MS = 24 * 60 * 60 * 1000;
const ORIGIN = new URL(env.AUTH_URL).origin;

const createdSetIds: string[] = [];
const createdProblemIds: string[] = [];
const createdConceptIds: string[] = [];

function dayBefore(day: string, days: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
}

const today = () => studyDay(new Date());
const yesterday = () => dayBefore(today(), 1);

async function loginConsented() {
  const profile = newProfile();
  const { headers } = await loginWithGoogle(profile);
  await getDb().update(learner).set({ consentedAt: new Date() }).where(eq(learner.email, profile.email));
  const found = await learnerWithEmail(profile.email);
  if (!found) throw new Error("학습자를 만들지 못했다.");
  return { headers, learnerId: found.id };
}

async function newProblem(format: Format) {
  const db = getDb();
  const [firstUnit] = await db.select({ id: unit.id }).from(unit).orderBy(asc(unit.id)).limit(1);
  if (!firstUnit) throw new Error("테스트 DB에 단원이 없다.");
  const conceptId = `test-${randomUUID()}`;
  createdConceptIds.push(conceptId);
  await db.insert(concept).values({ id: conceptId, unitId: firstUnit.id, title: "테스트 개념" });
  const [row] = await db
    .insert(quizProblem)
    .values({
      conceptId,
      format,
      stem: format === "blank" ? `${format} 문제 ____` : `${format} 문제`,
      answer: ANSWERS[format],
      hint: `${format} 힌트`,
      explanation: `${format} 해설`,
    })
    .returning();
  if (!row) throw new Error("문제를 넣지 못했다.");
  createdProblemIds.push(row.id);
  return row;
}

async function newSet(
  learnerId: string,
  sourceStudyDay: string,
  times: SetTimes = {},
  formats: Format[] = ["mcq", "blank", "free"],
) {
  const db = getDb();
  const [set] = await db.insert(recallSet).values({ learnerId, sourceStudyDay, ...times }).returning();
  if (!set) throw new Error("세트를 넣지 못했다.");
  createdSetIds.push(set.id);
  const items = [];
  for (const [index, format] of formats.entries()) {
    const problem = await newProblem(format);
    const [item] = await db
      .insert(recallItem)
      .values({ setId: set.id, position: index + 1, reason: "read_no_question", problemId: problem.id })
      .returning();
    if (!item) throw new Error("문항을 넣지 못했다.");
    items.push({ ...item, problem });
  }
  return { set, items };
}

function requestHeaders(headers: Headers, origin: string) {
  const merged = new Headers(headers);
  merged.set("origin", origin);
  merged.set("content-type", "application/json");
  return merged;
}

type Call = { headers?: Headers; origin?: string };

function requestToday({ headers = new Headers(), origin = ORIGIN, advanceDay = false }: Call & { advanceDay?: boolean } = {}) {
  const url = new URL("/api/recall-sets/today", env.AUTH_URL);
  if (advanceDay) url.searchParams.set("advanceDay", "1");
  return showToday(new Request(url, { method: "POST", headers: requestHeaders(headers, origin) }));
}

function sendEvent(setId: string, event: string, { headers = new Headers(), origin = ORIGIN }: Call = {}) {
  return recordEvent(
    new Request(new URL(`/api/recall-sets/${setId}/events`, env.AUTH_URL), {
      method: "POST",
      headers: requestHeaders(headers, origin),
      body: JSON.stringify({ event }),
    }),
    { params: Promise.resolve({ setId }) },
  );
}

function sendOpenedSection(itemId: string, { headers = new Headers(), origin = ORIGIN }: Call = {}) {
  return openSection(
    new Request(new URL(`/api/recall-items/${itemId}/opened-section`, env.AUTH_URL), {
      method: "POST",
      headers: requestHeaders(headers, origin),
    }),
    { params: Promise.resolve({ itemId }) },
  );
}

function sendAttempt(body: Record<string, unknown>, { headers = new Headers(), origin = ORIGIN }: Call = {}) {
  return submitAttempt(
    new Request(new URL("/api/quiz-attempts", env.AUTH_URL), {
      method: "POST",
      headers: requestHeaders(headers, origin),
      body: JSON.stringify(body),
    }),
  );
}

type TodayBody = {
  set: {
    id: string;
    items: { id: string; position: number; reason: string; problem: Record<string, unknown> }[];
  } | null;
};

async function todayBody(response: Response) {
  expect(response.status).toBe(200);
  return (await response.json()) as TodayBody;
}

async function setRow(id: string) {
  const [row] = await getDb().select().from(recallSet).where(eq(recallSet.id, id));
  if (!row) throw new Error("세트가 없다.");
  return row;
}

async function itemRow(id: string) {
  const [row] = await getDb().select().from(recallItem).where(eq(recallItem.id, id));
  if (!row) throw new Error("문항이 없다.");
  return row;
}

function attemptsForItem(itemId: string) {
  return getDb().select().from(quizAttempt).where(eq(quizAttempt.recallItemId, itemId));
}

function timesOf(row: typeof recallSet.$inferSelect) {
  const { shownAt, postponedAt, startedAt, completedAt } = row;
  return { shownAt, postponedAt, startedAt, completedAt };
}

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("ANTHROPIC_UTILITY_MODEL", "test-utility-model");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  ai.create.mockReset();
  const db = getDb();
  const setIds = createdSetIds.splice(0);
  const problemIds = createdProblemIds.splice(0);
  const conceptIds = createdConceptIds.splice(0);
  if (problemIds.length > 0) await db.delete(quizAttempt).where(inArray(quizAttempt.problemId, problemIds));
  if (setIds.length > 0) {
    await db.delete(recallItem).where(inArray(recallItem.setId, setIds));
    await db.delete(recallSet).where(inArray(recallSet.id, setIds));
  }
  if (problemIds.length > 0) await db.delete(quizProblem).where(inArray(quizProblem.id, problemIds));
  if (conceptIds.length > 0) await db.delete(concept).where(inArray(concept.id, conceptIds));
  await deleteCreatedLearners();
});

describe("꺼내 먹기 진행 기록", () => {
  it("TC-159 전날 세트가 준비된 학습자가 오늘 처음 들어오면 그 세트의 문항을 정답 없이 받고, 띄운 시각이 저장돼요", async () => {
    const { headers, learnerId } = await loginConsented();
    const { set, items } = await newSet(learnerId, yesterday());

    const body = await todayBody(await requestToday({ headers }));

    expect(body.set?.id).toBe(set.id);
    expect(body.set?.items.map((item) => item.id)).toEqual(items.map((item) => item.id));
    for (const [index, item] of (body.set?.items ?? []).entries()) {
      const expected = items[index]!;
      expect(item).toMatchObject({ position: index + 1, reason: "read_no_question" });
      expect(item.problem).toMatchObject({ format: expected.problem.format, stem: expected.problem.stem, hint: expected.problem.hint });
      if (expected.problem.format === "mcq") expect(item.problem.choices).toEqual(["새로 만든다", "부모가 준다", "React가 보관한다", "전역에 둔다"]);
    }
    const sent = JSON.stringify(body);
    for (const hidden of ["answerIndex", "accepted", "modelAnswer", "keyPoints", "explanation", "해설"]) {
      expect(sent).not.toContain(hidden);
    }
    expect((await setRow(set.id)).shownAt).not.toBeNull();
  });

  it("TC-160 이미 띄운 세트와 오늘 학습일로 만든 세트는 돌려주지 않고 아무것도 바꾸지 않아요", async () => {
    const shown = await loginConsented();
    const shownAt = new Date(Date.now() - 60_000);
    const { set: shownSet } = await newSet(shown.learnerId, yesterday(), { shownAt });
    const tomorrow = await loginConsented();
    const { set: tomorrowSet } = await newSet(tomorrow.learnerId, today());

    const shownBody = await todayBody(await requestToday({ headers: shown.headers }));
    const tomorrowBody = await todayBody(await requestToday({ headers: tomorrow.headers }));

    expect(shownBody.set).toBeNull();
    expect(tomorrowBody.set).toBeNull();
    expect((await setRow(shownSet.id)).shownAt).toEqual(shownAt);
    expect((await setRow(tomorrowSet.id)).shownAt).toBeNull();
  });

  it("TC-161 아직 띄우지 않은 세트가 여러 개면 가장 최근 학습일의 세트 하나만 돌려줘요", async () => {
    const { headers, learnerId } = await loginConsented();
    const { set: older } = await newSet(learnerId, dayBefore(today(), 3), {}, ["mcq"]);
    const { set: latest } = await newSet(learnerId, yesterday(), {}, ["mcq"]);

    const body = await todayBody(await requestToday({ headers }));

    expect(body.set?.id).toBe(latest.id);
    expect((await setRow(latest.id)).shownAt).not.toBeNull();
    expect((await setRow(older.id)).shownAt).toBeNull();
  });

  it("TC-162 나중에 할게요를 보내면 미룬 시각이 저장되고, 다시 요청해도 그 세트를 돌려주지 않아요", async () => {
    const { headers, learnerId } = await loginConsented();
    const { set } = await newSet(learnerId, yesterday(), {}, ["mcq"]);
    expect((await todayBody(await requestToday({ headers }))).set?.id).toBe(set.id);

    const postponed = await sendEvent(set.id, "postpone", { headers });
    const again = await todayBody(await requestToday({ headers }));

    expect(postponed.status).toBe(204);
    expect((await setRow(set.id)).postponedAt).not.toBeNull();
    expect(again.set).toBeNull();
  });

  it("TC-163 시작과 완료를 보내면 시각이 저장되고, 같은 기록을 다시 보내도 처음 시각을 유지해요", async () => {
    const { headers, learnerId } = await loginConsented();
    const { set } = await newSet(learnerId, yesterday(), {}, ["mcq"]);
    await requestToday({ headers });

    expect((await sendEvent(set.id, "start", { headers })).status).toBe(204);
    expect((await sendEvent(set.id, "complete", { headers })).status).toBe(204);
    const first = await setRow(set.id);
    expect(first.startedAt).not.toBeNull();
    expect(first.completedAt).not.toBeNull();

    expect((await sendEvent(set.id, "start", { headers })).status).toBe(204);
    expect((await sendEvent(set.id, "complete", { headers })).status).toBe(204);
    const second = await setRow(set.id);
    expect(second.startedAt).toEqual(first.startedAt);
    expect(second.completedAt).toEqual(first.completedAt);
  });

  it("TC-164 순서에 맞지 않는 세트 기록은 거절하고 세트를 바꾸지 않아요", async () => {
    const { headers, learnerId } = await loginConsented();
    const at = new Date(Date.now() - 60_000);
    const { set: unshown } = await newSet(learnerId, dayBefore(today(), 4), {}, ["mcq"]);
    const { set: shownOnly } = await newSet(learnerId, dayBefore(today(), 3), { shownAt: at }, ["mcq"]);
    const { set: started } = await newSet(learnerId, dayBefore(today(), 2), { shownAt: at, startedAt: at }, ["mcq"]);
    const { set: completed } = await newSet(
      learnerId,
      yesterday(),
      { shownAt: at, startedAt: at, completedAt: at },
      ["mcq"],
    );
    const attempts: [string, string][] = [
      [unshown.id, "start"],
      [shownOnly.id, "complete"],
      [started.id, "postpone"],
      [completed.id, "postpone"],
    ];
    const before = await Promise.all(attempts.map(async ([id]) => timesOf(await setRow(id))));

    for (const [id, event] of attempts) expect((await sendEvent(id, event, { headers })).status).toBe(409);

    const after = await Promise.all(attempts.map(async ([id]) => timesOf(await setRow(id))));
    expect(after).toEqual(before);
  });

  it("TC-165 꺼내 먹기 풀이를 문항 ID와 함께 보내면 그 문항의 풀이로 저장되고, 4-64의 꺼내 먹기 기록 항목을 모두 읽을 수 있어요", async () => {
    const { headers, learnerId } = await loginConsented();
    const { set, items } = await newSet(learnerId, yesterday());
    await requestToday({ headers });
    await sendEvent(set.id, "start", { headers });
    ai.create.mockResolvedValueOnce({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ grading: "correct" }) }],
    });
    const [choice, blank, free] = items as [(typeof items)[0], (typeof items)[0], (typeof items)[0]];
    const sent = [
      { item: choice, body: { chosenIndex: 2, confidence: "sure" } },
      { item: blank, body: { answerText: "useState", confidence: "unsure" } },
      { item: free, body: { answerText: "상태가 바뀌면 다시 그려요", confidence: "guess" } },
    ];

    for (const { item, body } of sent) {
      const response = await sendAttempt(
        { attemptId: randomUUID(), problemId: item.problemId, recallItemId: item.id, hintUsed: false, dontKnow: false, ...body },
        { headers },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        outcome: "graded",
        isCorrect: true,
        answer: ANSWERS[item.problem.format],
        explanation: item.problem.explanation,
      });
    }
    expect((await sendEvent(set.id, "complete", { headers })).status).toBe(204);

    const records = await getDb()
      .select({
        learnerId: recallSet.learnerId,
        conceptId: quizProblem.conceptId,
        problemId: quizAttempt.problemId,
        reason: recallItem.reason,
        sourceStudyDay: recallSet.sourceStudyDay,
        shownAt: recallSet.shownAt,
        studyDay: quizAttempt.studyDay,
        confidence: quizAttempt.confidence,
        format: quizProblem.format,
        chosenIndex: quizAttempt.chosenIndex,
        answerText: quizAttempt.answerText,
        isCorrect: quizAttempt.isCorrect,
        answeredAt: quizAttempt.answeredAt,
        completedAt: recallSet.completedAt,
      })
      .from(quizAttempt)
      .innerJoin(recallItem, eq(recallItem.id, quizAttempt.recallItemId))
      .innerJoin(recallSet, eq(recallSet.id, recallItem.setId))
      .innerJoin(quizProblem, eq(quizProblem.id, quizAttempt.problemId))
      .where(eq(recallSet.id, set.id))
      .orderBy(asc(recallItem.position));

    expect(records).toHaveLength(3);
    for (const [index, record] of records.entries()) {
      const { item, body } = sent[index]!;
      expect(record).toMatchObject({
        learnerId,
        conceptId: item.problem.conceptId,
        problemId: item.problemId,
        reason: "read_no_question",
        sourceStudyDay: yesterday(),
        studyDay: today(),
        confidence: body.confidence,
        format: item.problem.format,
        chosenIndex: "chosenIndex" in body ? body.chosenIndex : null,
        answerText: "answerText" in body ? body.answerText : null,
        isCorrect: true,
      });
      expect(record.shownAt).not.toBeNull();
      expect(record.answeredAt).not.toBeNull();
      expect(record.completedAt).not.toBeNull();
    }
  });

  it("TC-166 문항과 다른 문제로 보내거나 다른 학습자의 문항으로 보낸 꺼내 먹기 풀이는 거부하고 저장하지 않아요", async () => {
    const mine = await loginConsented();
    const other = await loginConsented();
    const { items: myItems } = await newSet(mine.learnerId, yesterday(), { shownAt: new Date() }, ["mcq", "mcq"]);
    const { items: otherItems } = await newSet(other.learnerId, yesterday(), { shownAt: new Date() }, ["mcq"]);
    const [myItem, mySecondItem] = myItems as [(typeof myItems)[0], (typeof myItems)[0]];
    const otherItem = otherItems[0]!;
    const answer = { chosenIndex: 2, confidence: "sure", hintUsed: false, dontKnow: false };

    const wrongProblem = await sendAttempt(
      { ...answer, attemptId: randomUUID(), problemId: mySecondItem.problemId, recallItemId: myItem.id },
      { headers: mine.headers },
    );
    const othersItem = await sendAttempt(
      { ...answer, attemptId: randomUUID(), problemId: otherItem.problemId, recallItemId: otherItem.id },
      { headers: mine.headers },
    );

    expect(wrongProblem.status).toBe(400);
    expect(othersItem.status).toBe(403);
    for (const response of [wrongProblem, othersItem]) expect(await response.text()).toBe("");
    for (const item of [myItem, otherItem]) expect(await attemptsForItem(item.id)).toEqual([]);
    expect(
      await getDb()
        .select()
        .from(quizAttempt)
        .where(inArray(quizAttempt.problemId, [mySecondItem.problemId, otherItem.problemId])),
    ).toEqual([]);
  });

  it("TC-167 이미 푼 문항에 다른 풀이 ID로 다시 보내면 거부하고 처음 풀이를 유지해요", async () => {
    const { headers, learnerId } = await loginConsented();
    const { items } = await newSet(learnerId, yesterday(), { shownAt: new Date(), startedAt: new Date() }, ["mcq"]);
    const item = items[0]!;
    const answer = { problemId: item.problemId, recallItemId: item.id, confidence: "sure", hintUsed: false, dontKnow: false };
    expect((await sendAttempt({ ...answer, attemptId: randomUUID(), chosenIndex: 2 }, { headers })).status).toBe(200);

    const second = await sendAttempt({ ...answer, attemptId: randomUUID(), chosenIndex: 0 }, { headers });

    expect(second.status).toBe(409);
    const rows = await attemptsForItem(item.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.chosenIndex).toBe(2);
  });

  it("TC-168 결과에서 절로 이동했다고 보내면 문항에 이동 시각이 저장되고, 다시 보내도 처음 시각을 유지해요", async () => {
    const { headers, learnerId } = await loginConsented();
    const { items } = await newSet(learnerId, yesterday(), { shownAt: new Date() }, ["mcq", "blank"]);
    const [opened, untouched] = items as [(typeof items)[0], (typeof items)[0]];

    expect((await sendOpenedSection(opened.id, { headers })).status).toBe(204);
    const first = (await itemRow(opened.id)).openedSectionAt;
    expect((await sendOpenedSection(opened.id, { headers })).status).toBe(204);

    expect(first).not.toBeNull();
    expect((await itemRow(opened.id)).openedSectionAt).toEqual(first);
    expect((await itemRow(untouched.id)).openedSectionAt).toBeNull();
  });

  it("TC-169 다른 학습자의 세트나 문항에 꺼내 먹기 기록을 보내면 거부하고 아무것도 바꾸지 않아요", async () => {
    const intruder = await loginConsented();
    const owner = await loginConsented();
    const { set, items } = await newSet(owner.learnerId, yesterday(), { shownAt: new Date() }, ["mcq"]);
    const item = items[0]!;
    const before = timesOf(await setRow(set.id));

    const responses = [
      await sendEvent(set.id, "postpone", { headers: intruder.headers }),
      await sendEvent(set.id, "start", { headers: intruder.headers }),
      await sendEvent(set.id, "complete", { headers: intruder.headers }),
      await sendOpenedSection(item.id, { headers: intruder.headers }),
    ];

    for (const response of responses) expect(response.status).toBe(403);
    expect(timesOf(await setRow(set.id))).toEqual(before);
    expect((await itemRow(item.id)).openedSectionAt).toBeNull();
  });

  it("TC-170 로그인하지 않았거나 저장에 동의하지 않았거나 다른 사이트에서 보낸 꺼내 먹기 요청은 거부해요", async () => {
    const owner = await loginConsented();
    const { set, items } = await newSet(owner.learnerId, yesterday(), {}, ["mcq"]);
    const item = items[0]!;
    const { headers: notConsented } = await loginWithGoogle(newProfile());
    const callers: [Call, number][] = [
      [{}, 401],
      [{ headers: notConsented }, 403],
      [{ headers: owner.headers, origin: "https://evil.example" }, 403],
    ];

    for (const [call, code] of callers) {
      expect((await requestToday(call)).status).toBe(code);
      expect((await sendEvent(set.id, "postpone", call)).status).toBe(code);
      expect((await sendOpenedSection(item.id, call)).status).toBe(code);
    }

    expect(timesOf(await setRow(set.id))).toEqual({ shownAt: null, postponedAt: null, startedAt: null, completedAt: null });
    expect((await itemRow(item.id)).openedSectionAt).toBeNull();
  });

  it("TC-171 운영이 아닌 환경에서 날짜를 하루 당겨 요청하면 내일 띄울 세트를 미리 받고, 운영에서는 당기지 않아요", async () => {
    const preview = await loginConsented();
    const { set: previewSet } = await newSet(preview.learnerId, today(), {}, ["mcq"]);
    const production = await loginConsented();
    const { set: productionSet } = await newSet(production.learnerId, today(), {}, ["mcq"]);

    vi.stubEnv("VERCEL_ENV", "preview");
    const previewBody = await todayBody(await requestToday({ headers: preview.headers, advanceDay: true }));
    vi.stubEnv("VERCEL_ENV", "production");
    const productionBody = await todayBody(await requestToday({ headers: production.headers, advanceDay: true }));

    expect(previewBody.set?.id).toBe(previewSet.id);
    expect((await setRow(previewSet.id)).shownAt).not.toBeNull();
    expect(productionBody.set).toBeNull();
    expect(timesOf(await setRow(productionSet.id))).toEqual({
      shownAt: null,
      postponedAt: null,
      startedAt: null,
      completedAt: null,
    });
    const sets = await getDb().select().from(recallSet).where(inArray(recallSet.learnerId, [preview.learnerId, production.learnerId]));
    expect(sets).toHaveLength(2);
  });
});
