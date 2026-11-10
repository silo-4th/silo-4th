import { expect, test } from "@playwright/test";

const GOOGLE_LOGIN_HOST = "accounts.google.com";

test("TC-214 첫 화면에서 Google로 계속하기를 누르면 Google 로그인 화면으로 넘어가요", async ({ page }) => {
  await page.route(`https://${GOOGLE_LOGIN_HOST}/**`, (route) => route.fulfill({ status: 200, body: "" }));

  await page.goto("/");
  await page.getByRole("button", { name: "Google로 계속하기" }).click();

  await expect(page).toHaveURL((url) => url.hostname === GOOGLE_LOGIN_HOST);
});

test("TC-279 첫 화면의 브라우저 탭 제목은 Pluck - AI 리딩 파트너이고, 왼쪽 위에 Pluck 로고가 보여요", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Pluck - AI 리딩 파트너");
  await expect(page.getByRole("banner").getByRole("img", { name: "Pluck" })).toBeVisible();
  await expect(page.getByText("sprout")).toHaveCount(0);
});
