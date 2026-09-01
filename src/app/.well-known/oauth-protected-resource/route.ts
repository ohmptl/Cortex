import { protectedResourceMetadata } from "@/mcp/metadata";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return protectedResourceMetadata(request);
}
