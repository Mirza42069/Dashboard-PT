import { describe, expect, test } from "bun:test";

import { requestClientUploadToken } from "./client-blob-upload";

describe("client Blob upload token exchange", () => {
  test("includes the signed-in session and returns the generated token", async () => {
    let request: { input: string | URL | Request; init?: RequestInit } | undefined;
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      request = { input, init };
      return Response.json({ clientToken: "vercel_blob_client_token" });
    };

    const token = await requestClientUploadToken(
      "http://localhost:3000/project-import/upload",
      "temporary-workbooks/project-import/user-1/workbook.xlsx",
      { selectedSheetName: "BoQ" },
      fetcher,
    );

    expect(token).toBe("vercel_blob_client_token");
    expect(request?.input).toBe("http://localhost:3000/project-import/upload");
    expect(request?.init?.credentials).toBe("include");
    expect(request?.init?.method).toBe("POST");
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      type: "blob.generate-client-token",
      payload: {
        pathname: "temporary-workbooks/project-import/user-1/workbook.xlsx",
        clientPayload: JSON.stringify({ selectedSheetName: "BoQ" }),
        multipart: false,
      },
    });
  });

  test("surfaces the server response instead of a generic SDK error", async () => {
    const fetcher = async () =>
      Response.json({ error: "Temporary workbook uploads are not configured." }, { status: 503 });

    expect(
      requestClientUploadToken(
        "/api/project-import/upload",
        "temporary-workbooks/project-import/user-1/workbook.xlsx",
        undefined,
        fetcher,
      ),
    ).rejects.toThrow("Temporary workbook uploads are not configured.");
  });

  test("requests a multipart token when large uploads opt in", async () => {
    let request: RequestInit | undefined;
    const fetcher = async (_input: string | URL | Request, init?: RequestInit) => {
      request = init;
      return Response.json({ clientToken: "token" });
    };

    await requestClientUploadToken(
      "/api/support/screenshots/upload",
      "support-screenshots/user-1/shot.png",
      undefined,
      fetcher,
      true,
    );

    expect(JSON.parse(String(request?.body)).payload.multipart).toBe(true);
  });
});
