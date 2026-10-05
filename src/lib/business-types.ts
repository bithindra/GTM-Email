// What Audit Outreach can search Google Maps for. Each type becomes one Maps query,
// "<keyword> in <area>, <city>", so the keyword is written the way people search
// Maps (plural, plain words) — not as a Google category id. Grouped for the picker.
// Client-safe: no imports.

export type BusinessType = { id: string; label: string; keyword: string };
export type BusinessGroup = { group: string; types: BusinessType[] };

const t = (label: string, keyword = label.toLowerCase()): BusinessType => ({
  id: keyword.replace(/[^a-z0-9]+/g, "-"),
  label,
  keyword,
});

export const BUSINESS_GROUPS: BusinessGroup[] = [
  {
    group: "Health & medical",
    types: [
      t("Dental clinics", "dental clinics"),
      t("Multispeciality hospitals", "multispeciality hospitals"),
      t("Clinics", "clinics"),
      t("Dermatologists & skin clinics", "skin clinics"),
      t("Eye hospitals", "eye hospitals"),
      t("IVF & fertility centres", "ivf centres"),
      t("Physiotherapy centres", "physiotherapy centres"),
      t("Diagnostic labs", "diagnostic centres"),
      t("Orthopaedic clinics", "orthopaedic clinics"),
      t("Paediatricians", "pediatric clinics"),
      t("Gynaecologists", "gynecologist clinics"),
      t("ENT clinics", "ent clinics"),
      t("Cosmetic & hair transplant clinics", "hair transplant clinics"),
      t("Ayurveda centres", "ayurvedic clinics"),
      t("Homeopathy clinics", "homeopathy clinics"),
      t("Psychologists & counsellors", "psychologists"),
      t("Veterinary clinics", "veterinary clinics"),
      t("Pharmacies", "pharmacies"),
      t("Nursing homes & elder care", "elder care homes"),
      t("Rehab centres", "rehabilitation centres"),
    ],
  },
  {
    group: "Beauty, wellness & fitness",
    types: [
      t("Salons", "salons"),
      t("Spas", "spas"),
      t("Beauty parlours", "beauty parlours"),
      t("Bridal makeup artists", "bridal makeup artists"),
      t("Nail studios", "nail studios"),
      t("Gyms", "gyms"),
      t("Yoga studios", "yoga studios"),
      t("Pilates & fitness studios", "fitness studios"),
      t("Dance studios", "dance studios"),
      t("Martial arts academies", "martial arts academies"),
      t("Slimming & weight-loss centres", "weight loss centres"),
      t("Nutritionists & dietitians", "dietitians"),
    ],
  },
  {
    group: "Food & hospitality",
    types: [
      t("Restaurants", "restaurants"),
      t("Cafés", "cafes"),
      t("Bakeries", "bakeries"),
      t("Cloud kitchens", "cloud kitchens"),
      t("Caterers", "caterers"),
      t("Bars & pubs", "pubs"),
      t("Sweet shops", "sweet shops"),
      t("Hotels", "hotels"),
      t("Resorts", "resorts"),
      t("Homestays & guest houses", "guest houses"),
      t("Banquet halls", "banquet halls"),
      t("Wedding venues", "wedding venues"),
    ],
  },
  {
    group: "Education & training",
    types: [
      t("Schools", "schools"),
      t("International schools", "international schools"),
      t("Preschools", "preschools"),
      t("Coaching institutes", "coaching institutes"),
      t("JEE & NEET coaching", "jee neet coaching"),
      t("Tuition centres", "tuition centres"),
      t("Colleges", "colleges"),
      t("Study-abroad consultants", "overseas education consultants"),
      t("Language institutes", "language institutes"),
      t("Computer training institutes", "computer training institutes"),
      t("Music academies", "music schools"),
      t("Art & design schools", "art schools"),
      t("Driving schools", "driving schools"),
    ],
  },
  {
    group: "Professional services",
    types: [
      t("Chartered accountants", "chartered accountants"),
      t("Law firms", "law firms"),
      t("Company secretaries", "company secretary services"),
      t("Tax consultants", "tax consultants"),
      t("Financial advisors", "financial advisors"),
      t("Insurance agencies", "insurance agencies"),
      t("Management consultants", "management consultants"),
      t("HR & recruitment agencies", "recruitment agencies"),
      t("Immigration & visa consultants", "visa consultants"),
      t("Architects", "architects"),
      t("Interior designers", "interior designers"),
      t("Event planners", "event planners"),
      t("Wedding planners", "wedding planners"),
      t("Photographers", "photographers"),
      t("Printing services", "printing services"),
      t("Translation services", "translation services"),
    ],
  },
  {
    group: "Marketing, tech & creative",
    types: [
      t("Digital marketing agencies", "digital marketing agencies"),
      t("Advertising agencies", "advertising agencies"),
      t("Web design companies", "website design companies"),
      t("Software companies", "software companies"),
      t("IT services", "it services"),
      t("App developers", "mobile app developers"),
      t("Branding agencies", "branding agencies"),
      t("PR agencies", "pr agencies"),
      t("Video production houses", "video production companies"),
      t("Co-working spaces", "coworking spaces"),
    ],
  },
  {
    group: "Real estate & construction",
    types: [
      t("Real estate agents", "real estate agents"),
      t("Builders & developers", "real estate developers"),
      t("Construction companies", "construction companies"),
      t("Civil contractors", "civil contractors"),
      t("Modular kitchens", "modular kitchen dealers"),
      t("Furniture stores", "furniture stores"),
      t("Home décor stores", "home decor stores"),
      t("Tiles & sanitaryware", "tiles showrooms"),
      t("Solar installers", "solar panel installers"),
      t("Packers & movers", "packers and movers"),
      t("Pest control", "pest control services"),
      t("Cleaning services", "cleaning services"),
      t("Security services", "security services"),
    ],
  },
  {
    group: "Retail & shopping",
    types: [
      t("Clothing stores", "clothing stores"),
      t("Boutiques", "boutiques"),
      t("Ethnic wear stores", "ethnic wear stores"),
      t("Jewellers", "jewellery stores"),
      t("Opticians", "opticians"),
      t("Footwear stores", "shoe stores"),
      t("Electronics stores", "electronics stores"),
      t("Mobile phone stores", "mobile phone shops"),
      t("Cosmetics stores", "cosmetics stores"),
      t("Gift shops", "gift shops"),
      t("Bookstores", "bookstores"),
      t("Toy stores", "toy stores"),
      t("Sports stores", "sports shops"),
      t("Pet stores", "pet shops"),
      t("Florists", "florists"),
      t("Supermarkets", "supermarkets"),
      t("Organic stores", "organic stores"),
      t("Hardware stores", "hardware stores"),
    ],
  },
  {
    group: "Automotive & travel",
    types: [
      t("Car dealers", "car dealers"),
      t("Two-wheeler dealers", "bike showrooms"),
      t("Used car dealers", "used car dealers"),
      t("Car service centres", "car service centres"),
      t("Car rentals", "car rentals"),
      t("Travel agencies", "travel agencies"),
      t("Tour operators", "tour operators"),
      t("Logistics & courier companies", "logistics companies"),
    ],
  },
  {
    group: "Industry & B2B",
    types: [
      t("Manufacturers", "manufacturers"),
      t("Exporters", "exporters"),
      t("Wholesalers & distributors", "wholesale distributors"),
      t("Industrial suppliers", "industrial suppliers"),
      t("Packaging companies", "packaging companies"),
      t("Textile manufacturers", "textile manufacturers"),
      t("Food processing companies", "food processing companies"),
      t("Engineering companies", "engineering companies"),
      t("Chemical companies", "chemical companies"),
      t("Pharmaceutical companies", "pharmaceutical companies"),
    ],
  },
  {
    group: "Finance & community",
    types: [
      t("NBFCs & loan providers", "loan providers"),
      t("Stock brokers", "stock brokers"),
      t("NGOs", "ngos"),
      t("Clubs & associations", "clubs"),
    ],
  },
];

