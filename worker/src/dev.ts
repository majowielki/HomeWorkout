// Local-only entry point: `npm run dev` runs this with wrangler.dev.jsonc.
import { fakeModel } from './fakeModel';
import { createHandler } from './index';

export type { Env } from './index';

export default createHandler({ model: () => fakeModel() });
