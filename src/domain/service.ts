import { z } from "zod";
import { ACADEMIC_ITEM_TYPES } from "./types.ts";
import type { AcademicRepository } from "./repository.ts";

const uuid = z.string().uuid();
const isoDate = z.string().datetime({ offset: true });

export const createManualItemSchema = z.object({
  courseId: uuid.nullish(),
  title: z.string().trim().min(1).max(300),
  type: z.enum(ACADEMIC_ITEM_TYPES),
  dueAt: isoDate.nullish(),
  description: z.string().max(50_000).nullish(),
  url: z.url().nullish(),
}).strict();

export const itemOverrideSchema = z.discriminatedUnion("field", [
  z.object({ itemId: uuid, field: z.literal("title"), value: z.string().trim().min(1).max(300) }).strict(),
  z.object({ itemId: uuid, field: z.literal("description"), value: z.string().max(50_000).nullable() }).strict(),
  z.object({ itemId: uuid, field: z.literal("item_type"), value: z.enum(ACADEMIC_ITEM_TYPES) }).strict(),
  z.object({ itemId: uuid, field: z.enum(["due_at", "available_at", "close_at"]), value: isoDate.nullable() }).strict(),
  z.object({ itemId: uuid, field: z.literal("url"), value: z.url().nullable() }).strict(),
]);

export class AcademicService {
  readonly repository: AcademicRepository;

  constructor(repository: AcademicRepository) {
    this.repository = repository;
  }

  async getToday(now = new Date()) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return this.repository.listAcademicItems({ from: start.toISOString(), to: end.toISOString() });
  }

  async getUpcoming(days = 14, now = new Date()) {
    const safeDays = Math.max(1, Math.min(days, 365));
    const end = new Date(now);
    end.setDate(end.getDate() + safeDays);
    return this.repository.listAcademicItems({ from: now.toISOString(), to: end.toISOString() });
  }

  async getCalendarRange(from: string, to: string) {
    const validFrom = isoDate.parse(from);
    const validTo = isoDate.parse(to);
    if (new Date(validFrom) > new Date(validTo)) throw new Error("from must precede to");
    return this.repository.listAcademicItems({ from: validFrom, to: validTo });
  }

  async createManualItem(input: unknown) {
    return this.repository.createManualItem(createManualItemSchema.parse(input));
  }

  async updateItemOverride(input: unknown) {
    const value = itemOverrideSchema.parse(input);
    await this.repository.setItemOverride(value.itemId, value.field, value.value);
    return this.repository.getAcademicItem(value.itemId);
  }

  async clearItemOverride(input: unknown) {
    const value = z.object({ itemId: uuid, field: z.enum(["title", "description", "item_type", "due_at", "available_at", "close_at", "url"]) }).strict().parse(input);
    await this.repository.clearItemOverride(value.itemId, value.field);
    return this.repository.getAcademicItem(value.itemId);
  }
}
