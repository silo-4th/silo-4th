import { expect, type Page } from "@playwright/test";
import { createLearner, deleteLearner, signIn, test } from "./fixtures";

const TONES = [
  ["기본", "친절하고 차분하게", "COUNT(*)는 모든 행을 세요."],
  ["MZ", "친구처럼 가볍고 짧게", "COUNT(*)는 그냥 다 셈 ㅇㅇ"],
  ["선생님", "차근차근 수업하듯이", "COUNT(*)는 모든 행을 셉니다."],
  ["F감성", "공감하고 응원하면서", "헷갈릴 만해요, 같이 볼게요 😊"],
  ["T감성", "결론부터 논리적으로", "결론: COUNT(*)는 NULL도 셉니다."],
] as const;

function toneItem(page: Page, name: string) {
  return page.getByRole("menuitemradio", { name: new RegExp(`^${name}`) });
}

async function openToneMenu(page: Page) {
  await page.getByRole("button", { name: "AI 말투" }).click();
  await expect(page.getByRole("menu", { name: "AI 말투" })).toBeVisible();
}

test("TC-259 에이전트 탭 말투 메뉴에서 MZ를 고르면 바꿨다는 안내가 뜨고, 다음 질문을 MZ 말투로 요청해요", async ({ page }) => {
  const bodies: { tone?: string }[] = [];
  await page.route("**/api/questions", (route) => {
    bodies.push(route.request().postDataJSON() as { tone?: string });
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream; charset=utf-8",
      body: `event: delta\ndata: ${JSON.stringify({ text: "다 셈 ㅇㅇ" })}\n\nevent: done\ndata: {}\n\n`,
    });
  });

  await page.goto("/study");
  await expect(page).toHaveURL(/\/study\/[^/]+$/);
  await openToneMenu(page);

  await expect(page.getByRole("menuitemradio")).toHaveCount(TONES.length);
  for (const [name, description, sample] of TONES) {
    const item = toneItem(page, name);
    await expect(item).toContainText(description);
    await expect(item).toContainText(sample);
  }
  await expect(toneItem(page, "기본")).toHaveAttribute("aria-checked", "true");

  await toneItem(page, "MZ").click();

  await expect(page.getByRole("menu", { name: "AI 말투" })).toHaveCount(0);
  await expect(page.getByText("말투를 MZ로 바꿨어요. 다음 답변부터 적용돼요.")).toBeVisible();

  await page.getByRole("textbox", { name: "질문" }).fill("COUNT(*)는 뭘 세요?");
  await page.getByRole("button", { name: "보내기", exact: true }).click();

  await expect(page.getByRole("list", { name: "대화" }).getByRole("listitem")).toHaveCount(2);
  expect(bodies).toHaveLength(1);
  expect(bodies[0]?.tone).toBe("mz");
});

test("TC-260 고른 말투는 새로고침해도 유지되고, 같은 브라우저에 다른 학습자가 들어오면 기본 말투로 시작해요", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("baseURL이 없다.");
  const other = await createLearner();
  try {
    await page.goto("/study");
    await expect(page).toHaveURL(/\/study\/[^/]+$/);
    await openToneMenu(page);
    await toneItem(page, "선생님").click();
    await expect(page.getByText("말투를 선생님으로 바꿨어요. 다음 답변부터 적용돼요.")).toBeVisible();

    await page.reload();
    await openToneMenu(page);

    await expect(toneItem(page, "선생님")).toHaveAttribute("aria-checked", "true");
    await expect(toneItem(page, "기본")).toHaveAttribute("aria-checked", "false");

    await signIn(context, baseURL, other);
    await page.goto("/study");
    await expect(page).toHaveURL(/\/study\/[^/]+$/);
    await openToneMenu(page);

    await expect(toneItem(page, "기본")).toHaveAttribute("aria-checked", "true");
    await expect(toneItem(page, "선생님")).toHaveAttribute("aria-checked", "false");
  } finally {
    await deleteLearner(other);
  }
});
