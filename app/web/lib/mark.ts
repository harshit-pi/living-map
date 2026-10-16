// The Living Map mark: a route of three stops on a map, the last one (where you
// are) filled. Shared by the logo component and the favicon.

export const MARK_PATHS = {
  route: "M5 17.5 C 7.5 9.5, 10 7, 12 7 S 16.5 9.5, 19 14",
  stops: [
    { cx: 5, cy: 17.5 },
    { cx: 12, cy: 7 },
  ],
  here: { cx: 19, cy: 14 },
};
