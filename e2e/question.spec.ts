import { randomUUID } from "node:crypto";
import { expect, type Page, type Route } from "@playwright/test";
import { createLearner, deleteLearner, firstUnits, saveAnswered, test } from "./fixtures";

type AskBody = { questionId: string; sessionId: string; unitId: string; content: string };
type StreamStub = { answerStreams: ((chunk: string) => void)[] };

const delta = (text: string) => `event: delta\ndata: ${JSON.stringify({ text })}\n\n`;
const DONE = "event: done\ndata: {}\n\n";
const ERROR = "event: error\ndata: {}\n\n";
const FAILED = "답을 가져오지 못했어요. 다시 보내 주세요.";

function fulfillStream(route: Route, body: string) {
  return route.fulfill({ status: 200, contentType: "text/event-stream; charset=utf-8", body });
}

function openedUnitId(page: Page) {
  return new URL(page.url()).pathname.split("/").at(-1);
}

// route.fulfill은 본문을 한 번에 보내므로, 조각 사이에 멈춘 응답은 브라우저의 fetch를 바꿔 흉내 낸다.
async function stubAnswerStreams(page: Page) {
  await page.addInitScript(() => {
    const stub = window as unknown as StreamStub;
    stub.answerStreams = [];
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.includes("/api/questions")) return original(input, init);
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          stub.answerStreams.push((chunk) => controller.enqueue(encoder.encode(chunk)));
        },
      });
      return Promise.resolve(new Response(body, { headers: { "Content-Type": "text/event-stream" } }));
    };
  });
  return async (request: number, chunk: string) => {
    await page.waitForFunction((index) => (window as unknown as StreamStub).answerStreams.length > index, request);
    await page.evaluate(
      ([index, value]) => (window as unknown as StreamStub).answerStreams[index]?.(value),
      [request, chunk] as const,
    );
  };
}

test("TC-51 실패한 질문을 다시 보내면 같은 질문으로 이어져 답을 받아요", async ({ page }) => {
  const [, second] = await firstUnits(2);
  if (!second) throw new Error("테스트 DB에 단원이 두 개 이상 있어야 한다.");
  const question = "GROUP BY 없이 HAVING만 쓸 수 있나요?";
  const answer = "네, 테이블 전체를 한 그룹으로 보고 HAVING을 적용해요.";
  const bodies: AskBody[] = [];
  await page.route("**/api/questions", (route) => {
    bodies.push(route.request().postDataJSON() as AskBody);
    return fulfillStream(route, bodies.length === 1 ? delta("네, 테이블") + ERROR : delta(answer) + DONE);
  });
  const conversation = page.getByRole("list", { name: "대화" }).getByRole("listitem");

  await page.goto("/study");
  await expect(page).toHaveURL(/\/study\/[^/]+$/);
  const unitA = openedUnitId(page);
  await page.getByRole("textbox", { name: "질문" }).fill(question);
  await page.getByRole("button", { name: "보내기", exact: true }).click();

  await expect(page.getByText(FAILED)).toBeVisible();

  await page.getByRole("button", { name: "강의 목록" }).click();
  await page.getByRole("link", { name: second.title, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: second.title, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "다시 시도" }).click();

  await expect(conversation.filter({ hasText: answer })).toHaveText(answer);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(bodies[0]).toMatchObject({ unitId: unitA, content: question });
  await expect(conversation.filter({ hasText: question })).toHaveCount(1);
  await expect(page.getByText(FAILED)).toHaveCount(0);
});

test("TC-52 질문을 보내면 보내는 중 표시가 나오고, 답이 오면 대화 목록에 붙어요", async ({ page }) => {
  const bodies: AskBody[] = [];
  let release = () => {};
  const firstAnswerHeld = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/questions", async (route) => {
    bodies.push(route.request().postDataJSON() as AskBody);
    if (bodies.length === 1) await firstAnswerHeld;
    await fulfillStream(route, delta("WHERE는 묶기 전 행을, ") + delta("HAVING은 묶은 그룹을 걸러요.") + DONE);
  });
  const input = page.getByRole("textbox", { name: "질문" });
  const send = page.getByRole("button", { name: "보내기", exact: true });
  const conversation = page.getByRole("list", { name: "대화" }).getByRole("listitem");
  const sending = page.getByRole("status");

  await page.goto("/study");
  await expect(page).toHaveURL(/\/study\/[^/]+$/);
  await input.fill("WHERE와 HAVING은 언제 다르게 쓰나요?");
  await send.click();

  await expect(sending).toHaveText("답을 준비하고 있어요");
  await expect(conversation).toHaveCount(1);

  release();

  await expect(conversation.nth(1)).toHaveText("WHERE는 묶기 전 행을, HAVING은 묶은 그룹을 걸러요.");
  await expect(sending).toHaveText("");
  expect(bodies[0]?.unitId).toBe(openedUnitId(page));

  await input.fill("HAVING에 집계 함수 말고 컬럼을 바로 써도 되나요?");
  await send.click();

  await expect(conversation).toHaveCount(4);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]?.questionId).not.toBe(bodies[0]?.questionId);
});

