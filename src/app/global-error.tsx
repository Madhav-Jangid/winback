'use client';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main className="error-screen" role="alert">
          <p className="error-eyebrow">Winback AI</p>
          <h1>We couldn’t open the app.</h1>
          <p>Try again. If the problem continues, restart the local development server.</p>
          <button className="btn btn-primary" onClick={reset}>Try again</button>
        </main>
      </body>
    </html>
  );
}
