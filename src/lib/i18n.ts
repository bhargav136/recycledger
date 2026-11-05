export type Language = "en" | "te";
export const translations = {
  en: {
    app: "RecycLedger", dashboard: "Dashboard", purchases: "Purchases", production: "Production",
    inventory: "Inventory", sales: "Sales", workers: "Workers", expenses: "Expenses",
    accounts: "Accounts & Reports", save: "Save", refresh: "Refresh", signOut: "Sign out",
    email: "Email", password: "Password", signIn: "Sign in", noRows: "No records yet",
    amount: "Amount (₹)", date: "Date", notes: "Notes", party: "Party / Supplier / Customer",
    quantity: "Quantity (kg)", rate: "Rate (₹/kg)", description: "Description",
    language: "Language", offline: "Offline changes are queued for sync"
  },
  te: {
    app: "రీసైకిల్ లెడ్జర్", dashboard: "డాష్‌బోర్డ్", purchases: "కొనుగోళ్లు", production: "ఉత్పత్తి",
    inventory: "నిల్వ", sales: "అమ్మకాలు", workers: "కార్మికులు", expenses: "ఖర్చులు",
    accounts: "ఖాతాలు & నివేదికలు", save: "సేవ్", refresh: "రిఫ్రెష్", signOut: "సైన్ అవుట్",
    email: "ఈమెయిల్", password: "పాస్‌వర్డ్", signIn: "సైన్ ఇన్", noRows: "రికార్డులు లేవు",
    amount: "మొత్తం (₹)", date: "తేదీ", notes: "గమనికలు", party: "పార్టీ / సరఫరాదారు / కస్టమర్",
    quantity: "పరిమాణం (కిలోలు)", rate: "ధర (₹/కిలో)", description: "వివరణ",
    language: "భాష", offline: "ఆఫ్‌లైన్ మార్పులు సింక్ కోసం క్యూలో ఉన్నాయి"
  }
} as const;
