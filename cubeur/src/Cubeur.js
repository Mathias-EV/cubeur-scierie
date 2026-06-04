import { useState, useCallback } from "react";

const PRODUITS = ["Volige","Planche","Liteau","Traverse","Bastaing","Poutre","Poteau","Tasseau","Chevron","Plateau"];
const ESSENCES = ["Sapin","Épicéa","Mélèze","Pin","Chêne","Hêtre","Douglas"];
const QUALITES = ["Choix 1","Choix 2","Choix 3","Rebut","Non trié"];

const initialForm = {
  produit:"", essence:"", epaisseur:"", largeur:"",
  longueur:"", qualite:"", nbUnites:"", volumeGrume:"",
};

function round(n, d=6) { return Math.round(n * 10**d) / 10**d; }

function calcul(form) {
  const ep = parseFloat(form.epaisseur) / 1000;
  const la = parseFloat(form.largeur) / 1000;
  const lo = parseFloat(form.longueur);
  const nb = parseFloat(form.nbUnites);
  const vg = parseFloat(form.volumeGrume);
  if (!ep||!la||!lo||!nb||!vg||vg===0) return null;
  const volumeUnit   = round(ep * la * lo, 6);
  const volumeCharge = round(volumeUnit * nb, 4);
  const rendement    = round(volumeCharge / vg, 4);
  const perte        = round(1 - rendement, 4);
  return { volumeUnit, volumeCharge, rendement, perte };
}

function pct(n)  { return (n*100).toFixed(1)+" %"; }
function m3f(n)  { return parseFloat(n).toFixed(4)+" m³"; }

