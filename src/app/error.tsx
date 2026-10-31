'use client';

import { useEffect } from 'react';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Application route error:', error);
  }, [error]);

  return (
    <main className="error-screen" role="alert">
      <p className="error-eyebrow">Winback AI</p>
      <h1>That page hit a snag.</h1>
      <p>Your work is safe. Try loading the page again.</p>
      <button className="btn btn-primary" onClick={reset}>Try again</button>
    </main>
  );
}
