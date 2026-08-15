import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders the Companion's replies as rich, carefully-styled markdown — tables,
 * lists, code, links and emphasis — so the model's numbers and structure read
 * like a polished document instead of a wall of plain text.
 */
const components: Components = {
  table: ({ children }) => (
    <div className="my-2 overflow-hidden rounded-lg border">
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-xs">{children}</table>
      </div>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-accent/50">{children}</thead>,
  tr: ({ children }) => <tr className="odd:bg-accent/20">{children}</tr>,
  th: ({ children }) => (
    <th className="border-b px-2.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border-b border-border/50 px-2.5 py-2 align-top">{children}</td>,
  code: ({ children }) => (
    <code className="rounded-md bg-accent/60 px-1.5 py-0.5 font-mono text-[0.85em]">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg border bg-muted p-3.5 text-xs font-mono leading-relaxed">
      {children}
    </pre>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="underline decoration-border underline-offset-2 transition-colors hover:text-foreground"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => <h3 className="mt-3 mb-1.5 text-base font-semibold tracking-tight">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-3 mb-1.5 text-[15px] font-semibold tracking-tight">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-2.5 mb-1 text-sm font-semibold tracking-tight">{children}</h4>,
  h4: ({ children }) => <h4 className="mt-2 mb-1 text-sm font-semibold tracking-tight">{children}</h4>,
  p: ({ children }) => <p className="my-1.5 leading-relaxed">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 rounded-r-md border-l-2 bg-accent/20 py-1 pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-border" />,
};

export default function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown text-sm leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
