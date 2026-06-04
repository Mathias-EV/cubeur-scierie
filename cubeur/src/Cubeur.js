import { useState, useEffect, useCallback, useRef } from "react";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const SHEET_ID = "1vBmNCK0vmQRIHy6S1btXgSWugznmr_L-P3wkH7Xj_w4";
const APPS_SCRIPT_URL_KEY = "cubeur_script_url";
const CODE_VENDEUR = "1234";
const CODE_SCIEUR  = "5678";

// ─── DONNÉES ──────────────────────────────────────────────────────────────────
const PRODUITS = ["Volige","Planche","Liteau","Traverse","Bastaing","Poutre","Poteau","Tasseau","Chevron","Plateau"];
const ESSENCES = ["Sapin","Épicéa","Mélèze","Pin","Chêne","Hêtre","Douglas"];
const QUALITES = ["Choix 1","Choix 2","Choix 3","Rebut","Non trié"];
const initLigne = { produit:"",essence:"",qualite:"",epaisseur:"",largeur:"",longueur:"",quantite:"" };
const initCmd   = { client:"",dateLivraison:"",notes:"",lignes:[{...initLigne}] };
const initCube  = { produit:"",essence:"",epaisseur:"",largeur:"",longueur:"",qualite:"",nbUnites:"",volumeGrume:"" };

// ─── UTILS ───────────────────────────────────────────────────────────────────
const round=(n,d=6)=>Math.round(n*10**d)/10**d;
const pct=(n)=>(n*100).toFixed(1)+" %";
const m3f=(n)=>parseFloat(n).toFixed(4)+" m³";
const genId=()=>"CMD-"+Date.now().toString(36).toUpperCase().slice(-6);
const today=()=>new Date().toISOString().split("T")[0];
const fmtDate=()=>new Date().toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"});

// ID produit stable : CMD-XXXXX-P1, CMD-XXXXX-P2 ...
const prodId=(cmdId,idx)=>`${cmdId}-P${idx+1}`;

function calculLigne(l){
  const ep=parseFloat(l.epaisseur)/1000, la=parseFloat(l.largeur)/1000,
        lo=parseFloat(l.longueur), nb=parseFloat(l.nbUnites), vg=parseFloat(l.volumeGrume);
  if(!ep||!la||!lo||!nb) return null;
  const vu=round(ep*la*lo,6), vc=round(vu*nb,4);
  const rend=vg>0?round(vc/vg,4):null;
  return { volUnit:vu, volCharge:vc, rend, perte:rend!=null?round(1-rend,4):null };
}

function calcul(f){
  const ep=parseFloat(f.epaisseur)/1000, la=parseFloat(f.largeur)/1000,
        lo=parseFloat(f.longueur), nb=parseFloat(f.nbUnites), vg=parseFloat(f.volumeGrume);
  if(!ep||!la||!lo||!nb||!vg||vg===0) return null;
  const vu=round(ep*la*lo,6), vc=round(vu*nb,4), rend=round(vc/vg,4);
  return { volumeUnit:vu, volumeCharge:vc, rendement:rend, perte:round(1-rend,4) };
}

// Envoi au script (mode no-cors — réponse opaque mais la requête passe)
async function callScript(url, body){
  await fetch(url,{method:"POST",mode:"no-cors",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(body)});
  return {ok:true};
}

