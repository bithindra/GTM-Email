import { v4 as uuid } from "uuid";
import type { Prospect, SearchFilters } from "./types";

const FIRST = ["Aarav", "Sofia", "Liam", "Mia", "Noah", "Emma", "Lucas", "Chloe", "Daniel", "Yuki", "Omar", "Ines", "Mateo", "Hana", "Ravi", "Elena", "Tom", "Aisha", "Felix", "Nina"];
const LAST = ["Mehta", "Garcia", "Smith", "Chen", "Müller", "Rossi", "Kim", "Dubois", "Silva", "Tanaka", "Khan", "Andersson", "Nguyen", "Okafor", "Walsh", "Popov", "Haddad", "Costa", "Berg", "Ito"];
const COMPANY_WORDS = ["Nova", "Vertex", "Lumen", "Quanta", "Forge", "Atlas", "Drift", "Pulse", "Strato", "Kindred", "Beacon", "Helio", "Cobalt", "Orbit", "Tessera", "Mosaic", "Cinder", "Verve", "Ridge", "Lattice"];
const COMPANY_SUFFIX = ["Labs", "AI", "Systems", "Technologies", "Health", "Logistics", "Foods", "Studios", "Capital", "Works"];
const INDUSTRIES = ["SaaS", "Fintech", "Healthtech", "E-commerce", "Logistics", "EdTech", "Manufacturing", "Marketing", "Cybersecurity", "Clean Energy"];
const TITLES = ["Founder & CEO", "Co-Founder", "Founder", "Managing Director", "Owner", "CEO", "President", "CFO", "Marketing Head", "HR Head"];

const CITIES: Record<string, string[]> = {
  "United States": ["San Francisco", "New York", "Austin", "Boston", "Seattle"],
  "United Kingdom": ["London", "Manchester", "Bristol"],
  "Germany": ["Berlin", "Munich", "Hamburg"],
  "India": ["Bengaluru", "Mumbai", "Delhi", "Pune"],
  "Singapore": ["Singapore"],
  "Canada": ["Toronto", "Vancouver"],
  "Australia": ["Sydney", "Melbourne"],
  "United Arab Emirates": ["Dubai", "Abu Dhabi"],
  "Netherlands": ["Amsterdam", "Rotterdam"],
  "Brazil": ["São Paulo", "Rio de Janeiro"],
  "France": ["Paris", "Lyon"],
  "Japan": ["Tokyo", "Osaka"],
};

const SIZES = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000"];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function generateMockProspects(filters: SearchFilters): Prospect[] {
  const countries = filters.countries.length ? filters.countries : Object.keys(CITIES);
  const sizes = filters.sizes.length ? filters.sizes : SIZES;
  const titles = filters.titles.length ? filters.titles : TITLES;
  const industries = filters.industries.length ? filters.industries : INDUSTRIES;
  const limit = Math.min(filters.limit || 25, 100);

  const out: Prospect[] = [];
  for (let i = 0; i < limit; i++) {
    const country = pick(countries);
    const cityList = CITIES[country] ?? ["—"];
    const first = pick(FIRST);
    const last = pick(LAST);
    const companyName = `${pick(COMPANY_WORDS)} ${pick(COMPANY_SUFFIX)}`;
    const domain = `${slug(companyName)}.com`;
    const name = `${first} ${last}`;
    out.push({
      id: uuid(),
      name,
      title: pick(titles),
      company: companyName,
      companySize: pick(sizes),
      industry: pick(industries),
      country,
      city: pick(cityList),
      linkedin: `https://www.linkedin.com/in/${slug(first)}-${slug(last)}`,
      email: `${slug(first)}@${domain}`,
      emailStatus: Math.random() > 0.3 ? "verified" : "guessed",
      createdAt: new Date().toISOString(),
    });
  }
  return out;
}

export const COUNTRY_OPTIONS = Object.keys(CITIES);
export const SIZE_OPTIONS = SIZES;
export const TITLE_OPTIONS = TITLES;
export const INDUSTRY_OPTIONS = INDUSTRIES;
