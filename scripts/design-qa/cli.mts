// 디자인 QA 하네스의 도구 모음이다. 사용법은 .claude/skills/design-qa/SKILL.md에 있다.
// 시안은 배포된 시안 주소와 시안 레포지토리 소스를, 개발 화면은 이 워크트리의 코드를 test DB로 띄운 개발 서버를 본다.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { type Browser, type Page, chromium } from "@playwright/test";

const DESIGN_URL = "https://sprout-ten-iota.vercel.app";
const DESIGN_REPO = "https://github.com/silo-4th/silo-4th-design.git";
const ROOT = process.cwd();
const STATE_DIR = path.join(ROOT, ".design-qa");
const SESSION_FILE = path.join(STATE_DIR, "session.json");
const SERVER_FILE = path.join(STATE_DIR, "server.json");
const LEARNERS_FILE = path.join(STATE_DIR, "learners.json");

const git = (...args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

// 시안 소스와 test DB 설정은 모든 워크트리가 같이 쓰므로 공통 git 디렉터리 기준으로 찾는다.
function commonDir() {
  return path.resolve(ROOT, git("rev-parse", "--git-common-dir"));
}

function designDir() {
  return path.join(commonDir(), "design-qa", "silo-4th-design");
}

function testEnvFile() {
  const candidates = [path.join(ROOT, ".env.test.local"), path.join(path.dirname(commonDir()), ".env.test.local")];
  const found = candidates.find((file) => existsSync(file));
  if (!found) throw new Error(`.env.test.local이 없다. README의 통합 테스트와 E2E 항목을 보고 만든다. 찾은 곳: ${candidates.join(", ")}`);
  return found;
}

function readJson<T>(file: string): T | undefined {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : undefined;
}

function writeJson(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function option(args: string[], name: string) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

// ---------- sync: 시안 레포지토리를 받아 최신으로 맞춘다 ----------

function sync() {
  const dir = designDir();
  if (existsSync(path.join(dir, ".git"))) {
    execFileSync("git", ["-C", dir, "fetch", "--depth", "1", "origin", "main"], { stdio: "inherit" });
    execFileSync("git", ["-C", dir, "reset", "--hard", "FETCH_HEAD"], { stdio: "inherit" });
  } else {
    mkdirSync(path.dirname(dir), { recursive: true });
    execFileSync("git", ["clone", "--depth", "1", DESIGN_REPO, dir], { stdio: "inherit" });
  }
  const commit = execFileSync("git", ["-C", dir, "log", "-1", "--format=%h %s"], { encoding: "utf8" }).trim();
  console.log(`시안 소스: ${dir}\n시안 커밋: ${commit}\n시안 주소: ${DESIGN_URL}`);
}

// ---------- start, end: QA 세션 ----------

type Session = { scope: string; maxRounds: number; baseCommit: string; startedAt: string; status: "open" | "done"; gateBlocks: number };

function start(args: string[]) {
  const scope = option(args, "scope");
  if (!scope) throw new Error('--scope "QA할 화면과 항목"을 넣는다.');
  const existing = readJson<Session>(SESSION_FILE);
  if (existing?.status === "open") throw new Error("열린 QA 세션이 있다. 이어서 진행하거나 `end`로 닫는다.");
  rmSync(path.join(STATE_DIR, "rounds"), { recursive: true, force: true });
  rmSync(path.join(STATE_DIR, "waivers.md"), { force: true });
  const session: Session = {
    scope,
    maxRounds: Number(option(args, "max") ?? 10),
    baseCommit: git("rev-parse", "HEAD"),
    startedAt: new Date().toISOString(),
    status: "open",
    gateBlocks: 0,
  };
  writeJson(SESSION_FILE, session);
  writeFileSync(path.join(STATE_DIR, "waivers.md"), "# 반영하지 않기로 한 지적\n\n");
  console.log(`QA 세션을 열었다. 라운드 결과는 .design-qa/rounds/NN.json에 쌓인다.\n${JSON.stringify(session, null, 2)}`);
}

async function end() {
  const session = readJson<Session>(SESSION_FILE);
  if (session) writeJson(SESSION_FILE, { ...session, status: "done" });
  await cleanup();
  console.log("QA 세션을 닫았다. 개발 서버는 띄운 터미널이나 백그라운드 작업을 멈춰 끈다.");
}

// ---------- serve: test DB로 개발 서버를 띄운다 ----------

function freePort(from: number): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(freePort(from + 1)));
    server.listen(from, () => server.close(() => resolve(from)));
  });
}