// ─── UI PRIMITIVES ────────────────────────────────────────────────────────────
function Toast({t}){ if(!t)return null; return <div style={{...S.toast,...(t.type==="error"?S.toastErr:t.type==="warn"?S.toastWarn:S.toastOk)}}>{t.msg}</div>; }
function Field({label,children,style}){ return <div style={{display:"flex",flexDirection:"column",gap:5,...style}}><label style={S.label}>{label}</label>{children}</div>; }
function Row2({children,style}){ return <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,...style}}>{children}</div>; }
function Row3({children}){ return <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>{children}</div>; }
function Sel({value,onChange,opts,ph="— choisir —"}){ return <select style={S.select} value={value} onChange={onChange}><option value="">{ph}</option>{opts.map(o=><option key={o} value={o}>{o}</option>)}</select>; }
function Inp({value,onChange,ph,type="text",min,step,style}){ return <input type={type} style={{...S.input,...style}} value={value} onChange={onChange} placeholder={ph} min={min} step={step}/>; }
function Num({value,onChange,ph,step="any"}){ return <Inp type="number" value={value} onChange={onChange} ph={ph} min="0" step={step}/>; }
function Card({title,children,accent,style}){ return <div style={{...S.card,...(accent?{borderColor:accent}:{}),...(style||{})}}>{title&&<div style={S.cardTitle}>{title}</div>}{children}</div>; }
function Badge({status}){
  const map={attente:["#2a1f0a","#D4A853"],production:["#0a1f2a","#5bb8d4"],valide:["#0a2a15","#6dbf7e"],annule:["#2a0a0a","#e07a5f"]};
  const [bg,fg]=map[status]||map.attente;
  return <span style={{background:bg,color:fg,padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{{attente:"En attente",production:"En production",valide:"✓ Validée",annule:"Annulée"}[status]||status}</span>;
}
function Stat({label,value,color}){ return <div style={{background:"rgba(212,168,83,0.05)",border:"1px solid rgba(212,168,83,0.12)",borderRadius:10,padding:"10px 8px",textAlign:"center"}}><div style={{fontSize:20,fontWeight:700,color:color||"#D4A853"}}>{value}</div><div style={{fontSize:9,color:"#6a5a4a",textTransform:"uppercase",letterSpacing:"0.08em",marginTop:2}}>{label}</div></div>; }
function Empty({icon,text}){ return <div style={{textAlign:"center",padding:"50px 20px",color:"#5a4a3a"}}><div style={{fontSize:36,marginBottom:10}}>{icon}</div><div style={{fontSize:14}}>{text}</div></div>; }
function Spinner(){ return <div style={S.spinner}/>; }

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function Login({onLogin}){
  const [code,setCode]=useState(""); const [err,setErr]=useState(""); const [shake,setShake]=useState(false);
  const go=()=>{
    if(code===CODE_VENDEUR){onLogin("vendeur");return;}
    if(code===CODE_SCIEUR){onLogin("scieur");return;}
    setErr("Code incorrect"); setShake(true); setTimeout(()=>{setShake(false);setErr("");setCode("");},800);
  };
  return (
    <div style={S.loginRoot}><div style={S.loginBg}/>
      <div style={{...S.loginCard,...(shake?S.shake:{})}}>
        <div style={S.loginLogo}><svg width="48" height="48" viewBox="0 0 32 32" fill="none"><rect x="2" y="13" width="28" height="5" rx="1" fill="#D4A853"/><rect x="2" y="7" width="28" height="5" rx="1" fill="#C4904A" opacity="0.7"/><rect x="2" y="20" width="28" height="5" rx="1" fill="#B87D3A" opacity="0.4"/><rect x="6" y="2" width="4" height="28" rx="1" fill="#8B5E2A" opacity="0.35"/><rect x="22" y="2" width="4" height="28" rx="1" fill="#8B5E2A" opacity="0.35"/></svg></div>
        <div style={S.loginTitle}>SCIERIE</div>
        <div style={S.loginSubtitle}>Gestion de commandes</div>
        <div style={S.loginDivider}/>
        <div style={S.loginLabel}>Code d'accès</div>
        <input style={{...S.loginInput,...(err?{borderColor:"#e07a5f"}:{})}} type="password" value={code} onChange={e=>setCode(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()} placeholder="••••" maxLength={8} autoFocus/>
        {err&&<div style={S.loginError}>{err}</div>}
        <button style={S.loginBtn} onClick={go}>Entrer</button>
        <div style={S.loginHint}><span style={{color:"#5a4a3a"}}>Vendeur : </span><span style={{color:"#8a7a68"}}>1234</span>{"  ·  "}<span style={{color:"#5a4a3a"}}>Scieur : </span><span style={{color:"#8a7a68"}}>5678</span></div>
      </div>
    </div>
  );
}

// ─── VENDEUR ──────────────────────────────────────────────────────────────────
function AppVendeur({scriptUrl,onLogout,showToast}){
  const [tab,setTab]=useState("new");
  const [form,setForm]=useState(initCmd);
  const [mes,setMes]=useState(()=>JSON.parse(localStorage.getItem("mes_commandes")||"[]"));
  const [sub,setSub]=useState(false);
  const [confirmDel,setConfirmDel]=useState(null);
  const [deleting,setDeleting]=useState(false);

  const sf=f=>e=>setForm(p=>({...p,[f]:e.target.value}));
  const sl=(i,f)=>e=>setForm(p=>{const ls=[...p.lignes];ls[i]={...ls[i],[f]:e.target.value};return{...p,lignes:ls};});
  const addL=()=>setForm(p=>({...p,lignes:[...p.lignes,{...initLigne}]}));
  const delL=i=>setForm(p=>({...p,lignes:p.lignes.filter((_,j)=>j!==i)}));
  const valid=form.client&&form.dateLivraison&&form.lignes.every(l=>l.produit&&l.essence&&l.quantite);

  const envoyer=async()=>{
    if(!valid||!scriptUrl){if(!scriptUrl)showToast("URL Apps Script manquante","error");return;}
    setSub(true);
    const id=genId(), dc=fmtDate();
    // Chaque produit a son propre ID stable : CMD-XXXXX-P1 ...
    const rows=form.lignes.map((l,i)=>[
      i===0?id:"", form.client,
      l.produit, l.essence, l.qualite,
      l.epaisseur, l.largeur, l.longueur, l.quantite,
      form.dateLivraison, i===0?form.notes:"", "attente", i===0?dc:"",
      prodId(id,i)   // col 14 = ID produit unique
    ]);
    try{
      await callScript(scriptUrl,{type:"commande",rows,id});
      const cmd={...form,id,statut:"attente",dateCreation:dc};
      const saved=[cmd,...JSON.parse(localStorage.getItem("mes_commandes")||"[]")];
      localStorage.setItem("mes_commandes",JSON.stringify(saved));
      setMes(saved); setForm(initCmd); setTab("mes-commandes");
      showToast(`Commande ${id} envoyée ✓`);
    }catch(e){showToast("Erreur d'envoi","error");}
    setSub(false);
  };

  const supprimer=async(id)=>{
    setDeleting(true);
    if(scriptUrl){try{await callScript(scriptUrl,{type:"deleteCommande",id});}catch(e){}}
    const upd=JSON.parse(localStorage.getItem("mes_commandes")||"[]").filter(c=>c.id!==id);
    localStorage.setItem("mes_commandes",JSON.stringify(upd));
    setMes(upd); setConfirmDel(null); setDeleting(false);
    showToast("Commande supprimée");
  };

  const nbAtt=mes.filter(c=>c.statut==="attente").length;
  return (
    <div style={S.root}>
      <header style={{...S.header,background:"linear-gradient(135deg,rgba(10,8,6,.97),rgba(20,15,5,.97))"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}><div style={{width:8,height:8,borderRadius:"50%",background:"#D4A853",boxShadow:"0 0 8px #D4A853"}}/><span style={S.logoText}>VENDEUR</span></div>
        <button style={S.btnLogout} onClick={onLogout}>⇤ Déconnexion</button>
      </header>
      <main style={S.main}>

        {tab==="new"&&<div style={S.page}>
          <Card title="Informations commande">
            <Field label="Client / chantier" style={{marginBottom:12}}><Inp value={form.client} onChange={sf("client")} ph="Ex: Dupont - Chalet Megève"/></Field>
            <Field label="Date de livraison souhaitée"><Inp type="date" value={form.dateLivraison} onChange={sf("dateLivraison")} min={today()}/></Field>
          </Card>
          {form.lignes.map((lg,i)=>(
            <Card key={i} title={`Produit ${form.lignes.length>1?i+1:""}`} accent={i===0?"rgba(212,168,83,.3)":"rgba(212,168,83,.12)"}>
              <Row2 style={{marginBottom:10}}>
                <Field label="Produit"><Sel value={lg.produit} onChange={sl(i,"produit")} opts={PRODUITS}/></Field>
                <Field label="Essence"><Sel value={lg.essence} onChange={sl(i,"essence")} opts={ESSENCES}/></Field>
              </Row2>
              <Field label="Qualité" style={{marginBottom:10}}><Sel value={lg.qualite} onChange={sl(i,"qualite")} opts={QUALITES}/></Field>
              <Row3>
                <Field label="Ép. mm"><Num value={lg.epaisseur} onChange={sl(i,"epaisseur")} ph="27"/></Field>
                <Field label="Larg. mm"><Num value={lg.largeur} onChange={sl(i,"largeur")} ph="120"/></Field>
                <Field label="Long. m"><Num value={lg.longueur} onChange={sl(i,"longueur")} ph="2.4" step="0.1"/></Field>
              </Row3>
              <Field label="Quantité (unités)" style={{marginTop:10}}><Num value={lg.quantite} onChange={sl(i,"quantite")} ph="100" step="1"/></Field>
              {form.lignes.length>1&&<button style={{...S.btnDel,marginTop:10,width:"100%",textAlign:"center"}} onClick={()=>delL(i)}>🗑 Supprimer ce produit</button>}
            </Card>
          ))}
          <button style={{...S.btnBig,background:"rgba(212,168,83,.08)",color:"#D4A853",border:"1px solid rgba(212,168,83,.3)",marginBottom:10}} onClick={addL}>+ Ajouter un produit</button>
          <Card title="Notes"><textarea style={{...S.input,minHeight:60,resize:"vertical"}} value={form.notes} onChange={sf("notes")} placeholder="Instructions particulières..."/></Card>
          <button style={{...S.btnBig,...(!valid||sub?S.btnDis:{})}} onClick={envoyer} disabled={!valid||sub}>{sub?<Spinner/>:"📤 Envoyer la commande"}</button>
        </div>}

        {tab==="mes-commandes"&&<div style={S.page}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
            <Stat label="Total" value={mes.length}/><Stat label="En attente" value={nbAtt} color="#D4A853"/>
          </div>
          {mes.length===0?<Empty icon="📭" text="Aucune commande envoyée"/>:mes.map(c=>(
            <Card key={c.id}>
              {confirmDel===c.id?(
                <div style={{textAlign:"center",padding:"8px 0"}}>
                  <div style={{color:"#e07a5f",fontSize:13,marginBottom:12}}>Supprimer <strong>{c.id}</strong> ?<br/><span style={{fontSize:11,color:"#6a5a4a"}}>Local + Sheet</span></div>
                  <div style={{display:"flex",gap:10,justifyContent:"center"}}>
                    <button style={{...S.btnSmall,color:"#e07a5f",borderColor:"rgba(224,122,95,.4)"}} onClick={()=>supprimer(c.id)} disabled={deleting}>{deleting?<Spinner/>:"Confirmer"}</button>
                    <button style={S.btnSmall} onClick={()=>setConfirmDel(null)}>Annuler</button>
                  </div>
                </div>
              ):(
                <>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                    <div><div style={{fontSize:11,color:"#6a5a4a"}}>{c.id}</div><div style={{fontWeight:700,color:"#e8ddd0",fontSize:15}}>{c.client}</div></div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}><Badge status={c.statut||"attente"}/><button style={{...S.btnDel,padding:"4px 8px",fontSize:12}} onClick={()=>setConfirmDel(c.id)}>🗑</button></div>
                  </div>
                  {(c.lignes||[]).map((l,i)=>(
                    <div key={i} style={{fontSize:12,color:"#a09080",marginBottom:2}}>
                      • <strong style={{color:"#D4A853"}}>{l.produit}</strong>{l.essence?` · ${l.essence}`:""}{l.qualite?` · ${l.qualite}`:""}
                      {l.epaisseur&&<span style={{color:"#6a5a4a",fontFamily:"monospace"}}> — {l.epaisseur}×{l.largeur}mm · {l.longueur}m · {l.quantite}u.</span>}
                    </div>
                  ))}
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"#6a5a4a",marginTop:6}}>
                    <span>Livraison : <strong style={{color:"#c4b09a"}}>{c.dateLivraison}</strong></span>
                    <span>{c.dateCreation}</span>
                  </div>
                </>
              )}
            </Card>
          ))}
        </div>}
      </main>
      <nav style={S.nav}>
        {[["new","✚","Commande"],["mes-commandes","📋",`Mes cmds${nbAtt?` (${nbAtt})`:""}`]].map(([k,ic,lb])=>(
          <button key={k} style={{...S.navBtn,...(tab===k?S.navBtnActive:{})}} onClick={()=>setTab(k)}>
            <span style={S.navIcon}>{ic}</span><span style={S.navLabel}>{lb}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// ─── SCIEUR ───────────────────────────────────────────────────────────────────
function AppScieur({scriptUrl,setScriptUrl,onLogout,showToast}){
  const [tab,setTab]=useState("arealiser");
  const [commandes,setCmd]=useState([]);
  const [loading,setLoading]=useState(false);
  const [expand,setExpand]=useState(null);

  // useRef pour cube : toujours à jour dans les closures async (pas de stale state)
  const cubeRef=useRef({});
  const [,forceRender]=useState(0);
  const cube=cubeRef.current;
  const setCubeState=(updater)=>{
    cubeRef.current=typeof updater==="function"?updater(cubeRef.current):updater;
    forceRender(v=>v+1);
  };

  // Cubage libre
  const [freeForm,setFree]=useState(initCube);
  const [freeHistory,setFreeHist]=useState(()=>JSON.parse(localStorage.getItem("cube_history")||"[]"));
  const [freeExp,setFreeExp]=useState({});
  const [exportedSet]=useState(()=>new Set(JSON.parse(localStorage.getItem("exported_ids")||"[]")));

  // Historique commandes
  const [histCmds,setHistCmds]=useState(()=>JSON.parse(localStorage.getItem("historique_cmds")||"[]"));

  const poll=useRef(null);
  const markExported=id=>{ exportedSet.add(id); localStorage.setItem("exported_ids",JSON.stringify([...exportedSet])); };

  const load=useCallback(async(silent=false)=>{
    if(!scriptUrl)return;
    if(!silent)setLoading(true);
    try{
      const r=await fetch(`${scriptUrl}?action=getCommandes&t=${Date.now()}`);
      const d=await r.json();
      if(d.commandes)setCmd(d.commandes);
    }catch(e){
      const loc=JSON.parse(localStorage.getItem("all_commandes")||"[]");
      if(loc.length)setCmd(loc);
    }
    if(!silent)setLoading(false);
  },[scriptUrl]);

  useEffect(()=>{ load(); poll.current=setInterval(()=>load(true),30000); return()=>clearInterval(poll.current); },[load]);

  // Init état cubage pour une commande — pré-remplit depuis les données de la commande
  const initCubeCmd=(cmd)=>{
    setCubeState(prev=>{
      if(prev[cmd.id])return prev; // déjà init
      const lignesMap={};
      (cmd.lignes||[]).forEach((l,i)=>{
        const pid=prodId(cmd.id,i);
        lignesMap[pid]={
          produit:l.produit, essence:l.essence, qualite:l.qualite||"",
          epaisseur:l.epaisseur||"", largeur:l.largeur||"", longueur:l.longueur||"",
          nbUnites:l.quantite||"", volumeGrume:"",
          volUnit:null, volCharge:null, rend:null, perte:null,
          exporting:false, exported:false,
          idx:i
        };
      });
      return {...prev,[cmd.id]:lignesMap};
    });
  };

  // Mettre à jour un champ d'un produit et recalculer
  const setField=(cmdId,pid,field,value)=>{
    setCubeState(prev=>{
      const cm={...prev[cmdId]};
      const p={...cm[pid],[field]:value};
      // recalcul
      const ep=parseFloat(field==="epaisseur"?value:p.epaisseur)/1000;
      const la=parseFloat(field==="largeur"?value:p.largeur)/1000;
      const lo=parseFloat(field==="longueur"?value:p.longueur);
      const nb=parseFloat(field==="nbUnites"?value:p.nbUnites);
      const vg=parseFloat(field==="volumeGrume"?value:p.volumeGrume);
      if(ep>0&&la>0&&lo>0&&nb>0){
        p.volUnit=round(ep*la*lo,6);
        p.volCharge=round(p.volUnit*nb,4);
        if(vg>0){p.rend=round(p.volCharge/vg,4);p.perte=round(1-p.rend,4);}
        else{p.rend=null;p.perte=null;}
      }else{p.volUnit=null;p.volCharge=null;p.rend=null;p.perte=null;}
      cm[pid]=p;
      return {...prev,[cmdId]:cm};
    });
  };

  const isPret=(p)=>p.nbUnites&&p.epaisseur&&p.largeur&&p.longueur&&p.volumeGrume&&!p.exported&&!p.exporting;

  // ── Valider UN produit ──
  const validerProduit=async(cmd, pid)=>{
    if(!scriptUrl){showToast("URL Apps Script manquante","error");return;}
    const p=cube[cmd.id]?.[pid];
    if(!p||!isPret(p))return;

    // Marquer exporting - écriture directe dans ref
    cubeRef.current={...cubeRef.current,[cmd.id]:{...cubeRef.current[cmd.id],[pid]:{...cubeRef.current[cmd.id]?.[pid],exporting:true}}};
    forceRender(v=>v+1);

    const date=fmtDate();
    const ep=parseFloat(p.epaisseur)/1000, la=parseFloat(p.largeur)/1000,
          lo=parseFloat(p.longueur), nb=parseFloat(p.nbUnites), vg=parseFloat(p.volumeGrume);
    const vu=round(ep*la*lo,6), vc=round(vu*nb,4);
    const rend=vg>0?round(vc/vg,4):0, perte=round(1-rend,4);

    const row=[date, cmd.id, pid, p.produit, p.essence, p.qualite,
               p.epaisseur, p.largeur, p.longueur, nb, vg, vu, vc, rend, perte];

    try{
      await callScript(scriptUrl,{type:"cubageProduit",row,id:pid});

      // Lire cubeRef.current DIRECTEMENT après le await (pas la closure) — toujours frais
      const etatCourant=cubeRef.current[cmd.id]||{};
      const updatedCmd={
        ...etatCourant,
        [pid]:{...etatCourant[pid],exported:true,exporting:false,volUnit:vu,volCharge:vc,rend,perte}
      };
      // tousExportes calculé de façon synchrone sur l'objet construit
      const tousExportes=Object.values(updatedCmd).every(p2=>p2.exported);

      // Écrire dans le ref ET déclencher re-render
      cubeRef.current={...cubeRef.current,[cmd.id]:updatedCmd};
      forceRender(v=>v+1);

      if(tousExportes){
        try{await callScript(scriptUrl,{type:"updateStatut",id:cmd.id,statut:"valide",date});}catch(e){}
        setCmd(c=>c.map(x=>x.id===cmd.id?{...x,statut:"valide"}:x));

        const hEntry={
          id:cmd.id, client:cmd.client,
          dateLivraison:cmd.dateLivraison||cmd.datelivraison,
          dateValidation:date,
          lignes:Object.values(updatedCmd).sort((a,b)=>a.idx-b.idx).map(p2=>({
            produit:p2.produit, essence:p2.essence, qualite:p2.qualite,
            epaisseur:p2.epaisseur, largeur:p2.largeur, longueur:p2.longueur,
            nbUnites:p2.nbUnites, volumeGrume:p2.volumeGrume,
            volUnit:p2.volUnit, volCharge:p2.volCharge, rend:p2.rend, perte:p2.perte
          }))
        };
        const hist=[hEntry,...JSON.parse(localStorage.getItem("historique_cmds")||"[]")];
        localStorage.setItem("historique_cmds",JSON.stringify(hist));
        setHistCmds(hist);
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

  // ── Cubage libre ──
  const sf=f=>e=>setFree(p=>({...p,[f]:e.target.value}));
  const freeRes=calcul(freeForm);
  const freeOk=freeRes&&freeForm.produit&&freeForm.essence&&freeForm.qualite;
  const addFree=()=>{
    if(!freeOk)return;
    const e={...freeForm,...freeRes,id:Date.now(),date:fmtDate()};
    const nh=[e,...freeHistory];
    setFreeHist(nh); localStorage.setItem("cube_history",JSON.stringify(nh));
    showToast("Charge cubée ✓"); setFree(initCube);
  };
  const exportFree=async(e)=>{
    if(!scriptUrl){showToast("URL Apps Script manquante","error");return;}
    if(exportedSet.has(String(e.id))){showToast("Déjà exporté !","warn");return;}
    setFreeExp(x=>({...x,[e.id]:true}));
    const row=[e.date,"","",e.produit,e.essence,e.qualite,
      e.epaisseur,e.largeur,e.longueur,e.nbUnites,
      e.volumeGrume,e.volumeUnit,e.volumeCharge,e.rendement,e.perte];
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

  return (
    <div style={S.root}>
      <header style={{...S.header,background:"linear-gradient(135deg,rgba(6,10,14,.97),rgba(5,15,20,.97))"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}><div style={{width:8,height:8,borderRadius:"50%",background:"#5bb8d4",boxShadow:"0 0 8px #5bb8d4"}}/><span style={{...S.logoText,color:"#5bb8d4"}}>SCIEUR</span></div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          {cmdAtt.length>0&&<div style={S.alertBadge}>{cmdAtt.length} en attente</div>}
          <button style={S.btnLogout} onClick={onLogout}>⇤</button>
        </div>
      </header>
      <main style={S.main}>

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
                {/* Entête */}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
                  <div>
                    <div style={{fontSize:11,color:"#5bb8d4"}}>{cmd.id}</div>
                    <div style={{fontWeight:700,color:"#e8ddd0",fontSize:15}}>{cmd.client}</div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
                    <Badge status={cmd.statut||"attente"}/>
                    {cubeCmd&&<span style={{fontSize:10,color:"#6dbf7e"}}>{nbExp}/{nbTot} validé{nbTot>1?"s":""}</span>}
                  </div>
                </div>
                <div style={{fontSize:12,color:"#6a5a4a",marginBottom:6}}>📅 <strong style={{color:"#c4b09a"}}>{cmd.dateLivraison||cmd.datelivraison}</strong>{cmd.notes&&<span style={{color:"#8a7a68",fontStyle:"italic"}}> · "{cmd.notes}"</span>}</div>

                {/* Résumé produits avec indicateur de statut */}
                <div style={{marginBottom:10}}>
                  {(cmd.lignes||[]).map((l,i)=>{
                    const pid=prodId(cmd.id,i);
                    const exp=cubeCmd?.[pid]?.exported;
                    return (
                      <div key={i} style={{fontSize:12,marginBottom:3,padding:"4px 8px",borderRadius:6,display:"flex",justifyContent:"space-between",alignItems:"center",
                        background:exp?"rgba(109,191,126,.06)":"rgba(255,255,255,.02)",
                        border:`1px solid ${exp?"rgba(109,191,126,.2)":"transparent"}`}}>
                        <span>
                          <span style={{color:exp?"#6dbf7e":"#D4A853",fontWeight:700}}>{exp?"✓ ":""}{l.produit}</span>
                          <span style={{color:"#8a7a68"}}>{l.essence?` · ${l.essence}`:""}</span>
                          {l.epaisseur&&<span style={{color:"#5a4a3a",fontFamily:"monospace"}}> {l.epaisseur}×{l.largeur}mm·{l.longueur}m·{l.quantite}u</span>}
                        </span>
                        <span style={{fontSize:10,color:"#5a4a3a",fontFamily:"monospace"}}>{pid.split("-").slice(-1)[0]}</span>
                      </div>
                    );
                  })}
                </div>

                <button style={{...S.btnSmall,width:"100%",textAlign:"center",
                  background:isOpen?"rgba(91,184,212,.12)":"rgba(212,168,83,.06)",
                  color:isOpen?"#5bb8d4":"#D4A853",
                  borderColor:isOpen?"rgba(91,184,212,.3)":"rgba(212,168,83,.2)"}}
                  onClick={()=>{if(!isOpen){initCubeCmd(cmd);setExpand(cmd.id);}else setExpand(null);}}>
                  {isOpen?"▲ Fermer":"👁 Voir commande"}
                </button>

                {/* ── FORMULAIRE PAR PRODUIT ── */}
                {isOpen&&cubeCmd&&(
                  <div style={{marginTop:14,borderTop:"1px solid rgba(91,184,212,.15)",paddingTop:14}}>
                    {Object.entries(cubeCmd).sort((a,b)=>a[1].idx-b[1].idx).map(([pid,p])=>{
                      const pret=isPret(p);
                      return (
                        <div key={pid} style={{
                          background:p.exported?"rgba(109,191,126,.04)":"rgba(255,255,255,.02)",
                          border:`1px solid ${p.exported?"rgba(109,191,126,.3)":"rgba(212,168,83,.15)"}`,
                          borderRadius:10, padding:"12px", marginBottom:12}}>

                          {/* Titre produit avec son ID */}
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                            <div style={{fontSize:12,fontWeight:700,color:p.exported?"#6dbf7e":"#D4A853",textTransform:"uppercase",letterSpacing:"0.07em"}}>
                              {p.exported?"✓ ":""}{p.produit} · {p.essence}
                              {p.qualite&&<span style={{color:"#6a5a4a",fontWeight:400}}> · {p.qualite}</span>}
                            </div>
                            <span style={{fontSize:10,color:"#5bb8d4",fontFamily:"monospace",background:"rgba(91,184,212,.08)",padding:"2px 6px",borderRadius:4}}>{pid}</span>
                          </div>

                          {p.exported?(
                            // Résumé après validation
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6}}>
                              <Mini label="Grume" value={m3f(parseFloat(p.volumeGrume)||0)} color="#a09080"/>
                              <Mini label="Vol." value={m3f(p.volCharge||0)} color="#D4A853"/>
                              <Mini label="Rend." value={p.rend!=null?pct(p.rend):"—"} color="#6dbf7e"/>
                              <Mini label="Perte" value={p.perte!=null?pct(p.perte):"—"} color="#e07a5f"/>
                            </div>
                          ):(
                            <>
                              <Row3>
                                <Field label="Ép. mm"><Num value={p.epaisseur} onChange={e=>setField(cmd.id,pid,"epaisseur",e.target.value)} ph="27"/></Field>
                                <Field label="Larg. mm"><Num value={p.largeur} onChange={e=>setField(cmd.id,pid,"largeur",e.target.value)} ph="120"/></Field>
                                <Field label="Long. m"><Num value={p.longueur} onChange={e=>setField(cmd.id,pid,"longueur",e.target.value)} ph="2.4" step="0.1"/></Field>
                              </Row3>
                              <Row2 style={{marginTop:10}}>
                                <Field label="Nb unités prod."><Num value={p.nbUnites} onChange={e=>setField(cmd.id,pid,"nbUnites",e.target.value)} ph={p.nbUnites||"200"} step="1"/></Field>
                                <Field label="Vol. grume (m³)"><Num value={p.volumeGrume} onChange={e=>setField(cmd.id,pid,"volumeGrume",e.target.value)} ph="2.5" step="0.01"/></Field>
                              </Row2>
                              {p.volCharge!=null&&(
                                <div style={{marginTop:8,background:"rgba(212,168,83,.04)",borderRadius:8,padding:"8px 10px",display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6}}>
                                  <Mini label="Vol. unit." value={m3f(p.volUnit)} color="#e8ddd0"/>
                                  <Mini label="Vol. charge" value={m3f(p.volCharge)} color="#D4A853"/>
                                  <Mini label="Rendement" value={p.rend!=null?pct(p.rend):"—"} color="#6dbf7e"/>
                                  <Mini label="Perte" value={p.perte!=null?pct(p.perte):"—"} color="#e07a5f"/>
                                </div>
                              )}
                              {p.volCharge!=null&&p.rend!=null&&<div style={{...S.rendBar,marginTop:6}}><div style={{...S.rendFill,width:pct(p.rend)}}/></div>}
                              <button
                                style={{...S.btnBig,...(!pret?S.btnDis:{}),marginTop:10,marginBottom:0,fontSize:13,padding:"11px",
                                  background:pret?"linear-gradient(135deg,#0a1f0a,#6dbf7e)":"rgba(255,255,255,.05)",
                                  color:pret?"#fff":"#4a3a2a",boxShadow:pret?"0 4px 12px rgba(109,191,126,.2)":"none"}}
                                onClick={()=>validerProduit(cmd,pid)} disabled={!pret||p.exporting}>
                                {p.exporting?<Spinner/>:`✓ Valider ${pid}`}
                              </button>
                              {!pret&&<div style={{textAlign:"center",fontSize:10,color:"#6a5a4a",marginTop:2}}>Remplis dimensions + nb unités + vol. grume</div>}
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

        {/* ══ HISTORIQUE ══ */}
        {tab==="historique"&&<div style={S.page}>
          {histCmds.length===0?<Empty icon="📚" text="Aucune commande validée pour l'instant"/>:<>
            <div style={{color:"#8a7a68",fontSize:12,marginBottom:14}}>{histCmds.length} commande{histCmds.length>1?"s":""} réalisée{histCmds.length>1?"s":""}</div>
            {histCmds.map(h=>(
              <div key={h.id} style={{...S.card,borderColor:"rgba(109,191,126,.2)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                  <div><div style={{fontSize:11,color:"#5bb8d4"}}>{h.id}</div><div style={{fontWeight:700,color:"#e8ddd0",fontSize:14}}>{h.client}</div></div>
                  <span style={{fontSize:11,color:"#6dbf7e",background:"rgba(109,191,126,.1)",padding:"3px 8px",borderRadius:12,border:"1px solid rgba(109,191,126,.2)"}}>✓ Réalisée</span>
                </div>
                <div style={{fontSize:12,color:"#6a5a4a",marginBottom:8}}>📅 <strong style={{color:"#c4b09a"}}>{h.dateLivraison}</strong> · Validée {h.dateValidation}</div>
                {(h.lignes||[]).map((l,i)=>(
                  <div key={i} style={{background:"rgba(109,191,126,.03)",border:"1px solid rgba(109,191,126,.1)",borderRadius:7,padding:"8px 10px",marginBottom:6}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#D4A853",marginBottom:4}}>{l.produit} · {l.essence}{l.qualite&&<span style={{color:"#6a5a4a",fontWeight:400}}> · {l.qualite}</span>}</div>
                    <div style={{fontSize:11,color:"#6a5a4a",fontFamily:"monospace",marginBottom:6}}>{l.epaisseur}×{l.largeur}mm · {l.longueur}m · {l.nbUnites}u.</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6}}>
                      <Mini label="Grume" value={m3f(l.volumeGrume||0)} color="#a09080"/>
                      <Mini label="Vol." value={m3f(l.volCharge||0)} color="#D4A853"/>
                      <Mini label="Rend." value={l.rend!=null?pct(l.rend):"—"} color="#6dbf7e"/>
                      <Mini label="Perte" value={l.perte!=null?pct(l.perte):"—"} color="#e07a5f"/>
                    </div>
                  </div>
                ))}
                {h.lignes&&h.lignes.length>1&&<div style={{textAlign:"right",fontSize:12,color:"#D4A853",marginTop:4,fontWeight:700}}>Total : {m3f(h.lignes.reduce((s,l)=>s+(l.volCharge||0),0))}</div>}
              </div>
            ))}
          </>}
        </div>}

        {/* ══ CUBAGE LIBRE ══ */}
        {tab==="cubage"&&<div style={S.page}>
          <div style={{fontSize:12,color:"#6a5a4a",marginBottom:14,textAlign:"center"}}>Cubage hors commande — sciage libre</div>
          <Card title="Produit">
            <Row2 style={{marginBottom:12}}>
              <Field label="Produit"><Sel value={freeForm.produit} onChange={sf("produit")} opts={PRODUITS}/></Field>
              <Field label="Essence"><Sel value={freeForm.essence} onChange={sf("essence")} opts={ESSENCES}/></Field>
            </Row2>
            <Field label="Qualité"><Sel value={freeForm.qualite} onChange={sf("qualite")} opts={QUALITES}/></Field>
          </Card>
          <Card title="Dimensions">
            <Row3>
              <Field label="Ép. (mm)"><Num value={freeForm.epaisseur} onChange={sf("epaisseur")} ph="27"/></Field>
              <Field label="Larg. (mm)"><Num value={freeForm.largeur} onChange={sf("largeur")} ph="120"/></Field>
              <Field label="Long. (m)"><Num value={freeForm.longueur} onChange={sf("longueur")} ph="2.4" step="0.1"/></Field>
            </Row3>
          </Card>
          <Card title="Charge">
            <Row2>
              <Field label="Nb unités"><Num value={freeForm.nbUnites} onChange={sf("nbUnites")} ph="200" step="1"/></Field>
              <Field label="Vol. grume (m³)"><Num value={freeForm.volumeGrume} onChange={sf("volumeGrume")} ph="2.5" step="0.01"/></Field>
            </Row2>
          </Card>
          {freeRes?(
            <div style={S.resultBox}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
                <RItem label="Vol. unitaire" value={m3f(freeRes.volumeUnit)}/>
                <RItem label="Vol. charge" value={m3f(freeRes.volumeCharge)} big/>
                <RItem label="Rendement" value={pct(freeRes.rendement)} color="#6dbf7e"/>
                <RItem label="Perte" value={pct(freeRes.perte)} color="#e07a5f"/>
              </div>
              <div style={S.rendBar}><div style={{...S.rendFill,width:pct(freeRes.rendement)}}/></div>
            </div>
          ):<div style={S.hint}>Remplis les champs pour calculer</div>}
          <button style={{...S.btnBig,...(!freeOk?S.btnDis:{})}} onClick={addFree} disabled={!freeOk}>Cuber et sauvegarder</button>
          {freeHistory.length>0&&<>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.15em",textTransform:"uppercase",color:"#D4A853",margin:"20px 0 10px",paddingBottom:5,borderBottom:"1px solid rgba(212,168,83,.15)"}}>Historique ({freeHistory.length})</div>
            {freeHistory.map(e=>(
              <div key={e.id} style={{...S.card,borderColor:exportedSet.has(String(e.id))?"rgba(109,191,126,.2)":"rgba(212,168,83,.12)"}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                  <span style={{fontWeight:700,color:"#D4A853"}}>{e.produit} · {e.essence}</span>
                  {exportedSet.has(String(e.id))&&<span style={{fontSize:11,color:"#6dbf7e"}}>✓ exporté</span>}
                </div>
                <div style={{fontSize:12,color:"#6a5a4a",fontFamily:"monospace",marginBottom:8}}>{e.epaisseur}×{e.largeur}mm · {e.longueur}m · {e.nbUnites}u · {m3f(e.volumeCharge)}</div>
                <div style={{display:"flex",gap:8}}>
                  {exportedSet.has(String(e.id))?(
                    <div style={{flex:1,textAlign:"center",fontSize:12,color:"#6dbf7e",padding:"8px",border:"1px solid rgba(109,191,126,.15)",borderRadius:7}}>✓ Exporté</div>
                  ):(
                    <button style={{...S.btnExport,flex:1}} onClick={()=>exportFree(e)} disabled={freeExp[e.id]}>{freeExp[e.id]?"…":"↑ Google Sheets"}</button>
                  )}
                  <button style={S.btnDel} onClick={()=>{const nh=freeHistory.filter(x=>x.id!==e.id);setFreeHist(nh);localStorage.setItem("cube_history",JSON.stringify(nh));}}>🗑</button>
                </div>
              </div>
            ))}
          </>}
        </div>}

        {/* ══ CONFIG ══ */}
        {tab==="config"&&<div style={S.page}>
          <Card title="Apps Script Web App">
            <Field label="URL Apps Script">
              <Inp value={scriptUrl} onChange={e=>{setScriptUrl(e.target.value);localStorage.setItem(APPS_SCRIPT_URL_KEY,e.target.value);}} ph="https://script.google.com/macros/s/..."/>
            </Field>
            {scriptUrl&&<div style={{fontSize:12,color:"#6dbf7e",marginTop:8}}>✓ URL enregistrée</div>}
          </Card>
          <Card title="Script Apps Script — À jour">
            <pre style={S.pre}>{`function doGet(e) {
  var ss = SpreadsheetApp.openById("${SHEET_ID}");
  if(e.parameter.action === "getCommandes") {
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
        quantite:o["quantite"],prodId:o["prodId"]||""
      });
    });
    return json({commandes:order.map(function(id){return map[id];})});
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
        "dateLivraison","notes","statut","dateCreation","prodId"]);
    var ids=s.getLastRow()>1
      ?s.getRange(2,1,s.getLastRow()-1,1).getValues().flat().map(String):[];
    if(ids.indexOf(String(d.id))===-1)
      d.rows.forEach(function(row){s.appendRow(row);});
  }

  if(d.type==="updateStatut"){
    var s=ss.getSheetByName("Vendeur");
    if(s&&s.getLastRow()>1){
      var lastRow=s.getLastRow();
      var v=s.getRange(2,1,lastRow-1,13).getValues();
      var inBlock=false;
      for(var i=0;i<v.length;i++){
        var cellId=String(v[i][0]).trim();
        if(cellId===String(d.id).trim()){
          // Première ligne du bloc : mettre à jour statut (col 12) et date (col 13)
          s.getRange(i+2,12).setValue(d.statut);
          inBlock=true;
        } else if(inBlock&&cellId===""){
          // Ligne produit suivante sans ID : mettre à jour aussi le statut
          s.getRange(i+2,12).setValue(d.statut);
        } else if(inBlock&&cellId!==""){
          // Nouvelle commande, arrêter
          break;
        }
      }
    }
  }

  if(d.type==="deleteCommande"){
    var s=ss.getSheetByName("Vendeur");
    if(s&&s.getLastRow()>1){
      var v=s.getRange(2,1,s.getLastRow()-1,1).getValues();
      var start=-1, end=-1;
      for(var i=0;i<v.length;i++){
        var c=String(v[i][0]).trim();
        if(c===String(d.id).trim()){start=i+2;end=i+2;}
        else if(start>0&&c===""){end=i+2;}
        else if(start>0&&c!==""){break;}
      }
      if(start>0){for(var r=end;r>=start;r--)s.deleteRow(r);}
    }
  }

  // cubageProduit : 1 ligne par produit, ID produit en col 3 (anti-doublon)
  if(d.type==="cubageProduit"){
    var s=ss.getSheetByName("Scieur")||ss.insertSheet("Scieur");
    if(s.getLastRow()===0)
      s.appendRow(["Date","Cmd ID","Prod ID","Produit","Essence",
        "Qualité","Ép.mm","Larg.mm","Long.m","Nb unités",
        "Vol.Grume m³","Vol.Unitaire m³","Vol.Charge m³",
        "Rendement","Perte"]);
    // Anti-doublon sur Prod ID (col 3)
    var col3=s.getLastRow()>1
      ?s.getRange(2,3,s.getLastRow()-1,1).getValues().flat().map(String):[];
    if(col3.indexOf(String(d.id))===-1)
      s.appendRow(d.row);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ok:true}))
    .setMimeType(ContentService.MimeType.JSON);
}
function json(o){
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}`}</pre>
          </Card>
          <div style={{background:"#1a1510",border:"1px solid rgba(212,168,83,.1)",borderRadius:8,padding:14,fontSize:12,color:"#8a7a68",lineHeight:1.9}}>
            <strong style={{color:"#e07a5f",display:"block",marginBottom:6}}>⚠ Nouveau déploiement requis</strong>
            Extensions → Apps Script → remplace tout → <strong style={{color:"#D4A853"}}>Nouveau déploiement</strong> → App Web → Tout le monde → Déployer → copier l'URL.<br/>
            <strong style={{color:"#D4A853",display:"block",margin:"8px 0 4px"}}>Colonnes Sheet Scieur :</strong>
            Date · Cmd ID · <strong>Prod ID</strong> · Produit · Essence · Qualité · Ép.mm · Larg.mm · Long.m · Nb unités · Vol.Grume · Vol.Unitaire · Vol.Charge · Rendement · Perte
          </div>
        </div>}

      </main>
      <nav style={S.nav}>
        {[
          ["arealiser","🪚",`À réaliser${aRealiser.length?` (${aRealiser.length})`:""}`],
          ["historique","📚","Historique"],
          ["cubage","📐","Libre"],
          ["config","⚙","Config"],
        ].map(([k,ic,lb])=>(
          <button key={k} style={{...S.navBtn,...(tab===k?{...S.navBtnActive,color:"#5bb8d4"}:{})}} onClick={()=>setTab(k)}>
            <span style={S.navIcon}>{ic}</span><span style={S.navLabel}>{lb}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// ─── MINI STAT INLINE ─────────────────────────────────────────────────────────
function Mini({label,value,color}){
  return <div style={{textAlign:"center"}}>
    <div style={{fontSize:9,color:"#6a5a4a",textTransform:"uppercase",marginBottom:2}}>{label}</div>
    <div style={{fontSize:11,fontWeight:700,color:color||"#e8ddd0"}}>{value}</div>
  </div>;
}
function RItem({label,value,big,color}){
  return <div>
    <div style={{fontSize:10,color:"#6a5a4a",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:3}}>{label}</div>
    <div style={{fontSize:big?18:14,fontWeight:big?700:600,color:color||"#e8ddd0"}}>{value}</div>
  </div>;
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App(){
  const [role,setRole]=useState(()=>sessionStorage.getItem("role")||null);
  const [scriptUrl,setScriptUrl]=useState(()=>localStorage.getItem(APPS_SCRIPT_URL_KEY)||"");
  const [toast,setToast]=useState(null);
  const showToast=(msg,type="success")=>{setToast({msg,type});setTimeout(()=>setToast(null),3500);};
  const login=r=>{setRole(r);sessionStorage.setItem("role",r);};
  const logout=()=>{setRole(null);sessionStorage.removeItem("role");};
  if(!role)return <Login onLogin={login}/>;
  return <>
    <Toast t={toast}/>
    {role==="vendeur"&&<AppVendeur scriptUrl={scriptUrl} onLogout={logout} showToast={showToast}/>}
    {role==="scieur"&&<AppScieur scriptUrl={scriptUrl} setScriptUrl={setScriptUrl} onLogout={logout} showToast={showToast}/>}
  </>;
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const S={
  root:{minHeight:"100vh",background:"#141210",color:"#e8ddd0",fontFamily:"Georgia,'Times New Roman',serif",display:"flex",flexDirection:"column",maxWidth:480,margin:"0 auto"},
  loginRoot:{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#0e0c0a",padding:20},
  loginBg:{position:"fixed",top:0,left:0,right:0,bottom:0,background:"radial-gradient(ellipse at 50% 40%, rgba(212,168,83,.08) 0%, transparent 70%)",pointerEvents:"none"},
  loginCard:{position:"relative",background:"rgba(30,24,16,.95)",border:"1px solid rgba(212,168,83,.25)",borderRadius:16,padding:"36px 28px",width:"100%",maxWidth:360,textAlign:"center",boxShadow:"0 20px 60px rgba(0,0,0,.6)"},
  loginLogo:{marginBottom:16,display:"flex",justifyContent:"center"},
  loginTitle:{fontSize:28,fontWeight:700,letterSpacing:"0.2em",color:"#D4A853",marginBottom:4},
  loginSubtitle:{fontSize:12,color:"#6a5a4a",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:24},
  loginDivider:{height:1,background:"rgba(212,168,83,.15)",margin:"0 0 24px"},
  loginLabel:{fontSize:11,color:"#8a7a68",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8,textAlign:"left"},
  loginInput:{width:"100%",boxSizing:"border-box",background:"#1a1510",border:"1px solid rgba(212,168,83,.2)",borderRadius:8,color:"#e8ddd0",padding:"14px 16px",fontSize:20,textAlign:"center",letterSpacing:"0.3em",outline:"none",fontFamily:"Georgia,serif"},
  loginError:{color:"#e07a5f",fontSize:13,marginTop:8},
  loginBtn:{width:"100%",marginTop:16,padding:"13px",fontSize:14,fontWeight:700,background:"linear-gradient(135deg,#8B5E2A,#D4A853)",color:"#141210",border:"none",borderRadius:8,cursor:"pointer",letterSpacing:"0.08em",fontFamily:"Georgia,serif"},
  loginHint:{marginTop:20,fontSize:11,color:"#4a3a2a"},
  shake:{animation:"shake .4s ease"},
  header:{position:"sticky",top:0,zIndex:20,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 18px",background:"rgba(10,8,6,.97)",borderBottom:"1px solid rgba(212,168,83,.15)",backdropFilter:"blur(8px)"},
  logoText:{fontSize:18,fontWeight:700,letterSpacing:"0.15em",color:"#D4A853"},
  alertBadge:{background:"rgba(212,168,83,.12)",border:"1px solid rgba(212,168,83,.3)",color:"#D4A853",padding:"4px 10px",borderRadius:20,fontSize:11,fontWeight:700},
  btnLogout:{padding:"6px 12px",fontSize:12,background:"rgba(255,255,255,.04)",color:"#6a5a4a",border:"1px solid rgba(255,255,255,.06)",borderRadius:6,cursor:"pointer"},
  toast:{position:"fixed",top:65,left:"50%",transform:"translateX(-50%)",zIndex:200,padding:"10px 20px",borderRadius:20,fontSize:13,fontWeight:600,whiteSpace:"nowrap",boxShadow:"0 4px 20px rgba(0,0,0,.6)"},
  toastOk:{background:"#1a3a22",color:"#6dbf7e",border:"1px solid #2d6640"},
  toastErr:{background:"#3a1a1a",color:"#e07a5f",border:"1px solid #6a2a2a"},
  toastWarn:{background:"#2a2010",color:"#D4A853",border:"1px solid #6a5020"},
  main:{flex:1,overflowY:"auto",paddingBottom:90},
  page:{padding:"14px 14px 8px"},
  card:{background:"rgba(255,255,255,.03)",border:"1px solid rgba(212,168,83,.12)",borderRadius:12,padding:"14px 12px",marginBottom:10},
  cardTitle:{fontSize:10,fontWeight:700,letterSpacing:"0.15em",textTransform:"uppercase",color:"#D4A853",marginBottom:10,opacity:.8},
  label:{fontSize:10,color:"#8a7a68",letterSpacing:"0.08em",textTransform:"uppercase"},
  select:{background:"#1e1a14",border:"1px solid rgba(212,168,83,.2)",borderRadius:8,color:"#e8ddd0",padding:"11px 10px",fontSize:14,width:"100%",outline:"none",fontFamily:"Georgia,serif",appearance:"none"},
  input:{background:"#1e1a14",border:"1px solid rgba(212,168,83,.2)",borderRadius:8,color:"#e8ddd0",padding:"11px 10px",fontSize:14,width:"100%",outline:"none",boxSizing:"border-box",fontFamily:"Georgia,serif"},
  resultBox:{background:"rgba(30,24,16,.9)",border:"1px solid rgba(212,168,83,.3)",borderRadius:12,padding:"14px",marginBottom:12},
  rendBar:{height:6,background:"rgba(255,255,255,.06)",borderRadius:3,overflow:"hidden"},
  rendFill:{height:"100%",background:"linear-gradient(90deg,#8B5E2A,#D4A853)",borderRadius:3,transition:"width .4s"},
  hint:{textAlign:"center",color:"#5a4a3a",fontSize:13,padding:"16px 0"},
  btnBig:{width:"100%",padding:"14px",fontSize:14,fontWeight:700,background:"linear-gradient(135deg,#8B5E2A,#D4A853)",color:"#141210",border:"none",borderRadius:10,cursor:"pointer",letterSpacing:"0.06em",fontFamily:"Georgia,serif",boxShadow:"0 4px 16px rgba(212,168,83,.2)",marginBottom:8,display:"flex",alignItems:"center",justifyContent:"center",gap:8},
  btnDis:{opacity:.3,cursor:"not-allowed"},
  btnSmall:{padding:"8px 14px",fontSize:12,border:"1px solid rgba(212,168,83,.2)",background:"rgba(212,168,83,.06)",color:"#D4A853",borderRadius:7,cursor:"pointer",fontFamily:"Georgia,serif"},
  btnRefresh:{width:"100%",padding:"10px",fontSize:13,background:"rgba(255,255,255,.03)",color:"#8a7a68",border:"1px solid rgba(255,255,255,.06)",borderRadius:8,cursor:"pointer",fontFamily:"Georgia,serif",marginBottom:14},
  btnExport:{padding:"9px",fontSize:12,background:"rgba(212,168,83,.06)",color:"#D4A853",border:"1px solid rgba(212,168,83,.25)",borderRadius:7,cursor:"pointer",fontFamily:"Georgia,serif"},
  btnDel:{padding:"9px 12px",fontSize:13,background:"rgba(200,80,60,.05)",color:"#e07a5f",border:"1px solid rgba(200,80,60,.2)",borderRadius:7,cursor:"pointer"},
  nav:{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,zIndex:20,display:"flex",background:"rgba(8,6,4,.98)",borderTop:"1px solid rgba(212,168,83,.15)",backdropFilter:"blur(12px)",paddingBottom:"env(safe-area-inset-bottom,0px)"},
  navBtn:{flex:1,padding:"12px 4px 10px",display:"flex",flexDirection:"column",alignItems:"center",gap:3,background:"transparent",border:"none",color:"#4a3a2a",cursor:"pointer"},
  navBtnActive:{color:"#D4A853"},
  navIcon:{fontSize:17},
  navLabel:{fontSize:9,letterSpacing:"0.04em",textTransform:"uppercase",fontFamily:"Georgia,serif"},
  pre:{background:"#0a0806",border:"1px solid rgba(212,168,83,.12)",borderRadius:6,padding:"10px",fontSize:10,color:"#a09070",overflowX:"auto",lineHeight:1.7,marginTop:8,fontFamily:"monospace",whiteSpace:"pre-wrap",wordBreak:"break-all"},
  spinner:{width:16,height:16,border:"2px solid rgba(0,0,0,.2)",borderTop:"2px solid #141210",borderRadius:"50%",animation:"spin .8s linear infinite"},
};
