import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import {
  SCHEDULE_PARTITION,
  SCHEDULED_BOTS,
  type BotScheduleDoc,
  type ScheduledBotId,
  isScheduledBotId,
  scheduleDocId,
} from "@/lib/bot-schedule";
import { allowViewerWrite, rejectExternal } from "@/lib/localhost-only";

async function readOne(
  container: Awaited<ReturnType<typeof getContainer>>,
  bot: ScheduledBotId,
): Promise<BotScheduleDoc | null> {
  try {
    const { resource } = await container.item(scheduleDocId(bot), SCHEDULE_PARTITION).read<BotScheduleDoc>();
    return resource ?? null;
  } catch {
    return null;
  }
}

/** GET — bots on the VM poll this (no write token required). */
export async function GET() {
  try {
    const container = await getContainer("trades");
    const schedules: BotScheduleDoc[] = [];
    for (const bot of SCHEDULED_BOTS) {
      const row = await readOne(container, bot);
      if (row) schedules.push(row);
      else {
        schedules.push({
          id: scheduleDocId(bot),
          kind: "bot_schedule",
          ticker: SCHEDULE_PARTITION,
          bot,
          paused: false,
          updated_at: "",
        });
      }
    }
    return NextResponse.json({ schedules });
  } catch (err) {
    console.error("bot-schedule GET:", err);
    return NextResponse.json({ error: "Failed to read schedule" }, { status: 500 });
  }
}

/** PATCH — set `{ bot, paused }` from the Actions UI. */
export async function PATCH(req: NextRequest) {
  if (!allowViewerWrite(req)) return rejectExternal();
  try {
    const body = (await req.json()) as { bot?: string; paused?: boolean };
    const bot = body.bot;
    if (!bot || !isScheduledBotId(bot)) {
      return NextResponse.json(
        { error: `bot must be one of: ${SCHEDULED_BOTS.join(", ")}` },
        { status: 400 },
      );
    }
    if (typeof body.paused !== "boolean") {
      return NextResponse.json({ error: "paused must be a boolean" }, { status: 400 });
    }
    const container = await getContainer("trades");
    const doc: BotScheduleDoc = {
      id: scheduleDocId(bot),
      kind: "bot_schedule",
      ticker: SCHEDULE_PARTITION,
      bot,
      paused: body.paused,
      updated_at: new Date().toISOString(),
    };
    const { resource } = await container.items.upsert(doc);
    return NextResponse.json({ item: resource });
  } catch (err) {
    console.error("bot-schedule PATCH:", err);
    return NextResponse.json({ error: "Failed to update schedule" }, { status: 500 });
  }
}