export default function Cubeur() {
  const [form, setForm]           = useState(initialForm);
  const [history, setHistory]     = useState([]);
  const [sheetUrl, setSheetUrl]   = useState("");
  const [toast, setToast]         = useState(null);
  const [tab, setTab]             = useState("form");
  const [exporting, setExporting] = useState({});

  const result     = calcul(form);
  const isValid    = result !== null && form.produit && form.essence && form.qualite;

  const showToast = (msg, type="success") => {
    setToast({msg,type});
    setTimeout(()=>setToast(null), 3000);
  };

  const set = (field) => (e) => setForm(f=>({...f,[field]:e.target.value}));

  const handleAdd = () => {
    if (!isValid) return;
    const entry = { ...form, ...result, id: Date.now(),
      date: new Date().toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"}) };
    setHistory(h=>[entry,...h]);
    setForm(initialForm);
    setTab("history");
    showToast("Charge ajoutée ✓");
  };

  const doExport = useCallback(async (entry) => {
    if (!sheetUrl) { showToast("URL Google Sheets manquante → onglet Config","error"); return; }
    setExporting(e=>({...e,[entry.id]:true}));
    const row = [
      entry.date, entry.produit, entry.essence, entry.qualite,
      entry.epaisseur, entry.largeur, entry.longueur, entry.nbUnites,
      entry.volumeGrume, entry.volumeUnit, entry.volumeCharge,
      entry.rendement, entry.perte
    ];
    try {
      await fetch(sheetUrl,{method:"POST",mode:"no-cors",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({row})});
      showToast("Envoyé vers Google Sheets ✓");
    } catch(e) {
      showToast("Envoyé (vérifier le Sheet)");
    }
    setExporting(e=>({...e,[entry.id]:false}));
  },[sheetUrl]);

  const exportAll = async () => {
    for (const e of history) { await doExport(e); await new Promise(r=>setTimeout(r,250)); }
  };

  const del = (id) => setHistory(h=>h.filter(e=>e.id!==id));

  const totalCharge = history.reduce((s,e)=>s+e.volumeCharge,0);
  const avgRendement = history.length ? history.reduce((s,e)=>s+e.rendement,0)/history.length : null;

  return (
    <div style={S.root}>
      {/* BG */}
      <div style={S.bg}/>

      {/* HEADER */}
      <header style={S.header}>
        <div style={S.logo}>
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
            <rect x="2" y="13" width="28" height="5" rx="1" fill="#D4A853" opacity="0.9"/>
            <rect x="2" y="7"  width="28" height="5" rx="1" fill="#C4904A" opacity="0.6"/>
            <rect x="2" y="20" width="28" height="5" rx="1" fill="#B87D3A" opacity="0.4"/>
            <rect x="6"  y="2" width="4" height="28" rx="1" fill="#8B5E2A" opacity="0.35"/>
            <rect x="22" y="2" width="4" height="28" rx="1" fill="#8B5E2A" opacity="0.35"/>
          </svg>
          <span style={S.logoText}>CUBEUR</span>
        </div>
        <span style={S.logoSub}>Scierie mobile</span>
      </header>

      {/* TOAST */}
      {toast && (
        <div style={{...S.toast, ...(toast.type==="error"?S.toastErr:S.toastOk)}}>
          {toast.msg}
        </div>
      )}

      {/* CONTENT */}
      <main style={S.main}>

        {/* ── SAISIE ── */}
        {tab==="form" && (
          <div style={S.page}>
            <Card title="Identification">
              <Row2>
                <Field label="Produit"><Sel value={form.produit} onChange={set("produit")} opts={PRODUITS} /></Field>
                <Field label="Essence"><Sel value={form.essence} onChange={set("essence")} opts={ESSENCES} /></Field>
              </Row2>
              <Field label="Qualité"><Sel value={form.qualite} onChange={set("qualite")} opts={QUALITES} /></Field>
            </Card>

            <Card title="Dimensions">
              <Row3>
                <Field label="Ép. (mm)"><Num value={form.epaisseur} onChange={set("epaisseur")} ph="27"/></Field>
                <Field label="Larg. (mm)"><Num value={form.largeur}   onChange={set("largeur")}   ph="120"/></Field>
                <Field label="Long. (m)"><Num value={form.longueur}  onChange={set("longueur")}  ph="2.4" step="0.1"/></Field>
              </Row3>
            </Card>

            <Card title="Charge">
              <Row2>
                <Field label="Nb unités"><Num value={form.nbUnites}   onChange={set("nbUnites")}   ph="200" step="1"/></Field>
                <Field label="Vol. grume (m³)"><Num value={form.volumeGrume} onChange={set("volumeGrume")} ph="2.5" step="0.01"/></Field>
              </Row2>
            </Card>

            {/* RÉSULTAT */}
            {result ? (
              <div style={S.resultBox}>
                <div style={S.resultGrid}>
                  <ResultItem label="Vol. unitaire"   value={m3f(result.volumeUnit)} />
                  <ResultItem label="Vol. charge"     value={m3f(result.volumeCharge)} big />
                  <ResultItem label="Rendement"       value={pct(result.rendement)} color="#6dbf7e" />
                  <ResultItem label="Perte"           value={pct(result.perte)} color="#e07a5f" />
                </div>
                <div style={S.rendBar}>
                  <div style={{...S.rendFill, width:pct(result.rendement)}}/>
                </div>
              </div>
            ) : (
              <div style={S.hint}>
                Remplis tous les champs pour voir le calcul
              </div>
            )}

            <button style={{...S.btnBig,...(!isValid?S.btnDis:{})}} onClick={handleAdd} disabled={!isValid}>
              + Ajouter à la liste des charges
            </button>
          </div>
        )}

        {/* ── HISTORIQUE ── */}
        {tab==="history" && (
          <div style={S.page}>
            {/* Stats */}
            {history.length>0 && (
              <div style={S.statsRow}>
                <Stat label="Charges" value={history.length}/>
                <Stat label="Total m³" value={totalCharge.toFixed(3)}/>
                {avgRendement!==null && <Stat label="Rend. moy." value={pct(avgRendement)}/>}
              </div>
            )}

            {history.length>0 && (
              <button style={S.btnExportAll} onClick={exportAll}>
                ↑ Tout exporter vers Google Sheets
              </button>
            )}

            {history.length===0 ? (
              <div style={S.empty}>
                <div style={{fontSize:40,marginBottom:12}}>📋</div>
                <p>Aucune charge enregistrée</p>
                <p style={{fontSize:13,opacity:0.5}}>Ajoute des charges depuis l'onglet Saisie</p>
              </div>
            ) : (
              history.map((e,i)=>(
                <div key={e.id} style={S.card}>
                  <div style={S.cardHead}>
                    <div>
                      <span style={S.cardProduit}>{e.produit}</span>
                      <span style={S.cardEssence}> · {e.essence}</span>
                      <span style={S.cardQualite}> · {e.qualite}</span>
                    </div>
                    <span style={S.cardDate}>{e.date}</span>
                  </div>
                  <div style={S.cardDims}>
                    {e.epaisseur}×{e.largeur}mm · {e.longueur}m · {e.nbUnites} u.
                  </div>
                  <div style={S.cardResults}>
                    <CardStat label="Vol. unitaire" value={m3f(e.volumeUnit)}/>
                    <CardStat label="Vol. charge"   value={m3f(e.volumeCharge)} big/>
                    <CardStat label="Rendement"     value={pct(e.rendement)} color={e.rendement>=0.5?"#6dbf7e":"#e07a5f"}/>
                    <CardStat label="Perte"         value={pct(e.perte)} color="#a09080"/>
                  </div>
                  <div style={S.cardActions}>
                    <button
                      style={S.btnExport}
                      onClick={()=>doExport(e)}
                      disabled={exporting[e.id]}
                    >
                      {exporting[e.id]?"…":"↑ Google Sheets"}
                    </button>
                    <button style={S.btnDel} onClick={()=>del(e.id)}>🗑</button>
                  </div>
                </div>
              ))
            )}

            {history.length>0 && (
              <button style={S.btnClear} onClick={()=>{if(window.confirm("Vider toutes les charges ?"))setHistory([])}}>
                Vider la liste
              </button>
            )}
          </div>
        )}

        {/* ── CONFIG ── */}
        {tab==="config" && (
          <div style={S.page}>
            <Card title="Connexion Google Sheets">
              <p style={S.configDesc}>
                Pour exporter, crée un <strong>Apps Script Web App</strong> dans ton Google Sheet (5 min).
              </p>

              {[
                ["1","Ouvre ton Google Sheet",""],
                ["2","Extensions → Apps Script","Clique sur ce menu en haut"],
                ["3","Colle ce script","Efface le contenu et colle :"],
                ["4","Déploie","Déployer → Nouveau déploiement → Type: Application Web → Accès: Tout le monde → Déployer"],
                ["5","Copie l'URL","Et colle-la dans le champ ci-dessous"],
              ].map(([n,title,desc])=>(
                <div key={n} style={S.step}>
                  <div style={S.stepN}>{n}</div>
                  <div style={{flex:1}}>
                    <div style={S.stepTitle}>{title}</div>
                    {desc && <div style={S.stepDesc}>{desc}</div>}
                    {n==="3" && (
                      <pre style={S.pre}>{`function doPost(e) {
  var sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getActiveSheet();
  var data = JSON.parse(e.postData.contents);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "Date","Produit","Essence","Qualité",
      "Ép.(mm)","Larg.(mm)","Long.(m)",
      "Nb Unités","Vol.Grume(m³)",
      "Vol.Unitaire(m³)","Vol.Charge(m³)",
      "Rendement","Perte"
    ]);
  }
  sheet.appendRow(data.row);
  return ContentService
    .createTextOutput(JSON.stringify({ok:true}))
    .setMimeType(ContentService.MimeType.JSON);
}`}</pre>
                    )}
                  </div>
                </div>
              ))}

              <div style={{marginTop:20}}>
                <label style={S.configLabel}>URL du Web App Apps Script</label>
                <input
                  style={S.configInput}
                  value={sheetUrl}
                  onChange={e=>setSheetUrl(e.target.value)}
                  placeholder="https://script.google.com/macros/s/..."
                />
                {sheetUrl && <div style={S.urlOk}>✓ URL enregistrée — export prêt !</div>}
              </div>
            </Card>

            <div style={S.infoBox}>
              <strong style={{color:"#D4A853"}}>Colonnes créées automatiquement :</strong><br/>
              Date · Produit · Essence · Qualité · Épaisseur · Largeur · Longueur · Nb Unités · Vol. Grume · Vol. Unitaire · Vol. Charge · Rendement · Perte
            </div>
          </div>
        )}
      </main>

      {/* BOTTOM NAV */}
      <nav style={S.nav}>
        {[
          ["form",    "✚", "Saisie"],
          ["history", "📋", `Charges${history.length?` (${history.length})`:""}` ],
          ["config",  "⚙", "Config"],
        ].map(([key,icon,label])=>(
          <button key={key} style={{...S.navBtn,...(tab===key?S.navBtnActive:{})}} onClick={()=>setTab(key)}>
            <span style={S.navIcon}>{icon}</span>
            <span style={S.navLabel}>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────

function Card({title,children}) {
  return (
    <div style={S.card}>
      <div style={S.cardTitle}>{title}</div>
      {children}
    </div>
  );
}
function Field({label,children}) {
  return <div style={S.field}><label style={S.label}>{label}</label>{children}</div>;
}
function Row2({children}) { return <div style={S.row2}>{children}</div>; }
function Row3({children}) { return <div style={S.row3}>{children}</div>; }
function Sel({value,onChange,opts}) {
  return (
    <select style={S.select} value={value} onChange={onChange}>
      <option value="">— choisir —</option>
      {opts.map(o=><option key={o} value={o}>{o}</option>)}
    </select>
  );
}
function Num({value,onChange,ph,step="any"}) {
  return <input type="number" min="0" step={step} style={S.input} value={value} onChange={onChange} placeholder={ph}/>;
}
function ResultItem({label,value,big,color}) {
  return (
    <div style={S.resultItem}>
      <div style={S.resultLabel}>{label}</div>
      <div style={{...S.resultValue,...(big?{fontSize:18,fontWeight:700}:{}),...(color?{color}:{})}}>{value}</div>
    </div>
  );
}
function CardStat({label,value,big,color}) {
  return (
    <div style={S.cardStat}>
      <div style={S.cardStatLabel}>{label}</div>
      <div style={{...S.cardStatValue,...(big?{fontSize:15,fontWeight:700,color:"#D4A853"}:{}),...(color?{color}:{})}}>{value}</div>
    </div>
  );
}
function Stat({label,value}) {
  return (
    <div style={S.statBox}>
      <div style={S.statVal}>{value}</div>
      <div style={S.statLabel}>{label}</div>
    </div>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const S = {
  root:{ minHeight:"100vh", background:"#141210", color:"#e8ddd0",
         fontFamily:"Georgia,'Times New Roman',serif", display:"flex",
         flexDirection:"column", maxWidth:480, margin:"0 auto",
         position:"relative" },
  bg:{ position:"fixed",top:0,left:0,right:0,bottom:0,
       backgroundImage:`repeating-linear-gradient(90deg,transparent,transparent 40px,rgba(212,168,83,0.02) 40px,rgba(212,168,83,0.02) 41px)`,
       pointerEvents:"none",zIndex:0 },

  // Header
  header:{ position:"sticky",top:0,zIndex:20,
           display:"flex",alignItems:"center",justifyContent:"space-between",
           padding:"14px 20px",
           background:"rgba(10,8,6,0.95)",
           borderBottom:"1px solid rgba(212,168,83,0.2)",
           backdropFilter:"blur(8px)" },
  logo:{ display:"flex",alignItems:"center",gap:10 },
  logoText:{ fontSize:20,fontWeight:700,letterSpacing:"0.12em",color:"#D4A853" },
  logoSub:{ fontSize:11,color:"#6a5a4a",letterSpacing:"0.1em",textTransform:"uppercase" },

  // Toast
  toast:{ position:"fixed",top:70,left:"50%",transform:"translateX(-50%)",
          zIndex:100,padding:"11px 22px",borderRadius:20,fontSize:13,fontWeight:600,
          whiteSpace:"nowrap",boxShadow:"0 4px 20px rgba(0,0,0,0.6)" },
  toastOk:{ background:"#1a3a22",color:"#6dbf7e",border:"1px solid #2d6640" },
  toastErr:{ background:"#3a1a1a",color:"#e07a5f",border:"1px solid #6a2a2a" },

  // Main
  main:{ position:"relative",zIndex:1,flex:1,
         overflowY:"auto",paddingBottom:80 },
  page:{ padding:"16px 16px 8px" },

  // Cards
  card:{ background:"rgba(255,255,255,0.03)",
         border:"1px solid rgba(212,168,83,0.12)",
         borderRadius:12,padding:"16px 14px",marginBottom:12 },
  cardTitle:{ fontSize:10,fontWeight:700,letterSpacing:"0.15em",
              textTransform:"uppercase",color:"#D4A853",marginBottom:12,opacity:0.8 },
  cardHead:{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6 },
  cardProduit:{ fontWeight:700,color:"#D4A853",fontSize:15 },
  cardEssence:{ color:"#c4b09a",fontSize:14 },
  cardQualite:{ color:"#8a7a68",fontSize:13 },
  cardDate:{ fontSize:11,color:"#6a5a4a" },
  cardDims:{ fontSize:12,color:"#8a7a68",marginBottom:10,fontFamily:"monospace" },
  cardResults:{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10 },
  cardStat:{ background:"rgba(0,0,0,0.2)",borderRadius:6,padding:"8px 10px" },
  cardStatLabel:{ fontSize:10,color:"#6a5a4a",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:3 },
  cardStatValue:{ fontSize:13,fontWeight:600,color:"#c4b09a" },
  cardActions:{ display:"flex",gap:8 },

  // Fields
  row2:{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12 },
  row3:{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10 },
  field:{ display:"flex",flexDirection:"column",gap:5,marginBottom:0 },
  label:{ fontSize:10,color:"#8a7a68",letterSpacing:"0.08em",textTransform:"uppercase" },
  select:{ background:"#1e1a14",border:"1px solid rgba(212,168,83,0.2)",
           borderRadius:8,color:"#e8ddd0",padding:"11px 10px",fontSize:14,
           width:"100%",outline:"none",fontFamily:"Georgia,serif",
           appearance:"none" },
  input:{ background:"#1e1a14",border:"1px solid rgba(212,168,83,0.2)",
          borderRadius:8,color:"#e8ddd0",padding:"11px 10px",fontSize:14,
          width:"100%",outline:"none",boxSizing:"border-box",fontFamily:"Georgia,serif" },

  // Result box
  resultBox:{ background:"rgba(30,24,16,0.9)",border:"1px solid rgba(212,168,83,0.3)",
              borderRadius:12,padding:"16px 14px",marginBottom:14 },
  resultGrid:{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12 },
  resultItem:{ },
  resultLabel:{ fontSize:10,color:"#6a5a4a",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4 },
  resultValue:{ fontSize:15,fontWeight:600,color:"#e8ddd0",fontVariantNumeric:"tabular-nums" },
  rendBar:{ height:6,background:"rgba(255,255,255,0.06)",borderRadius:3,overflow:"hidden" },
  rendFill:{ height:"100%",background:"linear-gradient(90deg,#8B5E2A,#D4A853)",borderRadius:3,transition:"width 0.4s ease" },
  hint:{ textAlign:"center",color:"#6a5a4a",fontSize:13,padding:"20px 0" },

  // Buttons
  btnBig:{ width:"100%",padding:"15px",fontSize:15,fontWeight:700,
           background:"linear-gradient(135deg,#8B5E2A,#D4A853)",
           color:"#141210",border:"none",borderRadius:10,cursor:"pointer",
           letterSpacing:"0.06em",fontFamily:"Georgia,serif",
           boxShadow:"0 4px 20px rgba(212,168,83,0.25)",marginBottom:8 },
  btnDis:{ opacity:0.3,cursor:"not-allowed" },
  btnExportAll:{ width:"100%",padding:"12px",fontSize:14,fontWeight:600,
                 background:"rgba(212,168,83,0.1)",color:"#D4A853",
                 border:"1px solid rgba(212,168,83,0.35)",borderRadius:8,
                 cursor:"pointer",fontFamily:"Georgia,serif",marginBottom:14 },
  btnExport:{ flex:1,padding:"9px",fontSize:13,
              background:"rgba(212,168,83,0.08)",color:"#D4A853",
              border:"1px solid rgba(212,168,83,0.3)",borderRadius:7,
              cursor:"pointer",fontFamily:"Georgia,serif" },
  btnDel:{ padding:"9px 14px",fontSize:14,
           background:"rgba(200,80,60,0.06)",color:"#e07a5f",
           border:"1px solid rgba(200,80,60,0.25)",borderRadius:7,cursor:"pointer" },
  btnClear:{ width:"100%",marginTop:16,padding:"10px",fontSize:13,color:"#6a5a4a",
             background:"transparent",border:"1px solid rgba(255,255,255,0.06)",
             borderRadius:8,cursor:"pointer",fontFamily:"Georgia,serif" },

  // Stats row
  statsRow:{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:14 },
  statBox:{ background:"rgba(212,168,83,0.06)",border:"1px solid rgba(212,168,83,0.15)",
            borderRadius:10,padding:"12px 10px",textAlign:"center" },
  statVal:{ fontSize:18,fontWeight:700,color:"#D4A853",fontVariantNumeric:"tabular-nums" },
  statLabel:{ fontSize:10,color:"#8a7a68",textTransform:"uppercase",letterSpacing:"0.08em",marginTop:3 },

  empty:{ textAlign:"center",padding:"60px 20px",color:"#6a5a4a",fontSize:15 },

  // Config
  configDesc:{ fontSize:13,color:"#a09080",lineHeight:1.7,marginBottom:16 },
  step:{ display:"flex",gap:12,alignItems:"flex-start",marginBottom:16 },
  stepN:{ width:26,height:26,borderRadius:"50%",background:"#D4A853",
          color:"#141210",fontWeight:700,fontSize:12,display:"flex",
          alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1 },
  stepTitle:{ fontWeight:700,fontSize:13,color:"#e8ddd0",marginBottom:3 },
  stepDesc:{ fontSize:12,color:"#8a7a68",lineHeight:1.6 },
  pre:{ background:"#0e0b08",border:"1px solid rgba(212,168,83,0.15)",
        borderRadius:6,padding:"10px 12px",fontSize:10.5,color:"#D4A853",
        overflowX:"auto",lineHeight:1.8,marginTop:8,fontFamily:"monospace",
        whiteSpace:"pre-wrap",wordBreak:"break-all" },
  configLabel:{ display:"block",fontSize:11,color:"#8a7a68",marginBottom:8,
                letterSpacing:"0.1em",textTransform:"uppercase" },
  configInput:{ width:"100%",boxSizing:"border-box",
                background:"#1e1a14",border:"1px solid rgba(212,168,83,0.25)",
                borderRadius:8,color:"#e8ddd0",padding:"12px 14px",fontSize:13,
                outline:"none",fontFamily:"Georgia,serif" },
  urlOk:{ marginTop:8,fontSize:12,color:"#6dbf7e" },
  infoBox:{ background:"#1a1510",border:"1px solid rgba(212,168,83,0.1)",
            borderRadius:8,padding:"14px",fontSize:12,color:"#8a7a68",
            lineHeight:1.8,marginTop:4 },

  // Bottom nav
  nav:{ position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",
        width:"100%",maxWidth:480,zIndex:20,
        display:"flex",background:"rgba(10,8,6,0.97)",
        borderTop:"1px solid rgba(212,168,83,0.2)",
        backdropFilter:"blur(12px)",
        paddingBottom:"env(safe-area-inset-bottom,0px)" },
  navBtn:{ flex:1,padding:"12px 8px 10px",display:"flex",flexDirection:"column",
           alignItems:"center",gap:4,background:"transparent",border:"none",
           color:"#6a5a4a",cursor:"pointer",transition:"color 0.2s" },
  navBtnActive:{ color:"#D4A853" },
  navIcon:{ fontSize:20 },
  navLabel:{ fontSize:10,letterSpacing:"0.06em",textTransform:"uppercase",
             fontFamily:"Georgia,serif" },
};
