/// <reference types="vitest/config" />
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { SITE } from './src/site.ts'

// Unique per build so the client can detect a newer deploy is live.
const buildId = Date.now().toString(36)

// Vercel populates these in `process.env` for every Build Step automatically —
// no "Automatically expose System Environment Variables" toggle needed, since
// that setting only governs Serverless/Edge Function *runtime* env, not the
// build. Empty outside Vercel (local dev, CI, tests), which the environment
// badge already treats as "nothing to show".
const gitCommitRef = process.env.VERCEL_GIT_COMMIT_REF ?? ''
const gitCommitSha = process.env.VERCEL_GIT_COMMIT_SHA ?? ''

/** Fills index.html's %SITE_TITLE%/%SITE_TAGLINE% placeholders from src/site.ts. */
function siteBranding(): Plugin {
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
  return {
    name: 'site-branding',
    transformIndexHtml(html) {
      return html.replaceAll('%SITE_TITLE%', escape(SITE.title)).replaceAll('%SITE_SHORT_NAME%', escape(SITE.shortName)).replaceAll('%SITE_TAGLINE%', escape(SITE.tagline))
    },
  }
}

/** Emits version.json into the build output so running tabs can poll for a newer buildId. */
function writeVersionFile(): Plugin {
  let outDir = 'dist'
  return {
    name: 'write-version-file',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      writeFileSync(resolve(process.cwd(), outDir, 'version.json'), JSON.stringify({ buildId }))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    writeVersionFile(),
    siteBranding(),
    VitePWA({
      // Custom src/sw.ts (not the default generated worker) so it can also
      // handle `push`/`notificationclick` for turn notifications — see that
      // file's doc comment for why navigations are deliberately left alone.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        // Only the hashed, content-addressed build output — never index.html
        // or version.json, which must always be fetched fresh.
        globPatterns: ['assets/**/*.{js,css,woff2}'],
      },
      registerType: 'autoUpdate',
      devOptions: { enabled: false },
      manifest: {
        // Site branding — src/site.ts, the one place to change it.
        name: SITE.title,
        short_name: SITE.shortName,
        description: SITE.tagline,
        start_url: '/',
        display: 'standalone',
        background_color: '#0a0a0a',
        theme_color: '#0a0a0a',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  // Listen on all interfaces so the dev server is reachable from other devices on the LAN.
  server: { host: true },
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
    __GIT_COMMIT_REF__: JSON.stringify(gitCommitRef),
    __GIT_COMMIT_SHA__: JSON.stringify(gitCommitSha),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    alias: {
      'jsr:@supabase/supabase-js@2': '@supabase/supabase-js',
    },
  },
})
