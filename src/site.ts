// Branding for this deployment — the site as a whole, as opposed to the games
// it hosts (whose names come from each game's own definition). Read by the app
// and, at build time, by vite.config.ts (index.html title, PWA manifest), so
// keep this file free of imports.

export const SITE = {
  /** Site name: page title, home page heading, installed-app name, notification fallback title. */
  title: 'Game Night',
  /** Short name for the installed PWA's icon label. */
  shortName: 'Game Night',
  /** One line for the home page and the PWA manifest. */
  tagline: 'Turn-based games with your friends — live, by turn, or on one device.',
}
