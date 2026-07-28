/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "warn",
      from: {},
      to: { circular: true },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      from: {},
      to: {
        couldNotResolve: true,
        // astro: and cloudflare: are virtual modules provided by the runtimes
        pathNot: ["^astro:", "^cloudflare:"],
      },
    },
    {
      name: "no-orphans",
      severity: "warn",
      from: {
        orphan: true,
        pathNot: [
          // type declaration files are never imported directly
          "\\.d\\.ts$",
          // Astro pages and layouts are entry points (file-based routing)
          "^src/pages/",
          "^src/layouts/",
          // Cloudflare Worker entry point
          "^src/worker\\.ts$",
          // Astro middleware — loaded by framework, not imported
          "^src/middleware\\.ts$",
          // global styles
          "^src/styles/",
        ],
      },
      to: {},
    },
    {
      name: "not-to-test",
      severity: "error",
      comment: "Production code must not import from tests/",
      from: { pathNot: "^tests/" },
      to: { path: "^tests/" },
    },
    {
      name: "no-non-package-json",
      severity: "error",
      comment: "Only import packages declared in package.json",
      from: {},
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] },
    },
    {
      name: "not-to-deprecated",
      severity: "warn",
      from: {},
      to: { dependencyTypes: ["deprecated"] },
    },

    // ── Layer boundaries ──────────────────────────────────────────────────
    // Expected flow: types ← lib ← services ← components ← pages/layouts/entry
    // All rules below guard against imports that go against that direction.

    {
      name: "no-lib-to-components",
      severity: "error",
      from: { path: "^src/lib/" },
      to: { path: "^src/components/" },
    },
    {
      name: "no-lib-to-pages",
      severity: "error",
      from: { path: "^src/lib/" },
      to: { path: "^src/pages/" },
    },
    {
      name: "no-components-to-pages",
      severity: "error",
      from: { path: "^src/components/" },
      to: { path: "^src/pages/" },
    },
    {
      // ui/ primitives (shadcn) must stay framework-agnostic —
      // importing a feature component would couple a primitive to a domain
      name: "no-ui-to-feature-components",
      severity: "error",
      from: { path: "^src/components/ui/" },
      to: { path: "^src/components/", pathNot: "^src/components/ui/" },
    },
    {
      // services are independent business-logic units — cross-imports create
      // hidden ordering constraints and make individual service testing harder
      name: "no-cross-service",
      severity: "warn",
      from: { path: "^src/lib/services/" },
      to: { path: "^src/lib/services/" },
    },
  ],

  options: {
    doNotFollow: {
      path: "node_modules",
    },

    tsConfig: {
      fileName: "./tsconfig.json",
    },

    // Resolve Astro/Cloudflare conditional exports correctly
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },

    reporterOptions: {
      dot: {
        // Collapse node_modules to package level in graphs
        collapsePattern: "node_modules/(?:@[^/]+/[^/]+|[^/]+)",
      },
      archi: {
        // High-level architecture view: collapse to top-level src/ dirs
        collapsePattern:
          "^(node_modules/(?:@[^/]+/[^/]+|[^/]+)|src/(?:components|lib|pages|layouts|hooks)(/[^/]+)?)",
      },
    },
  },
};
