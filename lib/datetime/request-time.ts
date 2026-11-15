/**
 * The clock reading for the request being served.
 *
 * For async Server Components only. A Server Component runs once per request
 * and never re-renders, so reading the clock there is a request input (like a
 * database read), not render-time impurity. Client components must not use
 * this: they take the time from props, state or an effect.
 */
export function serverRequestTimeMs(): number {
  return Date.now();
}
