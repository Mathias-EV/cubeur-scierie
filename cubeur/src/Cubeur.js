import { useState, useCallback, useEffect } from "react";
 
// ─── CONSTANTES ──────────────────────────────────────────────────────────────
const PRODUITS = ["Volige","Planche","Liteau","Traverse","Bastaing","Poutre","Poteau","Tasseau","Chevron","Plateau"];
const ESSENCES = ["Sapin","Épicéa","Mélèze","Pin","Chêne","Hêtre","Douglas"];
const QUALITES = ["Choix 1","Choix 2","Choix 3","Rebut","Non trié"];
const STATUTS  = { attente:"En attente", production:"En production", valide:"Validée" };
 
const initForm = { produit:"",essence:"",epaisseur:"",largeur:"",longueur:"",qualite:"",nbUnites:"",volumeGrume:"" };
const initCmd  = { client:"",produit:"",essence:"",qualite:"",epaisseur:"",largeur:"",longueur:"",quantite:"",dateLivraison:"",notes:"" };
 
// ─── UTILITAIRES ─────────────────────────────────────────────────────────────
function round(n,d=6){ return Math.round(n*10**d)/10**d; }
function calcul(f){
  const ep=parseFloat(f.epaisseur)/1000, la=parseFloat(f.largeur)/1000,
        lo=parseFloat(f.longueur),       nb=parseFloat(f.nbUnites),
        vg=parseFloat(f.volumeGrume);
  if(!ep||!la||!lo||!nb||!vg||vg===0) return null;
  const volumeUnit=round(ep*la*lo,6), volumeCharge=round(volumeUnit*nb,4),
        rendement=round(volumeCharge/vg,4), perte=round(1-rendement,4);
  return {volumeUnit,volumeCharge,rendement,perte};
}
function pct(n){ return (n*100).toFixed(1)+" %"; }
function m3f(n){ return parseFloat(n).toFixed(4)+" m³"; }
function genId(){ return "CMD-"+Date.now().toString(36).toUpperCase(); }
function today(){ return new Date().toISOString().split("T")[0]; }
 
// ─── STORAGE LOCAL (anti-doublon export) ─────────────────────────────────────
function getExported(){ try{ return JSON.parse(localStorage.getItem("exportedIds")||"[]"); }catch{ return []; } }
function markExported(id){ const l=getExported(); if(!l.includes(id)){ l.push(id); localStorage.setItem("exportedIds",JSON.stringify(l)); } }
function isExported(id){ return getExported().includes(id); }
 
// ─── COMPOSANTS GÉNÉRIQUES ───────────────────────────────────────────────────
function Field({label,children,style}){ return <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:0,...style}}><label style={S.label}>{label}</label>{children}</div>; }
function Row2({children}){ return <div style={S.row2}>{children}</div>; }
function Row3({children}){ return <div style={S.row3}>{children}</div>; }
function Sel({value,onChange,opts,ph="— choisir —"}){
  return <select style={S.select} value={value} onChange={onChange}><option value="">{ph}</option>{opts.map(o=><option key={o} value={o}>{o}</option>)}</select>;
}
function Inp({value,onChange,ph,type="text",min,step}){
  return <input type={type} style={S.input} value={value} onChange={onChange} placeholder={ph} min={min} step={step}/>;
}
function Num({value,onChange,ph,step="any"}){ return <Inp type="number" value={value} onChange={onChange} ph={ph} min="0" step={step}/>; }
function Card({title,children,color}){
  return <div style={{...S.card,borderColor:color||"rgba(212,168,83,0.12)"}}>{title&&<div style={S.cardTitle}>{title}</div>}{children}</div>;
}
function Badge({status}){
  const colors={attente:["#3a2a10","#D4A853"],production:["#0f2a3a","#5bb8d4"],valide:["#0f2a1a","#6dbf7e"]};
  const [bg,fg]=colors[status]||colors.attente;
  return <span style={{background:bg,color:fg,padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,letterSpacing:"0.06em"}}>{STATUTS[status]||status}</span>;
}
 
