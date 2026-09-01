import { NextResponse } from "next/server";
import { requireAcademicRepository } from "@/domain/auth";

export async function GET() {
  try {
    const { repository } = await requireAcademicRepository();
    const connection = await repository.getMoodleStatus();
    if (!connection) return NextResponse.json({ connected: false });
    const [capabilities, runs] = await Promise.all([
      repository.listCapabilities(connection.id), repository.listSyncRuns(10),
    ]);
    return NextResponse.json({ connected: connection.connected, connection, capabilities, runs });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to read Moodle status" }, { status: 401 });
  }
}
