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
      <body style={{ background: '#FFFBF4' }}>
        <style>{'button:focus-visible { outline: 3px solid #6D5AD6; outline-offset: 3px; }'}</style>
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          padding: '1rem',
        }}>
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#17233F' }}>
              Something went wrong
            </h1>
            <p style={{ marginTop: '0.5rem', color: '#596579', fontSize: '0.875rem' }}>
              Please refresh the page. If the problem continues, contact support.
            </p>
            <button
              onClick={reset}
              style={{
                marginTop: '1.5rem',
                background: '#5142B8',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '0.75rem',
                padding: '0.65rem 1.5rem',
                minHeight: '44px',
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