test("TC-55 답 조각이 오는 대로 질문 아래에 이어서 보여요", async ({ page }) => {
  const push = await stubAnswerStreams(page);
  const input = page.getByRole("textbox", { name: "질문" });
  const send = page.getByRole("button", { name: "보내기", exact: true });
  const conversation = page.getByRole("list", { name: "대화" }).getByRole("listitem");

  await page.goto("/study");
  await input.fill("WHERE와 HAVING은 언제 다르게 쓰나요?");
  await send.click();
  await push(0, delta("WHERE는 묶기 전 행을 걸러요."));

  await expect(conversation.nth(1)).toHaveText("WHERE는 묶기 전 행을 걸러요.");

  await push(0, delta(" HAVING은 묶은 그룹을 걸러요.") + DONE);

  await expect(conversation.nth(1)).toHaveText("WHERE는 묶기 전 행을 걸러요. HAVING은 묶은 그룹을 걸러요.");
  await expect(conversation).toHaveCount(2);

  await input.fill("집계 함수도 쓸 수 있나요?");
  await send.click();
  await push(1, delta("그룹마다 한 번씩"));
  await expect(page.getByText("그룹마다 한 번씩")).toBeVisible();
  await push(1, ERROR);

  await expect(page.getByText(FAILED)).toBeVisible();
  await expect(page.getByText("그룹마다 한 번씩")).toHaveCount(0);
});

test("TC-56 첫 글자가 5초 동안 오지 않으면 기다리는 중 문구로 바뀌어요", async ({ page }) => {
  const start = new Date("2026-11-04T09:00:00+09:00");
  await page.clock.install({ time: start });
  const sending = page.getByRole("status");

  await page.goto("/study");
  await page.clock.pauseAt(new Date(start.getTime() + 60_000));
  await page.getByRole("textbox", { name: "질문" }).fill("WHERE와 HAVING은 언제 다르게 쓰나요?");
  await page.getByRole("button", { name: "보내기", exact: true }).click();

  await expect(sending).toHaveText("답을 준비하고 있어요");
  await page.clock.runFor(4_900);
  await expect(sending).toHaveText("답을 준비하고 있어요");
  await page.clock.runFor(100);
  await expect(sending).toHaveText("답을 기다리는 중이에요");
});

test("TC-57 끊긴 질문을 다시 시도했는데 처리 중이면 새 질문 ID로 바로 다시 보내요", async ({ page }) => {
  const answer = "네, 테이블 전체를 한 그룹으로 보고 HAVING을 적용해요.";
  const question = "GROUP BY 없이 HAVING만 쓸 수 있나요?";
  const bodies: AskBody[] = [];
  await page.route("**/api/questions", (route) => {
    bodies.push(route.request().postDataJSON() as AskBody);
    if (bodies.length === 1) return fulfillStream(route, delta("네, 테이블"));
    if (bodies.length === 2) return route.fulfill({ status: 409 });
    return fulfillStream(route, delta(answer) + DONE);
  });
  const conversation = page.getByRole("list", { name: "대화" }).getByRole("listitem");

  await page.goto("/study");
  await page.getByRole("textbox", { name: "질문" }).fill(question);
  await page.getByRole("button", { name: "보내기", exact: true }).click();

  await expect(page.getByText("응답이 끊겼어요")).toBeVisible();

  await page.getByRole("button", { name: "다시 시도" }).click();

  await expect(conversation.filter({ hasText: answer })).toHaveText(answer);
  expect(bodies).toHaveLength(3);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(bodies[2]).toMatchObject({ unitId: bodies[0]?.unitId, content: question });
  expect(bodies[2]?.questionId).not.toBe(bodies[0]?.questionId);
  await expect(conversation.filter({ hasText: question })).toHaveCount(1);
  await expect(page.getByText("응답이 끊겼어요")).toHaveCount(0);
});

test("TC-58 질문을 보냈는데 로그인이 풀렸으면 첫 화면으로 가요", async ({ page, context }) => {
  await page.route("**/api/questions", async (route) => {
    await context.clearCookies();
    await route.fulfill({ status: 401 });
  });

  await page.goto("/study");
  await page.getByRole("textbox", { name: "질문" }).fill("GROUP BY 없이 HAVING만 쓸 수 있나요?");
  await page.getByRole("button", { name: "보내기", exact: true }).click();

  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(page.getByText(FAILED)).toHaveCount(0);
});

function panel(page: Page) {
  return {
    input: page.getByRole("textbox", { name: "질문" }),
    send: page.getByRole("button", { name: "보내기", exact: true }),
    newSession: page.getByRole("button", { name: "새 대화", exact: true }),
    history: page.getByRole("button", { name: "대화 기록", exact: true }),
    conversation: page.getByRole("list", { name: "대화" }).getByRole("listitem"),
    sessions: page.getByRole("list", { name: "세션 목록" }).getByRole("listitem"),
  };
}

