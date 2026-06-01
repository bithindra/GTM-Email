// Shared shortlisting options for Find Founders (UI) + Apollo query (server).

export const INDUSTRY_OPTIONS = [
  "SaaS", "Software", "Information Technology", "Cybersecurity", "Artificial Intelligence",
  "Fintech", "Financial Services", "Banking", "Insurance", "Venture Capital & PE",
  "Healthcare", "Hospital & Health Care", "Biotechnology", "Pharmaceuticals", "Medical Devices",
  "E-commerce", "Retail", "Consumer Goods", "Food & Beverages", "Apparel & Fashion", "Beauty & Cosmetics",
  "Manufacturing", "Industrial Automation", "Automotive", "Aerospace & Defense", "Construction",
  "Real Estate", "Education", "EdTech", "E-Learning",
  "Marketing & Advertising", "Media & Entertainment", "Gaming", "Telecommunications",
  "Logistics & Supply Chain", "Transportation", "Travel & Hospitality",
  "Energy & Utilities", "Clean Energy", "Oil & Gas", "Agriculture",
  "Legal Services", "Management Consulting", "Professional Services", "Staffing & Recruiting",
  "Nonprofit", "Government", "Crypto & Blockchain",
];

// label shown in UI -> Apollo person_seniorities value
export const SENIORITY_OPTIONS: { label: string; value: string }[] = [
  { label: "Owner", value: "owner" },
  { label: "Founder", value: "founder" },
  { label: "C-Suite", value: "c_suite" },
  { label: "Partner", value: "partner" },
  { label: "VP", value: "vp" },
  { label: "Head", value: "head" },
  { label: "Director", value: "director" },
  { label: "Manager", value: "manager" },
];

// Company annual revenue bands (USD). max null = open-ended.
export const REVENUE_BANDS: { label: string; min: number; max: number | null }[] = [
  { label: "< $1M", min: 0, max: 1_000_000 },
  { label: "$1M–$10M", min: 1_000_000, max: 10_000_000 },
  { label: "$10M–$50M", min: 10_000_000, max: 50_000_000 },
  { label: "$50M–$100M", min: 50_000_000, max: 100_000_000 },
  { label: "$100M–$500M", min: 100_000_000, max: 500_000_000 },
  { label: "$500M–$1B", min: 500_000_000, max: 1_000_000_000 },
  { label: "$1B+", min: 1_000_000_000, max: null },
];
