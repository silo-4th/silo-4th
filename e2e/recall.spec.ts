import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { asc, eq } from "drizzle-orm";
import { concept, type QuizAnswer, quizAttempt, quizProblem, recallItem, recallSet } from "@/lib/db/schema";
import { studyDay } from "@/lib/study-day";
import { db, firstUnits, saveAnswered, test } from "./fixtures";

type Format = "mcq" | "blank" | "free";
type Reason = "read_no_question" | "asked";

const PREPARE_PATH = "**/api/recall-sets";
const DAY_MS = 24 * 60 * 60 * 1000;

const PROBLEMS: Record<Format, { stem: string; answer: QuizAnswer }> = {
  mcq: {
    stem: "그룹 조건은 어디에 쓰나요?",
    answer: { choices: [{ text: "WHERE" }, { text: "HAVING" }, { text: "ORDER BY" }, { text: "LIMIT" }], answerIndex: 1 },
  },
  free: {
    stem: "WHERE와 HAVING의 차이를 설명해 보세요.",
    answer: { modelAnswer: "WHERE는 묶기 전에, HAVING은 묶은 뒤에 거른다.", keyPoints: ["묶기 전", "묶은 뒤"] },
  },
  blank: { stem: "그룹을 거르는 절은 ____예요.", answer: { accepted: ["HAVING"] } },
};

function yesterday() {
  return studyDay(new Date(Date.now() - DAY_MS));
}

async function firstUnit() {
  const [first] = await firstUnits(1);
  if (!first) throw new Error("테스트 DB에 단원이 있어야 한다.");
  return first;
}

// 진입할 때 서버가 만들었을 세트를 DB에 직접 넣는다. 문제는 학습자 것으로 만들어 학습자를 지울 때 함께 지워진다.
async function seedSet(learnerId: string, items: { format: Format; reason: Reason }[]) {
  const unit = await firstUnit();
  const concepts = await db
    .select({ id: concept.id, title: concept.title })
    .from(concept)
    .where(eq(concept.unitId, unit.id))
    .orderBy(asc(concept.id))
    .limit(items.length);
  if (concepts.length < items.length) throw new Error("테스트 DB의 첫 단원에 개념이 모자란다.");

  const [set] = await db.insert(recallSet).values({ learnerId, sourceStudyDay: yesterday() }).returning();
  if (!set) throw new Error("세트를 넣지 못했다.");
  const seeded = [];
  for (const [index, { format, reason }] of items.entries()) {
    const target = concepts[index];
    if (!target) throw new Error("개념이 모자란다.");
    const [problem] = await db
      .insert(quizProblem)
      .values({ learnerId, conceptId: target.id, format, ...PROBLEMS[format], hint: "힌트", explanation: "해설" })
      .returning({ id: quizProblem.id });
    if (!problem) throw new Error("문제를 넣지 못했다.");
    let sourceQuestionId: string | null = null;
    if (reason === "asked") {
      sourceQuestionId = randomUUID();
      await saveAnswered(
        learnerId,
        { questionId: sourceQuestionId, sessionId: randomUUID(), unitId: unit.id, content: "그룹 조건은 어디에 쓰나요?" },
        "HAVING에 써요.",
      );
    }
    const [created] = await db
      .insert(recallItem)
      .values({ setId: set.id, position: index + 1, reason, sourceQuestionId, problemId: problem.id })
      .returning({ id: recallItem.id });
    if (!created) throw new Error("문항을 넣지 못했다.");
    seeded.push({ id: created.id, conceptTitle: target.title });
  }
  return { setId: set.id, unit, items: seeded };
}

function setTimes(setId: string) {
  return db
    .select({ shownAt: recallSet.shownAt, postponedAt: recallSet.postponedAt, startedAt: recallSet.startedAt, completedAt: recallSet.completedAt })
    .from(recallSet)
    .where(eq(recallSet.id, setId))
    .then(([row]) => row);
}

function recallScreen(page: Page) {
  return page.getByRole("main", { name: "꺼내 먹기" });
}

