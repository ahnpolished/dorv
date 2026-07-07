import { beforeEach, describe, expect, it, vi } from "vitest";
import { listGoogleDocRevisions } from "../apps/extension/lib/gdoc/drive.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("listGoogleDocRevisions", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("lists revisions for a doc without persisting anything locally", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          revisions: [
            { id: "1", modifiedTime: "2026-07-01T00:00:00Z" },
            {
              id: "2",
              modifiedTime: "2026-07-02T00:00:00Z",
              lastModifyingUser: { displayName: "Ada", emailAddress: "ada@example.com" }
            }
          ]
        })
    });

    const revisions = await listGoogleDocRevisions("token", "doc-1");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://www.googleapis.com/drive/v3/files/doc-1/revisions?fields=revisions(id,modifiedTime,lastModifyingUser(displayName,emailAddress))",
      { headers: { Authorization: "Bearer token" } }
    );
    expect(revisions).toHaveLength(2);
    expect(revisions[1]?.lastModifyingUser?.displayName).toBe("Ada");
  });

  it("throws on a failed request", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve("not found")
    });

    await expect(listGoogleDocRevisions("token", "missing")).rejects.toThrow("Drive API failed");
  });

  it("returns an empty list when the API omits the field", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

    const revisions = await listGoogleDocRevisions("token", "doc-1");

    expect(revisions).toEqual([]);
  });
});
