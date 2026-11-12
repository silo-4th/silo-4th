// 디자인 QA 세션이 열려 있으면, 남은 지적이 모두 해결됐다고 확인될 때만 턴을 끝내게 한다.
// 값으로 확인할 수 있는 지적은 `npm run design-qa -- verify`가, 나머지는 다음 QA 라운드가 확인한다.
// 세션은 `npm run design-qa -- start`로 열고 `end`로 닫는다. 사용법은 .claude/skills/design-qa/SKILL.md에 있다.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

// 테스트 파일만 바뀌었으면 화면은 그대로이므로 다시 확인할 필요가 없다.
const isScreenFile = (file) => /^(app|lib|public)\//.test(file) && !/\.(test|spec)\.ts$/.test(file);

function verifyProblem(verify, rounds, since) {
  if (!verify) return "verify.json이 없다.";
  if (rounds.some((round) => !verify.rounds.includes(round))) return "verify.json이 모든 라운드를 검사한 결과가 아니다.";
  if (verify.failed > 0) return `verify 실패가 ${verify.failed}건 있다.`;
  if (verify.at <= since) return "verify.json이 마지막 화면 변경이나 최신 라운드보다 오래됐다.";
  return undefined;
}

/**
 * @param {{
 *   rounds: number[],
 *   latest: { findings: { id?: unknown, check?: unknown }[], mtimeMs: number } | { error: string } | undefined,
 *   waived: Set<string>,
 *   verify: { at: number, rounds: number[], failed: number } | undefined,
 *   lastScreenChange: number,
 *   maxRounds: number,
 * }} state
 * @returns {{ ok: boolean, reason: string }}
 */
function judge({ rounds, latest, waived, verify, lastScreenChange, maxRounds }) {
  const n = rounds.length;
  if (!latest) return { ok: false, reason: "QA 라운드가 아직 없다. design-qa 서브에이전트로 1라운드를 돌린다." };
  if ("error" in latest) return { ok: false, reason: latest.error };

  const problem = verifyProblem(verify, rounds, Math.max(lastScreenChange, latest.mtimeMs));
  const open = latest.findings.filter((finding) => !waived.has(finding.id));
  if (open.length === 0) {
    if (lastScreenChange <= latest.mtimeMs || !problem) {
      return { ok: true, reason: `${n}라운드에서 남은 지적이 없다. \`npm run design-qa -- end\`로 세션을 닫고 결과를 보고한다.` };
    }
    return {
      ok: false,
      reason: `지적 0건인 ${n}라운드 뒤에 화면 코드가 바뀌었다. \`npm run design-qa -- verify\`를 통과시킨다. ${problem}`,
    };
  }

  const unchecked = open.filter((finding) => finding.check == null);
  let reason;
  if (n < 2) {
    reason = `1라운드 지적 ${open.length}건이 남았다. 고친 뒤 \`npm run design-qa -- verify\`를 통과시키고, 새 서브에이전트로 마지막 확인 라운드를 돌린다.`;
  } else if (unchecked.length > 0) {
    const ids = unchecked.map((finding) => finding.id).join(", ");
    reason = `${n}라운드에 check가 없는 지적 ${unchecked.length}건이 남았다: ${ids}. 고친 뒤 새 서브에이전트로 다음 라운드를 돌려 다시 본다.`;
  } else if (problem) {
    reason = `${n}라운드 지적 ${open.length}건이 verify로 확인되지 않았다. ${problem} 고친 뒤 \`npm run design-qa -- verify\`를 통과시킨다.`;
  }
  if (!reason) {
    return { ok: true, reason: `${n}라운드 지적 ${open.length}건이 모두 verify를 통과했다. \`npm run design-qa -- end\`로 세션을 닫고 결과를 보고한다.` };
  }
  if (n >= maxRounds) {
    return { ok: true, reason: `최대 ${maxRounds}라운드에 닿았는데 지적 ${open.length}건이 남았다. 남은 지적을 사람에게 보고한다.` };
  }
  return { ok: false, reason };
}

const input = JSON.parse(readFileSync(0, "utf8"));
const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
const stateDir = path.join(root, ".design-qa");
const sessionFile = path.join(stateDir, "session.json");
if (!existsSync(sessionFile)) process.exit(0);

const session = JSON.parse(readFileSync(sessionFile, "utf8"));
if (session.status !== "open") process.exit(0);

const allow = (message) => {
  console.log(JSON.stringify({ systemMessage: `[디자인 QA] ${message}` }));
  process.exit(0);
};
const block = (reason) => {
  session.gateBlocks = (session.gateBlocks ?? 0) + 1;
  writeFileSync(sessionFile, `${JSON.stringify(session, null, 2)}\n`);
  console.error(`[디자인 QA] ${reason}\n절차는 .claude/skills/design-qa/SKILL.md를 따른다.`);
  process.exit(2);
};

// 하네스가 고장 나도 끝없이 막지 않도록 막은 횟수에 상한을 둔다.
const maxRounds = session.maxRounds ?? 10;
if ((session.gateBlocks ?? 0) >= maxRounds * 4) {
  allow("게이트가 너무 여러 번 막아서 이번에는 통과시켰다. .design-qa/rounds를 직접 확인한다.");
}

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
};

const roundsDir = path.join(stateDir, "rounds");
const roundFiles = existsSync(roundsDir)
  ? readdirSync(roundsDir)
      .filter((name) => /^\d+\.json$/.test(name))
      .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
  : [];

function readLatest(name) {
  const file = path.join(roundsDir, name);
  const data = readJson(file);
  if (data === undefined) return { error: `${name}을 JSON으로 읽지 못했다. 같은 라운드를 새 서브에이전트로 다시 돌린다.` };
  if (!Array.isArray(data.findings)) return { error: `${name}에 findings 배열이 없다. 같은 라운드를 다시 돌린다.` };
  return { findings: data.findings.map((finding) => finding ?? {}), mtimeMs: statSync(file).mtimeMs };
}

function readVerify() {
  const data = readJson(path.join(stateDir, "verify.json"));
  const at = Date.parse(data?.at);
  if (Number.isNaN(at) || !Array.isArray(data.rounds) || !Array.isArray(data.results)) return undefined;
  return { at, rounds: data.rounds, failed: data.results.filter((result) => result?.pass !== true).length };
}

function readWaived() {
  const file = path.join(stateDir, "waivers.md");
  return new Set(existsSync(file) ? readFileSync(file, "utf8").match(/R\d+-\d+/g) : []);
}

const git = (...args) => spawnSync("git", ["-c", "core.quotepath=false", ...args], { cwd: root, encoding: "utf8" }).stdout ?? "";

function readLastScreenChange() {
  const files = [
    ...git("diff", "--name-only", session.baseCommit).split("\n"),
    ...git("ls-files", "--others", "--exclude-standard").split("\n"),
  ]
    .map((file) => file.trim())
    .filter((file) => file && isScreenFile(file))
    .map((file) => path.join(root, file))
    .filter((file) => existsSync(file));
  return Math.max(0, ...files.map((file) => statSync(file).mtimeMs));
}

const verdict = judge({
  rounds: roundFiles.map((name) => Number.parseInt(name, 10)),
  latest: roundFiles.length > 0 ? readLatest(roundFiles.at(-1)) : undefined,
  waived: readWaived(),
  verify: readVerify(),
  lastScreenChange: readLastScreenChange(),
  maxRounds,
});
if (verdict.ok) allow(verdict.reason);
block(verdict.reason);
