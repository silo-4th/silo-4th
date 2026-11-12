// 디자인 QA 세션이 열려 있으면, 마지막 화면 수정 뒤의 QA 라운드가 지적 0건이고 verify가 통과했을 때만 턴을 끝내게 한다.
// 판정은 design-qa-judge.mjs가 하고, 이 훅은 세션 확인과 막은 횟수 기록만 한다. 사용법은 .claude/skills/design-qa/SKILL.md에 있다.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { judge, readState } from "./design-qa-judge.mjs";

const input = JSON.parse(readFileSync(0, "utf8"));
const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
const sessionFile = path.join(root, ".design-qa", "session.json");
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
if ((session.gateBlocks ?? 0) >= (session.maxRounds ?? 10) * 4) {
  allow("게이트가 너무 여러 번 막아서 이번에는 통과시켰다. .design-qa/rounds를 직접 확인한다.");
}

const verdict = judge(readState(root));
if (verdict.ok) allow(verdict.reason);
block(verdict.reason);
