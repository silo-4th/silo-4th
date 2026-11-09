import { expect, test } from "@playwright/test";

const GOOGLE_LOGIN_HOST = "accounts.google.com";

test("TC-214 첫 화면에서 Google로 계속하기를 누르면 Google 로그인 화면으로 넘어가요", async ({ page }) => {
  await page.route(`https://${GOOGLE_LOGIN_HOST}/**`, (route) => route.fulfill({ status: 200, body: "" }));

  await page.goto("/");
  await page.getByRole("button", { name: "Google로 계속하기" }).click();

  await expect(page).toHaveURL((url) => url.hostname === GOOGLE_LOGIN_HOST);
});
