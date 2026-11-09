import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { and, asc, eq, isNull } from "drizzle-orm";
import { concept, questionConcept, quizAttempt, quizProblem } from "@/lib/db/schema";
import type { ProblemView } from "@/lib/quiz-problems";
import { createLearner, daysFromNow, db, deleteLearner, firstUnits, saveAnswered, test } from "./fixtures";

const PROBLEMS_PATH = "**/api/quiz-problems";

function sampleProblem(stem: string): ProblemView {
  return {
    id: randomUUID(),
    format: "mcq",
    conceptId: "e2e-concept",
    conceptTitle: "E2E 개념",
    stem,
    hint: "그룹을 만든 뒤에 걸러요.",
    choices: ["WHERE", "HAVING", "ORDER BY", "LIMIT"],
  };
}

async function openFirstUnit(page: Page) {
  const [first] = await firstUnits(1);
  if (!first) throw new Error("테스트 DB에 단원이 있어야 한다.");
  await page.goto(`/study/${first.id}`);
  await expect(page.getByRole("heading", { level: 1, name: first.title, exact: true })).toBeVisible();
  return first;
}

function tab(page: Page, name: "AI 에이전트" | "퀴즈") {
  return page.getByRole("tab", { name, exact: true });
}

function quizPanel(page: Page) {
  return page.getByRole("tabpanel", { name: "퀴즈" });
}

test("TC-176 에이전트 탭에 갔다가 퀴즈 탭으로 돌아오면 풀던 문제와 카운트가 그대로이고 문제를 새로 만들지 않아요", async ({ page }) => {
  const problem = sampleProblem("그룹 조건은 어디에 쓰나요?");
  let requests = 0;
  await page.route(PROBLEMS_PATH, (route) => {
    requests += 1;
    return route.fulfill({ json: problem });
  });

  await openFirstUnit(page);
  await expect(page.getByRole("tabpanel", { name: "에이전트" }).getByRole("textbox", { name: "질문" })).toBeVisible();

  await tab(page, "퀴즈").click();
  const panel = quizPanel(page);
  await expect(panel.getByText(problem.stem)).toBeVisible();
  await expect(panel.getByText("1 / 5")).toBeVisible();
  await panel.getByText("HAVING", { exact: true }).click();

  await tab(page, "AI 에이전트").click();
  await expect(panel).toBeHidden();
  await tab(page, "퀴즈").click();

  await expect(panel.getByText(problem.stem)).toBeVisible();
  await expect(panel.getByText("1 / 5")).toBeVisible();
  expect(requests).toBe(1);
});

test("TC-177 문제를 만드는 동안 로딩을 보여 주고, 생성이 실패하면 오류와 다시 시도를 보여 주며 다시 시도하면 문제가 떠요", async ({ page }) => {
  const problem = sampleProblem("WHERE와 HAVING의 차이는 무엇인가요?");
  let failFirst: () => void = () => {};
  const firstHeld = new Promise<void>((resolve) => {
    failFirst = resolve;
  });
  let requests = 0;
  await page.route(PROBLEMS_PATH, async (route) => {
    requests += 1;
    if (requests === 1) {
      await firstHeld;
      return route.fulfill({ status: 502 });
    }
    return route.fulfill({ json: problem });
  });

  await openFirstUnit(page);
  await tab(page, "퀴즈").click();
  const panel = quizPanel(page);

  await expect(panel.getByText("문제를 만들고 있어요")).toBeVisible();
  failFirst();

  await expect(panel.getByText("문제를 만들지 못했어요")).toBeVisible();
  await expect(panel.getByRole("button", { name: "다시 시도" })).toBeVisible();
  await expect(panel.getByRole("region", { name: "퀴즈" })).toHaveCount(0);

  await panel.getByRole("button", { name: "다시 시도" }).click();
  await expect(panel.getByText(problem.stem)).toBeVisible();
  expect(requests).toBe(2);
});

