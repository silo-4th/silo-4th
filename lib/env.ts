// 환경 변수는 이 파일에서만 읽는다. 다른 파일의 process.env 접근은 eslint가 막는다.
// 값은 사용하는 시점에 읽어서, 키가 없어도 빌드는 통과하고 실제 호출에서만 실패한다.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`환경 변수 ${name}이 비어 있다. .env.example을 참고해 설정한다.`);
  return value;
}

export const env = {
  get ANTHROPIC_API_KEY() {
    return required("ANTHROPIC_API_KEY");
  },
  get ANTHROPIC_MODEL() {
    return required("ANTHROPIC_MODEL");
  },
  // 질문 개념 분류와 요약, 서술형 퀴즈 채점에 쓰는 모델이다. 근거는 _docs/wiki/adr/0008-question-concept-summary.md와 0010-quiz-free-grading.md다.
  get ANTHROPIC_UTILITY_MODEL() {
    return required("ANTHROPIC_UTILITY_MODEL");
  },
  get DATABASE_URL() {
    return required("DATABASE_URL");
  },
  get AUTH_SECRET() {
    return required("AUTH_SECRET");
  },
  get AUTH_URL() {
    return required("AUTH_URL");
  },
  get AUTH_GOOGLE_ID() {
    return required("AUTH_GOOGLE_ID");
  },
  get AUTH_GOOGLE_SECRET() {
    return required("AUTH_GOOGLE_SECRET");
  },
  // 배포한 커밋으로 질문을 나눠 본다. Vercel이 배포마다 넣어 주므로 따로 설정하지 않고, 로컬에서는 local로 남긴다.
  get APP_VERSION() {
    return process.env.VERCEL_GIT_COMMIT_SHA || "local";
  },
  // Vercel이 배포 환경마다 production, preview로 넣는다. 로컬에서는 비어 있다.
  get VERCEL_ENV() {
    return process.env.VERCEL_ENV;
  },
  // 브라우저용 VERCEL_ENV. Vercel이 Next.js 프로젝트에 자동으로 넣고, 빌드할 때 값이 코드에 박힌다.
  get NEXT_PUBLIC_VERCEL_ENV() {
    return process.env.NEXT_PUBLIC_VERCEL_ENV;
  },
};
