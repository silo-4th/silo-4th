import "server-only";
import { captureException } from "@sentry/nextjs";
import { and, eq, sql } from "drizzle-orm";
import { safeMessage } from "@/lib/auth/sentry-logger";
import { getDb } from "@/lib/db";
import { concept, sectionView } from "@/lib/db/schema";
import { MAX_DWELL_SEC } from "@/lib/section-reading";
import { studyDay } from "@/lib/study-day";

export type SeenInput = { conceptId: string };
// 학습일은 그 절을 처음 본 날이다. 새벽 4시를 넘겨 떠나도 머문 시간은 처음 본 날 줄에 더한다.
export type DwellInput = { conceptId: string; studyDay: string; dwellSec: number };

const STUDY_DAY = /^\d{4}-\d{2}-\d{2}$/;

// 요청 본문은 화면을 거치지 않고도 보낼 수 있어 타입과 달리 아무 값이나 올 수 있다.
export function parseSeenInput(input: unknown): SeenInput | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const { conceptId } = input as Record<string, unknown>;
  if (typeof conceptId !== "string" || !conceptId) return undefined;
  return { conceptId };
}

export function parseDwellInput(input: unknown): DwellInput | undefined {
  const seen = parseSeenInput(input);
  if (!seen) return undefined;
  const { studyDay: day, dwellSec } = input as Record<string, unknown>;
  if (typeof day !== "string" || !isCalendarDate(day)) return undefined;
  if (typeof dwellSec !== "number" || !Number.isInteger(dwellSec)) return undefined;
  if (dwellSec < 0 || dwellSec > MAX_DWELL_SEC) return undefined;
  return { ...seen, studyDay: day, dwellSec };
}

// 2026-02-30처럼 형식만 맞는 날짜는 Postgres가 오류로 거절하므로 여기서 걸러 낸다.
function isCalendarDate(value: string) {
  if (!STUDY_DAY.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().startsWith(value);
}

// 그날 처음 본 절이면 줄을 남기고, 이미 있으면 그대로 둔다. 머문 시간을 보낼 때 쓸 학습일을 돌려준다.
// 없는 개념이면 남기지 않고 undefined를 돌려준다.
export async function recordSeen(learnerId: string, { conceptId }: SeenInput): Promise<string | undefined> {
  const db = getDb();
  const [found] = await db.select({ id: concept.id }).from(concept).where(eq(concept.id, conceptId));
  if (!found) return undefined;
  const day = studyDay(new Date());
  await db.insert(sectionView).values({ learnerId, conceptId, studyDay: day }).onConflictDoNothing();
  return day;
}

// 동시에 온 요청이 서로 덮어쓰지 않게 DB에서 더한다. 본 적 없는 줄이면 false를 돌려준다.
export async function addDwell(learnerId: string, { conceptId, studyDay: day, dwellSec }: DwellInput) {
  const updated = await getDb()
    .update(sectionView)
    .set({ dwellSec: sql`${sectionView.dwellSec} + ${dwellSec}` })
    .where(
      and(eq(sectionView.learnerId, learnerId), eq(sectionView.conceptId, conceptId), eq(sectionView.studyDay, day)),
    )
    .returning({ conceptId: sectionView.conceptId });
  return updated.length > 0;
}

export function reportSectionViewError(error: unknown) {
  captureException(new Error(safeMessage(error, "section-views")));
}
