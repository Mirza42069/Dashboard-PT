import { zipSync } from "fflate";

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ZIP_CONTENT_TYPE = "application/zip";

export type ProjectWorkbookFile = {
  filename: string;
  body: Uint8Array<ArrayBuffer>;
};

/** Applies the public one-XLSX/many-ZIP response contract to built workbooks. */
export function packageProjectWorkbooks(files: ProjectWorkbookFile[], stamp: string) {
  if (files.length === 1) {
    return { ...files[0]!, contentType: XLSX_CONTENT_TYPE };
  }

  const archive = Object.fromEntries(files.map((file) => [file.filename, file.body]));
  return {
    filename: `projects-${stamp}.zip`,
    body: Uint8Array.from(zipSync(archive, { level: 0 })),
    contentType: ZIP_CONTENT_TYPE,
  };
}
