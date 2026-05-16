export async function createGoogleDoc(
  token: string,
  name: string,
  html: string
): Promise<{ id: string; webViewLink: string }> {
  const boundary = "-------dorv_boundary";
  const metadata = {
    name,
    mimeType: "application/vnd.google-apps.document"
  };

  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: text/html",
    "",
    html,
    `--${boundary}--`
  ].join("\r\n");

  const resp = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body
    }
  );

  if (!resp.ok) {
    throw new Error(`Drive API failed: ${resp.status} ${await resp.text()}`);
  }

  return resp.json() as Promise<{ id: string; webViewLink: string }>;
}
