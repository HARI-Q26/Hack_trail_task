import fs from 'fs';
import path from 'path';
import { PDFParse } from 'pdf-parse';

export interface KnowledgeChunk {
  id: string;
  docTitle: string;
  category: 'rules' | 'admissions' | 'notes' | 'circular';
  section: string;
  content: string;
}

let knowledgeChunksCache: KnowledgeChunk[] | null = null;

const DOC_MAPPINGS: Array<{
  filename: string;
  title: string;
  category: 'rules' | 'admissions' | 'notes' | 'circular';
}> = [
  {
    filename: '2_KIT Student Handbook 2026.pdf',
    title: 'KIT Student Handbook 2026',
    category: 'rules',
  },
  {
    filename: '3_KIT Admissions Brochure 2026.pdf',
    title: 'KIT Admissions Brochure 2026',
    category: 'admissions',
  },
  {
    filename: '4_DBMS Lesson Notes - Units 1 to 3.pdf',
    title: 'DBMS Lesson Notes (Units 1-3)',
    category: 'notes',
  },
  {
    filename: '5_Circular 12_2026_ On-duty proof within 3 working days (B.Tech).pdf',
    title: 'Circular 12/2026 - On-duty proof within 3 working days',
    category: 'circular',
  },
];

/**
 * Split text into semantic chunks based on headings, rules, or chapter breaks.
 */
function chunkDocumentText(text: string, docTitle: string, category: KnowledgeChunk['category']): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  // Split on chapters, sections, rules, units, or double newlines
  const rawSections = text.split(/(?=(?:Chapter\s+\d+|Rule\s+\d+\.\d+|Unit\s+\d+|Annexure\s+[A-Z]|Section\s+\d+))/i);

  let chunkIdx = 0;
  for (const rawSec of rawSections) {
    const trimmed = rawSec.trim();
    if (trimmed.length < 50) continue; // skip tiny fragments

    // If chunk is larger than 1500 chars, break into sub-blocks
    if (trimmed.length > 1500) {
      const paragraphs = trimmed.split(/\n\s*\n/);
      let buffer = '';
      let subIdx = 1;

      for (const p of paragraphs) {
        if ((buffer + '\n' + p).length > 1200 && buffer.length > 200) {
          const lines = buffer.trim().split('\n');
          const firstLine = lines[0].slice(0, 80).trim();
          chunks.push({
            id: `${docTitle}-${chunkIdx}-${subIdx}`,
            docTitle,
            category,
            section: firstLine || `Section ${chunkIdx}.${subIdx}`,
            content: buffer.trim(),
          });
          buffer = p;
          subIdx++;
        } else {
          buffer = buffer ? `${buffer}\n\n${p}` : p;
        }
      }

      if (buffer.trim().length > 50) {
        const lines = buffer.trim().split('\n');
        chunks.push({
          id: `${docTitle}-${chunkIdx}-${subIdx}`,
          docTitle,
          category,
          section: lines[0].slice(0, 80).trim(),
          content: buffer.trim(),
        });
      }
    } else {
      const lines = trimmed.split('\n');
      const firstLine = lines[0].slice(0, 80).trim();
      chunks.push({
        id: `${docTitle}-${chunkIdx}`,
        docTitle,
        category,
        section: firstLine || `Section ${chunkIdx}`,
        content: trimmed,
      });
    }
    chunkIdx++;
  }

  return chunks;
}

/**
 * Load and index all official KIT PDF documents.
 */
export async function initializeKnowledgeBase(): Promise<KnowledgeChunk[]> {
  if (knowledgeChunksCache && knowledgeChunksCache.length > 0) {
    return knowledgeChunksCache;
  }

  const chunks: KnowledgeChunk[] = [];
  const docsDir = path.resolve(process.cwd(), './data/documents');

  if (!fs.existsSync(docsDir)) {
    console.warn(`[KnowledgeBase]: Documents directory not found at ${docsDir}`);
    return [];
  }

  for (const mapping of DOC_MAPPINGS) {
    const filePath = path.join(docsDir, mapping.filename);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    try {
      const fileBuf = fs.readFileSync(filePath);
      const parser = new PDFParse(new Uint8Array(fileBuf));
      const parsed = await parser.getText();
      const docChunks = chunkDocumentText(parsed.text, mapping.title, mapping.category);
      chunks.push(...docChunks);
      console.info(`[KnowledgeBase]: Indexed ${docChunks.length} chunks from ${mapping.title}`);
    } catch (err: any) {
      console.error(`[KnowledgeBase]: Failed parsing ${mapping.filename}:`, err?.message || err);
    }
  }

  knowledgeChunksCache = chunks;
  return chunks;
}

/**
 * Search the indexed knowledge base using keyword scoring.
 */
export async function searchKnowledge(
  query: string,
  options: {
    limit?: number;
    category?: 'rules' | 'admissions' | 'notes' | 'circular' | 'all';
  } = {}
): Promise<Array<{ docTitle: string; section: string; content: string; score: number }>> {
  const { limit = 3, category = 'all' } = options;
  const chunks = await initializeKnowledgeBase();

  const cleanQuery = query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const terms = cleanQuery.split(/\s+/).filter(t => t.length > 2);

  if (terms.length === 0) {
    return [];
  }

  const scored: Array<{ docTitle: string; section: string; content: string; score: number }> = [];

  for (const chunk of chunks) {
    if (category !== 'all' && chunk.category !== category) {
      continue;
    }

    const contentLower = chunk.content.toLowerCase();
    const sectionLower = chunk.section.toLowerCase();

    let score = 0;
    for (const term of terms) {
      // Heading match is weighted higher
      if (sectionLower.includes(term)) {
        score += 5;
      }
      // Content occurrence
      const matches = contentLower.split(term).length - 1;
      score += Math.min(matches, 5);
    }

    if (score > 0) {
      scored.push({
        docTitle: chunk.docTitle,
        section: chunk.section,
        content: chunk.content,
        score,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
