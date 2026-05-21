---
starter_id: 10x-astro-starter
package_manager: npm
project_name: gitgud
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
---

## Why this stack

GitGud ships as a solo, after-hours web app with a 6-week MVP timeline and two forcing features: auth (FR-014/015) and AI-driven semantic comment classification (FR-012). The 10x Astro Starter bundles Supabase — covering PostgreSQL, auth, and row-level security — which handles the IC/EM role separation from FR-016 without custom middleware. Cloudflare Pages is edge-native with a generous free tier, matching the solo/after-hours economics. All four agent-friendly gates pass: TypeScript + Zod across the stack, Astro's convention-based file routing, strong training-data presence, current docs. The AI classification layer for FR-012 is not bundled but slots into Astro API routes cleanly as a thin Anthropic or OpenAI SDK addition. CI on GitHub Actions with auto-deploy-on-merge is the starter's default shape; no manual promotion gates are needed at solo MVP scale.
