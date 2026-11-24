/**
 * Saves `text` as a file named `filename` in the browser's downloads, as JSON. Nothing is sent
 * anywhere: the file is made in the page, and its object URL revoked as soon as the download has
 * started, as `nxsDownloadCsv` does.
 */
export function downloadJson(filename: string, text: string, doc: Document = document): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  try {
    const link = doc.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