export const ALL_BUSINESS_TYPES: BusinessType[] = BUSINESS_GROUPS.flatMap((g) => g.types);

/** Suggestions for the city box — any other city can be typed in. */
export const CITY_SUGGESTIONS = [
  "Mumbai", "Navi Mumbai", "Thane", "Pune", "Delhi", "New Delhi", "Gurugram", "Noida", "Ghaziabad",
  "Faridabad", "Bengaluru", "Hyderabad", "Chennai", "Kolkata", "Ahmedabad", "Surat", "Vadodara",
  "Rajkot", "Jaipur", "Lucknow", "Kanpur", "Chandigarh", "Mohali", "Ludhiana", "Amritsar",
  "Indore", "Bhopal", "Nagpur", "Nashik", "Aurangabad", "Kolhapur", "Goa", "Kochi",
  "Thiruvananthapuram", "Kozhikode", "Coimbatore", "Madurai", "Mysuru", "Mangaluru", "Visakhapatnam",
  "Vijayawada", "Bhubaneswar", "Guwahati", "Patna", "Ranchi", "Raipur", "Dehradun", "Varanasi",
  "Agra", "Udaipur", "Jodhpur", "Siliguri", "Jammu", "Srinagar",
  "Singapore", "Dubai", "Abu Dhabi", "London", "New York", "San Francisco", "Toronto", "Sydney",
];

/** The Maps query for one type in one place: "dental clinics in Koregaon Park, Pune". */
export function mapsQuery(keyword: string, city: string, area = ""): string {
  const place = [area.trim(), city.trim()].filter(Boolean).join(", ");
  return `${keyword.trim()} in ${place}`;
}
