import { useState, useEffect, useCallback, useRef } from "react";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const SHEET_ID = "1vBmNCK0vmQRIHy6S1btXgSWugznmr_L-P3wkH7Xj_w4";
const APPS_SCRIPT_URL_KEY = "cubeur_script_url";

// ─── DONNÉES ──────────────────────────────────────────────────────────────────
const PRODUITS = ["Volige","Planche","Liteau","Traverse","Bastaing","Poutre","Poteau","Tasseau","Chevron","Plateau"];
const ESSENCES = ["Sapin","Épicéa","Mélèze","Pin","Chêne","Hêtre","Douglas"];
const QUALITES = ["Choix 1","Choix 2","Choix 3","Rebut","Non trié"];
const UNITES   = ["m³","m²","mL"];

// unite par défaut = m³
const initLigne = { produit:"",essence:"",qualite:"",epaisseur:"",largeur:"",longueur:"",quantite:"",unite:"m³" };
const initCmd   = { client:"",dateLivraison:"",notes:"",lignes:[{...initLigne}] };
const initCube  = { produit:"",essence:"",epaisseur:"",largeur:"",longueur:"",qualite:"",nbUnites:"",volumeGrume:"",unite:"m³" };

// ─── UTILS ───────────────────────────────────────────────────────────────────
const round=(n,d=6)=>Math.round(n*10**d)/10**d;
const pct=(n)=>(n*100).toFixed(1)+" %";
const m3f=(n,u="m³")=>parseFloat(n).toFixed(4)+" "+(u||"m³");
const genId=()=>"CMD-"+Date.now().toString(36).toUpperCase().slice(-6);
const today=()=>new Date().toISOString().split("T")[0];
const fmtDate=()=>new Date().toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"});
const prodId=(cmdId,idx)=>`${cmdId}-P${idx+1}`;

// ─── CALCUL selon unité ───────────────────────────────────────────────────────
// Toutes les dimensions sont toujours stockées.
// Le calcul de la valeur principale change selon l'unité :
//   m³ : ep×la×lo×nb (volume)  + rendement vs grume
//   m²  : la×lo×nb (surface)
//   mL  : lo×nb (linéaire)
function calculParUnite(p){
  const ep=parseFloat(p.epaisseur)/1000;
  const la=parseFloat(p.largeur)/1000;
  const lo=parseFloat(p.longueur);
  const nb=parseFloat(p.nbUnites);
  const vg=parseFloat(p.volumeGrume);
  const unite=p.unite||"m³";

  // m³ : toutes les dims + nb obligatoires
  if(unite==="m³"){
    if(!ep||!la||!lo||!nb) return null;
    const vu=round(ep*la*lo,6), vc=round(vu*nb,4);
    const rend=vg>0?round(vc/vg,4):null;
    const perte=rend!=null?round(1-rend,4):null;
    return { volUnit:vu, volCharge:vc, volReel:null, rend, perte, unite };
  }

  // m² et mL : nb seul est obligatoire, dims sont optionnelles
  if(!nb) return null;

  let vu=null, vc=null, volReel=null;
  if(unite==="m²"){
    vc=round(nb,4);                                    // total m² saisi directement
    if(la&&lo) vu=round(la*lo,6);                     // surface unitaire si dispo
    if(ep)     volReel=round(nb*ep,4);                // vol réel = m² × épaisseur
  } else {
    // mL
    vc=round(nb,4);                                    // total mL saisi directement
    if(lo)    vu=round(lo,6);                         // longueur unitaire si dispo
    if(ep&&la) volReel=round(nb*ep*la,4);             // vol réel = mL × ep × la
  }
  const rend=(volReel!=null&&vg>0)?round(volReel/vg,4):null;
  const perte=rend!=null?round(1-rend,4):null;
  return { volUnit:vu, volCharge:vc, volReel, rend, perte, unite };
}

// Calcul cubage libre (m³ uniquement)
function calcul(f){
  const ep=parseFloat(f.epaisseur)/1000, la=parseFloat(f.largeur)/1000,
        lo=parseFloat(f.longueur), nb=parseFloat(f.nbUnites), vg=parseFloat(f.volumeGrume);
  if(!ep||!la||!lo||!nb||!vg||vg===0) return null;
  const vu=round(ep*la*lo,6), vc=round(vu*nb,4), rend=round(vc/vg,4);
  return { volumeUnit:vu, volumeCharge:vc, rendement:rend, perte:round(1-rend,4) };
}

async function callScript(url, body){
  await fetch(url,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  return {ok:true};
}

// ─── UI PRIMITIVES ────────────────────────────────────────────────────────────
function Toast({t}){ if(!t)return null; return <div style={{...S.toast,...(t.type==="error"?S.toastErr:t.type==="warn"?S.toastWarn:S.toastOk)}}>{t.msg}</div>; }
function Field({label,children,style}){ return <div style={{display:"flex",flexDirection:"column",gap:5,...style}}><label style={S.label}>{label}</label>{children}</div>; }
function Row2({children,style}){ return <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,...style}}>{children}</div>; }
function Row3({children}){ return <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>{children}</div>; }
function Sel({value,onChange,opts,ph="— choisir —"}){ return <select style={S.select} value={value} onChange={onChange}><option value="">{ph}</option>{opts.map(o=><option key={o} value={o}>{o}</option>)}</select>; }
function Inp({value,onChange,ph,type="text",min,step,style}){ return <input type={type} style={{...S.input,...style}} value={value} onChange={onChange} placeholder={ph} min={min} step={step}/>; }
function Num({value,onChange,ph}){ return <input style={{...S.input,...S.numInput}} type="text" inputMode="decimal" value={value} onChange={onChange} placeholder={ph}/>; }

// Sélecteur d'unité — boutons m³ / m² / mL
function UniteSel({value,onChange}){
  return <div style={{display:"flex",gap:6}}>
    {UNITES.map(u=>(
      <button key={u} type="button" onClick={()=>onChange(u)}
        style={{flex:1,padding:"9px 4px",fontSize:13,fontWeight:700,fontFamily:"Georgia,serif",
          borderRadius:7,cursor:"pointer",transition:"all 0.15s",
          background:value===u?"linear-gradient(135deg,#8B5E2A,#D4A853)":"rgba(212,168,83,0.06)",
          color:value===u?"#141210":"#D4A853",
          border:value===u?"none":"1px solid rgba(212,168,83,0.2)"}}>
        {u}
      </button>
    ))}
  </div>;
}

