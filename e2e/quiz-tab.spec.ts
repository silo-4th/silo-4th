import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { and, asc, eq, isNull } from "drizzle-orm";
import { concept, questionConcept, quizAttempt, quizProblem } from "@/lib/db/schema";
import type { ProblemView } from "@/lib/quiz-problems";
import { studyDay } from "@/lib/study-day";
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

async function startQuiz(page: Page) {
  await quizPanel(page).getByRole("button", { name: "AI 맞춤 문제 풀기" }).click();
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
  await startQuiz(page);
  const panel = quizPanel(page);
  await expect(panel.getByText(problem.stem)).toBeVisible();
  await expect(panel.getByText("1 / 3")).toBeVisible();
  await panel.getByText("HAVING", { exact: true }).click();

  await tab(page, "AI 에이전트").click();
  await expect(panel).toBeHidden();
  await tab(page, "퀴즈").click();

  await expect(panel.getByText(problem.stem)).toBeVisible();
  await expect(panel.getByText("1 / 3")).toBeVisible();
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
  await startQuiz(page);
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

test("TC-178 본 절도 대화도 없는 학습자가 퀴즈 홈에서 AI 맞춤 문제 풀기를 누르면 그 단원의 기본 문제가 개념 이름과 카운트와 함께 떠요", async ({ page }) => {
  const unit = await openFirstUnit(page);
  const defaults = await db
    .select({ stem: quizProblem.stem, conceptTitle: concept.title })
    .from(quizProblem)
    .innerJoin(concept, eq(concept.id, quizProblem.conceptId))
    .where(and(isNull(quizProblem.learnerId), isNull(quizProblem.retiredAt), eq(concept.unitId, unit.id)));
  expect(defaults.length).toBeGreaterThan(0);

  await tab(page, "퀴즈").click();
  const created = page.waitForResponse((response) => response.url().endsWith("/api/quiz-problems"));
  await startQuiz(page);
  const shown = (await (await created).json()) as ProblemView;

  const picked = defaults.find((row) => row.stem === shown.stem);
  expect(picked).toBeDefined();
  const panel = quizPanel(page);
  const card = panel.getByRole("region", { name: "퀴즈" });
  await expect(card).toBeVisible();
  await expect(card.getByText(picked?.conceptTitle ?? "", { exact: true })).toBeVisible();
  await expect(panel.getByText("1 / 3")).toBeVisible();
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
  await startQuiz(page);
  const card = quizPanel(page).getByRole("region", { name: "퀴즈" });
  await expect(card.getByText(view.stem)).toBeVisible();
  expect(bodies).toEqual([{ unitId: first.id }]);
  await expect(card.getByText(talked.title, { exact: true })).toBeVisible();

  await card.getByText("HAVING", { exact: true }).click();
  await card.getByRole("button", { name: "확실해요" }).click();
  await card.getByRole("button", { name: "정답 확인" }).click();
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
  await startQuiz(page);
  const panel = quizPanel(page);
  await expect(panel.getByText(unitProblem.stem)).toBeVisible();
  await expect(panel.getByText("1 / 3")).toBeVisible();

  await tab(page, "AI 에이전트").click();
  await page.getByRole("tabpanel", { name: "에이전트" }).getByRole("button", { name: "관련 문제 풀어보기" }).click();

  await expect(tab(page, "퀴즈")).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByText("문제를 만들고 있어요")).toBeVisible();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).toEqual({ questionId });

  releaseRelated();
  await expect(panel.getByText(relatedProblem.stem)).toBeVisible();
  await expect(panel.getByText("1 / 3")).toBeVisible();
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

async function storeProblem(
  learnerId: string,
  saved: { id: string; title: string },
  stem: string,
  explanation = "그룹 조건은 HAVING에 써요.",
): Promise<ProblemView> {
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
      explanation,
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
  await startQuiz(page);
  const panel = quizPanel(page);
  await expect(panel.getByText(view.stem)).toBeVisible();
  await expect(panel.getByText("1 / 3")).toBeVisible();
  await panel.getByText("HAVING", { exact: true }).click();

  await page.reload();
  await tab(page, "퀴즈").click();

  await expect(panel.getByText(view.stem)).toBeVisible();
  await expect(panel.getByText("1 / 3")).toBeVisible();
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
  await startQuiz(page);
  const panel = quizPanel(page);
  await expect(panel.getByText(view.stem)).toBeVisible();
  await expect(panel.getByText("1 / 3")).toBeVisible();

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
  await expect(panel.getByText("2 / 3")).toBeVisible();
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

test("TC-218 퀴즈 탭에서 답을 채점받으면 진행 게이지가 한 칸 차고, 다음 문제 버튼이 해설 바로 아래에 붙으며 해설이 길면 패널 아래에 고정돼요", async ({ page, learnerId }) => {
  const [first] = await firstUnits(1);
  if (!first) throw new Error("테스트 DB에 단원이 있어야 한다.");
  const saved = await firstConcept(first.id);
  const short = await storeProblem(learnerId, saved, "GROUP BY로 묶은 뒤 그룹 조건은 어디에 쓰나요?");
  const longExplanation = Array.from({ length: 40 }, (_, index) => `${index + 1}. 그룹을 만든 뒤 거르는 조건은 HAVING에 써요.`).join("\n\n");
  const long = await storeProblem(learnerId, saved, "그룹을 거르는 조건은 어디에 쓰나요?", longExplanation);
  const views = [short, long];
  let served = 0;
  await page.route(PROBLEMS_PATH, (route) => route.fulfill({ json: views[served++] }));

  await page.goto(`/study/${first.id}`);
  await tab(page, "퀴즈").click();
  await startQuiz(page);
  const panel = quizPanel(page);
  const card = panel.getByRole("region", { name: "퀴즈" });
  await expect(card.getByText(short.stem)).toBeVisible();
  const gauge = panel.getByRole("progressbar", { name: "문제 진행" });
  await expect(gauge).toHaveAttribute("aria-valuemax", "3");
  await expect(gauge).toHaveAttribute("aria-valuenow", "0");
  await expect(panel.getByText("1 / 3")).toBeVisible();
  await panel.getByRole("button", { name: "닫기", exact: true }).click();

  await card.getByText("HAVING", { exact: true }).click();
  await card.getByRole("button", { name: "확실해요" }).click();
  await card.getByRole("button", { name: "정답 확인" }).click();
  await expect(card.getByRole("region", { name: "채점 결과와 해설" })).toBeVisible();
  await expect(gauge).toHaveAttribute("aria-valuenow", "1");

  const learningPanel = page.getByRole("complementary", { name: "학습 패널" });
  const next = panel.getByRole("button", { name: "다음 문제" });
  await expect(next).toBeVisible();
  const nextBox = await next.boundingBox();
  const explanationBox = await card.getByText("그룹 조건은 HAVING에 써요.").boundingBox();
  const panelBox = await learningPanel.boundingBox();
  if (!nextBox || !explanationBox || !panelBox) throw new Error("버튼, 해설, 패널이 화면에 있어야 한다.");
  expect(nextBox.y - (explanationBox.y + explanationBox.height)).toBeLessThan(48);
  expect(panelBox.y + panelBox.height - (nextBox.y + nextBox.height)).toBeGreaterThan(nextBox.height);

  await next.click();
  await expect(card.getByText(long.stem)).toBeVisible();
  await card.getByText("HAVING", { exact: true }).click();
  await card.getByRole("button", { name: "확실해요" }).click();
  await card.getByRole("button", { name: "정답 확인" }).click();
  await expect(card.getByRole("region", { name: "채점 결과와 해설" })).toBeVisible();

  const pinned = panel.getByRole("button", { name: "다음 문제" });
  await expect(pinned).toBeVisible();
  const pinnedBox = await pinned.boundingBox();
  const longPanelBox = await learningPanel.boundingBox();
  if (!pinnedBox || !longPanelBox) throw new Error("버튼과 패널이 화면에 있어야 한다.");
  expect(longPanelBox.y + longPanelBox.height - (pinnedBox.y + pinnedBox.height)).toBeLessThan(pinnedBox.height);
});

test("TC-237 퀴즈 탭에 처음 들어가면 퀴즈 홈이 보이고 문제를 요청하지 않다가, AI 맞춤 문제 풀기를 누르면 열린 단원으로 첫 문제가 떠요", async ({ page, learnerId }) => {
  const [first] = await firstUnits(1);
  if (!first) throw new Error("테스트 DB에 단원이 있어야 한다.");
  const questionId = randomUUID();
  await saveAnswered(
    learnerId,
    { questionId, sessionId: randomUUID(), unitId: first.id, content: "GROUP BY 뒤에 조건은 어디에 쓰나요?" },
    "HAVING에 써요.",
  );
  await db.insert(questionConcept).values({ questionId, conceptId: (await firstConcept(first.id)).id });
  const problem = sampleProblem("그룹 조건은 어디에 쓰나요?");
  const bodies: unknown[] = [];
  await page.route(PROBLEMS_PATH, (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ json: problem });
  });

  await page.goto(`/study/${first.id}`);
  await tab(page, "퀴즈").click();
  const panel = quizPanel(page);
  await expect(panel.getByRole("button", { name: "AI 맞춤 문제 풀기" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "지난 문제 보기" })).toBeVisible();
  await expect(panel.getByText("문제를 출제해요")).toBeVisible();
  await expect(panel.getByText("기출 문제로 준비했어요")).toHaveCount(0);

  await tab(page, "AI 에이전트").click();
  await expect(panel).toBeHidden();
  await tab(page, "퀴즈").click();
  await expect(panel.getByRole("button", { name: "AI 맞춤 문제 풀기" })).toBeVisible();
  expect(bodies).toEqual([]);

  await startQuiz(page);
  await expect(panel.getByText(problem.stem)).toBeVisible();
  await expect(panel.getByText("1 / 3")).toBeVisible();
  expect(bodies).toEqual([{ unitId: first.id }]);
});

