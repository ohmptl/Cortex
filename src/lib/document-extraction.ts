import "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { getDocument, PasswordException } from "pdfjs-dist/legacy/build/pdf.mjs";
import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import mammoth from "mammoth";
import { ProviderError } from "../providers/errors.ts";
import { MAX_COURSE_FILE_BYTES } from "./file-limits.ts";

export { MAX_COURSE_FILE_BYTES as MAX_DOCUMENT_BYTES };

export interface ExtractedDocument {
  text: string;
  contentType: string;
}

const TEXT_FILE_PATTERN = /\.(?:txt|md|csv|tsv|json|xml|ya?ml|tcl|sql|sh|py|[cm]js|tsx?|jsx?|java|c|h|cc|cpp|css|html?)$/i;

export function normalizeExtractedText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\0/g, "")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractionError(kind: string, error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof PasswordException || (error instanceof Error && error.name === "PasswordException")) {
    return new ProviderError("FILE_EXTRACTION_FAILED", "Password-protected PDF files are not supported");
  }
  return new ProviderError("FILE_EXTRACTION_FAILED", `Unable to extract text from ${kind}`);
}

async function extractPdf(bytes: Uint8Array): Promise<string> {
  // Importing pdf.worker.mjs above registers PDF.js's in-process worker handler.
  // This is the Node-supported fake-worker path and gives Next a static asset edge.
  const loadingTask = getDocument({ data: bytes, useWorkerFetch: false });
  try {
    const document = await loadingTask.promise;
    const pages: string[] = [];
    for (let index = 1; index <= document.numPages; index += 1) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      const text = content.items.map((item) => "str" in item ? item.str : "").join(" ");
      pages.push(`--- Page ${index} ---\n${text}`);
      page.cleanup();
    }
    return pages.join("\n\n");
  } catch (error) {
    throw extractionError("PDF", error);
  } finally {
    await loadingTask.destroy();
  }
}

async function extractDocx(bytes: Uint8Array): Promise<string> {
  try {
    return (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
  } catch (error) {
    throw extractionError("DOCX", error);
  }
}

async function extractPptx(bytes: Uint8Array): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    const parser = new XMLParser({ ignoreAttributes: false });
    const names = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]));
    const slides: string[] = [];
    for (const [index, name] of names.entries()) {
      const parsed: unknown = parser.parse(await zip.file(name)!.async("text"));
      const values: string[] = [];
      const walk = (value: unknown): void => {
        if (typeof value === "string") values.push(value);
        else if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === "object") {
          Object.entries(value).forEach(([key, child]) => {
            if (key === "a:t" && typeof child === "string") values.push(child);
            else walk(child);
          });
        }
      };
      walk(parsed);
      slides.push(`--- Slide ${index + 1} ---\n${values.join(" ")}`);
    }
    return slides.join("\n\n");
  } catch (error) {
    throw extractionError("PPTX", error);
  }
}

export async function extractDocumentText(bytes: Uint8Array, mimeType: string, filename: string): Promise<ExtractedDocument> {
  if (bytes.byteLength > MAX_COURSE_FILE_BYTES) {
    throw new ProviderError("FILE_TOO_LARGE", `File exceeds the ${MAX_COURSE_FILE_BYTES} byte limit`);
  }

  const mime = mimeType.toLowerCase();
  let text: string;
  let contentType = mimeType;
  if (mime.startsWith("text/") || /^(?:application\/(?:json|xml|javascript|x-sh))$/.test(mime) || TEXT_FILE_PATTERN.test(filename)) {
    text = new TextDecoder().decode(bytes);
  } else if (mime === "application/pdf" || /\.pdf$/i.test(filename)) {
    text = await extractPdf(bytes);
    contentType = "application/pdf";
  } else if (mime.includes("wordprocessingml") || /\.docx$/i.test(filename)) {
    text = await extractDocx(bytes);
    contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  } else if (mime.includes("presentationml") || /\.pptx$/i.test(filename)) {
    text = await extractPptx(bytes);
    contentType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  } else {
    throw new ProviderError("UNSUPPORTED_CONTENT_TYPE", `Unsupported file content type: ${mimeType || "unknown"}`);
  }
  return { text: normalizeExtractedText(text), contentType };
}

export function paginateText(text: string, offset = 0, maxCharacters = 30_000) {
  const start = Math.max(0, offset);
  const size = Math.max(1, Math.min(maxCharacters, 100_000));
  const content = text.slice(start, start + size);
  const nextOffset = start + content.length < text.length ? start + content.length : null;
  return {
    content,
    totalCharacters: text.length,
    offset: start,
    returnedCharacters: content.length,
    truncated: nextOffset !== null,
    nextOffset,
  };
}
