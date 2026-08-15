import { setupServer } from "msw/node";

import { handlers } from "./handlers";

/** Shared MSW server. Handlers are reset between tests by vitest.setup.ts. */
export const server = setupServer(...handlers);
