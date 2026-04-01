export function isWithinCheckinWindow(date: Date, rules: any): boolean {
  let timeStr = new Intl.DateTimeFormat('en-US', {
    timeZone: rules.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date).replace('24:', '00:');

  const { checkinWindow } = rules;
  const { start, end } = checkinWindow;

  if (end < start) {
    return timeStr >= start || timeStr < end;
  }

  return timeStr >= start && timeStr < end;
}

export function isWithinBreakWindow(date: Date, rules: any): boolean {
  let timeStr = new Intl.DateTimeFormat('en-US', {
    timeZone: rules.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date).replace('24:', '00:');

  const { breakWindow } = rules;
  const { start, end } = breakWindow;

  if (end < start) {
    return timeStr >= start || timeStr < end;
  }

  return timeStr >= start && timeStr < end;
}

export function hasActivity(mouseDelta: number, keyCount: number): boolean {
  return mouseDelta > 0 || keyCount > 0;
}
