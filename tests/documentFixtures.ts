import JSZip from "jszip";

function pdfString(value: string): string {
  return value.replace(/([\\()])/g, "\\$1");
}

export function pdfFixture(pageTexts: string[], encrypted = false): Uint8Array {
  const objects = new Map<number, string>();
  const pageIds = pageTexts.map((_, index) => 4 + index * 2);
  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objects.set(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  objects.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pageTexts.forEach((text, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const stream = `BT /F1 18 Tf 72 720 Td (${pdfString(text)}) Tj ET`;
    objects.set(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.set(contentId, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let encryptId: number | null = null;
  if (encrypted) {
    encryptId = Math.max(...objects.keys()) + 1;
    const key = "00".repeat(32);
    objects.set(encryptId, `<< /Filter /Standard /V 1 /R 2 /O <${key}> /U <${key}> /P -4 >>`);
  }

  let pdf = "%PDF-1.4\n% fixture\n";
  const offsets = new Map<number, number>();
  for (const [id, body] of [...objects].sort(([left], [right]) => left - right)) {
    offsets.set(id, pdf.length);
    pdf += `${id} 0 obj\n${body}\nendobj\n`;
  }
  const xref = pdf.length;
  const size = Math.max(...objects.keys()) + 1;
  pdf += `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let id = 1; id < size; id += 1) pdf += `${String(offsets.get(id) ?? 0).padStart(10, "0")} 00000 n \n`;
  const encryption = encryptId === null ? "" : ` /Encrypt ${encryptId} 0 R /ID [<${"01".repeat(16)}> <${"01".repeat(16)}>]`;
  pdf += `trailer\n<< /Size ${size} /Root 1 0 R${encryption} >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

export async function docxFixture(text: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: "uint8array" });
}

export async function pptxFixture(slides: string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  slides.forEach((text, index) => zip.file(`ppt/slides/slide${index + 1}.xml`, `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><a:t>${text}</a:t></p:cSld></p:sld>`));
  return zip.generateAsync({ type: "uint8array" });
}
