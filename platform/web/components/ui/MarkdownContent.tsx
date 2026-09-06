"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  text: string;
  className?: string;
};

/** Renders AI/coach Markdown safely inside chat bubbles. */
export function MarkdownContent({ text, className = "" }: Props) {
  const src = (text || "").trim();
  if (!src) return null;

  return (
    <div className={`md-content ${className}`.trim()} dir="auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          // Avoid raw HTML; react-markdown escapes by default
          img: () => null
        }}
      >
        {src}
      </ReactMarkdown>
    </div>
  );
}
