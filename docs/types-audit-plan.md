Type Definitions Audit Plan

- Objective: Identify type drift between client (TypeScript) and server (TypeScript) API surfaces and propose a shared boundary or codegen approach.

Approach:

- Inventory current API types used in client: ApiResponse<T>, LoginResponse, UserInfo, CaptchaResponse, etc. (from client/src/api/request.ts)
- Inventory server types referencing API payloads and database entities (server/src/\*_/_.ts)
- Propose strategy:
  - Create a small shared-types package within the monorepo (e.g., packages/shared-types) exporting common interfaces.
  - Refactor client and server to import types from the shared package instead of duplicating definitions.
  - Add a simple CI check to validate that shared types converge with client/server expectations (e.g., a type-compatibility check script).
- Milestones:

1.  Define shared types surface and import paths.
2.  Migrate core API types to shared-types (start with ApiResponse, LoginResponse, UserInfo).
3.  Run type checks to ensure no drift.
4.  Document coding guidelines for adding shared types.

Notes:

- This is a non-trivial refactor; proceed in small steps with CI feedback.
