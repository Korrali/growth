export interface TemplateVars {
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  personalizedObservation?: string | null;
  trigger?: string | null;
  painHypothesis?: string | null;
  recommendedCTA?: string | null;
}

const TOKEN_FALLBACKS: Record<string, string> = {
  firstName: "there",
  lastName: "",
  companyName: "your company",
  personalizedObservation: "",
  trigger: "",
  painHypothesis: "",
  recommendedCTA: "",
};

export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = vars[key as keyof TemplateVars];
    if (value != null && value !== "") return value;
    return TOKEN_FALLBACKS[key] ?? match;
  });
}