test("TC-178 본 절도 대화도 없는 학습자가 퀴즈 탭을 열면 그 단원의 기본 문제가 개념 이름과 카운트와 함께 바로 떠요", async ({ page }) => {
  const unit = await openFirstUnit(page);
  const defaults = await db
    .select({ stem: quizProblem.stem, conceptTitle: concept.title })
    .from(quizProblem)
    .innerJoin(concept, eq(concept.id, quizProblem.conceptId))
    .where(and(isNull(quizProblem.learnerId), isNull(quizProblem.retiredAt), eq(concept.unitId, unit.id)));
  expect(defaults.length).toBeGreaterThan(0);

  const created = page.waitForResponse((response) => response.url().endsWith("/api/quiz-problems"));
  await tab(page, "퀴즈").click();
  const shown = (await (await created).json()) as ProblemView;

  const picked = defaults.find((row) => row.stem === shown.stem);
  expect(picked).toBeDefined();
  const panel = quizPanel(page);
  const card = panel.getByRole("region", { name: "퀴즈" });
  await expect(card).toBeVisible();
  await expect(card.getByText(picked?.conceptTitle ?? "", { exact: true })).toBeVisible();
  await expect(panel.getByText("1 / 5")).toBeVisible();
});

test("TC-179 대화한 개념으로 만든 문제를 퀴즈 탭에서 풀면 풀이 기록이 남고 다음 문제를 요청해요", async ({ page, learnerId }) => {
  const [first] = await firstUnits(1);
  if (!first) throw new Error("테스트 DB에 단원이 있어야 한다.");
  const [talked] = await db
    .select({ id: concept.id, title: concept.title })
    .from(concept)
    .where(eq(concept.unitId, first.id))
    .orderBy(asc(concept.id))
    .limit(1);
  if (!talked) throw new Error("테스트 DB의 첫 단원에 개념이 있어야 한다.");

  const questionId = randomUUID();
  await saveAnswered(
    learnerId,
    { questionId, sessionId: randomUUID(), unitId: first.id, content: "GROUP BY 뒤에 조건은 어디에 쓰나요?" },
    "HAVING에 써요.",
  );
  await db.insert(questionConcept).values({ questionId, conceptId: talked.id });
  const choices = ["WHERE", "HAVING", "ORDER BY", "LIMIT"];
  const [stored] = await db
    .insert(quizProblem)
    .values({
      learnerId,
      conceptId: talked.id,
      format: "mcq",
      stem: "GROUP BY로 묶은 뒤 그룹 조건은 어디에 쓰나요?",
      answer: { choices: choices.map((text) => ({ text })), answerIndex: 1 },
      hint: "그룹을 만든 뒤에 걸러요.",
      explanation: "그룹 조건은 HAVING에 써요.",
    })
    .returning();
  if (!stored) throw new Error("문제를 넣지 못했다.");
  const view: ProblemView = {
    id: stored.id,
    format: "mcq",
    conceptId: talked.id,
    conceptTitle: talked.title,
    stem: stored.stem,
    hint: stored.hint,
    choices,
  };

  const bodies: unknown[] = [];
  await page.route(PROBLEMS_PATH, (route) => {
    bodies.push(route.request().postDataJSON());
    return bodies.length === 1 ? route.fulfill({ json: view }) : undefined;
  });

  await page.goto(`/study/${first.id}`);
  await tab(page, "퀴즈").click();
  const card = quizPanel(page).getByRole("region", { name: "퀴즈" });
  await expect(card.getByText(view.stem)).toBeVisible();
  expect(bodies).toEqual([{ unitId: first.id }]);
  await expect(card.getByText(talked.title, { exact: true })).toBeVisible();

  await card.getByText("HAVING", { exact: true }).click();
  await card.getByRole("button", { name: "확실해요" }).click();
  await expect(card.getByRole("region", { name: "채점 결과와 해설" })).toBeVisible();

  const attempts = await db
    .select({ problemId: quizAttempt.problemId, isCorrect: quizAttempt.isCorrect })
    .from(quizAttempt)
    .where(eq(quizAttempt.learnerId, learnerId));
  expect(attempts).toEqual([{ problemId: stored.id, isCorrect: true }]);

  await card.getByRole("button", { name: "다음 문제" }).click();
  await expect.poll(() => bodies.length).toBe(2);
});

