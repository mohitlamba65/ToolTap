import crypto from "node:crypto";
import type { ChunkMetadata, StructuredChunk } from "./types.js";

/**
 * Structure-Aware Chunker
 * 
 * Parses document content based on Markdown headings and document sections
 * rather than arbitrary fixed-size character slicing.
 * Preserves heading paths (hierarchy) and metadata.
 */
export class StructureAwareChunker {
    private maxChunkSize: number;
    private chunkOverlap: number;

    constructor(maxChunkSize = 800, chunkOverlap = 150) {
        this.maxChunkSize = maxChunkSize;
        this.chunkOverlap = chunkOverlap;
    }

    /**
     * Parses text/markdown structurally and returns chunks with heading metadata.
     */
    chunkDocument(
        content: string,
        source: string,
        title: string,
        category = "general",
        tags: string[] = ["documentation"],
        effectiveDate: string = new Date().toISOString().split("T")[0]
    ): StructuredChunk[] {
        const lines = content.split(/\r?\n/);
        const sections: Array<{ headingPath: string; text: string }> = [];

        let currentHeadingPath: string[] = [title];
        let currentSectionText: string[] = [];

        for (const line of lines) {
            const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

            if (headingMatch) {
                // Save previous section if it has content
                if (currentSectionText.length > 0) {
                    sections.push({
                        headingPath: currentHeadingPath.join(" > "),
                        text: currentSectionText.join("\n").trim(),
                    });
                    currentSectionText = [];
                }

                const level = headingMatch[1].length;
                const headingTitle = headingMatch[2].trim();

                // Adjust heading stack depth
                if (level === 1) {
                    currentHeadingPath = [title, headingTitle];
                } else {
                    currentHeadingPath = currentHeadingPath.slice(0, level);
                    currentHeadingPath[level] = headingTitle;
                }
            } else {
                currentSectionText.push(line);
            }
        }

        // Flush trailing section
        if (currentSectionText.length > 0) {
            sections.push({
                headingPath: currentHeadingPath.join(" > "),
                text: currentSectionText.join("\n").trim(),
            });
        }

        const finalChunks: StructuredChunk[] = [];
        const docNodeId = `node_${Math.random().toString(36).substring(2, 9)}`;

        for (const section of sections) {
            if (!section.text) continue;

            // If section is smaller than maxChunkSize, keep as a single chunk
            if (section.text.length <= this.maxChunkSize) {
                finalChunks.push(
                    this.createChunk(section.text, section.headingPath, docNodeId, source, title, category, tags, effectiveDate)
                );
            } else {
                // Split oversized section with overlap while preserving heading path
                const subChunks = this.splitTextWithOverlap(section.text);
                for (const subText of subChunks) {
                    finalChunks.push(
                        this.createChunk(subText, section.headingPath, docNodeId, source, title, category, tags, effectiveDate)
                    );
                }
            }
        }

        return finalChunks;
    }

    private splitTextWithOverlap(text: string): string[] {
        const chunks: string[] = [];
        let start = 0;

        while (start < text.length) {
            let end = start + this.maxChunkSize;

            if (end < text.length) {
                // Try to find natural sentence or newline break near end
                const breakPoint = text.lastIndexOf(".", end);
                const newlinePoint = text.lastIndexOf("\n", end);
                const bestBreak = Math.max(breakPoint, newlinePoint);

                if (bestBreak > start + this.maxChunkSize / 2) {
                    end = bestBreak + 1;
                }
            }

            chunks.push(text.slice(start, end).trim());
            start = end - this.chunkOverlap;
        }

        return chunks;
    }

    private createChunk(
        text: string,
        headingPath: string,
        nodeId: string,
        source: string,
        title: string,
        category: string,
        tags: string[],
        effectiveDate: string
    ): StructuredChunk {
        const chunkId = crypto.randomUUID();

        const metadata: ChunkMetadata = {
            chunk_id: chunkId,
            node_id: nodeId,
            source,
            title,
            heading_path: headingPath,
            category,
            tags,
            effective_date: effectiveDate,
            status: "active",
        };

        return { text, metadata };
    }
}
