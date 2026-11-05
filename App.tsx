import React, { useEffect, useMemo, useState } from "react";
import {
  Alert, FlatList, KeyboardAvoidingView, Platform, SafeAreaView, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { Session } from "@supabase/supabase-js";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { supabase, supabaseConfigured } from "./src/lib/supabase";
import { initLocalDb, enqueue, cacheRows, readCachedRows } from "./src/lib/db";
import { syncPending } from "./src/lib/sync";
import { MODULES, ModuleKey, LABELS, money } from "./src/lib/modules";
import { Language, translations } from "./src/lib/i18n";

const C = { green:"#176B4D", dark:"#17352B", bg:"#F3F7F4", card:"#FFFFFF", muted:"#6B7B73", border:"#DCE7E0", red:"#B42318" };
const today = () => new Date().toISOString().slice(0,10);
const toPaise = (v: string) => Math.round((Number(v) || 0) * 100);

export default function App() {
  const [session,setSession] = useState<Session|null>(null);
  const [role,setRole] = useState<string|null>(null);
  const [factoryId,setFactoryId] = useState<string|null>(null);
  const [screen,setScreen] = useState<ModuleKey|"dashboard">("dashboard");
  const [language,setLanguage] = useState<Language>("en");
  const [rows,setRows] = useState<any[]>([]);
  const [busy,setBusy] = useState(false);
  const [values,setValues] = useState<Record<string,string>>({});
  const t = translations[language];

  useEffect(() => {
    initLocalDb().catch(console.warn);
    supabase.auth.getSession().then(({data}) => setSession(data.session));
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_e,s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { if (session) loadMembership(); else { setRole(null); setFactoryId(null); } }, [session]);

  async function loadMembership() {
    if (!session) return;
    if (session.user.id === "demo-owner-id") return;
    const {data,error} = await supabase.from("factory_members")
      .select("factory_id, role").eq("user_id",session.user.id).eq("active",true).limit(1).maybeSingle();
    if (error || !data || !["owner","admin"].includes(data.role)) {
      setRole(null); setFactoryId(null);
      return;
    }
    setRole(data.role); setFactoryId(data.factory_id);
  }

  function enterDemo() {
    setSession({ user: { id: "demo-owner-id", email: "demo@recycledger.com" } } as any);
    setRole("owner");
    setFactoryId("demo-factory-id");
  }

  async function loadModule(key: ModuleKey) {
    if (!factoryId) return;
    setBusy(true);
    const meta = MODULES.find(m=>m.key===key)!;
    try {
      if (key === "accounts") {
        const {data,error} = await supabase.from("financial_summary").select("*").eq("factory_id",factoryId).maybeSingle();
        if (error) throw error;
        setRows(data ? [data] : []);
      } else {
        const {data,error} = await supabase.from(meta.table).select("*").eq("factory_id",factoryId).order("created_at",{ascending:false}).limit(100);
        if (error) throw error;
        setRows(data || []);
        await cacheRows(meta.table,data || []);
      }
    } catch (e:any) {
      const cached = await readCachedRows(meta.table).catch(()=>[]);
      setRows(cached);
      Alert.alert("Using saved data", e?.message || t.offline);
    } finally { setBusy(false); }
  }

  useEffect(()=>{ if(screen!=="dashboard" && factoryId) loadModule(screen); },[screen,factoryId]);

  async function signIn(email:string,password:string) {
    if (!supabaseConfigured) {
      Alert.alert("Setup required","Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to your .env file, then restart Expo.");
      return;
    }
    setBusy(true);
    const {error} = await supabase.auth.signInWithPassword({email,password});
    setBusy(false);
    if(error) Alert.alert("Sign-in failed",error.message);
  }

  async function saveRecord() {
    if (!factoryId || !session || screen==="dashboard" || screen==="accounts" || screen==="inventory") return;
    const meta = MODULES.find(m=>m.key===screen)!;
    const payload:any = { factory_id:factoryId, created_by:session.user.id };
    for(const field of meta.fields) {
      const raw = values[field] ?? "";
      if(field.endsWith("_paise")) payload[field] = toPaise(raw);
      else if(["quantity_kg","input_kg","output_kg","scrap_kg"].includes(field)) payload[field] = Number(raw || 0);
      else if(field==="active") payload[field] = raw.toLowerCase()!=="false";
      else payload[field] = raw || null;
    }
    if(meta.kind==="purchase" && (!payload.party_name || !payload.material || payload.quantity_kg<=0 || payload.rate_paise<0)) {
      Alert.alert("Check entry","Supplier, material and positive quantity are required."); return;
    }
    if(meta.kind==="sale" && (!payload.party_name || !payload.product_name || payload.quantity_kg<=0)) {
      Alert.alert("Check entry","Customer, product and positive quantity are required."); return;
    }
    if(meta.kind==="production" && (!payload.batch_code || payload.input_kg<=0 || payload.output_kg<=0 || payload.output_kg+payload.scrap_kg>payload.input_kg)) {
      Alert.alert("Check entry","Enter a batch code and valid input/output/scrap quantities."); return;
    }
    if(meta.kind==="expense" && (!payload.category || payload.amount_paise<=0)) {
      Alert.alert("Check entry","Expense category and positive amount are required."); return;
    }
    setBusy(true);
    try {
      const {error} = await supabase.from(meta.table).insert(payload);
      if(error) throw error;
      setValues({});
      await loadModule(screen);
      Alert.alert("Saved","Record saved successfully.");
    } catch(e:any) {
      await enqueue(meta.table,"insert",payload);
      Alert.alert("Saved offline","This record is queued locally and will sync when online. If the server rejected it (rather than being offline), review the entry before retrying.");
      setValues({});
    } finally { setBusy(false); }
  }

  async function syncNow() {
    setBusy(true);
    const result = await syncPending();
    setBusy(false);
    Alert.alert("Sync complete",`${result.synced} synced, ${result.failed} still pending.`);
    if(screen!=="dashboard") loadModule(screen);
  }

  async function exportReport() {
    const html = `<html><body><h1>RecycLedger report</h1><p>Generated ${new Date().toLocaleString()}</p><table border="1" cellspacing="0" cellpadding="6"><tr>${Object.keys(rows[0]||{}).map(k=>`<th>${k}</th>`).join("")}</tr>${rows.map(r=>`<tr>${Object.values(r).map(v=>`<td>${String(v??"")}</td>`).join("")}</tr>`).join("")}</table></body></html>`;
    const file = await Print.printToFileAsync({html});
    if(await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri);
    else Alert.alert("Report created",file.uri);
  }

  if(!session) return <AuthScreen onSignIn={signIn} onDemo={enterDemo} busy={busy} language={language} setLanguage={setLanguage}/>;
  if(!role || !factoryId) return <SafeAreaView style={s.center}><Text style={s.title}>Access not assigned</Text><Text style={s.muted}>This account must be an active owner or admin in factory_members.</Text><TouchableOpacity style={s.button} onPress={()=>supabase.auth.signOut()}><Text style={s.buttonText}>{t.signOut}</Text></TouchableOpacity></SafeAreaView>;

  const current = MODULES.find(m=>m.key===screen);
  return <SafeAreaView style={s.safe}>
    <StatusBar style="dark"/>
    <View style={s.header}><View><Text style={s.brand}>♻ RecycLedger</Text><Text style={s.muted}>Factory management</Text></View>
      <TouchableOpacity onPress={()=>setLanguage(language==="en"?"te":"en")}><Text style={s.lang}>{language==="en"?"తెలుగు":"English"}</Text></TouchableOpacity>
    </View>
    <View style={s.nav}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Nav label={t.dashboard} active={screen==="dashboard"} onPress={()=>setScreen("dashboard")}/>
        {MODULES.map(m=><Nav key={m.key} label={t[m.key as keyof typeof t] || m.title} active={screen===m.key} onPress={()=>setScreen(m.key)}/>)}
      </ScrollView>
    </View>
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      {screen==="dashboard" ? <Dashboard onOpen={setScreen} onSync={syncNow} onSignOut={()=>supabase.auth.signOut()} busy={busy}/> :
        <View>
          <Text style={s.title}>{current?.title}</Text>
          {screen==="accounts" ? <Accounts rows={rows} onExport={exportReport}/> :
          screen==="inventory" ? <DataList rows={rows} empty={t.noRows}/> :
          <EntryForm meta={current!} values={values} setValues={setValues} onSave={saveRecord} busy={busy}/>}
          <View style={s.rowBetween}><Text style={s.section}>Recent records</Text><TouchableOpacity onPress={()=>loadModule(screen)}><Text style={s.link}>{t.refresh}</Text></TouchableOpacity></View>
          <DataList rows={rows} empty={t.noRows}/>
          {screen!=="inventory" && screen!=="accounts" ? <TouchableOpacity style={s.secondary} onPress={syncNow}><Text style={s.secondaryText}>Sync pending offline records</Text></TouchableOpacity> : null}
        </View>}
    </ScrollView>
  </SafeAreaView>;
}

function AuthScreen({onSignIn,onDemo,busy,language,setLanguage}:any) {
  const [email,setEmail]=useState(""); const [password,setPassword]=useState("");
  return <SafeAreaView style={s.safe}><StatusBar style="dark"/><KeyboardAvoidingView behavior={Platform.OS==="ios"?"padding":undefined} style={s.auth}>
    <Text style={s.logo}>♻</Text><Text style={s.title}>RecycLedger</Text><Text style={s.muted}>Plastic factory management</Text>
    <TextInput style={s.input} placeholder={language==="en"?"Email":"ఈమెయిల్"} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail}/>
    <TextInput style={s.input} placeholder={language==="en"?"Password":"పాస్‌వర్డ్"} secureTextEntry value={password} onChangeText={setPassword}/>
    <TouchableOpacity style={s.button} disabled={busy} onPress={()=>onSignIn(email.trim(),password)}><Text style={s.buttonText}>{busy?"Please wait…":(language==="en"?"Sign in":"సైన్ ఇన్")}</Text></TouchableOpacity>
    <TouchableOpacity style={[s.secondary,{marginTop:10}]} onPress={onDemo}><Text style={s.secondaryText}>{language==="en"?"Explore Demo Factory":"డెమో ఫ్యాక్టరీని చూడండి"}</Text></TouchableOpacity>
    <TouchableOpacity onPress={()=>setLanguage(language==="en"?"te":"en")}><Text style={s.link}>{language==="en"?"తెలుగులో చూడండి":"View in English"}</Text></TouchableOpacity>
    <Text style={s.hint}>Accounts are created by the factory owner in Supabase. Only active owners and admins can enter.</Text>
  </KeyboardAvoidingView></SafeAreaView>;
}
function Nav({label,active,onPress}:any){return <TouchableOpacity onPress={onPress} style={[s.navItem,active&&s.navActive]}><Text style={[s.navText,active&&s.navTextActive]}>{label}</Text></TouchableOpacity>}
function Dashboard({onOpen,onSync,onSignOut,busy}:any){
  return <View><Text style={s.title}>Factory overview</Text><Text style={s.muted}>Choose a module to manage today's operations.</Text>
    <View style={s.tiles}>{MODULES.map(m=><TouchableOpacity key={m.key} style={s.tile} onPress={()=>onOpen(m.key)}><Text style={s.tileTitle}>{m.title}</Text><Text style={s.tileSub}>Open module →</Text></TouchableOpacity>)}</View>
    <TouchableOpacity style={s.button} onPress={onSync} disabled={busy}><Text style={s.buttonText}>Sync offline queue</Text></TouchableOpacity>
    <TouchableOpacity style={s.secondary} onPress={onSignOut}><Text style={s.secondaryText}>Sign out</Text></TouchableOpacity>
  </View>
}
function EntryForm({meta,values,setValues,onSave,busy}:any){
  const fields=meta.fields.filter((f:string)=>f!=="active");
  return <View style={s.card}><Text style={s.section}>Add {meta.title} record</Text>
    {fields.map((f:string)=><View key={f}><Text style={s.label}>{LABELS[f]||f}</Text><TextInput style={s.input} value={values[f]||""} onChangeText={v=>setValues((p:any)=>({...p,[f]:v}))}
      placeholder={f.includes("date")?today():LABELS[f]||f} keyboardType={f.endsWith("_paise")||f.endsWith("_kg")||f==="quantity_kg"?"decimal-pad":"default"}/></View>)}
    <TouchableOpacity style={s.button} onPress={onSave} disabled={busy}><Text style={s.buttonText}>{busy?"Saving…":"Save record"}</Text></TouchableOpacity>
  </View>
}
function DataList({rows,empty}:any){
  if(!rows?.length) return <View style={s.empty}><Text style={s.muted}>{empty}</Text></View>;
  return <View>{rows.slice(0,50).map((r:any,i:number)=><View key={r.id||i} style={s.record}>
    <Text style={s.recordTitle}>{r.party_name||r.product_name||r.batch_code||r.full_name||r.item_name||r.category||r.material||"Record"}</Text>
    <Text style={s.muted}>{Object.entries(r).filter(([k])=>!["id","factory_id","created_by","created_at","updated_at"].includes(k)).slice(0,4).map(([k,v])=>`${LABELS[k]||k}: ${typeof v==="number"&&k.endsWith("_paise")?money(v):String(v??"—")}`).join("  •  ")}</Text>
  </View>)}</View>
}
function Accounts({rows,onExport}:any){
  const r=rows[0]||{};
  return <View style={s.card}>
    <Text style={s.section}>Financial snapshot</Text>
    {["sales_total_paise","purchase_total_paise","expense_total_paise","cogs_total_paise","gross_profit_paise","net_profit_paise","receivables_paise","payables_paise","cash_received_paise","cash_paid_paise"].map(k=><View key={k} style={s.metric}><Text style={s.muted}>{k.replaceAll("_"," ")}</Text><Text style={s.metricValue}>{money(r[k])}</Text></View>)}
    <Text style={s.hint}>Purchases are inventory acquisitions, not operating expenses. COGS is calculated from completed production batches and sold stock. Cash movement is shown separately from accrual profit.</Text>
    <TouchableOpacity style={s.button} onPress={onExport}><Text style={s.buttonText}>Export current report as PDF</Text></TouchableOpacity>
  </View>
}

const s=StyleSheet.create({
 safe:{flex:1,backgroundColor:C.bg},header:{paddingHorizontal:18,paddingVertical:14,flexDirection:"row",justifyContent:"space-between",alignItems:"center",backgroundColor:C.card},
 brand:{fontSize:22,fontWeight:"900",color:C.green},muted:{color:C.muted,fontSize:13},lang:{color:C.green,fontWeight:"700",padding:8},
 nav:{backgroundColor:C.card,borderTopWidth:1,borderTopColor:C.border,borderBottomWidth:1,borderBottomColor:C.border},
 navItem:{paddingHorizontal:14,paddingVertical:13},navActive:{borderBottomWidth:3,borderBottomColor:C.green},navText:{color:C.muted,fontWeight:"600"},navTextActive:{color:C.green},
 content:{padding:16,paddingBottom:50},title:{fontSize:25,fontWeight:"900",color:C.dark,marginBottom:8},section:{fontSize:17,fontWeight:"800",color:C.dark,marginBottom:12},
 card:{backgroundColor:C.card,borderRadius:16,padding:16,marginTop:16,borderWidth:1,borderColor:C.border},
 tiles:{flexDirection:"row",flexWrap:"wrap",gap:10,marginTop:18,marginBottom:18},tile:{width:"48%",backgroundColor:C.card,borderColor:C.border,borderWidth:1,borderRadius:14,padding:15,minHeight:90,justifyContent:"center"},
 tileTitle:{fontWeight:"800",color:C.dark,fontSize:16},tileSub:{color:C.green,marginTop:8,fontSize:12},
 input:{backgroundColor:"#FBFDFC",borderColor:C.border,borderWidth:1,borderRadius:10,padding:12,marginTop:6,marginBottom:12,color:C.dark},
 label:{color:C.muted,fontSize:12,fontWeight:"700"},button:{backgroundColor:C.green,padding:14,borderRadius:11,alignItems:"center",marginTop:8},buttonText:{color:"white",fontWeight:"800"},
 secondary:{borderColor:C.border,borderWidth:1,padding:13,borderRadius:11,alignItems:"center",marginTop:12},secondaryText:{color:C.green,fontWeight:"700"},
 record:{padding:13,backgroundColor:C.card,borderRadius:12,borderWidth:1,borderColor:C.border,marginBottom:8},recordTitle:{fontWeight:"800",color:C.dark,marginBottom:4},
 empty:{padding:22,alignItems:"center",backgroundColor:C.card,borderRadius:12,marginTop:8},rowBetween:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginTop:22},
 link:{color:C.green,fontWeight:"800",padding:6},metric:{flexDirection:"row",justifyContent:"space-between",paddingVertical:8,borderBottomWidth:1,borderBottomColor:C.border},metricValue:{fontWeight:"800",color:C.dark},
 auth:{flex:1,justifyContent:"center",padding:26},logo:{fontSize:48,textAlign:"center",color:C.green},hint:{fontSize:12,color:C.muted,lineHeight:18,marginTop:14,textAlign:"center"},center:{flex:1,justifyContent:"center",alignItems:"center",padding:24,backgroundColor:C.bg}
});