test("TC-238 이 단원에서 본 절도 대화도 없는 학습자는 퀴즈 홈에서 기출 문제로 준비했다는 안내를 봐요", async ({ page }) => {
  await openFirstUnit(page);
  await tab(page, "퀴즈").click();

  await expect(quizPanel(page).getByText("아직 나눈 대화가 없어서 기출 문제로 준비했어요")).toBeVisible();
});

async function solveSet(page: Page, views: ProblemView[]) {
  const panel = quizPanel(page);
  for (const [index, view] of views.entries()) {
    const card = panel.getByRole("region", { name: "퀴즈" });
    await expect(card.getByText(view.stem)).toBeVisible();
    await card.getByText("HAVING", { exact: true }).click();
    await card.getByRole("button", { name: "확실해요" }).click();
    await card.getByRole("button", { name: "정답 확인" }).click();
    await expect(card.getByRole("region", { name: "채점 결과와 해설" })).toBeVisible();
    if (index === views.length - 1) break;
    await expect(panel.getByRole("button", { name: "결과 보기" })).toHaveCount(0);
    await panel.getByRole("button", { name: "다음 문제" }).click();
  }
  await expect(panel.getByRole("button", { name: "다음 문제" })).toHaveCount(0);
  await panel.getByRole("button", { name: "결과 보기" }).click();
}

