import React from 'react';

const COLORS = {
  comment: '#6A9955',
  string: '#CE9178',
  number: '#B5CEA8',
  keyword: '#C586C0',
  literal: '#569CD6',
  call: '#DCDCAA',
  property: '#9CDCFE',
  plain: '#D4D4D4',
};

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'new', 'if', 'else', 'for', 'while', 'typeof',
  'void', 'class', 'import', 'from', 'export', 'default', 'async', 'await', 'of', 'in',
]);
const LITERALS = new Set(['true', 'false', 'null', 'undefined']);

const TOKEN_RE = /(\/\/.*$)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)(?=\()|(\.[A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)/g;

/** A small single-pass JS tokenizer: enough for the short SDK snippets shown on the marketing pages, not a full parser. */
export function highlightJsLine(line: string, key: string | number): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  let match: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(line))) {
    if (match.index > last) nodes.push(<span key={i++} style={{ color: COLORS.plain }}>{line.slice(last, match.index)}</span>);
    const [, comment, string, number, call, property, word] = match;
    if (comment !== undefined) nodes.push(<span key={i++} style={{ color: COLORS.comment }}>{comment}</span>);
    else if (string !== undefined) nodes.push(<span key={i++} style={{ color: COLORS.string }}>{string}</span>);
    else if (number !== undefined) nodes.push(<span key={i++} style={{ color: COLORS.number }}>{number}</span>);
    else if (call !== undefined) nodes.push(<span key={i++} style={{ color: COLORS.call }}>{call}</span>);
    else if (property !== undefined) nodes.push(
      <span key={i++}><span style={{ color: COLORS.plain }}>.</span><span style={{ color: COLORS.property }}>{property.slice(1)}</span></span>,
    );
    else if (word !== undefined) {
      const color = KEYWORDS.has(word) ? COLORS.keyword : LITERALS.has(word) ? COLORS.literal : COLORS.plain;
      nodes.push(<span key={i++} style={{ color }}>{word}</span>);
    }
    last = match.index + match[0].length;
  }
  if (last < line.length) nodes.push(<span key={i++} style={{ color: COLORS.plain }}>{line.slice(last)}</span>);
  return <span key={key} className="font-mono text-[13px] leading-[1.75] whitespace-pre">{nodes.length ? nodes : ' '}</span>;
}
