// Country (as Apollo writes it) → the IANA zone we send in. One zone per
// country: the US uses Central, so an 8:00–17:00 window lands between 9:00
// Eastern and 15:00 Pacific. Unknown countries return null and the campaign
// timezone applies.
const ZONES: Record<string, string> = {
  "united states": "America/Chicago",
  "usa": "America/Chicago",
  "canada": "America/Toronto",
  "united kingdom": "Europe/London",
  "ireland": "Europe/Dublin",
  "germany": "Europe/Berlin",
  "france": "Europe/Paris",
  "spain": "Europe/Madrid",
  "netherlands": "Europe/Amsterdam",
  "belgium": "Europe/Brussels",
  "italy": "Europe/Rome",
  "austria": "Europe/Vienna",
  "switzerland": "Europe/Zurich",
  "sweden": "Europe/Stockholm",
  "denmark": "Europe/Copenhagen",
  "norway": "Europe/Oslo",
  "finland": "Europe/Helsinki",
  "poland": "Europe/Warsaw",
  "czechia": "Europe/Prague",
  "czech republic": "Europe/Prague",
  "portugal": "Europe/Lisbon",
  "estonia": "Europe/Tallinn",
  "lithuania": "Europe/Vilnius",
  "latvia": "Europe/Riga",
  "greece": "Europe/Athens",
  "romania": "Europe/Bucharest",
  "hungary": "Europe/Budapest",
  "luxembourg": "Europe/Luxembourg",
  "israel": "Asia/Jerusalem",
  "united arab emirates": "Asia/Dubai",
  "india": "Asia/Kolkata",
  "singapore": "Asia/Singapore",
  "japan": "Asia/Tokyo",
  "australia": "Australia/Sydney",
  "new zealand": "Pacific/Auckland",
  "brazil": "America/Sao_Paulo",
  "argentina": "America/Argentina/Buenos_Aires",
  "mexico": "America/Mexico_City",
  "colombia": "America/Bogota",
  "chile": "America/Santiago",
  "south africa": "Africa/Johannesburg",
  "nigeria": "Africa/Lagos",
  "kenya": "Africa/Nairobi",
};

export function timezoneForCountry(country: string | null | undefined): string | null {
  if (!country) return null;
  return ZONES[country.trim().toLowerCase()] ?? null;
}
