/**
 * Typed accessor for the preload bridge.
 *
 * Kept in its own module so the log window can reach the same API without
 * importing the launcher application (and its whole stylesheet) into its bundle.
 */
export function hmcl(): import('@hmcl/shared').HmclApi {
  return (window as unknown as { hmcl: import('@hmcl/shared').HmclApi }).hmcl;
}