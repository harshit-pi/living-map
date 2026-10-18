// The time Learn's review schedule reads. LIVING_MAP_CLOCK_SKEW_DAYS moves it
// forward by whole days (e.g. 8 to try a return visit without waiting a
// week); it is for testing only, and read here and nowhere else.

const DAY = 86_400_000;
const skew = Number(process.env.LIVING_MAP_CLOCK_SKEW_DAYS ?? 0);

export const now = (): number =>
  Date.now() + (Number.isFinite(skew) ? skew : 0) * DAY;