async function serve() {
  const port = await freePort(3200);
  const url = `http://localhost:${port}`;
  // 로그인 세션 쿠키가 이 주소에서 통하도록 AUTH_URL만 바꾸고 나머지는 test 브랜치 값을 그대로 쓴다.
  const source = readFileSync(testEnvFile(), "utf8")
    .split(/\r?\n/)
    .filter((line) => !/^\s*AUTH_URL\s*=/.test(line));
  const envFile = path.join(STATE_DIR, "dev.env");
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(envFile, [...source, `AUTH_URL=${url}`, ""].join("\n"));
  writeJson(SERVER_FILE, { url, port });
  console.log(`개발 서버: ${url} (test DB)`);
  // Next.js는 실행 옵션을 하위 프로세스의 NODE_OPTIONS로 넘기는데 --env-file은 거기서 거부되므로, 여기서 읽어 물려준다.
  process.loadEnvFile(envFile);
  const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "dev", "--port", String(port)], {
    cwd: ROOT,
    stdio: "inherit",
  });
  const stop = () => {
    rmSync(SERVER_FILE, { force: true });
    child.kill();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", (code) => {
    rmSync(SERVER_FILE, { force: true });
    process.exit(code ?? 0);
  });
}

// ---------- run: 같은 단계로 시안이나 개발 화면을 열고 캡처한다 ----------

type Step =
  | { goto: string }
  | { click: string }
  | { hover: string }
  | { fill: string; value: string }
  | { press: string }
  | { wait: number | string }
  | { eval: string }
  | { shot: string; selector?: string; fullPage?: boolean }
  | { styles: string; name: string; props?: string[] };

const DEFAULT_PROPS = [
  "display",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "color",
  "background-color",
  "background-image",
  "padding",
  "margin",
  "gap",
  "border",
  "border-radius",
  "box-shadow",
  "opacity",
  "transition",
  "animation",
];

function parseSteps(raw: unknown): Step[] {
  if (!Array.isArray(raw)) throw new Error("단계 파일은 배열이어야 한다.");
  return raw.map((step: unknown, index) => {
    if (typeof step !== "object" || step === null) throw new Error(`${index}번 단계가 객체가 아니다.`);
    const known = ["goto", "click", "hover", "fill", "press", "wait", "eval", "shot", "styles"];
    if (!known.some((key) => key in step)) throw new Error(`${index}번 단계에 ${known.join(", ")} 중 하나가 없다.`);
    return step as Step;
  });
}

type Learners = { default?: string; created: string[] };

// e2e/fixtures는 불러오는 순간 DB에 연결하므로, 부르기 전에 loadTestEnv를 먼저 한다.
function loadTestEnv() {
  process.loadEnvFile(testEnvFile());
}

async function learnerFor(args: string[]) {
  const { createLearner } = await import("../../e2e/fixtures");
  const learners = readJson<Learners>(LEARNERS_FILE) ?? { created: [] };
  const fresh = args.includes("--fresh-learner") || args.includes("--unconsented");
  if (!fresh && learners.default) return learners.default;
  const id = await createLearner(!args.includes("--unconsented"));
  learners.created.push(id);
  if (!fresh) learners.default = id;
  writeJson(LEARNERS_FILE, learners);
  return id;
}

type Log = (line: string) => void;

