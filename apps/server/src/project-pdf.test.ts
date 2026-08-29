import { expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { PDFDocument } from "pdf-lib";

process.env.SKIP_ENV_VALIDATION = "true";

const {
  extractProjectPdf,
  parseProjectPdf,
  ProjectPdfError,
  pdfExtractionSchema,
  pdfExtractionDigest,
  validateProjectPdf,
} = await import("./project-pdf");

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

async function pdfWithPages(count: number) {
  const document = await PDFDocument.create();
  for (let page = 0; page < count; page++) document.addPage();
  return document.save();
}

const extraction = {
  projectCode: "PRJ-1",
  projectName: "PDF project",
  client: null,
  location: null,
  startDate: "2026-01-01",
  scheduleStartDate: "2026-01-01",
  endDate: "2026-01-31",
  periodType: "weekly" as const,
  confidence: "high" as const,
  warnings: [],
  metadataSources: {
    projectCode: { page: 1, table: "Project details", sourceRow: 1 },
    projectName: { page: 1, table: "Project details", sourceRow: 1 },
    client: null,
    location: null,
    startDate: { page: 1, table: "Project details", sourceRow: 2 },
    scheduleStartDate: { page: 1, table: "Project details", sourceRow: 2 },
    endDate: { page: 1, table: "Project details", sourceRow: 2 },
    periodType: { page: 1, table: "Project details", sourceRow: 2 },
  },
  rows: [
    {
      page: 1,
      table: "BoQ",
      sourceRow: 2,
      kind: "item" as const,
      code: "1",
      description: "Excavation",
      unit: "m3",
      quantity: 10,
      unitRate: 20,
      amount: 200,
      weight: 100,
      startPeriodIndex: 1,
      finishPeriodIndex: 1,
    },
  ],
  actualSnapshots: [],
};

const parsedPages = [
  {
    pageNumber: 1,
    markdown: "# Project details\n\n| Code | Name |\n| --- | --- |\n| PRJ-1 | PDF project |",
  },
];

test("validates PDFs at the 25-page boundary", async () => {
  expect(await validateProjectPdf(await pdfWithPages(25))).toEqual({ pageCount: 25 });
  await expect(validateProjectPdf(await pdfWithPages(26))).rejects.toThrow("no more than 25 pages");
});

test("rejects non-PDF input", async () => {
  await expect(validateProjectPdf(new TextEncoder().encode("not a pdf"))).rejects.toThrow(
    "not a valid PDF",
  );
});

test("uploads PDFs to Firecrawl with numbered-page parsing enabled", async () => {
  const requests: { input: string | URL | Request; init?: RequestInit }[] = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ input, init });
    return Response.json({
      success: true,
      data: {
        pages: [
          { pageNumber: 1, markdown: "first" },
          { pageNumber: 2, markdown: "second" },
        ],
        metadata: { numPages: 2, totalPages: 2 },
      },
    });
  };

  const result = await parseProjectPdf(
    new TextEncoder().encode("%PDF-test"),
    "folder/project.pdf",
    2,
    { apiKey: "test-key", fetcher, zeroDataRetention: true },
  );

  const request = requests[0]!;
  expect(result.map((page) => page.pageNumber)).toEqual([1, 2]);
  expect(String(request.input)).toBe("https://api.firecrawl.dev/v2/parse");
  expect(request.init?.method).toBe("POST");
  expect(new Headers(request.init?.headers).get("authorization")).toBe("Bearer test-key");
  const form = request.init?.body as FormData;
  const file = form.get("file") as File;
  expect(file.name).toBe("project.pdf");
  expect(file.type).toBe("application/pdf");
  const options = JSON.parse(await (form.get("options") as File).text());
  expect(options).toMatchObject({
    formats: ["markdown"],
    parsers: [{ type: "pdf", mode: "auto", maxPages: 2, pages: true }],
    removeBase64Images: true,
    zeroDataRetention: true,
  });
});

test("rejects incomplete Firecrawl page output", async () => {
  const fetcher = async () => Response.json({
    success: true,
    data: {
      pages: [{ pageNumber: 1, markdown: "first" }],
      metadata: { numPages: 1, totalPages: 2 },
    },
  });

  await expect(
    parseProjectPdf(new TextEncoder().encode("%PDF-test"), "project.pdf", 2, {
      apiKey: "test-key",
      fetcher,
    }),
  ).rejects.toThrow("complete document");
});

