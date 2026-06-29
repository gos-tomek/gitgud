import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Scissors } from "lucide-react";

function SuggestionBlock({ code }: { code: string }) {
  const lines = code.split("\n");
  return (
    <div className="my-2 overflow-hidden rounded-md border border-green-300">
      <div className="flex items-center gap-1.5 border-b border-green-300 bg-green-100 px-3 py-1.5">
        <Scissors className="size-3.5 text-green-700" />
        <span className="text-xs font-semibold text-green-700">Suggested change</span>
      </div>
      <div className="bg-green-50">
        {lines.map((line, i) => (
          <div key={i} className="flex font-mono text-xs leading-5">
            <span className="w-6 text-center text-green-600 select-none">+</span>
            <code className="flex-1 whitespace-pre-wrap text-green-900">{line}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

const COMPONENTS: React.ComponentProps<typeof Markdown>["components"] = {
  pre({ children }) {
    return <>{children}</>;
  },
  code(props) {
    const { children, className } = props;
    const match = /language-(\w+)/.exec(className ?? "");
    const lang = match?.[1];
    const content = (typeof children === "string" ? children : "").replace(/\n$/, "");

    if (lang === "suggestion") {
      return <SuggestionBlock code={content} />;
    }
    if (lang) {
      return (
        <pre className="my-2 overflow-x-auto rounded-md bg-slate-900 p-3 font-mono text-xs text-slate-100">
          {content}
        </pre>
      );
    }
    return <code className="rounded bg-slate-100 px-1 font-mono text-xs text-slate-700">{children}</code>;
  },
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
        {children}
      </a>
    );
  },
  blockquote({ children }) {
    return (
      <blockquote className="my-2 border-l-4 border-slate-300 pl-3 text-sm text-slate-500 italic">
        {children}
      </blockquote>
    );
  },
  p({ children }) {
    return <p className="mb-2 last:mb-0">{children}</p>;
  },
  ul({ children }) {
    return <ul className="mb-2 list-disc pl-5">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="mb-2 list-decimal pl-5">{children}</ol>;
  },
  li({ children }) {
    return <li className="mb-0.5">{children}</li>;
  },
};

export function CommentBody({ body }: { body: string }) {
  return (
    <div className="text-foreground text-sm">
      <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {body}
      </Markdown>
    </div>
  );
}
