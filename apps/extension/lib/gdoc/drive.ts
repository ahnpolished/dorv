export interface GoogleDriveFile {
  id: string;
  webViewLink: string;
  owners?: { emailAddress?: string }[];
}

export interface GoogleDriveRevision {
  id: string;
  modifiedTime: string;
  lastModifyingUser?: { displayName?: string; emailAddress?: string };
}

// Drive revision lister — kept for diagnostics. Version history for HUM-1417 is
// tracked in the PR bot-comment marker, not Drive revisions.
export async function listGoogleDocRevisions(
  token: string,
  fileId: string
): Promise<GoogleDriveRevision[]> {
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/revisions?fields=revisions(id,modifiedTime,lastModifyingUser(displayName,emailAddress))`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!resp.ok) {
    throw new Error(`Drive API failed: ${resp.status.toString()} ${await resp.text()}`);
  }

  const data = (await resp.json()) as { revisions?: GoogleDriveRevision[] };
  return data.revisions ?? [];
}

export async function createGoogleDoc(
  token: string,
  name: string,
  html: string
): Promise<GoogleDriveFile> {
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
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,owners(emailAddress)",
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
    throw new Error(`Drive API failed: ${resp.status.toString()} ${await resp.text()}`);
  }

  return (await resp.json()) as GoogleDriveFile;
}

export function inferOrganizationDomain(file: GoogleDriveFile): string | undefined {
  const ownerEmail = file.owners?.find((owner) => owner.emailAddress)?.emailAddress;
  const domain = ownerEmail?.split("@")[1]?.trim().toLowerCase();
  if (!domain || domain === "gmail.com" || domain === "googlemail.com") {
    return undefined;
  }
  return domain;
}

export async function grantAnyoneCommentAccess(
  token: string,
  fileId: string,
  fallbackDomain?: string
): Promise<void> {
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?fields=id`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type: "anyone",
        role: "commenter",
        allowFileDiscovery: false
      })
    }
  );

  if (!resp.ok) {
    const body = await resp.text();
    if (fallbackDomain && isPublishOutNotPermitted(body)) {
      await grantDomainCommentAccess(token, fileId, fallbackDomain);
      return;
    }
    throw new Error(`Drive permission failed: ${resp.status.toString()} ${body}`);
  }
}

async function grantDomainCommentAccess(
  token: string,
  fileId: string,
  domain: string
): Promise<void> {
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?fields=id`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type: "domain",
        domain,
        role: "commenter",
        allowFileDiscovery: false
      })
    }
  );

  if (!resp.ok) {
    throw new Error(
      `Drive organization permission failed: ${resp.status.toString()} ${await resp.text()}`
    );
  }
}

function isPublishOutNotPermitted(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as { error?: { errors?: { reason?: string }[] } };
    return (
      parsed.error?.errors?.some((error) => error.reason === "publishOutNotPermitted") ?? false
    );
  } catch {
    return body.includes("publishOutNotPermitted");
  }
}
