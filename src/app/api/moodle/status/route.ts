import { NextResponse } from "next/server";
import { requireAcademicRepository } from "@/domain/auth";

export async function GET() {
  try {
    const { repository } = await requireAcademicRepository();
    return NextResponse.json(await repository.getMoodleSyncStatus());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to read Moodle status" }, { status: 401 });
  }
}
