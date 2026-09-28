"use client";

import { motion, useInView, useReducedMotion } from "motion/react";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";

const KEYWORDS = new Set([
  "import", "from", "export", "const", "let", "await", "async", "function", "return", "if", "else", "new", "true", "false", "null", "type", "interface",
]);

/** Minimal JS/TS highlighter — good enough for docs snippets. */
function highlight(code: string): React.ReactNode[] {
  const tokens = code.split(/(\/\/[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b[A-Za-z_$][\w$]*\b|\d+(?:\.\d+)?)/g);
  return tokens.map((token, i) => {
    if (!token) return null;
    let className = "";
    if (token.startsWith("//")) className = "text-ink-500 italic";
    else if (/^["'`]/.test(token)) className = "text-[#c6ff3d]";
    else if (KEYWORDS.has(token)) className = "text-[#ff7ab8]";
    else if (/^\d/.test(token)) className = "text-[#ffc93d]";
    else if (/^[A-Z]/.test(token)) className = "text-[#8fb3ff]";
    else if (/^[a-z_$][\w$]*$/i.test(token) && code[code.indexOf(token) + token.length] === "(") className = "text-[#7fe7ff]";
    return className ? (
      <span key={i} className={className}>
        {token}
      </span>
    ) : (
      <span key={i}>{token}</span>
    );
  });
}

export function CodeBlock({
  code,
  filename,
  typing = false,
  className,
}: {
  code: string;
  filename?: string;
  /** Types the snippet out when it scrolls into view. */
  typing?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const reduced = useReducedMotion();
  const animate = typing && !reduced;
  const [shown, setShown] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!animate || !inView) return;
    let i = 0;
    const t = setInterval(() => {
      i = Math.min(code.length, i + 3);
      setShown(i);
      if (i >= code.length) clearInterval(t);
    }, 16);
    return () => clearInterval(t);
  }, [animate, code, inView]);

  const visible = animate ? code.slice(0, shown) : code;
  return (
    <div ref={ref} className={cn("overflow-hidden rounded-3xl border border-white/10 bg-[#0a0c13] shadow-2xl", className)}>
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
        <span className="size-3 rounded-full bg-[#ff5f57]" />
        <span className="size-3 rounded-full bg-[#febc2e]" />
        <span className="size-3 rounded-full bg-[#28c840]" />
        {filename && <span className="ml-2 font-mono text-xs text-ink-400">{filename}</span>}
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              play("pop");
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // ignore
            }
          }}
          className="ml-auto flex size-8 items-center justify-center rounded-lg text-ink-400 transition hover:bg-white/10 hover:text-white"
          aria-label="Copy code"
        >
          {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
        </button>
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed text-ink-100">
        <code>
          {highlight(visible)}
          {animate && shown < code.length && (
            <motion.span
              className="inline-block h-4 w-2 translate-y-0.5 bg-ink-100"
              animate={{ opacity: [1, 0] }}
              transition={{ duration: 0.6, repeat: Infinity }}
            />
          )}
        </code>
      </pre>
    </div>
  );
}
