import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";

type AskBody = { content: string; selectedText?: string; sectionConceptId?: string };

const delta = (text: string) => `event: delta\ndata: ${JSON.stringify({ text })}\n\n`;
const DONE = "event: done\ndata: {}\n\n";
const EASIER = "이 부분을 쉽게 설명해줘";
const EXAMPLE = "이 부분을 예시로 보여줘";

function agent(page: Page) {
  const panel = page.getByRole("tabpanel", { name: "AI 에이전트" });
  return {
    panel,
    input: panel.getByRole("textbox", { name: "질문" }),
    send: panel.getByRole("button", { name: "보내기", exact: true }),
    conversation: panel.getByRole("list", { name: "대화" }).getByRole("listitem"),
    actions: panel.locator(".bot-actions"),
  };
}

test("TC-311 답을 받으면 마지막 답 아래에 더 쉽게, 예시 보기, 관련 문제 풀기만 보이고, 더 쉽게를 누르면 마지막 답이 인용으로 붙은 질문이 가고 버튼 줄이 새 답 아래로 옮겨 가요", async ({
  page,
}) => {
  const bodies: AskBody[] = [];
  let releaseEasier = () => {};
  const easierHeld = new Promise<void>((resolve) => {
    releaseEasier = resolve;
  });
  await page.route("**/api/questions", async (route) => {
    const body = route.request().postDataJSON() as AskBody;
    bodies.push(body);
    if (body.content === EASIER) await easierHeld;
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream; charset=utf-8",
      body: delta(`${body.content}의 답`) + DONE,
    });
  });
  const { input, send, conversation, actions } = agent(page);

  await page.goto("/study");
  await input.fill("질문 A");
  await send.click();
  await expect(conversation).toHaveText(["질문 A", "질문 A의 답"]);

  await expect(actions.getByRole("button")).toHaveText(["더 쉽게", "예시 보기", "관련 문제 풀기"]);

  await actions.getByRole("button", { name: "더 쉽게" }).click();

  const asked = conversation.nth(2);
  await expect(asked.locator("blockquote")).toHaveText("질문 A의 답");
  await expect(asked).toContainText(EASIER);
  await expect(actions).toHaveCount(0);
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).toMatchObject({ content: EASIER, selectedText: "질문 A의 답" });
  expect(bodies[1]).not.toHaveProperty("sectionConceptId");

  releaseEasier();

  const easierAnswer = conversation.nth(3);
  await expect(easierAnswer).toHaveText(`${EASIER}의 답`);
  await expect(actions).toHaveCount(1);
  const answerBox = await easierAnswer.boundingBox();
  const actionsBox = await actions.boundingBox();
  expect(actionsBox && answerBox && actionsBox.y >= answerBox.y + answerBox.height).toBe(true);

  await actions.getByRole("button", { name: "예시 보기" }).click();

  await expect.poll(() => bodies.length).toBe(3);
  expect(bodies[2]).toMatchObject({ content: EXAMPLE, selectedText: `${EASIER}의 답` });
  await expect(conversation.nth(5)).toHaveText(`${EXAMPLE}의 답`);
});
