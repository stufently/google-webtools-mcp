/**
 * Hints a client uses when it chooses a tool and when it asks for confirmation.
 * Every tool here calls a Google API, so openWorldHint is true.
 *
 * createOnce is for GA4 creates: each call adds a new resource and changes
 * nothing that exists, so it is not destructive, but it is not idempotent.
 */
export const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

/** Adds or confirms something that is already the same if the call is repeated. */
export const addOnly = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

/** Creates a new GA4 resource. Repeating the call creates another one. */
export const createOnce = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

/** Removes a Search Console property or a submitted sitemap. */
export const remove = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
};