async function storeProblems(learnerId: string, unitId: string, count: number) {
  const saved = await firstConcept(unitId);
  const views: ProblemView[] = [];
  for (let index = 1; index <= count; index += 1) views.push(await storeProblem(learnerId, saved, `그룹 조건 문제 ${index}`));
  return views;
}

test("TC-248 퀴즈 탭에서 세 문제를 풀면 마지막 문제에 결과 보기가 보이고, 누르면 제목, 문항별 칩, 안내, 새 문제 풀기, 지난 문제 보기, 퀴즈 홈 버튼이 보여요", async ({ page, learnerId }) => {
  const [first] = await firstUnits(1);
  if (!first) throw new Error("테스트 DB에 단원이 있어야 한다.");
  const views = await storeProblems(learnerId, first.id, 3);
  let served = 0;
  await page.route(PROBLEMS_PATH, (route) => route.fulfill({ json: views[served++] }));

  await page.goto(`/study/${first.id}`);
  await tab(page, "퀴즈").click();
  await startQuiz(page);
  await solveSet(page, views);

  const panel = quizPanel(page);
  await expect(panel.getByRole("heading", { name: "3개 모두 맞혔어요" })).toBeVisible();
  await expect(panel.getByText("맞혔어요", { exact: true })).toHaveCount(3);
  await expect(panel.getByText("이 흐름 그대로 다음 단원으로 가도 좋아요.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "새 문제 풀기" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "지난 문제 보기" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "퀴즈 홈" })).toBeVisible();
  expect(served).toBe(3);
});

test("TC-282 퀴즈 탭 결과 화면에서 지난 문제 보기를 누르면 방금 푼 문제가 있는 지난 문제 목록이 열리고, 돌아가기를 누르면 결과 화면으로 돌아와요", async ({ page, learnerId }) => {
  const [first] = await firstUnits(1);
  if (!first) throw new Error("테스트 DB에 단원이 있어야 한다.");
  const views = await storeProblems(learnerId, first.id, 3);
  let served = 0;
  await page.route(PROBLEMS_PATH, (route) => route.fulfill({ json: views[served++] }));

  await page.goto(`/study/${first.id}`);
  await tab(page, "퀴즈").click();
  await startQuiz(page);
  await solveSet(page, views);

  const panel = quizPanel(page);
  const title = panel.getByRole("heading", { name: "3개 모두 맞혔어요" });
  await expect(title).toBeVisible();
  await panel.getByRole("button", { name: "지난 문제 보기" }).click();

  await expect(panel.getByRole("list", { name: "지난 문제 목록" }).getByRole("listitem")).toHaveCount(3);
  await panel.getByRole("button", { name: "돌아가기" }).click();
  await expect(title).toBeVisible();
});

test("TC-257 세 문제를 풀고 결과 화면에서 새 문제 풀기를 누르면 베타 안내 모달이 뜨고, 퀴즈 홈으로 나가 새로고침한 뒤 AI 맞춤 문제 풀기를 눌러도 같은 안내가 뜨며 문제를 만들지 않아요", async ({ page, learnerId }) => {
  const [first] = await firstUnits(1);
  if (!first) throw new Error("테스트 DB에 단원이 있어야 한다.");
  const views = await storeProblems(learnerId, first.id, 3);
  let served = 0;
  await page.route(PROBLEMS_PATH, (route) => route.fulfill({ json: views[served++] }));

  await page.goto(`/study/${first.id}`);
  await tab(page, "퀴즈").click();
  await startQuiz(page);
  await solveSet(page, views);

  const panel = quizPanel(page);
  const notice = page.getByRole("dialog", { name: "아직 베타 단계예요" });
  await panel.getByRole("button", { name: "새 문제 풀기" }).click();
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: "확인" }).click();
  await expect(notice).toBeHidden();
  await panel.getByRole("button", { name: "퀴즈 홈" }).click();

  await page.reload();
  await tab(page, "퀴즈").click();
  await startQuiz(page);
  await expect(notice).toBeVisible();
  await expect(panel.getByRole("button", { name: "AI 맞춤 문제 풀기" })).toBeVisible();
  expect(served).toBe(3);
});