test("TC-77 새 대화를 만들어 질문한 뒤 이전 대화로 돌아가면 그 대화의 질문과 답이 보이고, 새로고침해도 보고 있던 대화가 열려요", async ({
  page,
  context,
  learnerId,
}) => {
  await page.route("**/api/questions", async (route) => {
    const body = route.request().postDataJSON() as AskBody;
    const answer = `${body.content}의 답`;
    await saveAnswered(learnerId, body, answer);
    await fulfillStream(route, delta(answer) + DONE);
  });
  const { input, send, newSession, history, conversation, sessions } = panel(page);

  await page.goto("/study");
  await input.fill("질문 A");
  await send.click();
  await expect(conversation).toHaveText(["질문 A", "질문 A의 답"]);
  await history.click();
  await expect(sessions).toHaveCount(1);
  await page.keyboard.press("Escape");

  await newSession.click();

  await expect(conversation).toHaveCount(0);
  await history.click();
  await expect(sessions).toHaveCount(1);
  await page.keyboard.press("Escape");

  await input.fill("질문 B");
  await send.click();
  await expect(conversation).toHaveText(["질문 B", "질문 B의 답"]);
  await history.click();
  await expect(sessions).toHaveCount(2);

  await sessions.getByRole("button", { name: "질문 A" }).click();

  await expect(conversation).toHaveText(["질문 A", "질문 A의 답"]);

  await page.reload();

  await expect(conversation).toHaveText(["질문 A", "질문 A의 답"]);
  await history.click();
  await expect(sessions).toHaveCount(2);

  const tab = await context.newPage();
  await tab.goto("/study");

  await expect(panel(tab).conversation).toHaveText(["질문 B", "질문 B의 답"]);
});

test("TC-78 다른 학습자의 대화는 목록에 나오지 않고, 직접 요청해도 내용을 받지 못해요", async ({ page }) => {
  const [first] = await firstUnits(1);
  if (!first) throw new Error("테스트 DB에 단원이 없다.");
  const other = await createLearner();
  try {
    const sessionId = randomUUID();
    await saveAnswered(other, { questionId: randomUUID(), sessionId, unitId: first.id, content: "A의 질문" }, "A의 답");
    const listed = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/question-sessions");

    await page.goto("/study");
    await listed;

    await expect(page.getByText("A의 질문")).toHaveCount(0);

    const response = await page.request.get(`/api/question-sessions/${sessionId}`);

    expect(response.ok()).toBe(false);
    const body = await response.text();
    expect(body).not.toContain("A의 질문");
    expect(body).not.toContain("A의 답");
  } finally {
    await deleteLearner(other);
  }
});

test("TC-79 답을 받는 중에 다른 대화로 옮겨도 답은 질문한 대화에만 붙어요", async ({ page }) => {
  const push = await stubAnswerStreams(page);
  const { input, send, newSession, history, conversation, sessions } = panel(page);

  await page.goto("/study");
  await input.fill("이전 대화 질문");
  await send.click();
  await push(0, delta("이전 답") + DONE);
  await expect(conversation).toHaveText(["이전 대화 질문", "이전 답"]);

  await newSession.click();
  await input.fill("새 대화 질문");
  await send.click();
  await push(1, delta("새 답 앞부분"));
  await expect(page.getByText("새 답 앞부분")).toBeVisible();

  await history.click();
  await sessions.getByRole("button", { name: "이전 대화 질문" }).click();

  await expect(conversation).toHaveText(["이전 대화 질문", "이전 답"]);
  await push(1, delta(" 뒷부분") + DONE);
  await expect(conversation).toHaveText(["이전 대화 질문", "이전 답"]);

  await history.click();
  await sessions.getByRole("button", { name: "새 대화 질문" }).click();

  await expect(conversation).toHaveText(["새 대화 질문", "새 답 앞부분 뒷부분"]);
});

test("TC-80 학습셋을 바꿔도 지금 대화가 그대로 남아요", async ({ page }) => {
  const [, second] = await firstUnits(2);
  if (!second) throw new Error("테스트 DB에 단원이 두 개 이상 있어야 한다.");
  await page.route("**/api/questions", (route) => fulfillStream(route, delta("남아 있을 답") + DONE));
  const { input, send, history, conversation, sessions } = panel(page);

  await page.goto("/study");
  await input.fill("남아 있을 질문");
  await send.click();
  await expect(conversation).toHaveText(["남아 있을 질문", "남아 있을 답"]);
  await history.click();
  await expect(sessions).toHaveCount(1);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "강의 목록" }).click();
  await page.getByRole("link", { name: second.title, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: second.title, exact: true })).toBeVisible();

  await expect(conversation).toHaveText(["남아 있을 질문", "남아 있을 답"]);
  await history.click();
  await expect(sessions).toHaveCount(1);
});