// ─── APPLICATION PRINCIPALE ──────────────────────────────────────────────────
export default function Cubeur(){
  const [tab,setTab]           = useState("form");
  // Cubage
  const [form,setForm]         = useState(initForm);
  const [history,setHistory]   = useState([]);
  const [exporting,setExporting]= useState({});
  // Commandes
  const [commandes,setCommandes]= useState([]);
  const [cmdForm,setCmdForm]   = useState(initCmd);
  const [cmdView,setCmdView]   = useState("liste"); // liste | new | detail
  const [selectedCmd,setSelectedCmd]= useState(null);
  // Config
  const [sheetUrl,setSheetUrl] = useState(()=>localStorage.getItem("sheetUrl")||"");
  const [toast,setToast]       = useState(null);
 
  useEffect(()=>{ localStorage.setItem("sheetUrl",sheetUrl); },[sheetUrl]);
 
  const showToast=(msg,type="success")=>{ setToast({msg,type}); setTimeout(()=>setToast(null),3200); };
 
  // ── CUBAGE ────────────────────────────────────────────────────────────────
  const set  = f=>e=>setForm(p=>({...p,[f]:e.target.value}));
  const result = calcul(form);
  const isValid = result&&form.produit&&form.essence&&form.qualite;
 
  const handleAdd=()=>{
    if(!isValid) return;
    const entry={...form,...result,id:Date.now(),
      date:new Date().toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"})};
    setHistory(h=>[entry,...h]);
    setForm(initForm);
    showToast("Charge ajoutée ✓");
  };
 
  const doExport=useCallback(async(entry)=>{
    if(!sheetUrl){ showToast("URL Google Sheets manquante → Config","error"); return; }
    if(isExported(entry.id)){ showToast("Cette charge a déjà été exportée !","error"); return; }
    setExporting(e=>({...e,[entry.id]:true}));
    const row=[entry.date,entry.produit,entry.essence,entry.qualite,
      entry.epaisseur,entry.largeur,entry.longueur,entry.nbUnites,
      entry.volumeGrume,entry.volumeUnit,entry.volumeCharge,entry.rendement,entry.perte];
    try{
      await fetch(sheetUrl,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:"cubage",row})});
      markExported(entry.id);
      setHistory(h=>h.map(e=>e.id===entry.id?{...e,exported:true}:e));
      showToast("Envoyé vers Google Sheets ✓");
    }catch(e){ showToast("Envoyé (vérifier le Sheet)"); markExported(entry.id); setHistory(h=>h.map(e=>e.id===entry.id?{...e,exported:true}:e)); }
    setExporting(e=>({...e,[entry.id]:false}));
  },[sheetUrl]);
 
  const exportAll=async()=>{
    const nonExp=history.filter(e=>!isExported(e.id));
    if(nonExp.length===0){ showToast("Toutes les charges ont déjà été exportées","error"); return; }
    for(const e of nonExp){ await doExport(e); await new Promise(r=>setTimeout(r,250)); }
  };
 
  // ── COMMANDES ─────────────────────────────────────────────────────────────
  const setCmd=f=>e=>setCmdForm(p=>({...p,[f]:e.target.value}));
  const cmdValid=cmdForm.client&&cmdForm.produit&&cmdForm.essence&&cmdForm.dateLivraison;
 
  const addCommande=()=>{
    if(!cmdValid) return;
    const cmd={...cmdForm,id:genId(),statut:"attente",
      dateCreation:new Date().toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"})};
    setCommandes(c=>[cmd,...c]);
    setCmdForm(initCmd);
    setCmdView("liste");
    showToast(`Commande ${cmd.id} créée ✓`);
  };
 
  const updateStatut=(id,statut)=>{
    setCommandes(c=>c.map(cmd=>cmd.id===id?{...cmd,statut,
      ...(statut==="valide"?{dateValidation:new Date().toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"})}:{})}:cmd));
    if(statut==="valide") showToast("Commande validée ✓");
    if(statut==="production") showToast("Commande mise en production");
  };
 
  const cmdEnAttente  = commandes.filter(c=>c.statut==="attente");
  const cmdProduction = commandes.filter(c=>c.statut==="production");
  const cmdValidees   = commandes.filter(c=>c.statut==="valide");
 
  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div style={S.root}>
      <div style={S.bg}/>
 
      {/* HEADER */}
      <header style={S.header}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
            <rect x="2" y="13" width="28" height="5" rx="1" fill="#D4A853" opacity="0.9"/>
            <rect x="2" y="7"  width="28" height="5" rx="1" fill="#C4904A" opacity="0.6"/>
            <rect x="2" y="20" width="28" height="5" rx="1" fill="#B87D3A" opacity="0.4"/>
            <rect x="6"  y="2" width="4" height="28" rx="1" fill="#8B5E2A" opacity="0.35"/>
            <rect x="22" y="2" width="4" height="28" rx="1" fill="#8B5E2A" opacity="0.35"/>
          </svg>
          <div>
            <div style={S.logoText}>CUBEUR</div>
            <div style={S.logoSub}>Scierie mobile</div>
          </div>
        </div>
        {cmdEnAttente.length>0&&(
          <div style={S.alertBadge}>{cmdEnAttente.length} commande{cmdEnAttente.length>1?"s":""} en attente</div>
        )}
      </header>
 
      {/* TOAST */}
      {toast&&<div style={{...S.toast,...(toast.type==="error"?S.toastErr:S.toastOk)}}>{toast.msg}</div>}
 
      {/* CONTENU */}
      <main style={S.main}>
 
        {/* ══ SAISIE ══ */}
        {tab==="form"&&(
          <div style={S.page}>
            <Card title="Identification">
              <Row2>
                <Field label="Produit"><Sel value={form.produit} onChange={set("produit")} opts={PRODUITS}/></Field>
                <Field label="Essence"><Sel value={form.essence} onChange={set("essence")} opts={ESSENCES}/></Field>
              </Row2>
              <Field label="Qualité" style={{marginTop:12}}><Sel value={form.qualite} onChange={set("qualite")} opts={QUALITES}/></Field>
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
                <Field label="Nb unités"><Num value={form.nbUnites}    onChange={set("nbUnites")}    ph="200" step="1"/></Field>
                <Field label="Vol. grume (m³)"><Num value={form.volumeGrume} onChange={set("volumeGrume")} ph="2.5" step="0.01"/></Field>
              </Row2>
            </Card>
 
            {result?(
              <div style={S.resultBox}>
                <div style={S.resultGrid}>
                  <RItem label="Vol. unitaire"  value={m3f(result.volumeUnit)}/>
                  <RItem label="Vol. charge"    value={m3f(result.volumeCharge)} big/>
                  <RItem label="Rendement"      value={pct(result.rendement)} color="#6dbf7e"/>
                  <RItem label="Perte"          value={pct(result.perte)}     color="#e07a5f"/>
                </div>
                <div style={S.rendBar}><div style={{...S.rendFill,width:pct(result.rendement)}}/></div>
              </div>
            ):(
              <div style={S.hint}>Remplis tous les champs pour voir le calcul</div>
            )}
 
            <button style={{...S.btnBig,...(!isValid?S.btnDis:{})}} onClick={handleAdd} disabled={!isValid}>
              + Ajouter à la liste des charges
            </button>
          </div>
        )}
 
        {/* ══ CHARGES ══ */}
        {tab==="history"&&(
          <div style={S.page}>
            {history.length>0&&(
              <>
                <div style={S.statsRow}>
                  <Stat label="Charges" value={history.length}/>
                  <Stat label="Total m³" value={history.reduce((s,e)=>s+e.volumeCharge,0).toFixed(3)}/>
                  <Stat label="Non exportées" value={history.filter(e=>!isExported(e.id)).length}/>
                </div>
                <button style={S.btnExportAll} onClick={exportAll}>↑ Exporter les nouvelles charges</button>
              </>
            )}
 
            {history.length===0?(
              <div style={S.empty}><div style={{fontSize:40,marginBottom:12}}>📋</div><p>Aucune charge enregistrée</p></div>
            ):(
              history.map(e=>(
                <div key={e.id} style={{...S.card,borderColor:isExported(e.id)?"rgba(109,191,126,0.2)":"rgba(212,168,83,0.12)"}}>
                  <div style={S.cardHead}>
                    <div>
                      <span style={{fontWeight:700,color:"#D4A853",fontSize:15}}>{e.produit}</span>
                      <span style={{color:"#c4b09a",fontSize:14}}> · {e.essence}</span>
                      <span style={{color:"#8a7a68",fontSize:13}}> · {e.qualite}</span>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      {isExported(e.id)&&<span style={{fontSize:11,color:"#6dbf7e"}}>✓ exporté</span>}
                      <span style={{fontSize:11,color:"#6a5a4a"}}>{e.date}</span>
                    </div>
                  </div>
                  <div style={{fontSize:12,color:"#8a7a68",marginBottom:10,fontFamily:"monospace"}}>
                    {e.epaisseur}×{e.largeur}mm · {e.longueur}m · {e.nbUnites} u.
                  </div>
                  <div style={S.cardResults}>
                    <CStat label="Vol. unitaire" value={m3f(e.volumeUnit)}/>
                    <CStat label="Vol. charge"   value={m3f(e.volumeCharge)} big/>
                    <CStat label="Rendement"     value={pct(e.rendement)} color={e.rendement>=0.5?"#6dbf7e":"#e07a5f"}/>
                    <CStat label="Perte"         value={pct(e.perte)} color="#a09080"/>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    {isExported(e.id)?(
                      <div style={{flex:1,padding:"9px",textAlign:"center",fontSize:12,color:"#6dbf7e",
                        border:"1px solid rgba(109,191,126,0.2)",borderRadius:7,background:"rgba(109,191,126,0.05)"}}>
                        ✓ Déjà exporté vers Google Sheets
                      </div>
                    ):(
                      <button style={{...S.btnExport,flex:1}} onClick={()=>doExport(e)} disabled={exporting[e.id]}>
                        {exporting[e.id]?"…":"↑ Exporter vers Google Sheets"}
                      </button>
                    )}
                    <button style={S.btnDel} onClick={()=>setHistory(h=>h.filter(x=>x.id!==e.id))}>🗑</button>
                  </div>
                </div>
              ))
            )}
            {history.length>0&&(
              <button style={S.btnClear} onClick={()=>{if(window.confirm("Vider toutes les charges ?"))setHistory([])}}>
                Vider la liste
              </button>
            )}
          </div>
        )}
 
        {/* ══ COMMANDES ══ */}
        {tab==="commandes"&&(
          <div style={S.page}>
            {cmdView==="liste"&&(
              <>
                {/* Stats commandes */}
                <div style={S.statsRow}>
                  <Stat label="En attente"   value={cmdEnAttente.length}  color="#D4A853"/>
                  <Stat label="En prod."     value={cmdProduction.length} color="#5bb8d4"/>
                  <Stat label="Validées"     value={cmdValidees.length}   color="#6dbf7e"/>
                </div>
 
                <button style={S.btnBig} onClick={()=>setCmdView("new")}>
                  + Nouvelle commande
                </button>
 
                {commandes.length===0?(
                  <div style={S.empty}><div style={{fontSize:40,marginBottom:12}}>📦</div><p>Aucune commande</p></div>
                ):(
                  <>
                    {/* En attente */}
                    {cmdEnAttente.length>0&&<SectionHeader title="En attente" color="#D4A853"/>}
                    {cmdEnAttente.map(c=><CmdCard key={c.id} cmd={c} onSelect={()=>{setSelectedCmd(c);setCmdView("detail");}} onStatut={updateStatut}/>)}
 
                    {/* En production */}
                    {cmdProduction.length>0&&<SectionHeader title="En production" color="#5bb8d4"/>}
                    {cmdProduction.map(c=><CmdCard key={c.id} cmd={c} onSelect={()=>{setSelectedCmd(c);setCmdView("detail");}} onStatut={updateStatut}/>)}
 
                    {/* Validées */}
                    {cmdValidees.length>0&&<SectionHeader title="Validées" color="#6dbf7e"/>}
                    {cmdValidees.map(c=><CmdCard key={c.id} cmd={c} onSelect={()=>{setSelectedCmd(c);setCmdView("detail");}} onStatut={updateStatut}/>)}
                  </>
                )}
              </>
            )}
 
            {/* ── Nouvelle commande ── */}
            {cmdView==="new"&&(
              <>
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
                  <button style={S.btnBack} onClick={()=>setCmdView("liste")}>← Retour</button>
                  <div style={{fontWeight:700,color:"#D4A853",fontSize:16}}>Nouvelle commande</div>
                </div>
 
                <Card title="Client">
                  <Field label="Nom du client"><Inp value={cmdForm.client} onChange={setCmd("client")} ph="Nom ou entreprise"/></Field>
                </Card>
 
                <Card title="Produit souhaité">
                  <Row2>
                    <Field label="Produit"><Sel value={cmdForm.produit} onChange={setCmd("produit")} opts={PRODUITS}/></Field>
                    <Field label="Essence"><Sel value={cmdForm.essence} onChange={setCmd("essence")} opts={ESSENCES}/></Field>
                  </Row2>
                  <Field label="Qualité" style={{marginTop:12}}><Sel value={cmdForm.qualite} onChange={setCmd("qualite")} opts={QUALITES}/></Field>
                  <div style={{...S.row3,marginTop:12}}>
                    <Field label="Ép. (mm)"><Num value={cmdForm.epaisseur} onChange={setCmd("epaisseur")} ph="27"/></Field>
                    <Field label="Larg. (mm)"><Num value={cmdForm.largeur}   onChange={setCmd("largeur")}   ph="120"/></Field>
                    <Field label="Long. (m)"><Num value={cmdForm.longueur}  onChange={setCmd("longueur")}  ph="2.4" step="0.1"/></Field>
                  </div>
                  <Field label="Quantité (unités)" style={{marginTop:12}}><Num value={cmdForm.quantite} onChange={setCmd("quantite")} ph="100" step="1"/></Field>
                </Card>
 
                <Card title="Livraison">
                  <Field label="Date de livraison souhaitée">
                    <Inp type="date" value={cmdForm.dateLivraison} onChange={setCmd("dateLivraison")} min={today()}/>
                  </Field>
                  <Field label="Notes / remarques" style={{marginTop:12}}>
                    <textarea style={{...S.input,minHeight:70,resize:"vertical"}}
                      value={cmdForm.notes} onChange={setCmd("notes")} placeholder="Instructions particulières..."/>
                  </Field>
                </Card>
 
                <button style={{...S.btnBig,...(!cmdValid?S.btnDis:{})}} onClick={addCommande} disabled={!cmdValid}>
                  Créer la commande
                </button>
              </>
            )}
 
            {/* ── Détail commande ── */}
            {cmdView==="detail"&&selectedCmd&&(()=>{
              const cmd=commandes.find(c=>c.id===selectedCmd.id)||selectedCmd;
              return (
                <>
                  <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
                    <button style={S.btnBack} onClick={()=>setCmdView("liste")}>← Retour</button>
                    <div style={{fontWeight:700,color:"#D4A853",fontSize:16}}>{cmd.id}</div>
                    <Badge status={cmd.statut}/>
                  </div>
 
                  <Card>
                    <DRow label="Client"         value={cmd.client}/>
                    <DRow label="Créée le"        value={cmd.dateCreation}/>
                    <DRow label="Livraison"       value={cmd.dateLivraison} highlight/>
                    {cmd.dateValidation&&<DRow label="Validée le" value={cmd.dateValidation}/>}
                  </Card>
 
                  <Card title="Produit">
                    <DRow label="Produit"  value={cmd.produit}/>
                    <DRow label="Essence"  value={cmd.essence}/>
                    <DRow label="Qualité"  value={cmd.qualite}/>
                    {cmd.epaisseur&&<DRow label="Dimensions" value={`${cmd.epaisseur}×${cmd.largeur}mm · ${cmd.longueur}m`}/>}
                    {cmd.quantite&&<DRow label="Quantité"  value={`${cmd.quantite} unités`}/>}
                    {cmd.notes&&<DRow label="Notes" value={cmd.notes}/>}
                  </Card>
 
                  {/* Actions selon statut */}
                  <div style={{display:"flex",flexDirection:"column",gap:10,marginTop:8}}>
                    {cmd.statut==="attente"&&(
                      <button style={{...S.btnBig,background:"linear-gradient(135deg,#0f2a3a,#5bb8d4)",color:"#fff"}}
                        onClick={()=>updateStatut(cmd.id,"production")}>
                        🔨 Mettre en production
                      </button>
                    )}
                    {cmd.statut==="production"&&(
                      <button style={{...S.btnBig,background:"linear-gradient(135deg,#0f2a1a,#6dbf7e)",color:"#fff"}}
                        onClick={()=>updateStatut(cmd.id,"valide")}>
                        ✓ Valider la commande
                      </button>
                    )}
                    {cmd.statut==="valide"&&(
                      <div style={{textAlign:"center",padding:"12px",color:"#6dbf7e",fontSize:14,fontWeight:600,
                        border:"1px solid rgba(109,191,126,0.2)",borderRadius:8,background:"rgba(109,191,126,0.05)"}}>
                        ✓ Commande validée et livrée
                      </div>
                    )}
                    <button style={{...S.btnClear,marginTop:0}}
                      onClick={()=>{if(window.confirm("Supprimer cette commande ?")){setCommandes(c=>c.filter(x=>x.id!==cmd.id));setCmdView("liste");}}}>
                      🗑 Supprimer
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        )}
 
        {/* ══ CONFIG ══ */}
        {tab==="config"&&(
          <div style={S.page}>
            <Card title="Connexion Google Sheets">
              <p style={{fontSize:13,color:"#a09080",lineHeight:1.7,marginBottom:16}}>
                Pour exporter le cubage, crée un Apps Script Web App dans ton Google Sheet.
              </p>
              {[
                ["1","Extensions → Apps Script","Dans ton Google Sheet"],
                ["2","Colle ce script","Efface tout et colle :"],
                ["3","Déploie","Déployer → Nouveau déploiement → Application Web → Accès: Tout le monde"],
                ["4","Copie l'URL","Et colle-la ci-dessous"],
              ].map(([n,title,desc])=>(
                <div key={n} style={{display:"flex",gap:12,alignItems:"flex-start",marginBottom:14}}>
                  <div style={{width:24,height:24,borderRadius:"50%",background:"#D4A853",color:"#141210",
                    fontWeight:700,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    {n}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:13,color:"#e8ddd0",marginBottom:2}}>{title}</div>
                    <div style={{fontSize:12,color:"#8a7a68"}}>{desc}</div>
                    {n==="2"&&(
                      <pre style={S.pre}>{`function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var data = JSON.parse(e.postData.contents);
  var sheet;
  if(data.type === "cubage") {
    sheet = ss.getSheetByName("Cubage") || ss.insertSheet("Cubage");
    if(sheet.getLastRow()===0){
      sheet.appendRow(["Date","Produit","Essence","Qualité",
        "Ép.mm","Larg.mm","Long.m","Nb unités","Vol.Grume m³",
        "Vol.Unitaire m³","Vol.Charge m³","Rendement","Perte"]);
    }
  } else {
    sheet = ss.getSheetByName("Commandes") || ss.insertSheet("Commandes");
    if(sheet.getLastRow()===0){
      sheet.appendRow(["ID","Client","Produit","Essence","Qualité",
        "Ép.mm","Larg.mm","Long.m","Quantité","Date livraison","Notes","Statut","Créée le"]);
    }
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
              <label style={S.label}>URL du Web App Apps Script</label>
              <input style={{...S.input,marginTop:6}} value={sheetUrl}
                onChange={e=>setSheetUrl(e.target.value)}
                placeholder="https://script.google.com/macros/s/..."/>
              {sheetUrl&&<div style={{marginTop:8,fontSize:12,color:"#6dbf7e"}}>✓ URL enregistrée</div>}
            </Card>
 
            <div style={{background:"#1a1510",border:"1px solid rgba(212,168,83,0.1)",
              borderRadius:8,padding:14,fontSize:12,color:"#8a7a68",lineHeight:1.8}}>
              <strong style={{color:"#D4A853"}}>Onglets créés automatiquement dans le Sheet :</strong><br/>
              • <strong>Cubage</strong> : toutes les charges exportées<br/>
              • <strong>Commandes</strong> : pour usage futur<br/>
              <strong style={{color:"#D4A853",marginTop:8,display:"block"}}>Anti-doublon :</strong>
              Chaque charge ne peut être exportée qu'une seule fois.
            </div>
          </div>
        )}
      </main>
 
      {/* BARRE DE NAVIGATION */}
      <nav style={S.nav}>
        {[
          ["form",      "✚",  "Saisie"],
          ["history",   "📋", `Charges${history.length?` (${history.length})`:""}`],
          ["commandes", "📦", `Commandes${cmdEnAttente.length?` 🔴`:""}`],
          ["config",    "⚙",  "Config"],
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
 
// ─── SOUS-COMPOSANTS ─────────────────────────────────────────────────────────
function RItem({label,value,big,color}){
  return <div><div style={{fontSize:10,color:"#6a5a4a",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>{label}</div>
    <div style={{fontSize:big?18:15,fontWeight:big?700:600,color:color||"#e8ddd0",fontVariantNumeric:"tabular-nums"}}>{value}</div></div>;
}
function CStat({label,value,big,color}){
  return <div style={{background:"rgba(0,0,0,0.2)",borderRadius:6,padding:"8px 10px"}}>
    <div style={{fontSize:10,color:"#6a5a4a",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:3}}>{label}</div>
    <div style={{fontSize:big?15:13,fontWeight:big?700:600,color:color||(big?"#D4A853":"#c4b09a"),fontVariantNumeric:"tabular-nums"}}>{value}</div>
  </div>;
}
function Stat({label,value,color}){
  return <div style={{background:"rgba(212,168,83,0.06)",border:"1px solid rgba(212,168,83,0.15)",
    borderRadius:10,padding:"12px 10px",textAlign:"center"}}>
    <div style={{fontSize:18,fontWeight:700,color:color||"#D4A853",fontVariantNumeric:"tabular-nums"}}>{value}</div>
    <div style={{fontSize:10,color:"#8a7a68",textTransform:"uppercase",letterSpacing:"0.08em",marginTop:3}}>{label}</div>
  </div>;
}
function SectionHeader({title,color}){
  return <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",
    color:color||"#D4A853",marginTop:20,marginBottom:10,paddingBottom:6,
    borderBottom:`1px solid ${color||"#D4A853"}22`}}>{title}</div>;
}
function CmdCard({cmd,onSelect,onStatut}){
  return <div style={{...S.card,cursor:"pointer"}} onClick={onSelect}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
      <div>
        <div style={{fontWeight:700,color:"#D4A853",fontSize:13,letterSpacing:"0.06em"}}>{cmd.id}</div>
        <div style={{fontWeight:700,color:"#e8ddd0",fontSize:15,marginTop:2}}>{cmd.client}</div>
      </div>
      <Badge status={cmd.statut}/>
    </div>
    <div style={{fontSize:13,color:"#a09080",marginBottom:6}}>
      {cmd.produit}{cmd.essence?` · ${cmd.essence}`:""}{cmd.qualite?` · ${cmd.qualite}`:""}
    </div>
    {cmd.epaisseur&&<div style={{fontSize:12,color:"#6a5a4a",fontFamily:"monospace",marginBottom:6}}>
      {cmd.epaisseur}×{cmd.largeur}mm · {cmd.longueur}m · {cmd.quantite} u.
    </div>}
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div style={{fontSize:12,color:"#8a7a68"}}>Livraison : <strong style={{color:"#c4b09a"}}>{cmd.dateLivraison}</strong></div>
      <span style={{fontSize:12,color:"#D4A853"}}>Voir détail →</span>
    </div>
  </div>;
}
function DRow({label,value,highlight}){
  return <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",
    padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
    <span style={{fontSize:12,color:"#6a5a4a",textTransform:"uppercase",letterSpacing:"0.06em"}}>{label}</span>
    <span style={{fontSize:13,color:highlight?"#D4A853":"#c4b09a",fontWeight:highlight?700:400,textAlign:"right",maxWidth:"60%"}}>{value}</span>
  </div>;
}
 
// ─── STYLES ──────────────────────────────────────────────────────────────────
const S={
  root:{minHeight:"100vh",background:"#141210",color:"#e8ddd0",
    fontFamily:"Georgia,'Times New Roman',serif",display:"flex",
    flexDirection:"column",maxWidth:480,margin:"0 auto",position:"relative"},
  bg:{position:"fixed",top:0,left:0,right:0,bottom:0,
    backgroundImage:`repeating-linear-gradient(90deg,transparent,transparent 40px,rgba(212,168,83,0.02) 40px,rgba(212,168,83,0.02) 41px)`,
    pointerEvents:"none",zIndex:0},
  header:{position:"sticky",top:0,zIndex:20,display:"flex",alignItems:"center",
    justifyContent:"space-between",padding:"14px 20px",
    background:"rgba(10,8,6,0.95)",borderBottom:"1px solid rgba(212,168,83,0.2)",
    backdropFilter:"blur(8px)"},
  logoText:{fontSize:20,fontWeight:700,letterSpacing:"0.12em",color:"#D4A853"},
  logoSub:{fontSize:11,color:"#6a5a4a",letterSpacing:"0.1em",textTransform:"uppercase"},
  alertBadge:{background:"rgba(212,168,83,0.15)",border:"1px solid rgba(212,168,83,0.4)",
    color:"#D4A853",padding:"5px 12px",borderRadius:20,fontSize:12,fontWeight:700},
  toast:{position:"fixed",top:70,left:"50%",transform:"translateX(-50%)",zIndex:100,
    padding:"11px 22px",borderRadius:20,fontSize:13,fontWeight:600,
    whiteSpace:"nowrap",boxShadow:"0 4px 20px rgba(0,0,0,0.6)"},
  toastOk:{background:"#1a3a22",color:"#6dbf7e",border:"1px solid #2d6640"},
  toastErr:{background:"#3a1a1a",color:"#e07a5f",border:"1px solid #6a2a2a"},
  main:{position:"relative",zIndex:1,flex:1,overflowY:"auto",paddingBottom:90},
  page:{padding:"16px 16px 8px"},
  card:{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(212,168,83,0.12)",
    borderRadius:12,padding:"16px 14px",marginBottom:12},
  cardTitle:{fontSize:10,fontWeight:700,letterSpacing:"0.15em",textTransform:"uppercase",
    color:"#D4A853",marginBottom:12,opacity:0.8},
  cardHead:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6},
  cardResults:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10},
  row2:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12},
  row3:{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10},
  label:{fontSize:10,color:"#8a7a68",letterSpacing:"0.08em",textTransform:"uppercase"},
  select:{background:"#1e1a14",border:"1px solid rgba(212,168,83,0.2)",borderRadius:8,
    color:"#e8ddd0",padding:"11px 10px",fontSize:14,width:"100%",outline:"none",
    fontFamily:"Georgia,serif",appearance:"none"},
  input:{background:"#1e1a14",border:"1px solid rgba(212,168,83,0.2)",borderRadius:8,
    color:"#e8ddd0",padding:"11px 10px",fontSize:14,width:"100%",outline:"none",
    boxSizing:"border-box",fontFamily:"Georgia,serif"},
  resultBox:{background:"rgba(30,24,16,0.9)",border:"1px solid rgba(212,168,83,0.3)",
    borderRadius:12,padding:"16px 14px",marginBottom:14},
  resultGrid:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12},
  rendBar:{height:6,background:"rgba(255,255,255,0.06)",borderRadius:3,overflow:"hidden"},
  rendFill:{height:"100%",background:"linear-gradient(90deg,#8B5E2A,#D4A853)",borderRadius:3,transition:"width 0.4s ease"},
  hint:{textAlign:"center",color:"#6a5a4a",fontSize:13,padding:"20px 0"},
  statsRow:{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:14},
  empty:{textAlign:"center",padding:"60px 20px",color:"#6a5a4a",fontSize:15},
  btnBig:{width:"100%",padding:"15px",fontSize:15,fontWeight:700,
    background:"linear-gradient(135deg,#8B5E2A,#D4A853)",color:"#141210",
    border:"none",borderRadius:10,cursor:"pointer",letterSpacing:"0.06em",
    fontFamily:"Georgia,serif",boxShadow:"0 4px 20px rgba(212,168,83,0.25)",marginBottom:8},
  btnDis:{opacity:0.3,cursor:"not-allowed"},
  btnExportAll:{width:"100%",padding:"12px",fontSize:14,fontWeight:600,
    background:"rgba(212,168,83,0.1)",color:"#D4A853",
    border:"1px solid rgba(212,168,83,0.35)",borderRadius:8,
    cursor:"pointer",fontFamily:"Georgia,serif",marginBottom:14},
  btnExport:{padding:"9px",fontSize:13,background:"rgba(212,168,83,0.08)",
    color:"#D4A853",border:"1px solid rgba(212,168,83,0.3)",borderRadius:7,
    cursor:"pointer",fontFamily:"Georgia,serif"},
  btnDel:{padding:"9px 14px",fontSize:14,background:"rgba(200,80,60,0.06)",
    color:"#e07a5f",border:"1px solid rgba(200,80,60,0.25)",borderRadius:7,cursor:"pointer"},
  btnClear:{width:"100%",marginTop:16,padding:"10px",fontSize:13,color:"#6a5a4a",
    background:"transparent",border:"1px solid rgba(255,255,255,0.06)",
    borderRadius:8,cursor:"pointer",fontFamily:"Georgia,serif"},
  btnBack:{padding:"8px 14px",fontSize:13,background:"rgba(255,255,255,0.04)",
    color:"#8a7a68",border:"1px solid rgba(255,255,255,0.08)",borderRadius:7,
    cursor:"pointer",fontFamily:"Georgia,serif"},
  pre:{background:"#0e0b08",border:"1px solid rgba(212,168,83,0.15)",borderRadius:6,
    padding:"10px 12px",fontSize:10.5,color:"#D4A853",overflowX:"auto",
    lineHeight:1.8,marginTop:8,fontFamily:"monospace",whiteSpace:"pre-wrap",wordBreak:"break-all"},
  nav:{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",
    maxWidth:480,zIndex:20,display:"flex",background:"rgba(10,8,6,0.97)",
    borderTop:"1px solid rgba(212,168,83,0.2)",backdropFilter:"blur(12px)",
    paddingBottom:"env(safe-area-inset-bottom,0px)"},
  navBtn:{flex:1,padding:"12px 4px 10px",display:"flex",flexDirection:"column",
    alignItems:"center",gap:3,background:"transparent",border:"none",
    color:"#6a5a4a",cursor:"pointer"},
  navBtnActive:{color:"#D4A853"},
  navIcon:{fontSize:18},
  navLabel:{fontSize:9,letterSpacing:"0.04em",textTransform:"uppercase",fontFamily:"Georgia,serif"},
};
