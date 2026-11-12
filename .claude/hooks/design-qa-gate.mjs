// 디자인 QA 세션이 열려 있으면, 마지막 QA 라운드가 지적 0건이고 그 뒤로 코드가 바뀌지 않았을 때만 턴을 끝내게 한다.
// 세션은 `npm run design-qa -- start`로 열고 `end`로 닫는다. 사용법은 .claude/skills/design-qa/SKILL.md에 있다.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const input = JSON.parse(readFileSync(0, "utf8"));
const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
const stateDir = path.join(root, ".design-qa");
const sessionFile = path.join(stateDir, "session.json");
if (!existsSync(sessionFile)) process.exit(0);

const session = JSON.parse(readFileSync(sessionFile, "utf8"));
if (session.status !== "open") process.exit(0);

const allow = (message) => {
  console.log(JSON.stringify({ systemMessage: message }));
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
  allow("[디자인 QA] 게이트가 너무 여러 번 막아서 이번에는 통과시켰다. .design-qa/rounds를 직접 확인한다.");
}

const roundsDir = path.join(stateDir, "rounds");
const rounds = existsSync(roundsDir)
  ? readdirSync(roundsDir)
      .filter((name) => /^\d+\.json$/.test(name))
      .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
  : [];
if (rounds.length === 0) block("QA 라운드가 아직 없다. design-qa 서브에이전트로 1라운드를 돌린다.");

const latestFile = path.join(roundsDir, rounds.at(-1));
let latest;
try {
  latest = JSON.parse(readFileSync(latestFile, "utf8"));
} catch {
  block(`${path.basename(latestFile)}을 JSON으로 읽지 못했다. 같은 라운드를 새 서브에이전트로 다시 돌린다.`);
}
if (!Array.isArray(latest.findings)) block(`${path.basename(latestFile)}에 findings 배열이 없다. 같은 라운드를 다시 돌린다.`);

const open = latest.findings.length;
if (open > 0) {
  if (rounds.length >= maxRounds) {
    allow(`[디자인 QA] 최대 ${maxRounds}라운드에 닿았는데 지적 ${open}건이 남았다. 남은 지적을 사람에게 보고한다.`);
  }
  block(`${rounds.length}라운드 지적 ${open}건이 남았다. 모두 고치거나 waivers.md에 사유를 남긴 뒤 새 서브에이전트로 다음 라운드를 돌린다.`);
}

// 0건이어도 그 라운드 뒤에 코드를 바꿨다면 바뀐 화면은 아직 QA를 받지 않았다.
const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" }).stdout ?? "";
const changed = new Set([
  ...git("diff", "--name-only", session.baseCommit).split("\n"),
  ...git("ls-files", "--others", "--exclude-standard").split("\n"),
]);
const roundTime = statSync(latestFile).mtimeMs;
const newer = [...changed]
  .map((file) => file.trim())
  .filter((file) => file && !file.startsWith("_docs/") && !file.startsWith(".design-qa/"))
  .filter((file) => existsSync(path.join(root, file)) && statSync(path.join(root, file)).mtimeMs > roundTime);
if (newer.length > 0) {
  block(`지적 0건인 ${rounds.length}라운드 뒤에 바뀐 파일이 있다: ${newer.slice(0, 5).join(", ")}. 다음 라운드로 다시 확인한다.`);
}

allow(`[디자인 QA] ${rounds.length}라운드에서 지적 0건이다. \`npm run design-qa -- end\`로 세션을 닫고 결과를 보고한다.`);