test("TC-255 퀴즈 홈에서 지난 문제 보기를 누르면 푼 문제가 보이고, 거르고 펼쳐 답과 해설을 본 뒤 돌아가기로 퀴즈 홈에 와요", async ({ page, learnerId }) => {
  const [first] = await firstUnits(1);
  if (!first) throw new Error("테스트 DB에 단원이 있어야 한다.");
  const views = await storeProblems(learnerId, first.id, 3);
  let served = 0;
  await page.route(PROBLEMS_PATH, (route) => route.fulfill({ json: views[served++] }));

  await page.goto(`/study/${first.id}`);
  await tab(page, "퀴즈").click();
  const panel = quizPanel(page);
  const home = panel.getByRole("button", { name: "AI 맞춤 문제 풀기" });
  const past = panel.getByRole("button", { name: "지난 문제 보기" });
  const back = panel.getByRole("button", { name: "돌아가기" });
  await expect(home).toBeVisible();

  await past.click();
  await expect(panel.getByText("아직 푼 확인 문제가 없어요.")).toBeVisible();
  await expect(panel.getByText("문제를 풀면 여기에 모여요.")).toBeVisible();
  await back.click();
  await expect(home).toBeVisible();

  await startQuiz(page);
  for (const [index, view] of views.entries()) {
    const card = panel.getByRole("region", { name: "퀴즈" });
    await expect(card.getByText(view.stem)).toBeVisible();
    await card.getByText(index === 1 ? "WHERE" : "HAVING", { exact: true }).click();
    await card.getByRole("button", { name: "확실해요" }).click();
    await card.getByRole("button", { name: "정답 확인" }).click();
    await expect(card.getByRole("region", { name: "채점 결과와 해설" })).toBeVisible();
    await panel.getByRole("button", { name: index === views.length - 1 ? "결과 보기" : "다음 문제" }).click();
  }
  await panel.getByRole("button", { name: "퀴즈 홈" }).click();
  await past.click();

  const list = panel.getByRole("list", { name: "지난 문제 목록" });
  const items = list.getByRole("listitem");
  await expect(items).toHaveCount(3);
  const expected = [
    { stem: views[2]?.stem, chip: "맞혔어요" },
    { stem: views[1]?.stem, chip: "틀렸어요" },
    { stem: views[0]?.stem, chip: "맞혔어요" },
  ];
  for (const [index, { stem, chip }] of expected.entries()) {
    const item = items.nth(index);
    await expect(item.getByText(stem ?? "", { exact: true })).toBeVisible();
    await expect(item.getByText(first.title, { exact: true })).toBeVisible();
    await expect(item.getByText("객관식", { exact: true })).toBeVisible();
    await expect(item.getByText(chip, { exact: true })).toBeVisible();
  }

  await panel.getByRole("button", { name: "틀림", exact: true }).click();
  await expect(items).toHaveCount(1);
  const wrong = items.first();
  await expect(wrong.getByText(views[1]?.stem ?? "", { exact: true })).toBeVisible();

  await wrong.getByText(views[1]?.stem ?? "", { exact: true }).click();
  await expect(wrong.getByText("내 답", { exact: true })).toBeVisible();
  await expect(wrong.getByText("WHERE", { exact: true })).toBeVisible();
  await expect(wrong.getByText("정답", { exact: true })).toBeVisible();
  await expect(wrong.getByText("HAVING", { exact: true })).toBeVisible();
  await expect(wrong.getByText("그룹 조건은 HAVING에 써요.", { exact: true })).toBeVisible();

  await back.click();
  await expect(home).toBeVisible();
});

