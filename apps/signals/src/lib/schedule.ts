// Kept in sync with the Edge pipeline scheduler; timezone behavior is tested in pipeline.test.ts.
export function localDate(now: Date, timezone: string) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((k) => p.find((x) => x.type === k)!.value)
    .join("-");
}
export function zonedTime(date: string, time: string, timezone: string) {
  const [y, m, d] = date.split("-").map(Number),
    [h, min] = time.split(":").map(Number),
    target = Date.UTC(y, m - 1, d, h, min);
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const p = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(guess)),
      v = (k: string) => Number(p.find((x) => x.type === k)!.value),
      actual = Date.UTC(
        v("year"),
        v("month") - 1,
        v("day"),
        v("hour"),
        v("minute"),
      );
    guess += target - actual;
  }
  return new Date(guess);
}
export function schedule(
  timezone: string,
  times: string[],
  now = new Date(),
  tomorrow = false,
) {
  let date = localDate(now, timezone),
    time = [...times].sort()[0] ?? "07:30",
    email = zonedTime(date, time, timezone);
  if (tomorrow || email.getTime() <= now.getTime()) {
    date = new Date(Date.parse(date + "T12:00:00Z") + 86400000)
      .toISOString()
      .slice(0, 10);
    email = zonedTime(date, time, timezone);
  }
  return {
    date,
    email: email.toISOString(),
    collect: new Date(email.getTime() - 4 * 3600000).toISOString(),
    fallback: new Date(email.getTime() - 30 * 60000).toISOString(),
  };
}
