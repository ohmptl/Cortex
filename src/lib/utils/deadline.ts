import { differenceInCalendarDays, format, isPast } from "date-fns";
import type { StatusColor } from "@/types/assignment";

export function getStatusColor(deadline: string, completed: boolean): StatusColor {
  if (completed) return "gray";
  const due = new Date(deadline);
  const now = new Date();
  if (isPast(due)) return "red";
  const hoursLeft = (due.getTime() - now.getTime()) / (1000 * 60 * 60);
  if (hoursLeft <= 24 * 7) return "yellow";
  return "green";
}

export interface DeadlineDisplay {
  primary: string;
  secondary: string;
  color: StatusColor;
}

// Formats a deadline the way the assignment row expects: a short primary
// label (date/time/weekday depending on proximity) plus a relative secondary label.
export function formatDeadline(deadline: string, completed: boolean): DeadlineDisplay {
  const due = new Date(deadline);
  const now = new Date();
  const color = getStatusColor(deadline, completed);
  const diffMs = due.getTime() - now.getTime();
  const overdue = diffMs < 0;
  const absMs = Math.abs(diffMs);
  const hours = absMs / (1000 * 60 * 60);
  const days = differenceInCalendarDays(due, now);

  if (overdue) {
    const primary = format(due, "MMM d");
    const secondary =
      hours < 24 ? `${Math.max(1, Math.round(hours))}h overdue` : `${Math.abs(days)}d overdue`;
    return { primary, secondary, color };
  }

  if (hours < 24) {
    const primary = format(due, "h:mm a");
    const secondary = hours < 1 ? `In ${Math.max(1, Math.round(hours * 60))}m` : `In ${Math.round(hours)}h`;
    return { primary, secondary, color };
  }

  if (days < 7) {
    return { primary: format(due, "EEE, MMM d"), secondary: `In ${days}d`, color };
  }

  return { primary: format(due, "MMM d"), secondary: `In ${days}d`, color };
}
