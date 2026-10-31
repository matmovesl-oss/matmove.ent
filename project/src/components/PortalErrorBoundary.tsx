import {
  Component,
  type ReactNode,
} from 'react';

export class PortalErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = {
    failed: false,
  };

  static getDerivedStateFromError() {
    return {
      failed: true,
    };
  }

  componentDidCatch(error: Error) {
    console.error(
      'MatMove screen error',
      error
    );
  }

  render() {
    if (!this.state.failed) {
      return this.props.children;
    }

    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <section className="max-w-md rounded-2xl bg-white p-6 space-y-4">
          <h1 className="text-xl font-bold">
            We could not open this screen
          </h1>

          <p>
            Your account has not been deleted.
            Reopen the portal to continue.
          </p>

          <a
            className="block rounded-xl bg-blue-600 p-3 text-center text-white"
            href="/customer"
          >
            Reopen MatMove
          </a>

          <a
            className="block text-center text-blue-700"
            href="/login"
          >
            Go to sign in
          </a>
        </section>
      </main>
    );
  }
}