export interface EnrichmentProvider {
  enrichCompany(domain: string): Promise<Partial<CompanyEnrichment> | null>;
  enrichContact(email: string): Promise<Partial<ContactEnrichment> | null>;
}

export interface CompanyEnrichment {
  name: string;
  industry: string;
  employeeCount: number;
  description: string;
  detectedTechs: string[];
}

export interface ContactEnrichment {
  firstName: string;
  lastName: string;
  title: string;
  linkedinUrl: string;
}

// V1: no-op provider — returns null for all lookups
export class ManualEnrichmentProvider implements EnrichmentProvider {
  async enrichCompany(_domain: string): Promise<null> {
    return null;
  }

  async enrichContact(_email: string): Promise<null> {
    return null;
  }
}

// V2 stub — wire up Apollo/Clay/Hunter credentials here
export class ApolloEnrichmentProvider implements EnrichmentProvider {
  constructor(private readonly apiKey: string) {}

  async enrichCompany(_domain: string): Promise<null> {
    // TODO: implement Apollo company enrichment
    return null;
  }

  async enrichContact(_email: string): Promise<null> {
    // TODO: implement Apollo contact enrichment
    return null;
  }
}

export function getEnrichmentProvider(): EnrichmentProvider {
  const apolloKey = process.env.APOLLO_API_KEY;
  if (apolloKey) return new ApolloEnrichmentProvider(apolloKey);
  return new ManualEnrichmentProvider();
}