test("TC-202 어제 학습한 학습자가 오늘 처음 학습 화면에 들어오면 세트를 준비한 뒤 꺼내 먹기 입구를 전체 화면으로 띄워 꺼낼 개념과 이유를 보여 줘요", async ({ page, learnerId }) => {
  const order: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname === "/api/recall-sets" || pathname === "/api/recall-sets/today") order.push(pathname);
  });
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let seeded: Awaited<ReturnType<typeof seedSet>> | undefined;
  await page.route(PREPARE_PATH, async (route) => {
    seeded = await seedSet(learnerId, [
      { format: "mcq", reason: "read_no_question" },
      { format: "free", reason: "read_no_question" },
      { format: "blank", reason: "asked" },
    ]);
    await held;
    return route.fulfill({ status: 204 });
  });

  const unit = await firstUnit();
  await page.goto(`/study/${unit.id}`);
  await expect(page.getByText("어제 공부한 내용을 챙기고 있어요")).toBeVisible();
  release();

  const screen = recallScreen(page);
  await expect(screen.getByRole("heading", { name: "지난번에 공부한 것 중 3개를 꺼내 볼게요" })).toBeVisible();
  expect(order).toEqual(["/api/recall-sets", "/api/recall-sets/today"]);
  if (!seeded) throw new Error("세트를 넣지 못했다.");
  for (const { conceptTitle } of seeded.items) {
    await expect(screen.getByText(conceptTitle, { exact: true })).toBeVisible();
  }
  await expect(screen.getByText("넘어감", { exact: true })).toHaveCount(2);
  await expect(screen.getByText("물어봄", { exact: true })).toHaveCount(1);
  await expect(screen.getByRole("button", { name: "시작하기" })).toBeVisible();
  await expect(screen.getByRole("button", { name: "오늘은 건너뛸게요" })).toBeVisible();
  expect((await setTimes(seeded.setId))?.shownAt).not.toBeNull();
});

test("TC-203 띄울 세트가 없거나 세트 준비 요청이 실패한 학습자는 꺼내 먹기 없이 학습 화면을 그대로 써요", async ({ page }) => {
  const unit = await firstUnit();
  const title = page.getByRole("heading", { level: 1, name: unit.title, exact: true });

  const prepared = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/recall-sets");
  await page.goto(`/study/${unit.id}`);
  expect((await prepared).status()).toBe(204);
  await expect(title).toBeVisible();
  await expect(recallScreen(page)).toHaveCount(0);

  let failed = 0;
  await page.route(PREPARE_PATH, (route) => {
    failed += 1;
    return route.fulfill({ status: 500 });
  });
  await page.goto(`/study/${unit.id}`);
  await expect.poll(() => failed).toBe(1);
  await expect(title).toBeVisible();
  await expect(recallScreen(page)).toHaveCount(0);
});

test("TC-204 시작하기를 누르고 문항을 풀거나 건너뛰면 풀이가 문항 ID와 함께 저장되고, 마지막 문항 뒤 결과 단계로 넘어가며 시작과 완료 시각이 남아요", async ({ page, learnerId }) => {
  const { setId, unit, items } = await seedSet(learnerId, [
    { format: "mcq", reason: "read_no_question" },
    { format: "free", reason: "read_no_question" },
    { format: "blank", reason: "read_no_question" },
  ]);
  const [first, second, third] = items;
  if (!first || !second || !third) throw new Error("문항이 3개여야 한다.");

  await page.goto(`/study/${unit.id}`);
  const screen = recallScreen(page);
  await screen.getByRole("button", { name: "시작하기" }).click();

  const card = screen.getByRole("region", { name: "퀴즈" });
  await expect(screen.getByText("1 / 3")).toBeVisible();
  await card.getByText("HAVING", { exact: true }).click();
  await card.getByRole("button", { name: "확실해요" }).click();
  await card.getByRole("button", { name: "정답 확인" }).click();
  await expect(card.getByRole("region", { name: "채점 결과와 해설" })).toBeVisible();
  await card.getByRole("button", { name: "다음 문제" }).click();

  await expect(screen.getByText("2 / 3")).toBeVisible();
  await screen.getByRole("button", { name: "이 문제 건너뛰기" }).click();

  await expect(screen.getByText("3 / 3")).toBeVisible();
  await card.getByRole("textbox", { name: "빈칸에 들어갈 말" }).fill("HAVING");
  await card.getByRole("button", { name: "애매해요" }).click();
  await card.getByRole("button", { name: "정답 확인" }).click();
  await expect(card.getByRole("region", { name: "채점 결과와 해설" })).toBeVisible();
  await card.getByRole("button", { name: "결과 보기" }).click();

  await expect(screen.getByRole("heading", { name: "3개 중 1개를 틀렸어요" })).toBeVisible();

  const attempts = await db
    .select({ recallItemId: quizAttempt.recallItemId })
    .from(quizAttempt)
    .where(eq(quizAttempt.learnerId, learnerId));
  expect(attempts.map((row) => row.recallItemId).sort()).toEqual([first.id, third.id].sort());
  await expect.poll(async () => (await setTimes(setId))?.completedAt).not.toBeNull();
  const times = await setTimes(setId);
  expect(times?.startedAt).not.toBeNull();
  expect(times?.postponedAt).toBeNull();
});

