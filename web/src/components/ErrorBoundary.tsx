import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Detail render error:', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <section className="detail">
          <div className="error-box" style={{ margin: '20px 0' }}>
            ⚠️ 渲染出错: {this.state.error?.message || '未知错误'}
          </div>
          <button onClick={this.handleReset}>重试</button>
        </section>
      );
    }
    return this.props.children;
  }
}
