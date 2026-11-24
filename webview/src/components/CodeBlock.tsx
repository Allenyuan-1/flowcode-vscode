import type { ReactNode } from 'react';

const KEYWORDS = new Set([
  'def', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'not', 'and', 'or', 'is',
  'import', 'from', 'as', 'class', 'try', 'except', 'finally', 'with', 'lambda', 'yield',
  'pass', 'break', 'continue', 'raise', 'assert', 'global', 'nonlocal', 'async', 'await',
  'None', 'True', 'False', 'self', 'cls',
]);

const TOKEN = /("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(#.*$)|\b([A-Za-z_]\w*)\b|(\b\d+(?:\.\d+)?\b)/g;

function tokenize(line: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  let index = 0;
  while ((match = TOKEN.exec(line))) {
    if (match.index > last) nodes.push(line.slice(last, match.index));
    const [text, stringToken, commentToken, wordToken, numberToken] = match;
    const key = `t${index++}`;
    if (stringToken) nodes.push(<span className="tok-string" key={key}>{text}</span>);
    else if (commentToken) nodes.push(<span className="tok-comment" key={key}>{text}</span>);
    else if (numberToken) nodes.push(<span className="tok-number" key={key}>{text}</span>);
    else if (wordToken) {
      if (KEYWORDS.has(wordToken)) nodes.push(<span className="tok-keyword" key={key}>{text}</span>);
      else if (line[match.index + text.length] === '(') nodes.push(<span className="tok-call" key={key}>{text}</span>);
      else nodes.push(<span className="tok-name" key={key}>{text}</span>);
    } else {
      nodes.push(text);
    }
    last = match.index + text.length;
  }
  if (last < line.length) nodes.push(line.slice(last));
  return nodes;
}

export function CodeBlock({ code, showLineNumbers = true }: { code: string; showLineNumbers?: boolean }) {
  const lines = code.replace(/\n$/, '').split('\n');
  return (
    <div className="code-block">
      <div className="code-lines">
        {lines.map((line, index) => (
          <div className="code-line" key={index}>
            {showLineNumbers && <span className="line-no">{index + 1}</span>}
            <span className="line-code">{tokenize(line)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
