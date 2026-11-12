// 디자인 QA 세션을 끝내도 되는지 판정한다. Stop 훅 design-qa-gate.mjs와 `npm run design-qa -- end`가 같이 쓴다.
// 규칙은 .claude/skills/design-qa/SKILL.md의 반복 절차와 같다.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * @typedef {{ id: string, hasCheck: boolean }} OpenFinding
 * @typedef {{ round: number, mtimeMs: number, open: OpenFinding[] } | { round: number, error: string }} Round
 * @typedef {{ at: number, rounds: number[], failed: number }} Verify
 * @typedef {{
 *   maxRounds: number,
 *   rounds: Round[],
 *   verify: Verify | undefined,
 *   lastScreenChange: number | { error: string },
 * }} State
 * @typedef {{ ok: boolean, capped: boolean, reason: string }} Verdict
 */

// 테스트 파일만 바뀌었으면 화면은 그대로이므로 다시 확인할 필요가 없다.
const isScreenFile = (/** @type {string} */ file) => /^(app|lib|public)\//.test(file) && !/\.(test|spec)\.ts$/.test(file);

/** @param {string} file */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * @param {string} dir
 * @param {string} name
 * @param {Set<string>} waived
 * @returns {Round}
 */
function readRound(dir, name, waived) {
  const round = Number.parseInt(name, 10);
  const file = path.join(dir, name);
  const data = readJson(file);
  if (data === undefined) return { round, error: `rounds/${name}을 JSON으로 읽지 못했다. 같은 라운드를 새 서브에이전트로 다시 돌린다.` };
  if (!Array.isArray(data.findings)) return { round, error: `rounds/${name}에 findings 배열이 없다. 같은 라운드를 다시 돌린다.` };
  /** @type {OpenFinding[]} */
  const open = data.findings
    .map((/** @type {unknown} */ finding) => (typeof finding === "object" && finding !== null ? finding : {}))
    .map((/** @type {{ id?: unknown, check?: unknown }} */ finding) => ({ id: String(finding.id ?? "id 없음"), hasCheck: finding.check != null }))
    .filter((/** @type {OpenFinding} */ finding) => !waived.has(finding.id));
  return { round, mtimeMs: statSync(file).mtimeMs, open };
}

/**
 * @param {string} stateDir
 * @returns {Verify | undefined}
 */
function readVerify(stateDir) {
  const data = readJson(path.join(stateDir, "verify.json"));
  const at = Date.parse(data?.at);
  if (Number.isNaN(at) || !Array.isArray(data.rounds) || !Array.isArray(data.results)) return undefined;
  return { at, rounds: data.rounds, failed: data.results.filter((/** @type {{ pass?: unknown }} */ result) => result?.pass !== true).length };
}

// 지운 화면 파일은 수정 시각이 없지만, 지우면 그 파일이 있던 폴더의 수정 시각이 바뀐다.
/** @param {string} file */
function changedAt(file) {
  let current = file;
  while (!existsSync(current)) current = path.dirname(current);
  return statSync(current).mtimeMs;
}

/**
 * @param {string} root
 * @param {string} baseCommit
 * @returns {number | { error: string }}
 */
function readLastScreenChange(root, baseCommit) {
  /** @type {string[]} */
  const files = [];
  for (const args of [
    ["diff", "--name-only", "--no-renames", baseCommit],
    ["ls-files", "--others", "--exclude-standard"],
  ]) {
    const result = spawnSync("git", ["-c", "core.quotepath=false", ...args], { cwd: root, encoding: "utf8" });
    if (result.error || result.status !== 0) {
      const detail = result.error?.message ?? result.stderr.trim();
      return { error: `화면 변경을 알 수 없다. git ${args.join(" ")}이 실패했다. ${detail}` };
    }
    files.push(...result.stdout.split("\n").map((file) => file.trim()).filter((file) => file && isScreenFile(file)));
  }
  return Math.max(0, ...files.map((file) => changedAt(path.join(root, file))));
}

