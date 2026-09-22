import { describe, expect, it } from "vitest";
import { nameFromSlug, normalizeLinkedInUrl, parseProfileHtml, splitName } from "./linkedin";
import { assertPublicUrl, companyNameFrom, isPrivateIp, taglineFrom } from "./website";

describe("LinkedIn profile parsing", () => {
  // Shapes taken from real public profile pages (22 Sep 2026).
  const page = (title: string, og: string) =>
    `<html><head><title>${title}</title><meta property="og:description" content="${og}"></head></html>`;

  it("reads name and headline from the title, About from og:description", () => {
    const p = parseProfileHtml(page(
      "Satya Nadella - Chairman and CEO at Microsoft | LinkedIn",
      "Chairman and CEO at Microsoft · As chairman and CEO of Microsoft, I define my mission",
    ))!;
    expect(p.name).toBe("Satya Nadella");
    expect(p.firstName).toBe("Satya");
    expect(p.headline).toBe("Chairman and CEO at Microsoft");
    expect(p.about).toMatch(/^As chairman and CEO/);
  });
  it("pulls the employer from 'Experience:' and ignores location/connection noise", () => {
    const p = parseProfileHtml(page("Asha Rao | LinkedIn", "Experience: Acme Dental · Education: IIM Ahmedabad · Location: Pune · 500+ connections on LinkedIn"))!;
    expect(p.companyHint).toBe("Acme Dental");
    expect(p.about).toBe("");
  });
  it("decodes HTML entities", () => {
    const p = parseProfileHtml(page("Ravi &amp; Co Founder - Head of Sales &amp; Growth | LinkedIn", ""))!;
    expect(p.headline).toBe("Head of Sales & Growth");
  });
  it.each(["Sign Up | LinkedIn", "LinkedIn", "LinkedIn Login, Sign in | LinkedIn", ""])("treats '%s' as not a readable profile", (t) => {
    expect(parseProfileHtml(page(t, ""))).toBeNull();
  });
});

describe("names", () => {
  it.each([
    ["Dr. Asha Rao, CFA", "Asha Rao", "Asha"],
    ["asha rao", "Asha Rao", "Asha"],
    ["Prof. Ravi Kulkarni", "Ravi Kulkarni", "Ravi"],
    ["Satya Nadella 🚀", "Satya Nadella", "Satya"],
  ])("%s → %s", (raw, name, first) => {
    expect(splitName(raw)).toEqual({ name, firstName: first });
  });
  it("guesses a name from a slug only when it clearly has two parts", () => {
    expect(nameFromSlug("https://www.linkedin.com/in/asha-rao-4b1a2c3/")).toEqual({ name: "Asha Rao", firstName: "Asha" });
    expect(nameFromSlug("https://www.linkedin.com/in/williamhgates")).toEqual({ name: "", firstName: "" });
  });
  it("normalises profile links and rejects non-profile ones", () => {
    expect(normalizeLinkedInUrl("in.linkedin.com/in/asha-rao?utm=x")).toBe("https://www.linkedin.com/in/asha-rao/");
    expect(normalizeLinkedInUrl("https://www.linkedin.com/company/acme")).toBeNull();
    expect(normalizeLinkedInUrl("https://evil.com/in/asha")).toBeNull();
  });
});

describe("website reading", () => {
  it("prefers og:site_name, else the title part that matches the domain", () => {
    expect(companyNameFrom(`<meta property="og:site_name" content="Acme Dental">`, "acmedental.in")).toBe("Acme Dental");
    expect(companyNameFrom(`<title>Home | Acme Dental — Painless care</title>`, "acmedental.in")).toBe("Acme Dental");
    // Real title from zerodha.com, 22 Sep 2026 — colon with no space before it.
    expect(companyNameFrom(`<title>Zerodha: Online brokerage platform for stock trading &amp; investing</title>`, "zerodha.com")).toBe("Zerodha");
  });
  it("quotes their own first sentence, never bot walls or boilerplate", () => {
    const html = `<meta name="description" content="Painless dental care for busy Pune families. Open 7 days, 8am–9pm.">`;
    expect(taglineFrom(html, "Acme Dental")).toBe("Painless dental care for busy Pune families.");
    expect(taglineFrom(`<title>Just a moment...</title><h1>Checking your browser before accessing</h1>`, "")).toBe("");
    expect(taglineFrom(`<meta name="description" content="Welcome to our website">`, "")).toBe("");
  });
});

describe("SSRF guard — this endpoint is public", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"])(
    "%s is private",
    (ip) => expect(isPrivateIp(ip)).toBe(true),
  );
  it.each(["8.8.8.8", "142.250.183.100", "2606:4700::6810:84e5"])("%s is public", (ip) => expect(isPrivateIp(ip)).toBe(false));

  it.each([
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost:3000/",
    "file:///etc/passwd",
    "ftp://example.com/",
    "http://example.com:8080/",
    "http://user:pass@example.com/",
    "http://[::1]/",
  ])("refuses %s", async (u) => {
    await expect(assertPublicUrl(new URL(u))).rejects.toThrow();
  });
});
