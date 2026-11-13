"use client";

import React from "react";

function renderInline(text: string): React.ReactNode[] {
  // Matches **bold**, *italic*, `code`, and [links](url)
  const tokens = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);

  return tokens.map((token, idx) => {
    // Bold: **text**
    if (token.startsWith("**") && token.endsWith("**") && token.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-slate-900">
          {token.slice(2, -2)}
        </strong>
      );
    }
    // Italic: *text*
    if (token.startsWith("*") && token.endsWith("*") && token.length > 2 && !token.startsWith("**")) {
      return (
        <em key={idx} className="italic text-slate-800">
          {token.slice(1, -1)}
        </em>
      );
    }
    // Inline code: `code`
    if (token.startsWith("`") && token.endsWith("`") && token.length > 2) {
      return (
        <code
          key={idx}
          className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[12px] font-medium text-slate-800 border border-slate-200"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    // Markdown link: [text](url)
    const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={idx}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline hover:text-blue-800 font-medium"
        >
          {linkMatch[1]}
        </a>
      );
    }
    return <React.Fragment key={idx}>{token}</React.Fragment>;
  });
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(line);
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function FormattedText({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Markdown Table Detection
    if (trimmed.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = parseTableRow(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().includes("|") && lines[i].trim() !== "") {
        rows.push(parseTableRow(lines[i]));
        i++;
      }
      blocks.push(
        <div key={`tbl-${i}`} className="my-3 overflow-x-auto rounded-xl border border-slate-200 shadow-2xs">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs sm:text-sm">
            <thead className="bg-slate-50 text-slate-800 font-semibold">
              <tr>
                {headers.map((h, hIdx) => (
                  <th key={hIdx} className="px-3.5 py-2.5 font-semibold whitespace-nowrap">
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.map((r, rIdx) => (
                <tr key={rIdx} className={rIdx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                  {headers.map((_, cIdx) => (
                    <td key={cIdx} className="px-3.5 py-2 text-slate-700 leading-normal">
                      {renderInline(r[cIdx] || "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Headings (#, ##, ###)
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      blocks.push(
        <div key={`h-${i}`} className="pt-2 pb-0.5 border-b border-slate-100">
          <h4
            className={`font-bold text-slate-900 tracking-tight ${
              level === 1 ? "text-base sm:text-lg text-blue-900" : level === 2 ? "text-sm sm:text-base text-slate-900" : "text-sm text-slate-800"
            }`}
          >
            {renderInline(headingMatch[2])}
          </h4>
        </div>
      );
      i++;
      continue;
    }

    // Bullet List (- or * or •)
    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={`ul-${i}`} className="my-2 space-y-1.5 pl-2 text-slate-700 text-sm sm:text-[15px]">
          {items.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2.5 leading-relaxed">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
              <span className="flex-1">{renderInline(item)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Numbered/Ordered List (1. or 1))
    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={`ol-${i}`} className="my-2 space-y-1.5 pl-2 text-slate-700 text-sm sm:text-[15px]">
          {items.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2.5 leading-relaxed">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-50 font-mono text-[11px] font-bold text-blue-700 border border-blue-200">
                {idx + 1}
              </span>
              <span className="flex-1 pt-0.5">{renderInline(item)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Regular paragraph (group consecutive plain lines)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^[-*•]\s+/.test(lines[i].trim()) &&
      !/^\d+[.)]\s+/.test(lines[i].trim()) &&
      !/^#{1,3}\s+/.test(lines[i].trim()) &&
      !(lines[i].trim().includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }

    blocks.push(
      <p key={`p-${i}`} className="leading-relaxed text-slate-800 text-sm sm:text-[15px]">
        {renderInline(paraLines.join(" "))}
      </p>
    );
  }

  return <div className="space-y-3">{blocks}</div>;
}
