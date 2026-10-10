import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';
import * as errorReporting from '../lib/errorReporting';

vi.mock('../lib/errorReporting', () => ({
  captureException: vi.fn(),
}));

const ThrowError: React.FC<{ shouldThrow: boolean; message?: string }> = ({
  shouldThrow,
  message = 'Test explosion',
}) => {
  if (shouldThrow) {
    throw new Error(message);
  }
  return <div>Healthy content</div>;
};

describe('ErrorBoundary', () => {
  let originalConsoleError: typeof console.error;
  let reloadMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    originalConsoleError = console.error;
    // Suppress React's default error boundary logging in test output
    console.error = vi.fn();

    reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        reload: reloadMock,
      },
    });
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Healthy content')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    expect(errorReporting.captureException).not.toHaveBeenCalled();
  });

  it('(c) renders neutral fallback with reload button and reports error when child throws', () => {
    const errorMsg = 'Boom! Unhandled UI error';

    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} message={errorMsg} />
      </ErrorBoundary>
    );

    // Fallback UI rendered
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(
      screen.getByText(
        'An unexpected error occurred. Please reload the application to continue.'
      )
    ).toBeInTheDocument();

    const reloadButton = screen.getByRole('button', {
      name: /reload application/i,
    });
    expect(reloadButton).toBeInTheDocument();

    // Verify error was reported to errorReporting facade
    expect(errorReporting.captureException).toHaveBeenCalledTimes(1);
    expect(errorReporting.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: errorMsg }),
      expect.objectContaining({
        extra: expect.objectContaining({
          componentStack: expect.any(String),
        }),
      })
    );

    // Click reload button
    fireEvent.click(reloadButton);
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('renders custom fallback prop when provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom Error View</div>}>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Custom Error View')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    expect(errorReporting.captureException).toHaveBeenCalledTimes(1);
  });
});
