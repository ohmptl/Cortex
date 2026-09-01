import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createCortexMcpServer } from "../src/mcp/server.ts";
import type { AcademicRepository } from "../src/domain/repository.ts";

const expectedTools = [
  "add_note", "add_tag", "clear_item_override", "create_manual_item", "get_academic_item", "get_calendar_range",
  "get_course", "get_course_gradebook", "get_grade_item", "get_today", "get_upcoming", "list_academic_items",
  "list_courses", "mark_item_complete", "schedule_review", "search_academic_context", "trigger_moodle_sync", "update_item_override",
];

async function connectedClient(repository: AcademicRepository) {
  const server = createCortexMcpServer(repository);
  const client = new Client({ name: "cortex-tests", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

test("MCP publishes the complete normalized-domain tool surface without raw mutation tools", async () => {
  const { client, server } = await connectedClient({} as AcademicRepository);
  const response = await client.listTools();
  assert.deepEqual(response.tools.map((tool) => tool.name).sort(), expectedTools);
  assert.equal(response.tools.some((tool) => /raw/i.test(tool.name) && tool.annotations?.readOnlyHint === false), false);
  assert.equal(response.tools.find((tool) => tool.name === "get_today")?.annotations?.readOnlyHint, true);
  assert.equal(response.tools.find((tool) => tool.name === "update_item_override")?.annotations?.destructiveHint, false);
  await client.close();
  await server.close();
});

test("MCP deadline changes are persisted as overrides", async () => {
  let captured: { itemId: string; field: string; value: unknown } | null = null;
  const repository = {
    async setItemOverride(itemId: string, field: string, value: unknown) { captured = { itemId, field, value }; },
    async getAcademicItem(itemId: string) { return { id: itemId, title: "Source deadline retained", overrides: { due_at: captured?.value } }; },
  } as unknown as AcademicRepository;
  const { client, server } = await connectedClient(repository);
  const itemId = "123e4567-e89b-42d3-a456-426614174000";
  const dueAt = "2026-09-11T20:00:00.000Z";
  await client.callTool({ name: "update_item_override", arguments: { itemId, field: "due_at", value: dueAt } });
  assert.deepEqual(captured, { itemId, field: "due_at", value: dueAt });
  await client.close();
  await server.close();
});