async function runStep(page: Page, step: Step, out: string, prefix: string, log: Log) {
  // 개발 서버는 화면을 처음 열 때 컴파일하고 계속 열린 요청도 있어서 load까지만 기다린다. 나머지는 wait 단계로 맞춘다.
  if ("goto" in step) await page.goto(step.goto, { waitUntil: "load", timeout: 120_000 });
  else if ("click" in step) await page.locator(step.click).first().click();
  else if ("hover" in step) await page.locator(step.hover).first().hover();
  else if ("fill" in step) await page.locator(step.fill).first().fill(step.value);
  else if ("press" in step) await page.keyboard.press(step.press);
  else if ("wait" in step) {
    if (typeof step.wait === "number") await page.waitForTimeout(step.wait);
    else await page.locator(step.wait).first().waitFor();
  } else if ("eval" in step) log(JSON.stringify(await page.evaluate(step.eval)));
  else if ("shot" in step) {
    const file = path.join(out, `${prefix}-${step.shot}.png`);
    if (step.selector) await page.locator(step.selector).first().screenshot({ path: file });
    else await page.screenshot({ path: file, fullPage: step.fullPage ?? false });
    log(`캡처: ${file}`);
  } else {
    const props = step.props ?? DEFAULT_PROPS;
    const elements = await page.locator(step.styles).evaluateAll(
      (nodes, names) =>
        nodes.slice(0, 20).map((node) => {
          const style = getComputedStyle(node);
          const box = node.getBoundingClientRect();
          return {
            text: (node as HTMLElement).innerText?.slice(0, 200),
            box: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
            style: Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name)])),
          };
        }),
      props,
    );
    const file = path.join(out, `${prefix}-${step.name}.styles.json`);
    writeJson(file, { selector: step.styles, elements });
    log(`스타일: ${file} (요소 ${elements.length}개)`);
  }
}

type Target = "design" | "dev";

function readSteps(file: string) {
  return parseSteps(JSON.parse(readFileSync(file, "utf8")));
}

function devUrl() {
  const server = readJson<{ url: string }>(SERVER_FILE);
  if (!server) throw new Error("개발 서버가 없다. `npm run design-qa -- serve`를 백그라운드로 먼저 띄운다.");
  return server.url;
}

// run과 verify가 같은 화면을 보도록 뷰포트, 로그인, 학습자, 배지 숨김을 여기서만 정한다.
async function openPage(browser: Browser, target: Target, args: string[], log: Log) {
  const baseURL = target === "dev" ? devUrl() : DESIGN_URL;
  const [width, height] = (option(args, "viewport") ?? "1440x900").split("x").map(Number);
  const context = await browser.newContext({
    baseURL,
    viewport: { width: width ?? 1440, height: height ?? 900 },
    deviceScaleFactor: 1,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    reducedMotion: args.includes("--reduced-motion") ? "reduce" : "no-preference",
  });
  if (target === "dev" && !args.includes("--anonymous")) {
    loadTestEnv();
    const { signIn } = await import("../../e2e/fixtures");
    await signIn(context, baseURL, await learnerFor(args));
  }
  // Next.js 개발 표시 배지가 캡처에 찍혀 시안과의 차이로 잘못 지적되지 않게 숨긴다.
  // tsx가 함수에 붙이는 이름 도우미는 브라우저에 없으므로 문자열로 넘긴다.
  if (target === "dev") {
    await context.addInitScript(`document.addEventListener("DOMContentLoaded", function () {
      var style = document.createElement("style");
      style.textContent = "nextjs-portal { display: none !important; }";
      document.head.append(style);
    });`);
  }
  const page = await context.newPage();
  page.on("pageerror", (error) => log(`[페이지 오류] ${error.message}`));
  return page;
}

async function run(args: string[]) {
  const target = option(args, "target");
  const stepsFile = option(args, "steps");
  if (target !== "design" && target !== "dev") throw new Error("--target은 design이나 dev다.");
  if (!stepsFile) throw new Error("--steps <단계 JSON 파일>을 넣는다.");
  const steps = readSteps(stepsFile);
  const out = path.resolve(option(args, "out") ?? path.join(STATE_DIR, "shots"));
  mkdirSync(out, { recursive: true });

  const browser = await chromium.launch();
  try {
    const page = await openPage(browser, target, args, console.log);
    for (const step of steps) await runStep(page, step, out, target, console.log);
  } finally {
    await browser.close();
  }
}

