import Image from 'next/image';
import { getApiHealth } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const apiConnected = await getApiHealth();

  return (
    <main className="page-shell">
      <header className="site-header">
        <Image
          className="brand-logo"
          src="/brand/kaaryasthan-logo-horizontal-colour.svg"
          alt="MyDear Kaaryasthan"
          width={490}
          height={96}
          priority
        />
        <p className="brand-descriptor">Workflow, handled.</p>
      </header>
      <section className="intro" aria-labelledby="page-title">
        <p className="eyebrow">Work handled.</p>
        <h1 id="page-title">Keep work moving, without the chase.</h1>
        <p className="description">
          A dependable place for tasks, approvals, and teams is taking shape.
          See what needs your attention and keep everyday work on track.
        </p>
        <p className="status" role="status">
          <span
            className={apiConnected ? 'dot online' : 'dot'}
            aria-hidden="true"
          />
          {apiConnected
            ? 'Workspace service is ready'
            : 'Workspace service is unavailable. Please try again later.'}
        </p>
      </section>
    </main>
  );
}
