import { describe, expect, it } from "vitest";
import { parseSiteImportCsv } from "../site-csv-import";

describe("CSV site import preview", () => {
  it("normalizes URLs and detects duplicates within the file", () => {
    const rows = parseSiteImportCsv(
      'url,name\r\nhttps://EXAMPLE.com,Principal\r\nhttps://example.com/,Copie\r\n"https://example.org/","Nom, avec virgule"\r\n',
    );
    expect(rows.map((row) => row.status)).toEqual([
      "ready",
      "duplicate-file",
      "ready",
    ]);
    expect(rows[0]?.url).toBe("https://example.com/");
    expect(rows[2]?.name).toBe("Nom, avec virgule");
  });

  it("explains invalid lines without accepting a partial malformed file", () => {
    const rows = parseSiteImportCsv(
      "url,name\nfile:///etc/passwd,Local\nhttps://valid.example,Valide\n",
    );
    expect(rows[0]?.status).toBe("invalid");
    expect(rows[0]?.reason).toMatch(/HTTP or HTTPS/);
    expect(rows[1]?.status).toBe("ready");
    expect(() =>
      parseSiteImportCsv('url,name\n"https://broken.example,Nom'),
    ).toThrow(/non fermé/);
    expect(() => parseSiteImportCsv("name,url\nA,https://example.com")).toThrow(
      /première ligne/,
    );
  });

  it("bounds file size and row count", () => {
    expect(() =>
      parseSiteImportCsv("url,name\n" + "a".repeat(512 * 1024)),
    ).toThrow(/512 Ko/);
    expect(() =>
      parseSiteImportCsv(
        "url,name\n" +
          Array.from(
            { length: 501 },
            (_, i) => `https://site${i}.example,`,
          ).join("\n"),
      ),
    ).toThrow(/500 sites/);
  });
});