// ---------- verify: 라운드 지적의 check를 개발 화면에서 다시 확인한다 ----------

type Check = { steps: string; args: string[]; selector: string } & (
  | { prop: string; expected: string }
  | { text: string }
  | { count: number }
);
type CheckedFinding = { id: string; round: number; check: Check };
type VerifyResult = { id: string; round: number; pass: boolean; expected: string; actual: string };

const ROUNDS_DIR = path.join(STATE_DIR, "rounds");
const VERIFY_FILE = path.join(STATE_DIR, "verify.json");
const VERIFY_OUT = path.join(STATE_DIR, "verify");

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function parseCheck(raw: unknown, where: string): Check {
  const fail = (reason: string): never => {
    throw new Error(`${where}의 check가 틀렸다. ${reason}`);
  };
  if (!isRecord(raw)) return fail("객체가 아니다.");
  const { steps, args = [], selector } = raw;
  if (typeof steps !== "string" || !steps) return fail("steps에 개발 쪽 단계 파일 경로가 없다.");
  if (!existsSync(path.resolve(ROOT, steps))) return fail(`단계 파일 ${steps}이 없다.`);
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) return fail("args는 문자열 배열이다.");
  if (typeof selector !== "string" || !selector) return fail("selector가 없다.");
  const base = { steps, args: args as string[], selector };
  if ("count" in raw) {
    if (typeof raw.count !== "number" || !Number.isInteger(raw.count) || raw.count < 0) return fail("count는 0 이상의 정수다.");
    return { ...base, count: raw.count };
  }
  if ("text" in raw) {
    if (typeof raw.text !== "string") return fail("text는 문자열이다.");
    return { ...base, text: raw.text };
  }
  if (typeof raw.prop !== "string" || typeof raw.expected !== "string") {
    return fail("prop과 expected, text, count 중 하나가 있어야 한다.");
  }
  return { ...base, prop: raw.prop, expected: raw.expected };
}

function readRound(round: number, waived: Set<string>): CheckedFinding[] {
  const name = `${String(round).padStart(2, "0")}.json`;
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path.join(ROUNDS_DIR, name), "utf8"));
  } catch {
    throw new Error(`rounds/${name}을 JSON으로 읽지 못했다.`);
  }
  if (!isRecord(data) || !Array.isArray(data.findings)) throw new Error(`rounds/${name}에 findings 배열이 없다.`);
  return data.findings.flatMap((finding: unknown, index) => {
    if (!isRecord(finding) || finding.check === undefined) return [];
    if (typeof finding.id !== "string" || !finding.id) throw new Error(`rounds/${name}의 ${index}번 지적에 id가 없다.`);
    if (waived.has(finding.id)) return [];
    return [{ id: finding.id, round, check: parseCheck(finding.check, `rounds/${name} ${finding.id}`) }];
  });
}

function roundNumbers() {
  if (!existsSync(ROUNDS_DIR)) return [];
  return readdirSync(ROUNDS_DIR)
    .filter((name) => /^\d+\.json$/.test(name))
    .map((name) => Number.parseInt(name, 10))
    .sort((a, b) => a - b);
}

