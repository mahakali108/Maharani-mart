'use client';

/**
 * Catches errors thrown from the root layout itself (rare, but if it
 * happens app/error.tsx cannot render because it depends on the same
 * layout tree). Must render its own <html>/<body>.
 */
export default function GlobalRootError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          padding: '1rem',
        }}>
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#0b0b0b' }}>
              Something went wrong
            </h1>
            <p style={{ marginTop: '0.5rem', color: '#6d6d6d', fontSize: '0.875rem' }}>
              Please refresh the page. If the problem continues, contact support.
            </p>
            <button
              onClick={reset}
              style={{
                marginTop: '1.5rem',
                background: '#c8102e',
                color: '#fff',
                border: 'none',
                borderRadius: '0.75rem',
                padding: '0.65rem 1.5rem',
                fontSize: '0.875rem',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