function Card({title,children,accent,style}){ return <div style={{...S.card,...(accent?{borderColor:accent}:{}),...(style||{})}}>{title&&<div style={S.cardTitle}>{title}</div>}{children}</div>; }
function Badge({status}){
  const map={attente:["#2a1f0a","#D4A853"],production:["#0a1f2a","#5bb8d4"],valide:["#0a2a15","#6dbf7e"],annule:["#2a0a0a","#e07a5f"]};
  const [bg,fg]=map[status]||map.attente;
  return <span style={{background:bg,color:fg,padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{{attente:"En attente",production:"En production",valide:"✓ Validée",annule:"Annulée"}[status]||status}</span>;
}
function Stat({label,value,color}){ return <div style={{background:"rgba(212,168,83,0.05)",border:"1px solid rgba(212,168,83,0.12)",borderRadius:10,padding:"10px 8px",textAlign:"center"}}><div style={{fontSize:20,fontWeight:700,color:color||"#D4A853"}}>{value}</div><div style={{fontSize:9,color:"#6a5a4a",textTransform:"uppercase",letterSpacing:"0.08em",marginTop:2}}>{label}</div></div>; }
function Empty({icon,text}){ return <div style={{textAlign:"center",padding:"50px 20px",color:"#5a4a3a"}}><div style={{fontSize:36,marginBottom:10}}>{icon}</div><div style={{fontSize:14}}>{text}</div></div>; }
function Spinner(){ return <div style={S.spinner}/>; }
function Mini({label,value,color}){ return <div style={{textAlign:"center"}}><div style={{fontSize:9,color:"#6a5a4a",textTransform:"uppercase",marginBottom:2}}>{label}</div><div style={{fontSize:11,fontWeight:700,color:color||"#e8ddd0"}}>{value}</div></div>; }
function RItem({label,value,big,color}){ return <div><div style={{fontSize:10,color:"#6a5a4a",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:3}}>{label}</div><div style={{fontSize:big?18:14,fontWeight:big?700:600,color:color||"#e8ddd0"}}>{value}</div></div>; }

// Affichage résumé dimensionnel selon unité
function dimLabel(l){
  return `${l.epaisseur||"—"}×${l.largeur||"—"}mm · ${l.longueur||"—"}m · ${l.quantite||"—"}u.`;
}

// ─── APP ─────────────────────────────────────────────────────────────────────
export default function App(){
  const [tab,setTab]=useState("commande");
  const [scriptUrl,setScriptUrl]=useState(()=>localStorage.getItem(APPS_SCRIPT_URL_KEY)||"");
  const [toast,setToast]=useState(null);
  const showToast=(msg,type="success")=>{setToast({msg,type});setTimeout(()=>setToast(null),3500);};

  // ── Commande ──
  const [form,setForm]=useState(initCmd);
  const [submitting,setSub]=useState(false);
  const [confirmDel,setConfirmDel]=useState(null);
  const [deleting,setDeleting]=useState(false);

  // ── À réaliser ──
  const [commandes,setCmd]=useState([]);
  const [loading,setLoading]=useState(false);
  const [expand,setExpand]=useState(null);
  const cubeRef=useRef({});
  const [,forceRender]=useState(0);
  const cube=cubeRef.current;
  const setCube=(updater)=>{ cubeRef.current=typeof updater==="function"?updater(cubeRef.current):updater; forceRender(v=>v+1); };

  // ── Historique COMMUN (depuis Sheet) ──
  const [histCmds,setHistCmds]=useState([]);
  const [histLoading,setHistLoading]=useState(false);
  const [histDetail,setHistDetail]=useState(null); // commande ouverte en détail

  // ── Cubage libre ──
  const [freeForm,setFree]=useState(initCube);
  const [freeHistory,setFreeHist]=useState(()=>JSON.parse(localStorage.getItem("cube_history")||"[]"));
  const [freeExp,setFreeExp]=useState({});
  const [exportedSet]=useState(()=>new Set(JSON.parse(localStorage.getItem("exported_ids")||"[]")));

  const poll=useRef(null);
  const markExported=id=>{ exportedSet.add(id); localStorage.setItem("exported_ids",JSON.stringify([...exportedSet])); };

  // ── Charger commandes ──
  const load=useCallback(async(silent=false)=>{
    if(!scriptUrl)return;
    if(!silent)setLoading(true);
    try{
      const r=await fetch(`${scriptUrl}?action=getCommandes&t=${Date.now()}`);
      const d=await r.json();
      if(d.commandes)setCmd(d.commandes);
    }catch(e){}
    if(!silent)setLoading(false);
  },[scriptUrl]);

  // ── Charger historique COMMUN depuis Sheet ──
  const loadHist=useCallback(async()=>{
    if(!scriptUrl)return;
    setHistLoading(true);
    try{
      const r=await fetch(`${scriptUrl}?action=getHistorique&t=${Date.now()}`);
      const d=await r.json();
      if(d.historique)setHistCmds(d.historique);
    }catch(e){}
    setHistLoading(false);
  },[scriptUrl]);

  useEffect(()=>{ load(); poll.current=setInterval(()=>load(true),30000); return()=>clearInterval(poll.current); },[load]);

  // ─────────────────────────────────────────────────────────────────────────────
  // ONGLET 1 — COMMANDE
  // ─────────────────────────────────────────────────────────────────────────────
  const sf=f=>e=>setForm(p=>({...p,[f]:e.target.value}));
  const sl=(i,f)=>e=>setForm(p=>{const ls=[...p.lignes];ls[i]={...ls[i],[f]:e.target.value};return{...p,lignes:ls};});
  const slv=(i,v)=>setForm(p=>{const ls=[...p.lignes];ls[i]={...ls[i],unite:v};return{...p,lignes:ls};});
  const addL=()=>setForm(p=>({...p,lignes:[...p.lignes,{...initLigne}]}));
  const delL=i=>setForm(p=>({...p,lignes:p.lignes.filter((_,j)=>j!==i)}));
  const formValid=form.client&&form.dateLivraison&&form.lignes.every(l=>l.produit&&l.essence&&l.quantite);

  const envoyer=async()=>{
    if(!formValid||!scriptUrl){if(!scriptUrl)showToast("URL Apps Script manquante","error");return;}
    setSub(true);
    const id=genId(), dc=fmtDate();
    const rows=form.lignes.map((l,i)=>[
      i===0?id:"", form.client, l.produit, l.essence, l.qualite,
      l.epaisseur, l.largeur, l.longueur, l.quantite,
      form.dateLivraison, i===0?form.notes:"", "attente", i===0?dc:"",
      prodId(id,i), l.unite||"m³"   // col 15 = unité
    ]);
    try{
      await callScript(scriptUrl,{type:"commande",rows,id});
      setForm(initCmd);
      showToast(`Commande ${id} envoyée ✓`);
      setTimeout(()=>load(true),1000);
    }catch(e){showToast("Erreur d'envoi","error");}
    setSub(false);
  };

  const supprimerCommande=async(id)=>{
    setDeleting(true);
    if(scriptUrl){try{await callScript(scriptUrl,{type:"deleteCommande",id});}catch(e){}}
    setCmd(c=>c.filter(x=>x.id!==id));
    setConfirmDel(null); setDeleting(false);
    showToast("Commande supprimée");
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // ONGLET 2 — À RÉALISER
  // ─────────────────────────────────────────────────────────────────────────────
  const initCubeCmd=(cmd)=>{
    setCube(prev=>{
      if(prev[cmd.id])return prev;
      const lignesMap={};
      (cmd.lignes||[]).forEach((l,i)=>{
        const pid=prodId(cmd.id,i);
        lignesMap[pid]={
          produit:l.produit, essence:l.essence, qualite:l.qualite||"",
          epaisseur:l.epaisseur||"", largeur:l.largeur||"", longueur:l.longueur||"",
          nbUnites:l.quantite||"", volumeGrume:"",
          unite:l.unite||l.prodId_unite||"m³",  // récupérer l'unité de la commande
          volUnit:null, volCharge:null, rend:null, perte:null,
          exporting:false, exported:false, idx:i
        };
      });
      return {...prev,[cmd.id]:lignesMap};
    });
  };

  const setField=(cmdId,pid,field,value)=>{
    setCube(prev=>{
      const cm={...prev[cmdId]};
      const p={...cm[pid],[field]:value};
      const res=calculParUnite(p);
      if(res){
        p.volUnit=res.volUnit; p.volCharge=res.volCharge;
        p.volReel=res.volReel; p.rend=res.rend; p.perte=res.perte;
      } else {
        p.volUnit=null; p.volCharge=null; p.volReel=null; p.rend=null; p.perte=null;
      }
      cm[pid]=p;
      return {...prev,[cmdId]:cm};
    });
  };

  const isPret=(p)=>{
    const u=p.unite||"m³";
    if(u==="m³"){
      // m³ : toutes les dims + grume obligatoires
      return p.epaisseur&&p.largeur&&p.longueur&&p.nbUnites&&p.volumeGrume&&!p.exported&&!p.exporting;
    }
    // m² et mL : seule la quantité est obligatoire, dims optionnelles
    return p.nbUnites&&!p.exported&&!p.exporting;
  };

  const validerProduit=async(cmd,pid)=>{
    if(!scriptUrl){showToast("URL Apps Script manquante","error");return;}
    const p=cubeRef.current[cmd.id]?.[pid];
    if(!p||!isPret(p))return;

    cubeRef.current={...cubeRef.current,[cmd.id]:{...cubeRef.current[cmd.id],[pid]:{...cubeRef.current[cmd.id][pid],exporting:true}}};
    forceRender(v=>v+1);

    const date=fmtDate();
    const res=calculParUnite(p);
    if(!res){showToast("Données incomplètes","error");return;}
    const {volUnit:vu,volCharge:vc,rend,perte}=res;
    const vg=parseFloat(p.volumeGrume)||0;
    const unite=p.unite||"m³";

    const row=[date,cmd.id,pid,p.produit,p.essence,p.qualite,
      p.epaisseur,p.largeur,p.longueur,p.nbUnites,
      vg,vu,vc,res.volReel??"—",rend??"—",perte??"—",unite];

    try{
      await callScript(scriptUrl,{type:"cubageProduit",row,id:pid});
      const fresh=cubeRef.current[cmd.id]||{};
      const updatedCmd={...fresh,[pid]:{...fresh[pid],exported:true,exporting:false,volUnit:vu,volCharge:vc,volReel:res.volReel??null,rend,perte,unite}};
      const tousExportes=Object.values(updatedCmd).every(p2=>p2.exported);
      cubeRef.current={...cubeRef.current,[cmd.id]:updatedCmd};
      forceRender(v=>v+1);

      if(tousExportes){
        try{await callScript(scriptUrl,{type:"updateStatut",id:cmd.id,statut:"valide",date});}catch(e){}
        setCmd(c=>c.map(x=>x.id===cmd.id?{...x,statut:"valide"}:x));

        // Sauvegarder historique dans le Sheet (commun)
        const hEntry={
          id:cmd.id, client:cmd.client,
          dateLivraison:cmd.dateLivraison||cmd.datelivraison,
          dateValidation:date, notes:cmd.notes||"",
          lignes:Object.values(updatedCmd).sort((a,b)=>a.idx-b.idx).map(p2=>({
            produit:p2.produit,essence:p2.essence,qualite:p2.qualite,
            epaisseur:p2.epaisseur,largeur:p2.largeur,longueur:p2.longueur,
            nbUnites:p2.nbUnites,volumeGrume:p2.volumeGrume,
            volUnit:p2.volUnit,volCharge:p2.volCharge,volReel:p2.volReel??null,
            rend:p2.rend,perte:p2.perte,unite:p2.unite||"m³"
          }))
        };
        try{ await callScript(scriptUrl,{type:"saveHistorique",entry:hEntry}); }catch(e){}
        setHistCmds(h=>[hEntry,...h]);
        showToast(`✓ Commande ${cmd.id} entièrement validée !`);
        setExpand(null);
      }else{
        showToast(`${p.produit} exporté ✓`);
      }
    }catch(e){
      cubeRef.current={...cubeRef.current,[cmd.id]:{...cubeRef.current[cmd.id],[pid]:{...cubeRef.current[cmd.id]?.[pid],exporting:false}}};
      forceRender(v=>v+1);
      showToast("Erreur — réessaie","error");
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // CUBAGE LIBRE
  // ─────────────────────────────────────────────────────────────────────────────
  const sfree=f=>e=>setFree(p=>({...p,[f]:e.target.value}));
  const sfreeUnite=v=>setFree(p=>({...p,unite:v,epaisseur:"",largeur:"",longueur:"",nbUnites:"",volumeGrume:""}));
  // Calcul libre : utilise calculParUnite pour toutes les unités
  const freeRes=calculParUnite(freeForm);
  const freeOk=freeRes&&freeForm.produit&&freeForm.essence&&freeForm.qualite;
  const addFree=async()=>{
    if(!freeOk)return;
    const entry={
      id:"LIBRE-"+Date.now().toString(36).toUpperCase().slice(-6),
      type:"libre", date:fmtDate(),
      produit:freeForm.produit, essence:freeForm.essence, qualite:freeForm.qualite,
      epaisseur:freeForm.epaisseur, largeur:freeForm.largeur, longueur:freeForm.longueur,
      nbUnites:freeForm.nbUnites, volumeGrume:freeForm.volumeGrume,
      unite:freeForm.unite||"m³",
      volUnit:freeRes.volUnit, volCharge:freeRes.volCharge,
      volReel:freeRes.volReel??null, rend:freeRes.rend, perte:freeRes.perte
    };
    // Sauvegarder dans l'historique commun du Sheet
    if(scriptUrl){
      try{
        const hEntry={
          id:entry.id, client:"Cubage libre", type:"libre",
          dateLivraison:"—", dateValidation:entry.date, notes:"",
          lignes:[{
            produit:entry.produit, essence:entry.essence, qualite:entry.qualite,
            epaisseur:entry.epaisseur, largeur:entry.largeur, longueur:entry.longueur,
            nbUnites:entry.nbUnites, volumeGrume:entry.volumeGrume,
            volUnit:entry.volUnit, volCharge:entry.volCharge,
            volReel:entry.volReel, rend:entry.rend, perte:entry.perte,
            unite:entry.unite
          }]
        };
        await callScript(scriptUrl,{type:"saveHistorique",entry:hEntry});
        setHistCmds(h=>[hEntry,...h]);
      }catch(e){}
    }
    // Envoyer aussi dans le Sheet Scieur (anti-doublon sur entry.id)
    if(scriptUrl){
      try{
        const u=entry.unite||"m³";
        const row=[
          entry.date, "", entry.id,
          entry.produit, entry.essence, entry.qualite,
          entry.epaisseur, entry.largeur, entry.longueur,
          entry.nbUnites, entry.volumeGrume||0,
          entry.volUnit||0, entry.volCharge||0,
          entry.volReel??"—", entry.rend??"—", entry.perte??"—", u
        ];
        await callScript(scriptUrl,{type:"cubageProduit",row,id:entry.id});
      }catch(e){}
    }
    // Garder aussi en local pour affichage immédiat dans cet onglet
    const nh=[entry,...freeHistory];
    setFreeHist(nh); localStorage.setItem("cube_history",JSON.stringify(nh));
    showToast("Charge cubée et sauvegardée ✓"); setFree(initCube);
  };
  const exportFree=async(e)=>{
    if(!scriptUrl){showToast("URL Apps Script manquante","error");return;}
    if(exportedSet.has(String(e.id))){showToast("Déjà exporté !","warn");return;}
    setFreeExp(x=>({...x,[e.id]:true}));
    const row=[e.date,"","",e.produit,e.essence,e.qualite,e.epaisseur,e.largeur,e.longueur,e.nbUnites,e.volumeGrume,e.volumeUnit,e.volumeCharge,e.rendement,e.perte,"m³"];
    try{
      await callScript(scriptUrl,{type:"cubageProduit",row,id:String(e.id)});
      markExported(String(e.id));
      setFreeHist(h=>h.map(x=>x.id===e.id?{...x,exported:true}:x));
      showToast("Exporté ✓");
    }catch(ex){showToast("Envoyé (vérifier le Sheet)"); markExported(String(e.id));}
    setFreeExp(x=>({...x,[e.id]:false}));
  };

  const cmdAtt=commandes.filter(c=>["attente","En attente"].includes(c.statut));
  const cmdProd=commandes.filter(c=>["production","En production"].includes(c.statut));
  const cmdVal=commandes.filter(c=>["valide","Validée"].includes(c.statut));
  const aRealiser=[...cmdAtt,...cmdProd];

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDU
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={S.root}>
      <Toast t={toast}/>
      <header style={S.header}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:"#D4A853",boxShadow:"0 0 8px #D4A853"}}/>
          <span style={S.logoText}>SCIERIE</span>
        </div>
        {cmdAtt.length>0&&<div style={S.alertBadge}>{cmdAtt.length} en attente</div>}
      </header>

      <main style={S.main}>

        {/* ══ COMMANDE ══ */}
        {tab==="commande"&&<div style={S.page}>
          <Card title="Informations commande">
            <Field label="Client / chantier" style={{marginBottom:12}}>
              <Inp value={form.client} onChange={sf("client")} ph="Ex: Dupont - Chalet Megève"/>
            </Field>
            <Field label="Date de livraison souhaitée">
              <Inp type="date" value={form.dateLivraison} onChange={sf("dateLivraison")} min={today()}/>
            </Field>
          </Card>

          {form.lignes.map((lg,i)=>(
            <Card key={i} title={`Produit ${form.lignes.length>1?i+1:""}`} accent={i===0?"rgba(212,168,83,.3)":"rgba(212,168,83,.12)"}>
              {/* Unité en haut bien visible */}
              <Field label="Unité de mesure" style={{marginBottom:12}}>
                <UniteSel value={lg.unite||"m³"} onChange={v=>slv(i,v)}/>
              </Field>
              <Row2 style={{marginBottom:10}}>
                <Field label="Produit"><Sel value={lg.produit} onChange={sl(i,"produit")} opts={PRODUITS}/></Field>
                <Field label="Essence"><Sel value={lg.essence} onChange={sl(i,"essence")} opts={ESSENCES}/></Field>
              </Row2>
              <Field label="Qualité" style={{marginBottom:10}}>
                <Sel value={lg.qualite} onChange={sl(i,"qualite")} opts={QUALITES}/>
              </Field>
              {/* Dimensions : obligatoires en m³, optionnelles en m²/mL */}
              {(lg.unite||"m³")==="m³"?(
                <Row3>
                  <Field label="Ép. mm"><Num value={lg.epaisseur} onChange={sl(i,"epaisseur")} ph="27"/></Field>
                  <Field label="Larg. mm"><Num value={lg.largeur} onChange={sl(i,"largeur")} ph="120"/></Field>
                  <Field label="Long. m"><Num value={lg.longueur} onChange={sl(i,"longueur")} ph="2.4"/></Field>
                </Row3>
              ):(
                <Row3>
                  <Field label="Ép. mm (opt.)"><Num value={lg.epaisseur} onChange={sl(i,"epaisseur")} ph="27"/></Field>
                  <Field label="Larg. mm (opt.)"><Num value={lg.largeur} onChange={sl(i,"largeur")} ph="120"/></Field>
                  <Field label="Long. m (opt.)"><Num value={lg.longueur} onChange={sl(i,"longueur")} ph="2.4"/></Field>
                </Row3>
              )}
              <Field label={(lg.unite||"m³")==="m³"?"Quantité (unités)":(lg.unite==="m²")?"Total commandé (m²)":"Total commandé (mL)"} style={{marginTop:10}}>
                <Num value={lg.quantite} onChange={sl(i,"quantite")} ph="100"/>
              </Field>
              {form.lignes.length>1&&<button style={{...S.btnDel,marginTop:10,width:"100%",textAlign:"center"}} onClick={()=>delL(i)}>🗑 Supprimer ce produit</button>}
            </Card>
          ))}

          <button style={{...S.btnBig,background:"rgba(212,168,83,.08)",color:"#D4A853",border:"1px solid rgba(212,168,83,.3)",marginBottom:10}} onClick={addL}>
            + Ajouter un produit
          </button>
          <Card title="Notes">
            <textarea style={{...S.input,minHeight:60,resize:"vertical"}} value={form.notes} onChange={sf("notes")} placeholder="Instructions particulières..."/>
          </Card>
          <button style={{...S.btnBig,...(!formValid||submitting?S.btnDis:{})}} onClick={envoyer} disabled={!formValid||submitting}>
            {submitting?<Spinner/>:"📤 Envoyer la commande"}
          </button>

          {commandes.length>0&&<>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.15em",textTransform:"uppercase",color:"#D4A853",margin:"20px 0 10px",paddingBottom:5,borderBottom:"1px solid rgba(212,168,83,.15)"}}>Commandes envoyées</div>
            <button style={S.btnRefresh} onClick={()=>load()}>{loading?"⏳ Chargement...":"↻ Actualiser"}</button>
            {commandes.map(c=>(
              <Card key={c.id}>
                {confirmDel===c.id?(
                  <div style={{textAlign:"center",padding:"8px 0"}}>
                    <div style={{color:"#e07a5f",fontSize:13,marginBottom:12}}>Supprimer <strong>{c.id}</strong> ?</div>
                    <div style={{display:"flex",gap:10,justifyContent:"center"}}>
                      <button style={{...S.btnSmall,color:"#e07a5f",borderColor:"rgba(224,122,95,.4)"}} onClick={()=>supprimerCommande(c.id)} disabled={deleting}>{deleting?<Spinner/>:"Confirmer"}</button>
                      <button style={S.btnSmall} onClick={()=>setConfirmDel(null)}>Annuler</button>
                    </div>
                  </div>
                ):(
                  <>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                      <div><div style={{fontSize:11,color:"#6a5a4a"}}>{c.id}</div><div style={{fontWeight:700,color:"#e8ddd0",fontSize:14}}>{c.client}</div></div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}><Badge status={c.statut||"attente"}/><button style={{...S.btnDel,padding:"4px 8px",fontSize:12}} onClick={()=>setConfirmDel(c.id)}>🗑</button></div>
                    </div>
                    {(c.lignes||[]).map((l,i)=>(
                      <div key={i} style={{fontSize:12,color:"#a09080",marginBottom:2}}>
                        • <strong style={{color:"#D4A853"}}>{l.produit}</strong>{l.essence?` · ${l.essence}`:""}{l.qualite?` · ${l.qualite}`:""}
                        <span style={{color:"#5bb8d4",fontSize:11}}> [{l.unite||"m³"}]</span>
                        <span style={{color:"#6a5a4a",fontFamily:"monospace",fontSize:11}}> — {dimLabel(l)}</span>
                      </div>
                    ))}
                    <div style={{fontSize:12,color:"#6a5a4a",marginTop:6}}>Livraison : <strong style={{color:"#c4b09a"}}>{c.dateLivraison||c.datelivraison}</strong></div>
                  </>
                )}
              </Card>
            ))}
          </>}
        </div>}

        {/* ══ À RÉALISER ══ */}
        {tab==="arealiser"&&<div style={S.page}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
            <Stat label="Attente" value={cmdAtt.length} color="#D4A853"/>
            <Stat label="Prod." value={cmdProd.length} color="#5bb8d4"/>
            <Stat label="Validées" value={cmdVal.length} color="#6dbf7e"/>
          </div>
          <button style={S.btnRefresh} onClick={()=>load()}>{loading?"⏳ Chargement...":"↻ Actualiser"}</button>
          {!scriptUrl&&<div style={{textAlign:"center",padding:16,color:"#D4A853",fontSize:13}}>⚠ Configure l'URL Apps Script dans ⚙ Config</div>}
          {aRealiser.length===0&&scriptUrl&&!loading&&<Empty icon="✅" text="Aucune commande à réaliser"/>}

          {aRealiser.map(cmd=>{
            const cubeCmd=cube[cmd.id];
            const pids=cubeCmd?Object.keys(cubeCmd):[];
            const nbExp=pids.filter(pid=>cubeCmd[pid].exported).length;
            const nbTot=(cmd.lignes||[]).length;
            const isOpen=expand===cmd.id;
            return (
              <div key={cmd.id} style={{...S.card,marginBottom:12,borderColor:isOpen?"rgba(91,184,212,.4)":"rgba(212,168,83,.12)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
                  <div><div style={{fontSize:11,color:"#5bb8d4"}}>{cmd.id}</div><div style={{fontWeight:700,color:"#e8ddd0",fontSize:15}}>{cmd.client}</div></div>
                  <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
                    <Badge status={cmd.statut||"attente"}/>
                    {cubeCmd&&<span style={{fontSize:10,color:"#6dbf7e"}}>{nbExp}/{nbTot} validé{nbTot>1?"s":""}</span>}
                  </div>
                </div>
                <div style={{fontSize:12,color:"#6a5a4a",marginBottom:6}}>📅 <strong style={{color:"#c4b09a"}}>{cmd.dateLivraison||cmd.datelivraison}</strong>{cmd.notes&&<span style={{color:"#8a7a68",fontStyle:"italic"}}> · "{cmd.notes}"</span>}</div>
                <div style={{marginBottom:10}}>
                  {(cmd.lignes||[]).map((l,i)=>{
                    const pid=prodId(cmd.id,i);
                    const exp=cubeCmd?.[pid]?.exported;
                    const u=l.unite||"m³";
                    return (
                      <div key={i} style={{fontSize:12,marginBottom:3,padding:"4px 8px",borderRadius:6,display:"flex",justifyContent:"space-between",alignItems:"center",background:exp?"rgba(109,191,126,.06)":"rgba(255,255,255,.02)",border:`1px solid ${exp?"rgba(109,191,126,.2)":"transparent"}`}}>
                        <span>
                          <span style={{color:exp?"#6dbf7e":"#D4A853",fontWeight:700}}>{exp?"✓ ":""}{l.produit}</span>
                          <span style={{color:"#8a7a68"}}>{l.essence?` · ${l.essence}`:""}</span>
                          <span style={{color:"#5bb8d4",fontSize:10}}> [{u}]</span>
                          <span style={{color:"#5a4a3a",fontFamily:"monospace",fontSize:11}}> {dimLabel(l)}</span>
                        </span>
                        <span style={{fontSize:10,color:"#5bb8d4",fontFamily:"monospace",background:"rgba(91,184,212,.08)",padding:"2px 5px",borderRadius:4}}>{pid.split("-").slice(-1)[0]}</span>
                      </div>
                    );
                  })}
                </div>
                <button style={{...S.btnSmall,width:"100%",textAlign:"center",background:isOpen?"rgba(91,184,212,.12)":"rgba(212,168,83,.06)",color:isOpen?"#5bb8d4":"#D4A853",borderColor:isOpen?"rgba(91,184,212,.3)":"rgba(212,168,83,.2)"}}
                  onClick={()=>{if(!isOpen){initCubeCmd(cmd);setExpand(cmd.id);}else setExpand(null);}}>
                  {isOpen?"▲ Fermer":"👁 Voir commande"}
                </button>

                {isOpen&&cubeCmd&&(
                  <div style={{marginTop:14,borderTop:"1px solid rgba(91,184,212,.15)",paddingTop:14}}>
                    {Object.entries(cubeCmd).sort((a,b)=>a[1].idx-b[1].idx).map(([pid,p])=>{
                      const pret=isPret(p);
                      const u=p.unite||"m³";
                      return (
                        <div key={pid} style={{background:p.exported?"rgba(109,191,126,.04)":"rgba(255,255,255,.02)",border:`1px solid ${p.exported?"rgba(109,191,126,.3)":"rgba(212,168,83,.15)"}`,borderRadius:10,padding:"12px",marginBottom:12}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                            <div style={{fontSize:12,fontWeight:700,color:p.exported?"#6dbf7e":"#D4A853",textTransform:"uppercase",letterSpacing:"0.07em"}}>
                              {p.exported?"✓ ":""}{p.produit} · {p.essence}
                              {p.qualite&&<span style={{color:"#6a5a4a",fontWeight:400}}> · {p.qualite}</span>}
                              <span style={{color:"#5bb8d4",fontSize:11,fontWeight:400,textTransform:"none",letterSpacing:0}}> [{u}]</span>
                            </div>
                            <span style={{fontSize:10,color:"#5bb8d4",fontFamily:"monospace",background:"rgba(91,184,212,.08)",padding:"2px 6px",borderRadius:4}}>{pid}</span>
                          </div>
                          {p.exported?(
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6}}>
                              {u==="m³"&&<Mini label="Grume" value={m3f(parseFloat(p.volumeGrume)||0)} color="#a09080"/>}
                              <Mini label={u==="mL"?"Linéaire":"Volume/Surface"} value={m3f(p.volCharge||0,u)} color="#D4A853"/>
                              {u==="m³"&&p.rend!=null&&<Mini label="Rend." value={pct(p.rend)} color="#6dbf7e"/>}
                              {u==="m³"&&p.perte!=null&&<Mini label="Perte" value={pct(p.perte)} color="#e07a5f"/>}
                            </div>
                          ):(
                            <>
                              {/* m³ : tout obligatoire | m²/mL : dims optionnelles */}
                              {u==="m³"?(
                                <Row3>
                                  <Field label="Ép. mm"><Num value={p.epaisseur} onChange={e=>setField(cmd.id,pid,"epaisseur",e.target.value)} ph="27"/></Field>
                                  <Field label="Larg. mm"><Num value={p.largeur} onChange={e=>setField(cmd.id,pid,"largeur",e.target.value)} ph="120"/></Field>
                                  <Field label="Long. m"><Num value={p.longueur} onChange={e=>setField(cmd.id,pid,"longueur",e.target.value)} ph="2.4"/></Field>
                                </Row3>
                              ):(
                                <Row3>
                                  <Field label="Ép. mm (opt.)"><Num value={p.epaisseur} onChange={e=>setField(cmd.id,pid,"epaisseur",e.target.value)} ph="27"/></Field>
                                  <Field label="Larg. mm (opt.)"><Num value={p.largeur} onChange={e=>setField(cmd.id,pid,"largeur",e.target.value)} ph="120"/></Field>
                                  <Field label="Long. m (opt.)"><Num value={p.longueur} onChange={e=>setField(cmd.id,pid,"longueur",e.target.value)} ph="2.4"/></Field>
                                </Row3>
                              )}

                              <Row2 style={{marginTop:10}}>
                                <Field label={u==="m²"?"Total produit (m²)":u==="mL"?"Total produit (mL)":"Nb unités prod."}>
                                  <Num value={p.nbUnites} onChange={e=>setField(cmd.id,pid,"nbUnites",e.target.value)} ph={p.nbUnites||"200"}/>
                                </Field>
                                {/* Grume pour m³ obligatoire, pour m²/mL optionnelle si on veut le rendement */}
                                <Field label={u==="m³"?"Vol. grume (m³)":"Vol. grume m³ (opt.)"}>
                                  <Num value={p.volumeGrume} onChange={e=>setField(cmd.id,pid,"volumeGrume",e.target.value)} ph="2.5"/>
                                </Field>
                              </Row2>

                              {p.volCharge!=null&&(
                                <div style={{marginTop:8,background:"rgba(212,168,83,.04)",borderRadius:8,padding:"8px 10px",display:"grid",gridTemplateColumns:u==="m³"?"1fr 1fr 1fr 1fr":((p.volUnit!=null&&p.rend!=null)?"1fr 1fr 1fr 1fr":p.volUnit!=null?"1fr 1fr 1fr":"1fr 1fr"),gap:6}}>
                                  {(u==="m³"||p.volUnit!=null)&&<Mini label={u==="m³"?"Vol. unit.":"Dim. unit."} value={m3f(p.volUnit||0,u)} color="#e8ddd0"/>}
                                  <Mini label={u==="mL"?"Total (mL)":u==="m²"?"Total (m²)":"Vol. charge"} value={m3f(p.volCharge,u)} color="#D4A853"/>
                                  {u!=="m³"&&p.volReel!=null&&<Mini label="Vol. réel m³" value={m3f(p.volReel)} color="#C4904A"/>}
                                  {p.rend!=null&&<Mini label="Rendement" value={pct(p.rend)} color="#6dbf7e"/>}
                                  {p.perte!=null&&<Mini label="Perte" value={pct(p.perte)} color="#e07a5f"/>}
                                </div>
                              )}
                              {u==="m³"&&p.volCharge!=null&&p.rend!=null&&<div style={{...S.rendBar,marginTop:6}}><div style={{...S.rendFill,width:pct(p.rend)}}/></div>}

                              <button style={{...S.btnBig,...(!pret?S.btnDis:{}),marginTop:10,marginBottom:0,fontSize:13,padding:"11px",background:pret?"linear-gradient(135deg,#0a1f0a,#6dbf7e)":"rgba(255,255,255,.05)",color:pret?"#fff":"#4a3a2a",boxShadow:pret?"0 4px 12px rgba(109,191,126,.2)":"none"}}
                                onClick={()=>validerProduit(cmd,pid)} disabled={!pret||p.exporting}>
                                {p.exporting?<Spinner/>:`✓ Valider ${pid}`}
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {cmdVal.length>0&&<>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.15em",textTransform:"uppercase",color:"#6dbf7e",marginTop:20,marginBottom:8,paddingBottom:5,borderBottom:"1px solid rgba(109,191,126,.2)"}}>Validées récentes</div>
            {cmdVal.map(cmd=>(
              <div key={cmd.id} style={{...S.card,borderColor:"rgba(109,191,126,.15)",opacity:0.7}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div><div style={{fontSize:11,color:"#5bb8d4"}}>{cmd.id}</div><div style={{fontWeight:700,color:"#e8ddd0"}}>{cmd.client}</div></div>
                  <Badge status="valide"/>
                </div>
              </div>
            ))}
          </>}
        </div>}

        {/* ══ HISTORIQUE COMMUN ══ */}
        {tab==="historique"&&<div style={S.page}>
          {/* Détail d'une commande — overlay */}
          {histDetail&&(
            <div style={{position:"fixed",inset:0,zIndex:100,background:"rgba(0,0,0,.96)",overflowY:"auto",padding:"20px 14px"}}>
              <div style={{maxWidth:480,margin:"0 auto"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                  <div>
                    <div style={{fontSize:11,color:"#5bb8d4"}}>{histDetail.id}</div>
                    <div style={{fontWeight:700,color:"#e8ddd0",fontSize:18}}>{histDetail.type==="libre"?"📐 Cubage libre":histDetail.client}</div>
                  </div>
                  <button style={{...S.btnSmall,fontSize:16,padding:"6px 14px"}} onClick={()=>setHistDetail(null)}>✕</button>
                </div>
                <div style={{fontSize:12,color:"#6a5a4a",marginBottom:14}}>
                  📅 Livraison : <strong style={{color:"#c4b09a"}}>{histDetail.dateLivraison}</strong>
                  {" · "}Validée le <strong style={{color:"#c4b09a"}}>{histDetail.dateValidation}</strong>
                  {histDetail.notes&&<div style={{marginTop:4,color:"#8a7a68",fontStyle:"italic"}}>"{histDetail.notes}"</div>}
                </div>
                {/* Totaux globaux */}
                {histDetail.lignes&&(()=>{
                  const m3lines=histDetail.lignes.filter(l=>(l.unite||"m³")==="m³");
                  const m2lines=histDetail.lignes.filter(l=>l.unite==="m²");
                  const mLlines=histDetail.lignes.filter(l=>l.unite==="mL");
                  return <div style={{background:"rgba(212,168,83,.06)",borderRadius:10,padding:"10px 12px",marginBottom:14,display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
                    {m3lines.length>0&&<Stat label="Total m³" value={m3f(m3lines.reduce((s,l)=>s+(l.volCharge||0),0))} color="#D4A853"/>}
                    {m2lines.length>0&&<Stat label="Total m²" value={m3f(m2lines.reduce((s,l)=>s+(l.volCharge||0),0),"m²")} color="#5bb8d4"/>}
                    {mLlines.length>0&&<Stat label="Total mL" value={m3f(mLlines.reduce((s,l)=>s+(l.volCharge||0),0),"mL")} color="#9A7A54"/>}
                  </div>;
                })()}
                {(histDetail.lignes||[]).map((l,i)=>{
                  const u=l.unite||"m³";
                  return (
                    <div key={i} style={{background:"rgba(30,22,12,.95)",border:"1px solid rgba(212,168,83,.3)",borderRadius:10,padding:"12px",marginBottom:8}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                        <div style={{fontWeight:700,color:"#D4A853",fontSize:13}}>{l.produit} · {l.essence}{l.qualite&&<span style={{color:"#6a5a4a",fontWeight:400}}> · {l.qualite}</span>}</div>
                        <span style={{background:"rgba(91,184,212,.12)",color:"#5bb8d4",padding:"2px 8px",borderRadius:12,fontSize:11,fontWeight:700}}>{u}</span>
                      </div>
                      <div style={{fontSize:11,color:"#6a5a4a",fontFamily:"monospace",marginBottom:8}}>
                        {`${l.epaisseur||"—"}mm × ${l.largeur||"—"}mm · ${l.longueur||"—"}m · ${l.nbUnites||"—"}u.`}
                      </div>
                      {(()=>{
                        const cols=u==="m³"?4:(l.volUnit&&l.rend!=null?5:l.volUnit?3:2);
                        return <div style={{display:"grid",gridTemplateColumns:`repeat(${cols},1fr)`,gap:8}}>
                          {u==="m³"&&<Mini label="Grume" value={m3f(l.volumeGrume||0)} color="#a09080"/>}
                          {u!=="m³"&&l.volUnit&&<Mini label="Dim. unit." value={m3f(l.volUnit,u)} color="#e8ddd0"/>}
                          <Mini label={u==="mL"?"Total mL":u==="m²"?"Total m²":"Volume"} value={m3f(l.volCharge||0,u)} color="#D4A853"/>
                          {u!=="m³"&&l.volReel!=null&&<Mini label="Vol. réel m³" value={m3f(l.volReel)} color="#C4904A"/>}
                          {l.rend!=null&&<Mini label="Rendement" value={pct(l.rend)} color="#6dbf7e"/>}
                          {l.perte!=null&&<Mini label="Perte" value={pct(l.perte)} color="#e07a5f"/>}
                        </div>;
                      })()}
                    </div>
                  );
                })}
                <button style={{...S.btnBig,marginTop:8}} onClick={()=>setHistDetail(null)}>Fermer</button>
              </div>
            </div>
          )}

          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div style={{color:"#8a7a68",fontSize:12}}>{histCmds.length} commande{histCmds.length>1?"s":""} réalisée{histCmds.length>1?"s":""}</div>
            <button style={S.btnRefresh} onClick={loadHist}>{histLoading?"⏳":"↻ Actualiser"}</button>
          </div>
          {!scriptUrl&&<div style={{textAlign:"center",padding:16,color:"#D4A853",fontSize:13}}>⚠ Configure l'URL Apps Script dans ⚙ Config</div>}
          {histCmds.length===0&&!histLoading&&scriptUrl&&<Empty icon="📚" text="Aucune commande validée — appuie sur ↻ pour charger"/>}
          {histLoading&&<Empty icon="⏳" text="Chargement..."/>}

          {histCmds.map(h=>{
            const isLibre=h.type==="libre";
            const borderC=isLibre?"rgba(154,122,84,.35)":"rgba(109,191,126,.2)";
            const accentC=isLibre?"#9A7A54":"#6dbf7e";
            const bgC=isLibre?"rgba(154,122,84,.04)":"transparent";
            return (
            <div key={h.id} style={{...S.card,borderColor:borderC,borderLeft:`3px solid ${accentC}`,background:bgC,cursor:"pointer"}}
              onClick={()=>setHistDetail(h)}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                <div>
                  <div style={{fontSize:11,color:"#5bb8d4"}}>{h.id}</div>
                  <div style={{fontWeight:700,color:"#e8ddd0",fontSize:14}}>{isLibre?"Cubage libre":h.client}</div>
                </div>
                <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
                  <span style={{fontSize:11,color:accentC,background:`rgba(${isLibre?"154,122,84":"109,191,126"},.1)`,padding:"3px 8px",borderRadius:12,border:`1px solid rgba(${isLibre?"154,122,84":"109,191,126"},.2)`}}>
                    {isLibre?"📐 Libre":"✓ Réalisée"}
                  </span>
                  <span style={{fontSize:10,color:"#6a5a4a"}}>{h.dateValidation}</span>
                </div>
              </div>
              <div style={{fontSize:12,color:"#6a5a4a",marginBottom:6}}>📅 <strong style={{color:"#c4b09a"}}>{isLibre?h.dateValidation:h.dateLivraison}</strong></div>
              {/* Résumé compact */}
              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:6}}>
                {(h.lignes||[]).map((l,i)=>(
                  <span key={i} style={{fontSize:11,color:"#a09080",background:"rgba(255,255,255,.03)",padding:"2px 8px",borderRadius:10,border:"1px solid rgba(212,168,83,.1)"}}>
                    {l.produit} <span style={{color:"#5bb8d4"}}>[{l.unite||"m³"}]</span>
                  </span>
                ))}
              </div>
              <div style={{fontSize:11,color:"#6a5a4a"}}>
                Total : <strong style={{color:"#D4A853"}}>{m3f((h.lignes||[]).filter(l=>(l.unite||"m³")==="m³").reduce((s,l)=>s+(l.volCharge||0),0))}</strong>
                {(h.lignes||[]).some(l=>l.unite==="m²")&&<span> · <strong style={{color:"#5bb8d4"}}>{m3f((h.lignes||[]).filter(l=>l.unite==="m²").reduce((s,l)=>s+(l.volCharge||0),0),"m²")}</strong></span>}
                {(h.lignes||[]).some(l=>l.unite==="mL")&&<span> · <strong style={{color:"#9A7A54"}}>{m3f((h.lignes||[]).filter(l=>l.unite==="mL").reduce((s,l)=>s+(l.volCharge||0),0),"mL")}</strong></span>}
              </div>
              <div style={{fontSize:10,color:"#5bb8d4",marginTop:6,textAlign:"right"}}>Appuyer pour voir le détail →</div>
            </div>
            );
          })}
        </div>}

        {/* ══ CUBAGE LIBRE ══ */}
        {tab==="libre"&&<div style={S.page}>
          <div style={{fontSize:12,color:"#6a5a4a",marginBottom:14,textAlign:"center"}}>Cubage hors commande — sciage libre</div>

          <Card title="Produit">
            <Field label="Unité de mesure" style={{marginBottom:12}}>
              <UniteSel value={freeForm.unite||"m³"} onChange={sfreeUnite}/>
            </Field>
            <Row2 style={{marginBottom:12}}>
              <Field label="Produit"><Sel value={freeForm.produit} onChange={sfree("produit")} opts={PRODUITS}/></Field>
              <Field label="Essence"><Sel value={freeForm.essence} onChange={sfree("essence")} opts={ESSENCES}/></Field>
            </Row2>
            <Field label="Qualité"><Sel value={freeForm.qualite} onChange={sfree("qualite")} opts={QUALITES}/></Field>
          </Card>

          <Card title={(freeForm.unite||"m³")==="m³"?"Dimensions":"Dimensions"}>
            {(freeForm.unite||"m³")==="m³"?(
              <Row3>
                <Field label="Ép. mm"><Num value={freeForm.epaisseur} onChange={sfree("epaisseur")} ph="27"/></Field>
                <Field label="Larg. mm"><Num value={freeForm.largeur} onChange={sfree("largeur")} ph="120"/></Field>
                <Field label="Long. m"><Num value={freeForm.longueur} onChange={sfree("longueur")} ph="2.4"/></Field>
              </Row3>
            ):(
              <Row3>
                <Field label="Ép. mm (opt.)"><Num value={freeForm.epaisseur} onChange={sfree("epaisseur")} ph="27"/></Field>
                <Field label="Larg. mm (opt.)"><Num value={freeForm.largeur} onChange={sfree("largeur")} ph="120"/></Field>
                <Field label="Long. m (opt.)"><Num value={freeForm.longueur} onChange={sfree("longueur")} ph="2.4"/></Field>
              </Row3>
            )}
          </Card>

          <Card title="Charge">
            <Row2>
              <Field label={(freeForm.unite||"m³")==="m³"?"Nb unités":freeForm.unite==="m²"?"Total (m²)":"Total (mL)"}>
                <Num value={freeForm.nbUnites} onChange={sfree("nbUnites")} ph={(freeForm.unite||"m³")==="m³"?"200":"ex: 15"}/>
              </Field>
              <Field label={(freeForm.unite||"m³")==="m³"?"Vol. grume (m³)":"Vol. grume m³ (opt.)"}>
                <Num value={freeForm.volumeGrume} onChange={sfree("volumeGrume")} ph="2.5"/>
              </Field>
            </Row2>
          </Card>

          {freeRes&&(()=>{
            const u=freeForm.unite||"m³";
            return (
              <div style={S.resultBox}>
                <div style={{display:"grid",gridTemplateColumns:u==="m³"?"1fr 1fr":(freeRes.volUnit!=null&&freeRes.rend!=null)?"1fr 1fr 1fr 1fr":freeRes.volUnit!=null?"1fr 1fr 1fr":"1fr 1fr",gap:12,marginBottom:12}}>
                  {(u==="m³"||freeRes.volUnit!=null)&&<RItem label={u==="m³"?"Vol. unitaire":"Dim. unitaire"} value={m3f(freeRes.volUnit||0,u)}/>}
                  <RItem label={u==="m²"?"Total m²":u==="mL"?"Total mL":"Vol. charge"} value={m3f(freeRes.volCharge,u)} big/>
                  {u!=="m³"&&freeRes.volReel!=null&&<RItem label="Vol. réel m³" value={m3f(freeRes.volReel)} color="#C4904A"/>}
                  {freeRes.rend!=null&&<RItem label="Rendement" value={pct(freeRes.rend)} color="#6dbf7e"/>}
                  {freeRes.perte!=null&&<RItem label="Perte" value={pct(freeRes.perte)} color="#e07a5f"/>}
                </div>
                {freeRes.rend!=null&&<div style={S.rendBar}><div style={{...S.rendFill,width:pct(freeRes.rend)}}/></div>}
              </div>
            );
          })()}
          {!freeRes&&<div style={S.hint}>Remplis les champs pour calculer</div>}

          <button style={{...S.btnBig,...(!freeOk?S.btnDis:{})}} onClick={addFree} disabled={!freeOk}>
            Cuber et sauvegarder dans l'historique
          </button>

          {/* Historique local récent */}
          {freeHistory.length>0&&<>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.15em",textTransform:"uppercase",color:"#9A7A54",margin:"20px 0 10px",paddingBottom:5,borderBottom:"1px solid rgba(154,122,84,.2)"}}>
              Sessions récentes (local)
            </div>
            {freeHistory.slice(0,5).map(e=>{
              const u=e.unite||"m³";
              return (
                <div key={e.id} style={{...S.card,borderColor:"rgba(154,122,84,.25)",borderLeft:"3px solid rgba(154,122,84,.5)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <div>
                      <span style={{fontWeight:700,color:"#D4A853"}}>{e.produit} · {e.essence}</span>
                      <span style={{marginLeft:6,fontSize:11,color:"#5bb8d4",background:"rgba(91,184,212,.08)",padding:"1px 6px",borderRadius:8}}>{u}</span>
                    </div>
                    <span style={{fontSize:10,color:"#9A7A54",background:"rgba(154,122,84,.1)",padding:"2px 7px",borderRadius:8,border:"1px solid rgba(154,122,84,.2)"}}>Libre</span>
                  </div>
                  <div style={{fontSize:11,color:"#6a5a4a",fontFamily:"monospace",marginBottom:6}}>
                    {e.epaisseur&&`${e.epaisseur}×${e.largeur}mm · `}{e.longueur&&`${e.longueur}m · `}
                    <strong style={{color:"#D4A853"}}>{m3f(e.volCharge||0,u)}</strong>
                    {e.volReel!=null&&<span style={{color:"#C4904A"}}> · réel {m3f(e.volReel)}</span>}
                    {e.rend!=null&&<span style={{color:"#6dbf7e"}}> · {pct(e.rend)}</span>}
                  </div>
                  <div style={{fontSize:10,color:"#5a4a3a"}}>{e.date}</div>
                </div>
              );
            })}
            {freeHistory.length>5&&<div style={{fontSize:11,color:"#6a5a4a",textAlign:"center",marginTop:6}}>+ {freeHistory.length-5} autres · voir l'onglet Historique</div>}
          </>}
        </div>}

        {/* ══ CONFIG ══ */}
        {tab==="config"&&<div style={S.page}>
          <Card title="Apps Script Web App">
            <p style={{fontSize:13,color:"#a09080",lineHeight:1.7,marginBottom:14}}>Colle l'URL de ton Apps Script déployée.</p>
            <Field label="URL Apps Script">
              <Inp value={scriptUrl} onChange={e=>{setScriptUrl(e.target.value);localStorage.setItem(APPS_SCRIPT_URL_KEY,e.target.value);}} ph="https://script.google.com/macros/s/..."/>
            </Field>
            {scriptUrl&&<div style={{fontSize:12,color:"#6dbf7e",marginTop:8}}>✓ URL enregistrée</div>}
          </Card>
          <Card title="Script Apps Script — Version complète">
            <pre style={S.pre}>{`function doGet(e) {
  var ss = SpreadsheetApp.openById("${SHEET_ID}");
  var action = e.parameter.action;

  if(action === "getCommandes") {
    var sheet = ss.getSheetByName("Vendeur");
    if(!sheet||sheet.getLastRow()<2) return json({commandes:[]});
    var rows = sheet.getDataRange().getValues();
    var h = rows[0], map={}, order=[];
    rows.slice(1).forEach(function(r){
      var o={}; h.forEach(function(k,i){o[k]=r[i];});
      var id=String(o["id"]||"").trim();
      if(id){
        map[id]={id,client:o["client"],
          dateLivraison:o["dateLivraison"],notes:o["notes"],
          statut:o["statut"]||"attente",
          dateCreation:o["dateCreation"],lignes:[]};
        order.push(id);
      }
      var cid=id||order[order.length-1];
      if(cid&&map[cid]) map[cid].lignes.push({
        produit:o["produit"],essence:o["essence"],
        qualite:o["qualite"],epaisseur:o["epaisseur"],
        largeur:o["largeur"],longueur:o["longueur"],
        quantite:o["quantite"],prodId:o["prodId"]||"",
        unite:o["unite"]||"m³"
      });
    });
    return json({commandes:order.map(function(id){return map[id];})});
  }

  if(action === "getHistorique") {
    var sheet = ss.getSheetByName("Historique");
    if(!sheet||sheet.getLastRow()<2) return json({historique:[]});
    var data = sheet.getRange(2,1,sheet.getLastRow()-1,1).getValues().flat();
    var historique = data.map(function(cell){
      try{ return JSON.parse(cell); }catch(e){ return null; }
    }).filter(Boolean);
    return json({historique:historique});
  }

  return json({ok:true});
}

function doPost(e) {
  var d=JSON.parse(e.postData.contents);
  var ss=SpreadsheetApp.openById("${SHEET_ID}");

  if(d.type==="commande"){
    var s=ss.getSheetByName("Vendeur")||ss.insertSheet("Vendeur");
    if(s.getLastRow()===0)
      s.appendRow(["id","client","produit","essence","qualite",
        "epaisseur","largeur","longueur","quantite",
        "dateLivraison","notes","statut","dateCreation","prodId","unite"]);
    var ids=s.getLastRow()>1
      ?s.getRange(2,1,s.getLastRow()-1,1).getValues().flat().map(String):[];
    if(ids.indexOf(String(d.id))===-1)
      d.rows.forEach(function(row){s.appendRow(row);});
  }

  if(d.type==="updateStatut"){
    var s=ss.getSheetByName("Vendeur");
    if(s&&s.getLastRow()>1){
      var v=s.getRange(2,1,s.getLastRow()-1,13).getValues();
      var inBlock=false;
      for(var i=0;i<v.length;i++){
        var cid=String(v[i][0]).trim();
        if(cid===String(d.id).trim()){s.getRange(i+2,12).setValue(d.statut);inBlock=true;}
        else if(inBlock&&cid===""){s.getRange(i+2,12).setValue(d.statut);}
        else if(inBlock&&cid!==""){break;}
      }
    }
  }

  if(d.type==="deleteCommande"){
    var s=ss.getSheetByName("Vendeur");
    if(s&&s.getLastRow()>1){
      var v=s.getRange(2,1,s.getLastRow()-1,1).getValues();
      var start=-1,end=-1;
      for(var i=0;i<v.length;i++){
        var c=String(v[i][0]).trim();
        if(c===String(d.id).trim()){start=i+2;end=i+2;}
        else if(start>0&&c===""){end=i+2;}
        else if(start>0&&c!==""){break;}
      }
      if(start>0){for(var r=end;r>=start;r--)s.deleteRow(r);}
    }
  }

  if(d.type==="cubageProduit"){
    var s=ss.getSheetByName("Scieur")||ss.insertSheet("Scieur");
    if(s.getLastRow()===0)
      s.appendRow(["Date","Cmd ID","Prod ID","Produit","Essence",
        "Qualité","Ép.mm","Larg.mm","Long.m","Nb unités",
        "Vol.Grume m³","Vol.Unitaire","Vol.Charge","Rendement","Perte","Unité"]);
    var col3=s.getLastRow()>1
      ?s.getRange(2,3,s.getLastRow()-1,1).getValues().flat().map(String):[];
    if(col3.indexOf(String(d.id))===-1) s.appendRow(d.row);
  }

  if(d.type==="saveHistorique"){
    var s=ss.getSheetByName("Historique")||ss.insertSheet("Historique");
    if(s.getLastRow()===0) s.appendRow(["data_json"]);
    // Anti-doublon sur l'id de commande
    var existing=s.getLastRow()>1
      ?s.getRange(2,1,s.getLastRow()-1,1).getValues().flat():[];
    var alreadyIn=existing.some(function(cell){
      try{return JSON.parse(cell).id===d.entry.id;}catch(e){return false;}
    });
    if(!alreadyIn) s.appendRow([JSON.stringify(d.entry)]);
  }

  return ContentService.createTextOutput(JSON.stringify({ok:true}))
    .setMimeType(ContentService.MimeType.JSON);
}
function json(o){
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}`}</pre>
          </Card>
          <div style={{background:"#1a1510",border:"1px solid rgba(212,168,83,.1)",borderRadius:8,padding:14,fontSize:12,color:"#8a7a68",lineHeight:1.9}}>
            <strong style={{color:"#D4A853",display:"block",marginBottom:6}}>⚠ Nouveau déploiement requis</strong>
            Extensions → Apps Script → remplace tout → <strong style={{color:"#D4A853"}}>Nouveau déploiement</strong> → App Web → Tout le monde → Déployer → copier l'URL.<br/>
            <strong style={{color:"#D4A853",display:"block",margin:"8px 0 4px"}}>Nouvel onglet Sheet :</strong>
            • <strong>Historique</strong> — 1 ligne par commande validée (JSON) · commun à tous les appareils<br/>
            • <strong>Scieur</strong> — ajoute la colonne "Unité" en fin de ligne
          </div>
        </div>}

      </main>

      <nav style={S.nav}>
        {[
          ["commande","✚","Commande"],
          ["arealiser","🪚",`À réaliser${aRealiser.length?` (${aRealiser.length})`:""}`],
          ["historique","📚","Historique"],
          ["libre","📐","Libre"],
          ["config","⚙","Config"],
        ].map(([k,ic,lb])=>(
          <button key={k} style={{...S.navBtn,...(tab===k?S.navBtnActive:{})}} onClick={()=>{setTab(k);if(k==="historique"&&histCmds.length===0)loadHist();}}>
            <span style={S.navIcon}>{ic}</span><span style={S.navLabel}>{lb}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const S={
  root:{minHeight:"100vh",background:"#141210",color:"#e8ddd0",fontFamily:"Georgia,'Times New Roman',serif",display:"flex",flexDirection:"column",maxWidth:480,margin:"0 auto"},
  header:{position:"sticky",top:0,zIndex:20,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 18px",background:"rgba(10,8,6,.97)",borderBottom:"1px solid rgba(212,168,83,.15)",backdropFilter:"blur(8px)"},
  logoText:{fontSize:18,fontWeight:700,letterSpacing:"0.15em",color:"#D4A853"},
  alertBadge:{background:"rgba(212,168,83,.12)",border:"1px solid rgba(212,168,83,.3)",color:"#D4A853",padding:"4px 10px",borderRadius:20,fontSize:11,fontWeight:700},
  toast:{position:"fixed",top:65,left:"50%",transform:"translateX(-50%)",zIndex:200,padding:"10px 20px",borderRadius:20,fontSize:13,fontWeight:600,whiteSpace:"nowrap",boxShadow:"0 4px 20px rgba(0,0,0,.6)"},
  toastOk:{background:"#1a3a22",color:"#6dbf7e",border:"1px solid #2d6640"},
  toastErr:{background:"#3a1a1a",color:"#e07a5f",border:"1px solid #6a2a2a"},
  toastWarn:{background:"#2a2010",color:"#D4A853",border:"1px solid #6a5020"},
  main:{flex:1,overflowY:"auto",paddingBottom:80},
  page:{padding:"14px 14px 8px"},
  card:{background:"rgba(255,255,255,.03)",border:"1px solid rgba(212,168,83,.12)",borderRadius:12,padding:"14px 12px",marginBottom:10},
  cardTitle:{fontSize:10,fontWeight:700,letterSpacing:"0.15em",textTransform:"uppercase",color:"#D4A853",marginBottom:10,opacity:.8},
  label:{fontSize:10,color:"#8a7a68",letterSpacing:"0.08em",textTransform:"uppercase"},
  select:{background:"#1e1a14",border:"1px solid rgba(212,168,83,.2)",borderRadius:8,color:"#e8ddd0",padding:"11px 10px",fontSize:14,width:"100%",outline:"none",fontFamily:"Georgia,serif",appearance:"none"},
  input:{background:"#1e1a14",border:"1px solid rgba(212,168,83,.2)",borderRadius:8,color:"#e8ddd0",padding:"11px 10px",fontSize:14,width:"100%",outline:"none",boxSizing:"border-box",fontFamily:"Georgia,serif"},
  numInput:{MozAppearance:"textfield",WebkitAppearance:"none",appearance:"none"},
  resultBox:{background:"rgba(30,24,16,.9)",border:"1px solid rgba(212,168,83,.3)",borderRadius:12,padding:"14px",marginBottom:12},
  rendBar:{height:6,background:"rgba(255,255,255,.06)",borderRadius:3,overflow:"hidden"},
  rendFill:{height:"100%",background:"linear-gradient(90deg,#8B5E2A,#D4A853)",borderRadius:3,transition:"width .4s"},
  hint:{textAlign:"center",color:"#5a4a3a",fontSize:13,padding:"16px 0"},
  btnBig:{width:"100%",padding:"14px",fontSize:14,fontWeight:700,background:"linear-gradient(135deg,#8B5E2A,#D4A853)",color:"#141210",border:"none",borderRadius:10,cursor:"pointer",letterSpacing:"0.06em",fontFamily:"Georgia,serif",boxShadow:"0 4px 16px rgba(212,168,83,.2)",marginBottom:8,display:"flex",alignItems:"center",justifyContent:"center",gap:8},
  btnDis:{opacity:.3,cursor:"not-allowed"},
  btnSmall:{padding:"8px 14px",fontSize:12,border:"1px solid rgba(212,168,83,.2)",background:"rgba(212,168,83,.06)",color:"#D4A853",borderRadius:7,cursor:"pointer",fontFamily:"Georgia,serif"},
  btnRefresh:{padding:"8px 14px",fontSize:12,background:"rgba(255,255,255,.03)",color:"#8a7a68",border:"1px solid rgba(255,255,255,.06)",borderRadius:7,cursor:"pointer",fontFamily:"Georgia,serif"},
  btnExport:{padding:"9px",fontSize:12,background:"rgba(212,168,83,.06)",color:"#D4A853",border:"1px solid rgba(212,168,83,.25)",borderRadius:7,cursor:"pointer",fontFamily:"Georgia,serif"},
  btnDel:{padding:"9px 12px",fontSize:13,background:"rgba(200,80,60,.05)",color:"#e07a5f",border:"1px solid rgba(200,80,60,.2)",borderRadius:7,cursor:"pointer"},
  nav:{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,zIndex:20,display:"flex",background:"rgba(8,6,4,.98)",borderTop:"1px solid rgba(212,168,83,.15)",backdropFilter:"blur(12px)",paddingBottom:"env(safe-area-inset-bottom,0px)"},
  navBtn:{flex:1,padding:"10px 2px 8px",display:"flex",flexDirection:"column",alignItems:"center",gap:2,background:"transparent",border:"none",color:"#4a3a2a",cursor:"pointer"},
  navBtnActive:{color:"#D4A853"},
  navIcon:{fontSize:16},
  navLabel:{fontSize:8,letterSpacing:"0.04em",textTransform:"uppercase",fontFamily:"Georgia,serif"},
  pre:{background:"#0a0806",border:"1px solid rgba(212,168,83,.12)",borderRadius:6,padding:"10px",fontSize:10,color:"#a09070",overflowX:"auto",lineHeight:1.7,marginTop:8,fontFamily:"monospace",whiteSpace:"pre-wrap",wordBreak:"break-all"},
  spinner:{width:16,height:16,border:"2px solid rgba(0,0,0,.2)",borderTop:"2px solid #141210",borderRadius:"50%",animation:"spin .8s linear infinite"},
};
