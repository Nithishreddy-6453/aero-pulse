import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface TabErrorBoundaryProps {
  sectionName: string;
  children: ReactNode;
}

interface TabErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class TabErrorBoundary extends Component<TabErrorBoundaryProps, TabErrorBoundaryState> {
  constructor(props: TabErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
    };
  }

  static getDerivedStateFromError(error: Error): TabErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Unexpected rendering error.',
    };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Handled gracefully by the frosted recovery UI
  }

  private handleReset = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <section
          role="alert"
          className="glass-card mx-auto my-8 max-w-xl rounded-3xl border border-rose-200/80 bg-white/85 p-7 text-center backdrop-blur-2xl"
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FF3B30]/12 text-[#C81E1E]">
            <AlertCircle className="h-6 w-6" aria-hidden="true" />
          </div>
          <h2 className="mt-4 font-display text-[19px] font-extrabold tracking-[-0.02em] text-[#0F172A]">
            {this.props.sectionName} paused unexpectedly
          </h2>
          <p className="mt-1.5 text-[13px] font-medium text-[#475569]">
            {this.state.errorMessage || 'A temporary display issue interrupted this view.'}
          </p>
          <button
            type="button"
            onClick={this.handleReset}
            className="apple-press mt-5 inline-flex h-10 items-center gap-2 rounded-full bg-[#0F172A] px-5 text-[13px] font-bold text-white shadow-sm hover:bg-slate-800"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Reload {this.props.sectionName}
          </button>
        </section>
      );
    }

    return this.props.children;
  }
}
