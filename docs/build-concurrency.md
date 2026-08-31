Build Concurrency and CI Caching Guidelines

Goal

- Reduce total CI build time by running client and server builds in parallel while preserving determinism and cache efficiency.

What to do

- Use the root script build:ci to run both workspace builds in parallel.
- Ensure npm ci is used in CI to install dependencies deterministically.
- Enable caching for npm_modules and esbuild caches in CI to speed up subsequent runs.
- Verify both client and server builds complete successfully in parallel and produce predictable artifacts.

Recommended CI steps (example, adapt to your CI provider)

- Install deps: npm ci
- Build in parallel: npm run build:ci
- Store artifacts: client/dist and server/dist as separate artifacts for downstream steps
- Cache: node_modules/.cache and esbuild cache directories if applicable

Notes

- If one side fails, fail the entire pipeline and surface the error from the failed task
- Keep logs verbose enough to diagnose speed bottlenecks and cache misses
