import React from 'react';

export interface SkipToContentLinkProps {
  targetId?: string;
  className?: string;
}

export const SkipToContentLink: React.FC<SkipToContentLinkProps> = ({
  targetId = 'main-content',
  className = '',
}) => {
  const handleClick = () => {
    const targetElement = document.getElementById(targetId);
    if (targetElement) {
      targetElement.focus();
    }
  };

  return (
    <a
      href={`#${targetId}`}
      onClick={handleClick}
      className={`sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:text-xs focus:font-semibold focus:rounded-xl focus:bg-zinc-900 focus:text-cyan-400 focus:border focus:border-cyan-500/40 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-zinc-950 focus:shadow-neon-cyan ${className}`.trim()}
    >
      Skip to main content
    </a>
  );
};
