export type ModuleKey = "purchases" | "production" | "sales" | "expenses" | "workers" | "inventory" | "accounts";
export const MODULES: { key: ModuleKey; title: string; table: string; fields: string[]; kind: string }[] = [
  { key:"purchases", title:"Purchases", table:"purchases", fields:["party_name","material","quantity_kg","rate_paise","paid_paise","due_date","notes"], kind:"purchase" },
  { key:"production", title:"Production", table:"production_batches", fields:["batch_code","product_name","input_kg","output_kg","scrap_kg","raw_material_cost_paise","labour_cost_paise","overhead_cost_paise","notes"], kind:"production" },
  { key:"sales", title:"Sales", table:"sales", fields:["party_name","invoice_no","product_name","quantity_kg","rate_paise","paid_paise","due_date","notes"], kind:"sale" },
  { key:"expenses", title:"Expenses", table:"expenses", fields:["category","description","amount_paise","paid_paise","expense_date","notes"], kind:"expense" },
  { key:"workers", title:"Workers", table:"workers", fields:["full_name","phone","role_title","daily_wage_paise","active"], kind:"worker" },
  { key:"inventory", title:"Inventory", table:"inventory_balances", fields:["item_name","item_type","quantity_kg","unit"], kind:"inventory" },
  { key:"accounts", title:"Accounts & Reports", table:"financial_summary", fields:[], kind:"report" }
];
export const LABELS: Record<string,string> = {
  party_name:"Party name", material:"Material", quantity_kg:"Quantity (kg)", rate_paise:"Rate (₹)",
  paid_paise:"Paid (₹)", due_date:"Due date (YYYY-MM-DD)", notes:"Notes", batch_code:"Batch code",
  product_name:"Product", input_kg:"Input (kg)", output_kg:"Output (kg)", scrap_kg:"Scrap (kg)",
  raw_material_cost_paise:"Raw material cost (₹)", labour_cost_paise:"Labour cost (₹)",
  overhead_cost_paise:"Overhead (₹)", invoice_no:"Invoice number", category:"Category",
  description:"Description", amount_paise:"Amount (₹)", expense_date:"Expense date (YYYY-MM-DD)",
  full_name:"Worker name", phone:"Phone", role_title:"Role", daily_wage_paise:"Daily wage (₹)",
  active:"Active", item_name:"Item", item_type:"Type", unit:"Unit"
};
export const money = (paise: number | null | undefined) =>
  `₹${((Number(paise || 0))/100).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
