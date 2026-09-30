import { describe, it, expect } from "vitest";
import { parseApolloCsv, isBuyerTitle, relevantTechnologies, routeProduct, titleRank } from "@/lib/import/apollo";

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

  it("uses Trust's buyer titles for a Trust list", () => {
    expect(isBuyerTitle("Chief Technology Officer", "TRUST")).toBe(true);
    expect(isBuyerTitle("VP of Engineering", "TRUST")).toBe(true);
    expect(isBuyerTitle("Chief Information Security Officer", "TRUST")).toBe(true);
    expect(isBuyerTitle("Chief Technology Officer", "REVENUE")).toBe(false);
    expect(isBuyerTitle("VP Finance", "TRUST")).toBe(false);
  });

  it("puts billing tools first, dedupes and caps the list", () => {
    const raw = ["Gmail", "Stripe", "Gmail", ...Array.from({ length: 40 }, (_, i) => `T${i}`), "Chargebee"].join(", ");
    const techs = relevantTechnologies(raw);
    expect(techs.slice(0, 2)).toEqual(["Stripe", "Chargebee"]);
    expect(techs).toHaveLength(25);
    expect(techs.filter((t) => t === "Gmail")).toHaveLength(1);
  });
});

describe("ROUTE mode (cross-use)", () => {
  const cto = (email: string, site: string, techs: string) =>
    `Al,Bo,Chief Technology Officer,Co,${email},Verified,80,,,,http://${site},US,"${techs}",`;

  it("sends Stripe billers to Revenue and the rest to Trust", () => {
    const { leads } = parseApolloCsv(
      csv(cto("a@pay.io", "pay.io", "Gmail, Stripe"), cto("b@sec.io", "sec.io", "Gmail, Okta")),
      new Set(),
      "ROUTE",
    );
    expect(leads.map((l) => [l.email, l.product])).toEqual([
      ["a@pay.io", "REVENUE"],
      ["b@sec.io", "TRUST"],
    ]);
  });

  it("keeps the founder over a CTO at the same company, whatever the row order", () => {
    const { leads, skipped } = parseApolloCsv(
      csv(cto("cto@pay.io", "pay.io", "Stripe"), 'Jo,Ko,Founder & CEO,Co,jo@pay.io,Verified,80,,,,http://pay.io,US,"Stripe",'),
      new Set(),
      "ROUTE",
    );
    expect(leads.map((l) => l.email)).toEqual(["jo@pay.io"]);
    expect(skipped).toEqual({ second_contact_same_company: 1 });
  });

  it("routes and ranks", () => {
    expect(routeProduct("Gmail, Stripe, Slack")).toBe("REVENUE");
    expect(routeProduct("Gmail, Stripe Radar")).toBe("REVENUE");
    expect(routeProduct("Gmail, Okta")).toBe("TRUST");
    expect(titleRank("Co-Founder & CTO")).toBe(1);
    expect(titleRank("CISO")).toBe(2);
    expect(titleRank("CTO")).toBe(3);
    expect(titleRank("VP Engineering")).toBe(4);
  });
});

describe("firm imports", () => {
  it("accept partners and principals only when importing firms", () => {
    const row = 'Jo,Ray,Managing Partner,Ray CFO,jo@raycfo.com,Verified,5,accounting,"fractional cfo",,http://raycfo.com,United States,,';
    expect(parseApolloCsv(csv(row)).leads).toHaveLength(0);
    expect(parseApolloCsv(csv(row), new Set(), "REVENUE", { firm: true }).leads).toHaveLength(1);
    expect(isBuyerTitle("Principal Engineer", "TRUST")).toBe(false);
  });
});