/**
 * @param {string} root
 * @returns {State}
 */
export function readState(root) {
  const stateDir = path.join(root, ".design-qa");
  const session = JSON.parse(readFileSync(path.join(stateDir, "session.json"), "utf8"));
  const waiversFile = path.join(stateDir, "waivers.md");
  const waived = new Set(existsSync(waiversFile) ? readFileSync(waiversFile, "utf8").match(/R\d+-\d+/g) : []);
  const roundsDir = path.join(stateDir, "rounds");
  const names = existsSync(roundsDir)
    ? readdirSync(roundsDir)
        .filter((name) => /^\d+\.json$/.test(name))
        .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
    : [];
  return {
    maxRounds: session.maxRounds ?? 10,
    rounds: names.map((name) => readRound(roundsDir, name, waived)),
    verify: readVerify(stateDir),
    lastScreenChange: readLastScreenChange(root, session.baseCommit),
  };
}

/**
 * @param {Verify | undefined} verify
 * @param {number[]} rounds
 * @param {number} since
 */
function verifyProblem(verify, rounds, since) {
  if (!verify) return "verify.json이 없다.";
  if (rounds.some((round) => !verify.rounds.includes(round))) return "verify.json이 모든 라운드를 검사한 결과가 아니다. `--round` 없이 다시 돌린다.";
  if (verify.failed > 0) return `verify 실패가 ${verify.failed}건 있다.`;
  if (verify.at <= since) return "verify.json이 마지막 화면 변경보다 오래됐다.";
  return undefined;
}

/**
 * @param {State} state
 * @returns {string | undefined} 끝낼 수 없는 이유
 */
function blockReason({ rounds, verify, lastScreenChange }) {
  const latest = rounds.at(-1);
  if (!latest) return "QA 라운드가 아직 없다. design-qa 서브에이전트로 1라운드를 돌린다.";
  for (const round of rounds) if ("error" in round) return round.error;
  if ("error" in latest) return latest.error;

  const n = latest.round;
  if (latest.open.length > 0) {
    const ids = latest.open.map((finding) => finding.id).join(", ");
    return `${n}라운드 지적 ${latest.open.length}건이 남았다: ${ids}. 고친 뒤 \`npm run design-qa -- verify\`를 통과시키고, 새 서브에이전트로 ${n + 1}라운드를 돌린다.`;
  }
  if (typeof lastScreenChange !== "number") return lastScreenChange.error;
  if (lastScreenChange > latest.mtimeMs) {
    return `지적 0건인 ${n}라운드 뒤에 화면 코드가 바뀌었다. 새 서브에이전트로 ${n + 1}라운드를 돌린다.`;
  }

  // check가 없는 라운드는 verify가 확인할 것이 없으므로, 그 라운드가 생겼다고 verify를 다시 요구하지 않는다.
  const checkedRounds = rounds
    .filter((round) => "open" in round && round.open.some((finding) => finding.hasCheck))
    .map((round) => round.round);
  const problem = checkedRounds.length > 0 ? verifyProblem(verify, checkedRounds, lastScreenChange) : undefined;
  if (problem) return `앞 라운드의 check 지적이 verify로 확인되지 않았다. ${problem} \`npm run design-qa -- verify\`를 통과시킨다.`;
  return undefined;
}

/**
 * @param {State} state
 * @returns {Verdict}
 */
export function judge(state) {
  const reason = blockReason(state);
  if (!reason) {
    const n = state.rounds.at(-1)?.round;
    return { ok: true, capped: false, reason: `${n}라운드에서 남은 지적이 없다. \`npm run design-qa -- end\`로 세션을 닫고 결과를 보고한다.` };
  }
  if (state.rounds.length >= state.maxRounds) {
    return { ok: true, capped: true, reason: `최대 ${state.maxRounds}라운드에 닿아 멈춘다. 남은 상태를 사람에게 보고한다. ${reason}` };
  }
  return { ok: false, capped: false, reason };
}
