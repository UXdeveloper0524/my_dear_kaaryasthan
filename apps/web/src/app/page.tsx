import { getApiHealth } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const apiConnected = await getApiHealth();

  return (
    <main className="page-shell">
      <div className="brand">Kaaryasthan</div>
      <section className="intro" aria-labelledby="page-title">
        <p className="eyebrow">Your work, in one place</p>
        <h1 id="page-title">Make progress visible.</h1>
        <p className="description">
          Plan projects, move tasks forward, and see what needs attention. Your
          workspace is being built.
        </p>
        <p className="status" role="status">
          <span
            className={apiConnected ? 'dot online' : 'dot'}
            aria-hidden="true"
          />
          API {apiConnected ? 'connected' : 'not connected yet'}
        </p>
      </section>
    </main>
  );
}
