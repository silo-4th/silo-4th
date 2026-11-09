import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// .env.local을 불러오기 전에 확인한다. vercel env pull로 만든 .env.local에도 VERCEL 키가 들어 있다.
const isVercelBuild = Boolean(process.env.VERCEL);

// drizzle-kit은 .env.local을 읽지 않아서 직접 불러온다.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

// Vercel 빌드에서는 Neon 연동이 넣어 준 직접 연결 주소로 마이그레이션한다.
// 로컬에서는 DATABASE_URL만 쓴다. .env.local의 다른 키가 --env-file로 지정한 테스트 DB 주소를 앞서면 안 된다.
const url = isVercelBuild
  ? (process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL)
  : process.env.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: url ?? "" },
});