test("TC-205 오늘은 건너뛸게요를 누르면 세트에 미룬 시각이 저장되고 학습 화면으로 가요", async ({ page, learnerId }) => {
  const { setId, unit } = await seedSet(learnerId, [{ format: "mcq", reason: "read_no_question" }]);

  await page.goto(`/study/${unit.id}`);
  const screen = recallScreen(page);
  await screen.getByRole("button", { name: "오늘은 건너뛸게요" }).click();

  await expect(page.getByRole("heading", { level: 1, name: unit.title, exact: true })).toBeVisible();
  await expect(screen).toHaveCount(0);
  await expect.poll(async () => (await setTimes(setId))?.postponedAt).not.toBeNull();
  expect((await setTimes(setId))?.startedAt).toBeNull();
});

test("TC-236 꺼내 먹기를 푸는 중에 새로고침하면 입구 없이 남은 문항부터 이어 풀고, 결과에 앞서 푼 문항도 보이며 완료 시각이 남아요", async ({ page, learnerId }) => {
  const { setId, unit, items } = await seedSet(learnerId, [
    { format: "mcq", reason: "read_no_question" },
    { format: "mcq", reason: "read_no_question" },
  ]);
  const [first, second] = items;
  if (!first || !second) throw new Error("문항이 2개여야 한다.");

  await page.goto(`/study/${unit.id}`);
  const screen = recallScreen(page);
  await screen.getByRole("button", { name: "시작하기" }).click();

  const card = screen.getByRole("region", { name: "퀴즈" });
  await expect(screen.getByText("1 / 2")).toBeVisible();
  await card.getByText("HAVING", { exact: true }).click();
  await card.getByRole("button", { name: "확실해요" }).click();
  await card.getByRole("button", { name: "정답 확인" }).click();
  await expect(card.getByRole("region", { name: "채점 결과와 해설" })).toBeVisible();
  await card.getByRole("button", { name: "다음 문제" }).click();
  await expect(screen.getByText("2 / 2")).toBeVisible();
  await expect.poll(async () => (await setTimes(setId))?.startedAt).not.toBeNull();

  await page.reload();

  await expect(screen.getByText("2 / 2")).toBeVisible();
  await expect(screen.getByRole("button", { name: "시작하기" })).toHaveCount(0);
  await card.getByText("HAVING", { exact: true }).click();
  await card.getByRole("button", { name: "확실해요" }).click();
  await card.getByRole("button", { name: "정답 확인" }).click();
  await expect(card.getByRole("region", { name: "채점 결과와 해설" })).toBeVisible();
  await card.getByRole("button", { name: "결과 보기" }).click();

  await expect(screen.getByRole("heading", { name: "2개 모두 맞혔어요" })).toBeVisible();
  await expect(screen.getByText(`1. ${first.conceptTitle}`)).toBeVisible();
  await expect(screen.getByText(`2. ${second.conceptTitle}`)).toBeVisible();

  const attempts = await db
    .select({ recallItemId: quizAttempt.recallItemId })
    .from(quizAttempt)
    .where(eq(quizAttempt.learnerId, learnerId));
  expect(attempts.map((row) => row.recallItemId).sort()).toEqual([first.id, second.id].sort());
  await expect.poll(async () => (await setTimes(setId))?.completedAt).not.toBeNull();
  expect((await setTimes(setId))?.startedAt).not.toBeNull();
});
