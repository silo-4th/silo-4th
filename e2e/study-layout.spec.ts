import { expect } from "@playwright/test";
import { firstUnits, test, unitsWithSections } from "./fixtures";

test("TC-206 상단 바의 강의 목록 버튼으로 레일을 열면 지금 단원이 표시되고, 다른 단원을 고르면 레일이 닫히고 상단 바 제목이 그 단원으로 바뀌어요", async ({
  page,
}) => {
  const [first, second] = await firstUnits(2);
  if (!first || !second) throw new Error("테스트 DB에 단원이 두 개 이상 있어야 한다.");
  const topBar = page.getByRole("banner");
  const rail = page.getByRole("navigation", { name: "단원" });

  await page.goto(`/study/${first.id}`);
  await expect(topBar.getByText(first.title, { exact: true })).toBeVisible();

  await topBar.getByRole("button", { name: "강의 목록" }).click();
  await expect(rail.getByRole("link", { name: first.title, exact: true })).toHaveAttribute("aria-current", "page");

  await rail.getByRole("link", { name: second.title, exact: true }).click();

  await expect(rail).toBeHidden();
  await expect(topBar.getByText(second.title, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: second.title, exact: true })).toBeVisible();
});

test("TC-207 본문 위 구간 탭은 지금 읽는 절을 표시하고, 절 주소로 열거나 본문을 내려 읽으면 표시가 그 절로 옮겨 가요", async ({
  page,
}) => {
  const unit = (await unitsWithSections()).find(({ sections }) => sections.length >= 3);
  if (!unit) throw new Error("테스트 DB에 절이 세 개 이상인 단원이 있어야 한다.");
  const middleIndex = Math.floor(unit.sections.length / 2);
  const middle = unit.sections[middleIndex];
  const next = unit.sections[middleIndex + 1];
  if (!middle || !next) throw new Error("가운데 절과 다음 절을 찾지 못했다.");
  const current = page.getByRole("navigation", { name: "목차" }).locator('[aria-current="location"]');

  await page.goto(`/study/${unit.id}#${middle.key}`);

  await expect(current).toHaveCount(1);
  await expect(current).toHaveText(middle.title);

  await page
    .getByRole("heading", { level: 3, name: next.title, exact: true })
    .evaluate((element) => element.scrollIntoView({ block: "start" }));

  await expect(current).toHaveText(next.title);
  await expect(current).toHaveCount(1);
});

test("TC-208 상단 바 아바타를 눌러 로그아웃하면 첫 화면으로 가요", async ({ page }) => {
  const googleButton = page.getByRole("button", { name: "Google로 계속하기" });

  await page.goto("/study");
  await page.getByRole("banner").getByRole("button", { name: "계정 메뉴" }).click();
  await page.getByRole("button", { name: "로그아웃" }).click();

  await expect(page).toHaveURL("/");
  await expect(googleButton).toBeVisible();

  await page.goto("/study");

  await expect(page).toHaveURL("/");
  await expect(googleButton).toBeVisible();
});
