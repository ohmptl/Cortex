import assert from "node:assert/strict";
import test from "node:test";
import { extractDocumentText, MAX_DOCUMENT_BYTES, paginateText } from "../src/lib/document-extraction.ts";
import { ProviderError } from "../src/providers/errors.ts";
import { docxFixture, pdfFixture, pptxFixture } from "./documentFixtures.ts";

function providerCode(code: string) {
  return (error: unknown) => error instanceof ProviderError && error.code === code;
}

test("PDF extraction uses the registered in-process worker and extracts multiple pages", async () => {
  const worker = (globalThis as typeof globalThis & { pdfjsWorker?: { WorkerMessageHandler?: unknown } }).pdfjsWorker;
  assert.ok(worker?.WorkerMessageHandler, "the server worker handler must be statically available");
  const extracted = await extractDocumentText(pdfFixture(["First page", "Second page"]), "application/pdf", "notes.pdf");
  assert.match(extracted.text, /--- Page 1 ---\nFirst page/);
  assert.match(extracted.text, /--- Page 2 ---\nSecond page/);
});

test("malformed and encrypted PDFs fail with controlled typed errors", async () => {
  await assert.rejects(() => extractDocumentText(new TextEncoder().encode("not a pdf"), "application/pdf", "broken.pdf"), providerCode("FILE_EXTRACTION_FAILED"));
  await assert.rejects(() => extractDocumentText(pdfFixture(["secret"], true), "application/pdf", "protected.pdf"), providerCode("FILE_EXTRACTION_FAILED"));
});

test("plain text, source files, DOCX, and PPTX remain supported", async () => {
  assert.equal((await extractDocumentText(new TextEncoder().encode("set course ok\r\n"), "application/octet-stream", "setup.tcl")).text, "set course ok");
  assert.match((await extractDocumentText(await docxFixture("Word fixture"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "notes.docx")).text, /Word fixture/);
  const slides = await extractDocumentText(await pptxFixture(["Alpha", "Beta"]), "application/vnd.openxmlformats-officedocument.presentationml.presentation", "deck.pptx");
  assert.match(slides.text, /--- Slide 1 ---\nAlpha/);
  assert.match(slides.text, /--- Slide 2 ---\nBeta/);
});

test("document size and pagination bounds are enforced", async () => {
  await assert.rejects(() => extractDocumentText(new Uint8Array(MAX_DOCUMENT_BYTES + 1), "text/plain", "large.txt"), providerCode("FILE_TOO_LARGE"));
  assert.equal(paginateText("x".repeat(40_000)).returnedCharacters, 30_000);
  const page = paginateText("x".repeat(150_000), 25, 200_000);
  assert.equal(page.offset, 25);
  assert.equal(page.returnedCharacters, 100_000);
  assert.equal(page.nextOffset, 100_025);
  assert.equal(page.truncated, true);
});
