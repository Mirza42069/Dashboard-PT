import { expect, test } from "bun:test";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";

import type { WorkbookInterpretation } from "./workbook-ai";

process.env.SKIP_ENV_VALIDATION = "true";

const { interpretWorkbook } = await import("./workbook-ai");

const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 20,
    text: 20,
    reasoning: undefined,
  },
};

function modelAnswer(value: unknown) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify(value) }],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    }),
  });
}

const validInterpretation: WorkbookInterpretation = {
  sheetName: "BoQ",
  projectCode: "PRJ-001",
  projectName: "Example project",
  client: null,
  location: null,
  startDate: "2026-01-01",
  endDate: "2026-03-31",
  headerRow: 1,
  dataStartRow: 2,
  dataEndRow: 10,
  descriptionColumn: 1,
  unitColumn: 2,
  quantityColumn: 3,
  unitRateColumn: null,
  amountColumn: 4,
  weightColumn: null,
  startColumn: 5,
  finishColumn: 6,
  sectionRows: [],
  excludedRows: [10],
  periodType: "weekly",
  confidence: "high",
  warnings: [],
};

test("does not make non-mocked Gateway calls during tests", async () => {
  let answers = 0;

  const result = await interpretWorkbook({}, () => {
    answers++;
  });

  expect(result).toBeNull();
  expect(answers).toBe(0);
});

test("returns a validated Gateway workbook interpretation", async () => {
  let answers = 0;
  const model = modelAnswer(validInterpretation);

  const result = await interpretWorkbook(
    { sheets: [{ name: "BoQ" }] },
    () => {
      answers++;
    },
    model,
  );

  expect(result).toEqual(validInterpretation);
  expect(answers).toBe(1);
  expect(model.doGenerateCalls).toHaveLength(1);
  expect(model.doGenerateCalls[0]?.maxOutputTokens).toBe(1_500);
  expect(model.doGenerateCalls[0]?.providerOptions).toMatchObject({
    gateway: { only: ["azure"], disallowPromptTraining: true },
  });
  expect(model.doGenerateCalls[0]?.responseFormat).toMatchObject({
    type: "json",
    name: "project_workbook_layout",
  });
});

test("settles the AI credit when structured output is unusable", async () => {
  let answers = 0;

  const result = await interpretWorkbook(
    {},
    () => {
      answers++;
    },
    modelAnswer({}),
  );

  expect(result).toBeNull();
  expect(answers).toBe(1);
});

test("does not settle the AI credit when the provider is unavailable", async () => {
  let answers = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      throw new APICallError({
        message: "provider unavailable",
        url: "https://example.invalid",
        requestBodyValues: {},
        statusCode: 503,
        isRetryable: true,
      });
    },
  });

  const result = await interpretWorkbook(
    {},
    () => {
      answers++;
    },
    model,
  );

  expect(result).toBeNull();
  expect(answers).toBe(0);
  expect(model.doGenerateCalls).toHaveLength(2);
});

test("propagates AI credit settlement failures", async () => {
  expect(
    interpretWorkbook(
      {},
      () => {
        throw new Error("settlement failed");
      },
      modelAnswer(validInterpretation),
    ),
  ).rejects.toThrow("settlement failed");
});
