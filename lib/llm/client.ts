import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

let client: Anthropic | undefined;

export function anthropic() {
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}