test("TC-192 대화 중 관련 문제 풀어보기를 누르면 퀴즈 탭으로 넘어가 로딩 뒤 그 질문으로 만든 문제가 뜨고 카운트는 그대로예요", async ({ page, learnerId }) => {
  const [first] = await firstUnits(1);
  if (!first) throw new Error("테스트 DB에 단원이 있어야 한다.");
  const questionId = randomUUID();
  await saveAnswered(
    learnerId,
    { questionId, sessionId: randomUUID(), unitId: first.id, content: "GROUP BY 뒤에 조건은 어디에 쓰나요?" },
    "HAVING에 써요.",
  );

  const unitProblem = sampleProblem("그룹 조건은 어디에 쓰나요?");
  const relatedProblem = sampleProblem("HAVING은 WHERE와 무엇이 다른가요?");
  let releaseRelated: () => void = () => {};
  const relatedHeld = new Promise<void>((resolve) => {
    releaseRelated = resolve;
  });
  const bodies: unknown[] = [];
  await page.route(PROBLEMS_PATH, async (route) => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) return route.fulfill({ json: unitProblem });
    await relatedHeld;
    return route.fulfill({ json: relatedProblem });
  });

  await page.goto(`/study/${first.id}`);
  await tab(page, "퀴즈").click();
  const panel = quizPanel(page);
  await expect(panel.getByText(unitProblem.stem)).toBeVisible();
  await expect(panel.getByText("1 / 5")).toBeVisible();

  await tab(page, "AI 에이전트").click();
  await page.getByRole("tabpanel", { name: "에이전트" }).getByRole("button", { name: "관련 문제 풀어보기" }).click();

  await expect(tab(page, "퀴즈")).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByText("문제를 만들고 있어요")).toBeVisible();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).toEqual({ questionId });

  releaseRelated();
  await expect(panel.getByText(relatedProblem.stem)).toBeVisible();
  await expect(panel.getByText("1 / 5")).toBeVisible();
});

async function firstConcept(unitId: string) {
  const [found] = await db
    .select({ id: concept.id, title: concept.title })
    .from(concept)
    .where(eq(concept.unitId, unitId))
    .orderBy(asc(concept.id))
    .limit(1);
  if (!found) throw new Error("테스트 DB의 단원에 개념이 있어야 한다.");
  return found;
}

async function storeProblem(learnerId: string, saved: { id: string; title: string }, stem: string): Promise<ProblemView> {
  const choices = ["WHERE", "HAVING", "ORDER BY", "LIMIT"];
  const [stored] = await db
    .insert(quizProblem)
    .values({
      learnerId,
      conceptId: saved.id,
      format: "mcq",
      stem,
      answer: { choices: choices.map((text) => ({ text })), answerIndex: 1 },
      hint: "그룹을 만든 뒤에 걸러요.",
      explanation: "그룹 조건은 HAVING에 써요.",
    })
    .returning();
  if (!stored) throw new Error("문제를 넣지 못했다.");
  return { id: stored.id, format: "mcq", conceptId: saved.id, conceptTitle: saved.title, stem, hint: stored.hint, choices };
}

