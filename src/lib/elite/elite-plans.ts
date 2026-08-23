export type ElitePlanCode = "BASIC" | "PRO" | "AGENCY" | "EDITORIAL";

export type ElitePlan = {
  code: ElitePlanCode;
  name: string;
  monthlyPriceUsd: number;
  creditsPerMonth: number;
  maxBooksPerMonth: number;
  maxChaptersPerBook: number;
  maxWordsPerChapter: number;
  allowResearch: boolean;
  allowFactCheck: boolean;
  allowExports: boolean;
  exportFormats: Array<"pdf" | "docx" | "epub">;
  rateLimitPerHour: number;
  usage_limit: Record<string, unknown>;
  pricing: Record<string, unknown>;
  billing: Record<string, unknown>;
  stripe?: {
    priceIdEnv: string;
    checkoutMode: "subscription";
  };
};

export const ELITE_PLANS: ElitePlan[] = [
  {
    code: "BASIC",
    name: "Básico",
    monthlyPriceUsd: 19,
    creditsPerMonth: 100,
    maxBooksPerMonth: 3,
    maxChaptersPerBook: 12,
    maxWordsPerChapter: 2500,
    allowResearch: false,
    allowFactCheck: false,
    allowExports: true,
    exportFormats: ["pdf"],
    rateLimitPerHour: 20,
    usage_limit: {
      books_per_month: 3,
      chapters_per_book: 12,
      research: false,
    },
    pricing: {
      currency: "USD",
      billing_cycle: "monthly",
    },
    billing: {
      provider: "stripe_or_local",
    },
    stripe: {
      priceIdEnv: "STRIPE_PRICE_BASIC",
      checkoutMode: "subscription",
    },
  },
  {
    code: "PRO",
    name: "Pro",
    monthlyPriceUsd: 49,
    creditsPerMonth: 500,
    maxBooksPerMonth: 15,
    maxChaptersPerBook: 30,
    maxWordsPerChapter: 5000,
    allowResearch: true,
    allowFactCheck: true,
    allowExports: true,
    exportFormats: ["pdf", "docx", "epub"],
    rateLimitPerHour: 60,
    usage_limit: {
      books_per_month: 15,
      chapters_per_book: 30,
      research: true,
      fact_check: true,
    },
    pricing: {
      currency: "USD",
      billing_cycle: "monthly",
    },
    billing: {
      provider: "stripe_or_local",
    },
    stripe: {
      priceIdEnv: "STRIPE_PRICE_PRO",
      checkoutMode: "subscription",
    },
  },
  {
    code: "AGENCY",
    name: "Agencia",
    monthlyPriceUsd: 149,
    creditsPerMonth: 2000,
    maxBooksPerMonth: 80,
    maxChaptersPerBook: 80,
    maxWordsPerChapter: 8000,
    allowResearch: true,
    allowFactCheck: true,
    allowExports: true,
    exportFormats: ["pdf", "docx", "epub"],
    rateLimitPerHour: 180,
    usage_limit: {
      books_per_month: 80,
      chapters_per_book: 80,
      research: true,
      fact_check: true,
      team: true,
    },
    pricing: {
      currency: "USD",
      billing_cycle: "monthly",
    },
    billing: {
      provider: "stripe_or_local",
    },
    stripe: {
      priceIdEnv: "STRIPE_PRICE_AGENCY",
      checkoutMode: "subscription",
    },
  },
  {
    code: "EDITORIAL",
    name: "Editorial",
    monthlyPriceUsd: 499,
    creditsPerMonth: 10000,
    maxBooksPerMonth: 500,
    maxChaptersPerBook: 120,
    maxWordsPerChapter: 12000,
    allowResearch: true,
    allowFactCheck: true,
    allowExports: true,
    exportFormats: ["pdf", "docx", "epub"],
    rateLimitPerHour: 500,
    usage_limit: {
      books_per_month: 500,
      chapters_per_book: 120,
      research: true,
      fact_check: true,
      priority_queue: true,
    },
    pricing: {
      currency: "USD",
      billing_cycle: "monthly",
      custom_contract: true,
    },
    billing: {
      provider: "stripe_or_local",
    },
    stripe: {
      priceIdEnv: "STRIPE_PRICE_EDITORIAL",
      checkoutMode: "subscription",
    },
  },
];

export function getElitePlan(code: string): ElitePlan {
  return (
    ELITE_PLANS.find((plan) => plan.code === code) ||
    ELITE_PLANS[0]
  );
}

export function estimateCreditsForAction(action: string, words = 0): number {
  const normalized = String(action || "").toUpperCase();

  if (normalized.includes("RESEARCH")) return 12;
  if (normalized.includes("FACT_CHECK")) return 8;
  if (normalized.includes("BLUEPRINT")) return 6;
  if (normalized.includes("DOSSIER")) return 8;
  if (normalized.includes("CHAPTER")) {
    return Math.max(5, Math.ceil(Number(words || 0) / 800));
  }

  return 3;
}
