import { MARK_PATHS } from "./mark.ts";

// The tab icon is the logo mark, drawn in the brand colours read from brand.css,
// so changing the brand changes the favicon too.
export function setFavicon() {
  const css = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) =>
    css.getPropertyValue(`--color-${name}`).trim() || fallback;
  const ink = color("ink", "#141413");
  const surface = color("surface", "#ffffff");
  const primary = color("primary", "#d97757");
  const muted = color("muted", "#73726c");
  const stops = MARK_PATHS.stops
    .map(
      (s) =>
        `<circle cx="${s.cx}" cy="${s.cy}" r="2.8" fill="${surface}" stroke="${ink}" stroke-width="2"/>`,
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${MARK_PATHS.route}" fill="none" stroke="${muted}" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="0.5 3.2"/>${stops}<circle cx="${MARK_PATHS.here.cx}" cy="${MARK_PATHS.here.cy}" r="3.8" fill="${primary}"/></svg>`;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.type = "image/svg+xml";
  // the browser's own chrome matches the page background
  let theme = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  if (!theme) {
    theme = document.createElement("meta");
    theme.name = "theme-color";
    document.head.appendChild(theme);
  }
  theme.content = color("canvas", "#faf9f5");
  link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