test("TC-278 지난 문제 목록을 불러오는 동안 뼈대가 보이고, 불러오지 못하면 목록을 불러오지 못했어요와 다시 시도가 보이며, 다시 시도하면 목록이 보여요", async ({ page, learnerId }) => {
  const [first] = await firstUnits(1);
  if (!first) throw new Error("테스트 DB에 단원이 있어야 한다.");
  const view = await storeProblem(learnerId, await firstConcept(first.id), "그룹 조건은 어디에 쓰나요?");
  await db.insert(quizAttempt).values({
    id: randomUUID(),
    learnerId,
    problemId: view.id,
    studyDay: studyDay(new Date()),
    chosenIndex: 1,
    confidence: "sure",
    isCorrect: true,
    appVersion: "e2e",
  });
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let retried = false;
  let listedAfterRetry = 0;
  await page.route("**/api/quiz-attempts", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    if (retried) {
      listedAfterRetry += 1;
      return route.continue();
    }
    await held;
    return route.fulfill({ status: 500 });
  });

  await page.goto(`/study/${first.id}`);
  await tab(page, "퀴즈").click();
  const panel = quizPanel(page);
  await panel.getByRole("button", { name: "지난 문제 보기" }).click();

  await expect(panel.getByRole("status").filter({ hasText: "지난 문제를 불러오고 있어요" })).toHaveCount(1);
  release();

  const failed = panel.getByRole("heading", { name: "목록을 불러오지 못했어요" });
  await expect(failed).toBeVisible();
  retried = true;
  await panel.getByRole("button", { name: "다시 시도" }).click();

  await expect(panel.getByRole("list", { name: "지난 문제 목록" }).getByText(view.stem, { exact: true })).toBeVisible();
  await expect(failed).toHaveCount(0);
  expect(listedAfterRetry).toBeGreaterThan(0);
});