test("TC-196 문제를 풀다가 새로고침해도 같은 문제와 카운트가 이어서 나오고 문제를 새로 만들지 않아요", async ({ page, learnerId }) => {
  const [first] = await firstUnits(1);
  if (!first) throw new Error("테스트 DB에 단원이 있어야 한다.");
  const view = await storeProblem(learnerId, await firstConcept(first.id), "GROUP BY로 묶은 뒤 그룹 조건은 어디에 쓰나요?");
  let requests = 0;
  await page.route(PROBLEMS_PATH, (route) => {
    requests += 1;
    return route.fulfill({ json: view });
  });

  await page.goto(`/study/${first.id}`);
  await tab(page, "퀴즈").click();
  const panel = quizPanel(page);
  await expect(panel.getByText(view.stem)).toBeVisible();
  await expect(panel.getByText("1 / 5")).toBeVisible();
  await panel.getByText("HAVING", { exact: true }).click();

  await page.reload();
  await tab(page, "퀴즈").click();

  await expect(panel.getByText(view.stem)).toBeVisible();
  await expect(panel.getByText("1 / 5")).toBeVisible();
  expect(requests).toBe(1);
});

test("TC-197 문제를 제출한 뒤 새로고침하면 그 문제 대신 열린 단원으로 다음 문제를 만들고 카운트가 하나 늘어요", async ({ page, learnerId }) => {
  const [first] = await firstUnits(1);
  if (!first) throw new Error("테스트 DB에 단원이 있어야 한다.");
  const view = await storeProblem(learnerId, await firstConcept(first.id), "GROUP BY로 묶은 뒤 그룹 조건은 어디에 쓰나요?");
  const next = sampleProblem("WHERE와 HAVING의 차이는 무엇인가요?");
  const bodies: unknown[] = [];
  await page.route(PROBLEMS_PATH, (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ json: bodies.length === 1 ? view : next });
  });

  await page.goto(`/study/${first.id}`);
  await tab(page, "퀴즈").click();
  const panel = quizPanel(page);
  await expect(panel.getByText(view.stem)).toBeVisible();
  await expect(panel.getByText("1 / 5")).toBeVisible();

  await db.insert(quizAttempt).values({
    id: randomUUID(),
    learnerId,
    problemId: view.id,
    studyDay: daysFromNow(0),
    chosenIndex: 1,
    confidence: "sure",
    isCorrect: true,
    appVersion: "e2e",
  });

  await page.reload();
  await tab(page, "퀴즈").click();

  await expect(panel.getByText(next.stem)).toBeVisible();
  await expect(panel.getByText("2 / 5")).toBeVisible();
  expect(bodies).toEqual([{ unitId: first.id }, { unitId: first.id }]);
});

test("TC-198 문제 ID로 요청하면 정답과 해설을 뺀 내 문제와 기본 문제는 받고, 다른 학습자의 문제는 받지 못해요", async ({ page, learnerId }) => {
  const [first] = await firstUnits(1);
  if (!first) throw new Error("테스트 DB에 단원이 있어야 한다.");
  const saved = await firstConcept(first.id);
  const mine = await storeProblem(learnerId, saved, "내 문제예요.");
  const [shared] = await db
    .select({ id: quizProblem.id, format: quizProblem.format, conceptId: quizProblem.conceptId, conceptTitle: concept.title, stem: quizProblem.stem, hint: quizProblem.hint, answer: quizProblem.answer })
    .from(quizProblem)
    .innerJoin(concept, eq(concept.id, quizProblem.conceptId))
    .where(and(isNull(quizProblem.learnerId), isNull(quizProblem.retiredAt), eq(concept.unitId, first.id)))
    .limit(1);
  if (!shared) throw new Error("테스트 DB의 첫 단원에 기본 문제가 있어야 한다.");
  const { answer, ...sharedView } = shared;
  const expectedShared: ProblemView = "choices" in answer ? { ...sharedView, choices: answer.choices.map((choice) => choice.text) } : sharedView;

  const otherLearnerId = await createLearner();
  try {
    const others = await storeProblem(otherLearnerId, saved, "다른 학습자의 문제예요.");

    const ownResponse = await page.request.get(`/api/quiz-problems/${mine.id}`);
    expect(ownResponse.status()).toBe(200);
    expect(((await ownResponse.json()) as { problem: unknown }).problem).toEqual(mine);

    const sharedResponse = await page.request.get(`/api/quiz-problems/${shared.id}`);
    expect(sharedResponse.status()).toBe(200);
    expect(((await sharedResponse.json()) as { problem: unknown }).problem).toEqual(expectedShared);

    const othersResponse = await page.request.get(`/api/quiz-problems/${others.id}`);
    expect(othersResponse.status()).toBe(404);
  } finally {
    await deleteLearner(otherLearnerId);
  }
});

