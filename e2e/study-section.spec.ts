import { expect } from "@playwright/test";
import { test, unitsWithSections } from "./fixtures";

async function unitWithSections(index: number) {
  const unit = (await unitsWithSections())[index];
  if (!unit || unit.sections.length < 2) {
    throw new Error(`테스트 DB의 ${index + 1}번째 단원에 절이 두 개 이상 있어야 한다.`);
  }
  return unit;
}

test("TC-71 절 주소로 들어오면 그 학습셋이 열리고 그 절이 화면에 보여요", async ({ page }) => {
  const unit = await unitWithSections(1);
  const section = unit.sections[Math.floor(unit.sections.length / 2)];
  if (!section) throw new Error("가운데 절을 찾지 못했다.");

  await page.goto(`/study/${unit.id}#${section.key}`);

  await expect(page.getByRole("heading", { level: 1, name: unit.title, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "강의 목록" }).click();
  await expect(
    page.getByRole("navigation", { name: "단원" }).getByRole("link", { name: unit.title, exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { level: 3, name: section.title, exact: true })).toBeInViewport();
});

test("TC-73 목차에서 절을 고르면 그 절로 가고 주소가 절 주소로 바뀌어요", async ({ page }) => {
  const unit = await unitWithSections(0);
  const section = unit.sections.at(-1);
  if (!section) throw new Error("마지막 절을 찾지 못했다.");
  const heading = page.getByRole("heading", { level: 3, name: section.title, exact: true });

  await page.goto(`/study/${unit.id}`);
  await expect(heading).toBeAttached();
  await expect(heading).not.toBeInViewport();

  await page.getByRole("navigation", { name: "목차" }).getByRole("link", { name: section.title, exact: true }).click();

  await expect(heading).toBeInViewport();
  await expect(page).toHaveURL(
    (url) => url.pathname === `/study/${unit.id}` && decodeURIComponent(url.hash) === `#${section.key}`,
  );
});

test("TC-74 없는 절 주소로 들어오면 그 학습셋 맨 위가 보여요", async ({ page }) => {
  const unit = await unitWithSections(0);

  await page.goto(`/study/${unit.id}#없는-절`);

  await expect(page.getByRole("heading", { level: 1, name: unit.title, exact: true })).toBeInViewport();
});

test("TC-285 단원 주소로 처음 들어오면 구간 탭 맨 앞에 인트로가 있고 인트로가 선택되어 있어요", async ({ page }) => {
  const unit = await unitWithSections(0);
  const toc = page.getByRole("navigation", { name: "목차" });
  const current = toc.locator('[aria-current="location"]');

  await page.goto(`/study/${unit.id}`);

  await expect(toc.getByRole("link")).toHaveText(["인트로", ...unit.sections.map(({ title }) => title)]);
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText("인트로");
});

test("TC-286 본문을 내려 읽다가 구간 탭에서 인트로를 고르면 단원 맨 위로 가고 표시가 인트로로 돌아와요", async ({ page }) => {
  const unit = await unitWithSections(0);
  const last = unit.sections.at(-1);
  if (!last) throw new Error("마지막 절을 찾지 못했다.");
  const toc = page.getByRole("navigation", { name: "목차" });
  const current = toc.locator('[aria-current="location"]');

  await page.goto(`/study/${unit.id}`);
  await toc.getByRole("link", { name: last.title, exact: true }).click();
  await expect(current).toHaveText(last.title);

  await toc.getByRole("link", { name: "인트로", exact: true }).click();

  await expect(page.getByRole("heading", { level: 1, name: unit.title, exact: true })).toBeInViewport();
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText("인트로");
});
