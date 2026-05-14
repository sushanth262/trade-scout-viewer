export const SCHEDULED_BOTS = ["copytrade", "earnings-trade", "indicator-alert-bot"] as const;
export type ScheduledBotId = (typeof SCHEDULED_BOTS)[number];

export const SCHEDULE_PARTITION = "__BOT_SCHED__" as const;

export interface BotScheduleDoc {
  id: string;
  kind: "bot_schedule";
  ticker: typeof SCHEDULE_PARTITION;
  bot: ScheduledBotId;
  paused: boolean;
  updated_at: string;
}

export function scheduleDocId(bot: string): string {
  return `bot-schedule-${bot}`;
}

export function isScheduledBotId(s: string): s is ScheduledBotId {
  return (SCHEDULED_BOTS as readonly string[]).includes(s);
}