test("TC-213 다시 낸 기본 문제는 문제를 내준 시각 뒤의 풀이만 푼 것으로 봐요", async ({ page, learnerId }) => {
  const [first] = await firstUnits(1);
  if (!first) throw new Error("테스트 DB에 단원이 있어야 한다.");
  const [shared] = await db
    .select({ id: quizProblem.id })
    .from(quizProblem)
    .innerJoin(concept, eq(concept.id, quizProblem.conceptId))
    .where(and(isNull(quizProblem.learnerId), isNull(quizProblem.retiredAt), eq(concept.unitId, first.id)))
    .limit(1);
  if (!shared) throw new Error("테스트 DB의 첫 단원에 기본 문제가 있어야 한다.");

  const answeredAt = new Date();
  await db.insert(quizAttempt).values({
    id: randomUUID(),
    learnerId,
    problemId: shared.id,
    studyDay: daysFromNow(0),
    chosenIndex: 0,
    confidence: "sure",
    isCorrect: false,
    answeredAt,
    appVersion: "e2e",
  });

  async function solvedWhenShownAt(shownAt: Date) {
    const response = await page.request.get(`/api/quiz-problems/${shared?.id}?${new URLSearchParams({ shownAt: shownAt.toISOString() })}`);
    expect(response.status()).toBe(200);
    return ((await response.json()) as { solved: boolean }).solved;
  }

  expect(await solvedWhenShownAt(new Date(answeredAt.getTime() - 60_000))).toBe(true);
  expect(await solvedWhenShownAt(new Date(answeredAt.getTime() + 60_000))).toBe(false);
});

test("TC-218 퀴즈 탭에서 답을 채점받으면 진행 게이지가 한 칸 차고, 패널 아래에 고정된 다음 문제 버튼이 보여요", async ({ page, learnerId }) => {
  const [first] = await firstUnits(1);
  if (!first) throw new Error("테스트 DB에 단원이 있어야 한다.");
  const view = await storeProblem(learnerId, await firstConcept(first.id), "GROUP BY로 묶은 뒤 그룹 조건은 어디에 쓰나요?");
  await page.route(PROBLEMS_PATH, (route) => route.fulfill({ json: view }));

  await page.goto(`/study/${first.id}`);
  await tab(page, "퀴즈").click();
  const panel = quizPanel(page);
  const card = panel.getByRole("region", { name: "퀴즈" });
  await expect(card.getByText(view.stem)).toBeVisible();
  const gauge = panel.getByRole("progressbar", { name: "문제 진행" });
  await expect(gauge).toHaveAttribute("aria-valuemax", "5");
  await expect(gauge).toHaveAttribute("aria-valuenow", "0");
  await expect(panel.getByText("1 / 5")).toBeVisible();

  await card.getByText("HAVING", { exact: true }).click();
  await card.getByRole("button", { name: "확실해요" }).click();
  await expect(card.getByRole("region", { name: "채점 결과와 해설" })).toBeVisible();
  await expect(gauge).toHaveAttribute("aria-valuenow", "1");

  const next = panel.getByRole("button", { name: "다음 문제" });
  await expect(next).toBeVisible();
  const nextBox = await next.boundingBox();
  const panelBox = await page.getByRole("complementary", { name: "학습 패널" }).boundingBox();
  if (!nextBox || !panelBox) throw new Error("버튼과 패널이 화면에 있어야 한다.");
  expect(panelBox.y + panelBox.height - (nextBox.y + nextBox.height)).toBeLessThan(nextBox.height);
});