function waivedIds() {
  const file = path.join(STATE_DIR, "waivers.md");
  return new Set(existsSync(file) ? readFileSync(file, "utf8").match(/R\d+-\d+/g) : []);
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

async function evaluateCheck(page: Page, check: Check): Promise<Pick<VerifyResult, "pass" | "expected" | "actual">> {
  const locator = page.locator(check.selector);
  const count = await locator.count();
  if ("count" in check) return { pass: count === check.count, expected: String(check.count), actual: String(count) };
  const expected = "text" in check ? squash(check.text) : check.expected.trim();
  if (count === 0) return { pass: false, expected, actual: "요소 없음" };
  const actual =
    "text" in check
      ? squash(await locator.first().innerText())
      : (await locator.first().evaluate((node, prop) => getComputedStyle(node).getPropertyValue(prop), check.prop)).trim();
  return { pass: actual === expected, expected, actual };
}

async function verifyGroup(browser: Browser, group: CheckedFinding[], index: number): Promise<VerifyResult[]> {
  const [{ check }] = group as [CheckedFinding];
  const prefix = `${String(index + 1).padStart(2, "0")}-${path.basename(check.steps, ".json")}`;
  const quiet: Log = () => {};
  const page = await openPage(browser, "dev", check.args, quiet);
  try {
    for (const step of readSteps(check.steps)) await runStep(page, step, VERIFY_OUT, prefix, quiet);
    const results: VerifyResult[] = [];
    for (const { id, round, check: each } of group) results.push({ id, round, ...(await evaluateCheck(page, each)) });
    return results;
  } catch (error) {
    // 단계가 끝까지 돌지 못하면 화면 상태를 믿을 수 없으므로 묶인 check를 모두 실패로 둔다.
    const actual = `단계 실행 실패. ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`;
    return group.map(({ id, round }) => ({ id, round, pass: false, expected: "", actual }));
  } finally {
    await page.context().close();
  }
}

async function verify(args: string[]) {
  const only = option(args, "round");
  const all = roundNumbers();
  const rounds = only === undefined ? all : [Number.parseInt(only, 10)];
  if (all.length === 0) throw new Error("라운드 파일이 없다. design-qa 서브에이전트로 1라운드를 먼저 돌린다.");
  const missing = rounds.filter((round) => !all.includes(round));
  if (missing.length > 0) throw new Error(`라운드 ${only}의 파일이 없다. 있는 라운드는 ${all.join(", ")}이다.`);

  const waived = waivedIds();
  const groups = new Map<string, CheckedFinding[]>();
  for (const finding of rounds.flatMap((round) => readRound(round, waived))) {
    const key = JSON.stringify([finding.check.steps, finding.check.args]);
    groups.set(key, [...(groups.get(key) ?? []), finding]);
  }

  const results: VerifyResult[] = [];
  if (groups.size > 0) {
    mkdirSync(VERIFY_OUT, { recursive: true });
    const browser = await chromium.launch();
    try {
      for (const [index, group] of [...groups.values()].entries()) results.push(...(await verifyGroup(browser, group, index)));
    } finally {
      await browser.close();
    }
  }

  // --round 실행은 QA 에이전트가 새로 쓴 check를 시험하는 용도라서, Stop 훅이 읽는 verify.json은 전체 실행만 쓴다.
  if (only === undefined) writeJson(VERIFY_FILE, { at: new Date().toISOString(), rounds, results });
  const failed = results.filter((result) => !result.pass);
  for (const result of failed) console.log(`${result.id}  기대: ${result.expected}  실제: ${result.actual}`);
  console.log(`통과 ${results.length - failed.length}/${results.length}`);
  if (failed.length > 0) process.exitCode = 1;
}

// ---------- cleanup: 만든 테스트 학습자를 지운다 ----------

async function cleanup() {
  const learners = readJson<Learners>(LEARNERS_FILE);
  if (!learners?.created.length) return;
  loadTestEnv();
  const { deleteLearner } = await import("../../e2e/fixtures");
  for (const id of learners.created) await deleteLearner(id);
  rmSync(LEARNERS_FILE, { force: true });
  console.log(`테스트 학습자 ${learners.created.length}명을 지웠다.`);
}

const [command, ...rest] = process.argv.slice(2);
const commands: Record<string, (args: string[]) => unknown> = { sync, start, end, serve, run, verify, cleanup };
const handler = command ? commands[command] : undefined;
if (!handler) {
  console.error(`명령: ${Object.keys(commands).join(", ")}. 자세한 사용법은 .claude/skills/design-qa/SKILL.md를 본다.`);
  process.exit(1);
}
try {
  await handler(rest);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
