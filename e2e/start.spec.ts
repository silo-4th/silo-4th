import { expect, type Page, test as guest } from "@playwright/test";
import { koreanToday } from "@/lib/exam-date";
import { daysFromNow, test } from "./fixtures";

function onStudy(url: URL) {
  return url.pathname === "/study" || url.pathname.startsWith("/study/");
}

function startScreen(page: Page) {
  return {
    examDate: page.getByLabel("시험 날짜"),
    consent: page.getByRole("checkbox"),
    submit: page.getByRole("button", { name: "시작하기" }),
  };
}

test.describe("저장에 동의하지 않은 학습자", () => {
  test.use({ consented: false });

  test("TC-28 시작 화면에서 시험 날짜를 고르면 켜져 있는 저장 동의 그대로 학습 화면으로 바로 가요", async ({ page }) => {
    const screen = startScreen(page);

    await page.goto("/start");
    await expect(screen.consent).toBeChecked();

    await screen.examDate.fill(daysFromNow(30));
    await screen.submit.click();

    await expect(page).toHaveURL(onStudy);
  });

  test("TC-29 시험 날짜를 지우거나 저장 동의를 끄면 시작하기 버튼이 꺼지고 시작 화면에 머물러요", async ({ page }) => {
    const screen = startScreen(page);

    await page.goto("/start");
    await expect(screen.examDate).toHaveValue(koreanToday(new Date()));
    await expect(screen.submit).toBeEnabled();

    await screen.examDate.fill("");
    await expect(screen.submit).toBeDisabled();

    await screen.examDate.fill(daysFromNow(30));
    await expect(screen.submit).toBeEnabled();

    await screen.consent.uncheck();
    await expect(screen.submit).toBeDisabled();
    await expect(page).toHaveURL("/start");
  });
});

guest("TC-30 로그인하지 않고 시작 화면을 열면 첫 화면으로 가요", async ({ page }) => {
  await page.goto("/start");

  await expect(page).toHaveURL("/");
});

test("TC-31 시험 날짜와 저장 동의를 이미 낸 학습자는 첫 화면과 시작 화면을 건너뛰고 학습 화면으로 가요", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(onStudy);

  await page.goto("/start");
  await expect(page).toHaveURL(onStudy);
});
