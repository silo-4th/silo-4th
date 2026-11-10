import { expect, type Page, type Route } from "@playwright/test";
import { test } from "./fixtures";

type AskBody = { questionId: string; content: string };

const delta = (text: string) => `event: delta\ndata: ${JSON.stringify({ text })}\n\n`;
const DONE = "event: done\ndata: {}\n\n";

function fulfillStream(route: Route, body: string) {
  return route.fulfill({ status: 200, contentType: "text/event-stream; charset=utf-8", body });
}

async function answerEcho(page: Page) {
  const asked: AskBody[] = [];
  await page.route("**/api/questions", (route) => {
    const body = route.request().postDataJSON() as AskBody;
    asked.push(body);
    return fulfillStream(route, delta(`${body.content}의 답`) + DONE);
  });
  return asked;
}

function agent(page: Page) {
  const panel = page.getByRole("tabpanel", { name: "AI 에이전트" });
  return {
    input: panel.getByRole("textbox", { name: "질문" }),
    send: panel.getByRole("button", { name: "보내기", exact: true }),
    conversation: panel.getByRole("list", { name: "대화" }).getByRole("listitem"),
  };
}

async function ask(page: Page, content: string) {
  const { input, send, conversation } = agent(page);
  await input.fill(content);
  await send.click();
  await expect(conversation.filter({ hasText: `${content}의 답` })).toHaveCount(1);
}

test("TC-209 패널을 닫으면 본문 오른쪽에 마스코트 열기 버튼이 보이고, 다시 열면 닫기 전 대화가 그대로예요", async ({ page }) => {
  await answerEcho(page);
  const studyPanel = page.getByRole("complementary", { name: "학습 패널" });
  const openPanel = page.getByRole("button", { name: "AI 패널 열기" });

  await page.goto("/study");
  await ask(page, "질문 A");

  await page.getByRole("button", { name: "패널 닫기" }).click();

  await expect(studyPanel).toBeHidden();
  await expect(openPanel).toBeVisible();

  await openPanel.click();

  await expect(studyPanel).toBeVisible();
  await expect(agent(page).conversation).toHaveText(["질문 A", "질문 A의 답"]);
  await ask(page, "질문 B");
});

test("TC-210 대화 기록 버튼을 누르면 세션 목록이 담긴 메뉴가 열리고, 대화를 고르거나 Esc를 누르면 메뉴가 닫혀요", async ({ page }) => {
  await answerEcho(page);
  const history = page.getByRole("button", { name: "대화 기록", exact: true });
  const menu = page.getByRole("navigation", { name: "대화 기록" });
  const sessions = page.getByRole("list", { name: "세션 목록" }).getByRole("listitem");

  await page.goto("/study");
  await ask(page, "첫 질문");
  await page.getByRole("button", { name: "새 대화", exact: true }).click();
  await ask(page, "두 번째 질문");

  await expect(sessions).toHaveCount(0);

  await history.click();

  await expect(menu).toBeVisible();
  await expect(sessions).toHaveCount(2);

  await page.keyboard.press("Escape");

  await expect(menu).toBeHidden();
  await expect(history).toBeFocused();

  await history.click();
  await sessions.getByRole("button", { name: "첫 질문" }).click();

  await expect(menu).toBeHidden();
  await expect(agent(page).conversation).toHaveText(["첫 질문", "첫 질문의 답"]);
});

test("TC-211 빈 대화에서는 마스코트 인사가 보이고, 질문을 보내면 사라졌다가 새 대화를 누르면 다시 보여요", async ({ page }) => {
  await answerEcho(page);
  const greeting = page.getByRole("tabpanel", { name: "AI 에이전트" }).getByText("오늘은 무엇부터 해볼까요?");

  await page.goto("/study");

  await expect(greeting).toBeVisible();

  await ask(page, "첫 질문");

  await expect(greeting).toBeHidden();

  await page.getByRole("button", { name: "새 대화", exact: true }).click();

  await expect(agent(page).conversation).toHaveCount(0);
  await expect(greeting).toBeVisible();
});

test("TC-212 답을 두 번 받으면 관련 문제 풀어보기는 마지막 답 아래 하나만 보이고, 누르면 마지막 질문으로 문제를 요청해요", async ({ page }) => {
  const asked = await answerEcho(page);
  const problemBodies: unknown[] = [];
  await page.route("**/api/quiz-problems", (route) => {
    problemBodies.push(route.request().postDataJSON());
    return route.fulfill({ status: 500 });
  });
  const related = page.getByRole("tabpanel", { name: "AI 에이전트" }).getByRole("button", { name: "관련 문제 풀기" });

  await page.goto("/study");
  await ask(page, "질문 A");
  await ask(page, "질문 B");

  await expect(agent(page).conversation).toHaveText(["질문 A", "질문 A의 답", "질문 B", "질문 B의 답"]);
  await expect(related).toHaveCount(1);

  await related.click();

  await expect(page.getByRole("tab", { name: "퀴즈", exact: true })).toHaveAttribute("aria-selected", "true");
  const questionB = asked.find(({ content }) => content === "질문 B")?.questionId;
  await expect.poll(() => problemBodies.at(-1)).toEqual({ questionId: questionB });
});
