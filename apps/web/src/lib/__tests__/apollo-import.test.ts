import { describe, it, expect } from "vitest";
import { parseApolloCsv, isBuyerTitle, relevantTechnologies } from "@/lib/import/apollo";

const HEADER =
  "First Name,Last Name,Title,Company Name,Email,Email Status,# Employees,Industry,Keywords,Person Linkedin Url,Website,Country,Technologies,Parent company (Apollo data)";

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

const good = 'Jane,Doe,Founder & CEO,Acme,jane@acme.io,Verified,25,computer software,"saas, billing",http://linkedin.com/in/jane,http://www.acme.io,United States,"Gmail, Stripe",';

describe("parseApolloCsv", () => {
  it("maps a qualifying row", () => {
    const { leads, skipped } = parseApolloCsv(csv(good));
    expect(skipped).toEqual({});
    expect(leads[0]).toMatchObject({
      email: "jane@acme.io",
      title: "Founder & CEO",
      companyName: "Acme",
      domain: "acme.io",
      website: "http://www.acme.io",
      employeeCount: 25,
      technologies: ["Stripe", "Gmail"],
      country: "United States",
    });
  });

  it("drops unverified, non-buyer, acquired, duplicate and same-company rows with reasons", () => {
    const { leads, skipped } = parseApolloCsv(
      csv(
        good,
        good, // duplicate email
        'Sam,Roe,CTO,Acme,sam@acme.io,Verified,25,,,,,acme.io,US,,', // same company + not a buyer
        'Ann,Lee,CEO,Acme,ann@acme.io,Verified,25,,,,http://acme.io,US,,', // second contact same company
        'Bo,Ng,CEO,Beta,bo@beta.io,Extrapolated,10,,,,http://beta.io,US,,',
        'Cy,Oh,CEO,Unleash (Acq. by Zendesk),cy@unleash.so,Verified,30,,,,http://unleash.so,US,,',
        'Di,Po,CEO,Gamma,di@gamma.io,Verified,30,,,,http://gamma.io,US,,Big Parent Inc',
        ',,CEO,Delta,,Unavailable,10,,,,http://delta.io,US,,',
      ),
    );
    expect(leads.map((l) => l.email)).toEqual(["jane@acme.io"]);
    expect(skipped).toEqual({
      duplicate_email: 1,
      not_decision_maker: 1,
      second_contact_same_company: 1,
      email_not_verified: 1,
      acquired_or_subsidiary: 2,
      no_email: 1,
    });
  });

  it("skips emails already in Growth", () => {
    expect(parseApolloCsv(csv(good), new Set(["JANE@acme.io"])).skipped).toEqual({ duplicate_email: 1 });
  });
});

describe("helpers", () => {
  it("accepts founders and finance, rejects engineers", () => {
    expect(isBuyerTitle("Co-Founder and CEO")).toBe(true);
    expect(isBuyerTitle("VP Finance")).toBe(true);
    expect(isBuyerTitle("Head of RevOps")).toBe(true);
    expect(isBuyerTitle("Director of Engineering")).toBe(false);
  });

  it("puts billing tools first, dedupes and caps the list", () => {
    const raw = ["Gmail", "Stripe", "Gmail", ...Array.from({ length: 40 }, (_, i) => `T${i}`), "Chargebee"].join(", ");
    const techs = relevantTechnologies(raw);
    expect(techs.slice(0, 2)).toEqual(["Stripe", "Chargebee"]);
    expect(techs).toHaveLength(25);
    expect(techs.filter((t) => t === "Gmail")).toHaveLength(1);
  });
});