test("classifies Firecrawl rate limits as retryable provider failures", async () => {
  const fetcher = async () => Response.json(
    { success: false, error: "rate limited" },
    { status: 429 },
  );

  const error = await parseProjectPdf(
    new TextEncoder().encode("%PDF-test"),
    "project.pdf",
    1,
    { apiKey: "test-key", fetcher },
  ).catch((caught) => caught);
  expect(error).toBeInstanceOf(ProjectPdfError);
  expect(error).toMatchObject({ kind: "provider", code: "pdf_provider_rate_limited" });
});

test("bounds streamed Firecrawl responses before buffering them completely", async () => {
  const fetcher = async () => new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(2_100_000));
        controller.enqueue(new Uint8Array(2_100_000));
        controller.close();
      },
    }),
  );

  await expect(
    parseProjectPdf(new TextEncoder().encode("%PDF-test"), "project.pdf", 1, {
      apiKey: "test-key",
      fetcher,
    }),
  ).rejects.toThrow("too large");
});

test("sanitizes Firecrawl response-stream failures", async () => {
  const fetcher = async () => new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new Error("private transport detail"));
      },
    }),
  );

  const error = await parseProjectPdf(
    new TextEncoder().encode("%PDF-test"),
    "project.pdf",
    1,
    { apiKey: "test-key", fetcher },
  ).catch((caught) => caught);
  expect(error).toMatchObject({ kind: "provider", code: "pdf_provider_unavailable" });
  expect(error.message).not.toContain("private transport detail");
});

test("uses Firecrawl page text with the privacy-focused Azure Gateway route", async () => {
  let answers = 0;
  let parses = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      expect(parses).toBe(1);
      return {
        content: [{ type: "text", text: JSON.stringify(extraction) }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      };
    },
  });

  const result = await extractProjectPdf(
    new Uint8Array([1, 2, 3]),
    "project.pdf",
    1,
    {
      onModelAnswer: () => {
        answers++;
      },
      onParsed: () => {
        parses++;
      },
      model,
      parsedPages,
    },
  );

  expect(result).toEqual(extraction);
  expect(parses).toBe(1);
  expect(answers).toBe(1);
  expect(model.doGenerateCalls[0]?.providerOptions).toMatchObject({
    gateway: {
      only: ["azure"],
      disallowPromptTraining: true,
    },
    openai: { store: false },
  });
  expect(model.doGenerateCalls[0]?.prompt).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: "user",
        content: expect.arrayContaining([
          expect.objectContaining({
            type: "text",
            text: expect.stringContaining('<pdf-page number="1">'),
          }),
        ]),
      }),
    ]),
  );
  expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain(
    "never infer values from charts",
  );
  expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).not.toContain('"type":"file"');
});

test("requires model-reported provenance for extracted project metadata", () => {
  expect(
    pdfExtractionSchema.safeParse({
      ...extraction,
      metadataSources: { ...extraction.metadataSources, projectName: null },
    }).success,
  ).toBe(false);
});

test("rejects duplicate extracted PDF row locators", () => {
  expect(
    pdfExtractionSchema.safeParse({
      ...extraction,
      rows: [extraction.rows[0], { ...extraction.rows[0], description: "Duplicate" }],
    }).success,
  ).toBe(false);
});

test("uses a stable digest for immutable extraction values", () => {
  expect(pdfExtractionDigest(extraction)).toBe(pdfExtractionDigest(structuredClone(extraction)));
  expect(
    pdfExtractionDigest({
      ...extraction,
      rows: [{ ...extraction.rows[0]!, quantity: 11 }],
    }),
  ).not.toBe(pdfExtractionDigest(extraction));
});

test("propagates credit settlement failures after a valid PDF answer", async () => {
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify(extraction) }],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    }),
  });

  await expect(
    extractProjectPdf(
      new Uint8Array([1]),
      "project.pdf",
      1,
      {
        onModelAnswer: () => {
          throw new Error("settlement failed");
        },
        model,
        parsedPages,
      },
    ),
  ).rejects.toThrow("settlement failed");
});
