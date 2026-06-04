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

const initCmd  = { client:"",produit:"",essence:"",qualite:"",epaisseur:"",largeur:"",longueur:"",quantite:"",dateLivraison:"",notes:"" };
const initCube = { produit:"",essence:"",epaisseur:"",largeur:"",longueur:"",qualite:"",nbUnites:"",volumeGrume:"" };

// ─── UTILS ───────────────────────────────────────────────────────────────────
function round(n,d=6){ return Math.round(n*10**d)/10**d; }
function calcul(f){
  const ep=parseFloat(f.epaisseur)/1000, la=parseFloat(f.largeur)/1000,
        lo=parseFloat(f.longueur), nb=parseFloat(f.nbUnites), vg=parseFloat(f.volumeGrume);
  if(!ep||!la||!lo||!nb||!vg||vg===0) return null;
  const vu=round(ep*la*lo,6), vc=round(vu*nb,4), rend=round(vc/vg,4);
  return { volumeUnit:vu, volumeCharge:vc, rendement:rend, perte:round(1-rend,4) };
}
function pct(n){ return (n*100).toFixed(1)+" %"; }
function m3f(n){ return parseFloat(n).toFixed(4)+" m³"; }
function genId(){ return "CMD-"+Date.now().toString(36).toUpperCase().slice(-6); }
function today(){ return new Date().toISOString().split("T")[0]; }
function fmtDate(d){ return new Date().toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"}); }

// ─── COMPOSANTS UI ────────────────────────────────────────────────────────────
function Toast({toast}){
  if(!toast) return null;
  return <div style={{...S.toast,...(toast.type==="error"?S.toastErr:toast.type==="warn"?S.toastWarn:S.toastOk)}}>{toast.msg}</div>;
}
function Field({label,children,style}){
  return <div style={{display:"flex",flexDirection:"column",gap:5,...style}}>
    <label style={S.label}>{label}</label>{children}
  </div>;
}
function Row2({children,style}){ return <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,...style}}>{children}</div>; }
function Row3({children}){ return <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>{children}</div>; }
function Sel({value,onChange,opts,ph="— choisir —"}){
  return <select style={S.select} value={value} onChange={onChange}>
    <option value="">{ph}</option>
    {opts.map(o=><option key={o} value={o}>{o}</option>)}
  </select>;
}
function Inp({value,onChange,ph,type="text",min,step,style}){
  return <input type={type} style={{...S.input,...style}} value={value} onChange={onChange} placeholder={ph} min={min} step={step}/>;
}
function Num({value,onChange,ph,step="any"}){ return <Inp type="number" value={value} onChange={onChange} ph={ph} min="0" step={step}/>; }
function Card({title,children,accent}){
  return <div style={{...S.card,...(accent?{borderColor:accent}:{})}}>
    {title&&<div style={S.cardTitle}>{title}</div>}
    {children}
  </div>;
}
function Badge({status}){
  const map={attente:["#2a1f0a","#D4A853"],production:["#0a1f2a","#5bb8d4"],valide:["#0a2a15","#6dbf7e"],annule:["#2a0a0a","#e07a5f"]};
  const [bg,fg]=map[status]||map.attente;
  return <span style={{background:bg,color:fg,padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,letterSpacing:"0.05em",whiteSpace:"nowrap"}}>
    {{attente:"En attente",production:"En production",valide:"✓ Validée",annule:"Annulée"}[status]||status}
  </span>;
}
function Stat({label,value,color}){
  return <div style={{background:"rgba(212,168,83,0.05)",border:"1px solid rgba(212,168,83,0.12)",borderRadius:10,padding:"10px 8px",textAlign:"center"}}>
    <div style={{fontSize:20,fontWeight:700,color:color||"#D4A853"}}>{value}</div>
    <div style={{fontSize:9,color:"#6a5a4a",textTransform:"uppercase",letterSpacing:"0.08em",marginTop:2}}>{label}</div>
  </div>;
}
function Empty({icon,text}){
  return <div style={{textAlign:"center",padding:"50px 20px",color:"#5a4a3a"}}>
    <div style={{fontSize:36,marginBottom:10}}>{icon}</div>
    <div style={{fontSize:14}}>{text}</div>
  </div>;
}
function Spinner(){ return <div style={S.spinner}/>; }

// ─── ÉCRAN D'ACCUEIL ─────────────────────────────────────────────────────────
function Login({onLogin}){
  const [code,setCode]   = useState("");
  const [error,setError] = useState("");
  const [shake,setShake] = useState(false);

  const tryLogin=()=>{
    if(code===CODE_VENDEUR){ onLogin("vendeur"); return; }
    if(code===CODE_SCIEUR){  onLogin("scieur");  return; }
    setError("Code incorrect"); setShake(true);
    setTimeout(()=>{ setShake(false); setError(""); setCode(""); },800);
  };

  return (
    <div style={S.loginRoot}>
      <div style={S.loginBg}/>
      <div style={{...S.loginCard,...(shake?S.shake:{})}}>
        <div style={S.loginLogo}>
          <svg width="48" height="48" viewBox="0 0 32 32" fill="none">
            <rect x="2" y="13" width="28" height="5" rx="1" fill="#D4A853"/>
            <rect x="2" y="7"  width="28" height="5" rx="1" fill="#C4904A" opacity="0.7"/>
            <rect x="2" y="20" width="28" height="5" rx="1" fill="#B87D3A" opacity="0.4"/>
            <rect x="6"  y="2" width="4" height="28" rx="1" fill="#8B5E2A" opacity="0.35"/>
            <rect x="22" y="2" width="4" height="28" rx="1" fill="#8B5E2A" opacity="0.35"/>
          </svg>
        </div>
        <div style={S.loginTitle}>SCIERIE</div>
        <div style={S.loginSubtitle}>Gestion de commandes</div>
        <div style={S.loginDivider}/>
        <div style={S.loginLabel}>Code d'accès</div>
        <input
          style={{...S.loginInput,...(error?{borderColor:"#e07a5f"}:{})}}
          type="password" value={code}
          onChange={e=>setCode(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&tryLogin()}
          placeholder="••••" maxLength={8} autoFocus/>
        {error&&<div style={S.loginError}>{error}</div>}
        <button style={S.loginBtn} onClick={tryLogin}>Entrer</button>
        <div style={S.loginHint}>
          <span style={{color:"#5a4a3a"}}>Vendeur : </span><span style={{color:"#8a7a68"}}>1234</span>
          {"  ·  "}
          <span style={{color:"#5a4a3a"}}>Scieur : </span><span style={{color:"#8a7a68"}}>5678</span>
        </div>
      </div>
    </div>
  );
}

// ─── APP VENDEUR ──────────────────────────────────────────────────────────────
function AppVendeur({scriptUrl,onLogout,showToast}){
  const [tab,setTab]           = useState("new"); // new | mes-commandes
  const [form,setForm]         = useState(initCmd);
  const [mesCommandes,setMes]  = useState([]);
  const [loading,setLoading]   = useState(false);
  const [submitting,setSub]    = useState(false);

  const set=f=>e=>setForm(p=>({...p,[f]:e.target.value}));
  const isValid=form.client&&form.produit&&form.essence&&form.dateLivraison&&form.quantite;

  // Charger mes commandes depuis le Sheet
  const loadCommandes=useCallback(async()=>{
    if(!scriptUrl) return;
    setLoading(true);
    try{
      const r=await fetch(`${scriptUrl}?action=getCommandes`,{method:"GET",mode:"no-cors"});
      // no-cors ne retourne pas de données lisibles — on utilise le stockage local
    }catch(e){}
    // Lire depuis localStorage (commandes créées sur cet appareil)
    const saved=JSON.parse(localStorage.getItem("mes_commandes")||"[]");
    setMes(saved);
    setLoading(false);
  },[scriptUrl]);

  useEffect(()=>{ loadCommandes(); },[loadCommandes]);

  const soumettre=async()=>{
    if(!isValid) return;
    if(!scriptUrl){ showToast("URL Apps Script manquante — contacter le scieur","error"); return; }
    setSub(true);
    const id=genId();
    const row=[id,form.client,form.produit,form.essence,form.qualite,
      form.epaisseur,form.largeur,form.longueur,form.quantite,
      form.dateLivraison,form.notes,"attente",fmtDate()];
    try{
      await fetch(scriptUrl,{method:"POST",mode:"no-cors",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({type:"commande",row,id})});
      // Sauvegarder localement
      const cmd={...form,id,statut:"attente",dateCreation:fmtDate()};
      const saved=JSON.parse(localStorage.getItem("mes_commandes")||"[]");
      saved.unshift(cmd);
      localStorage.setItem("mes_commandes",JSON.stringify(saved));
      setMes(saved);
      setForm(initCmd);
      setTab("mes-commandes");
      showToast(`Commande ${id} envoyée ✓`);
    }catch(e){ showToast("Erreur d'envoi — vérifier la connexion","error"); }
    setSub(false);
  };

  const nbAttente=mesCommandes.filter(c=>c.statut==="attente").length;

  return (
    <div style={S.root}>
      <header style={{...S.header,background:"linear-gradient(135deg,rgba(10,8,6,0.97),rgba(20,15,5,0.97))"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:"#D4A853",boxShadow:"0 0 8px #D4A853"}}/>
          <span style={S.logoText}>VENDEUR</span>
        </div>
        <button style={S.btnLogout} onClick={onLogout}>⇤ Déconnexion</button>
      </header>

      <main style={{...S.main}}>
        {tab==="new"&&(
          <div style={S.page}>
            <Card title="Nouvelle commande">
              <Field label="Nom du client / chantier">
                <Inp value={form.client} onChange={set("client")} ph="Ex: Dupont - Chalet Megève"/>
              </Field>
            </Card>

            <Card title="Produit souhaité">
              <Row2 style={{marginBottom:12}}>
                <Field label="Produit"><Sel value={form.produit} onChange={set("produit")} opts={PRODUITS}/></Field>
                <Field label="Essence"><Sel value={form.essence} onChange={set("essence")} opts={ESSENCES}/></Field>
              </Row2>
              <Field label="Qualité" style={{marginBottom:12}}>
                <Sel value={form.qualite} onChange={set("qualite")} opts={QUALITES}/>
              </Field>
              <Row3>
                <Field label="Ép. (mm)"><Num value={form.epaisseur} onChange={set("epaisseur")} ph="27"/></Field>
                <Field label="Larg. (mm)"><Num value={form.largeur} onChange={set("largeur")} ph="120"/></Field>
                <Field label="Long. (m)"><Num value={form.longueur} onChange={set("longueur")} ph="2.4" step="0.1"/></Field>
              </Row3>
              <Field label="Quantité (unités)" style={{marginTop:12}}>
                <Num value={form.quantite} onChange={set("quantite")} ph="100" step="1"/>
              </Field>
            </Card>

            <Card title="Livraison">
              <Field label="Date souhaitée" style={{marginBottom:12}}>
                <Inp type="date" value={form.dateLivraison} onChange={set("dateLivraison")} min={today()}/>
              </Field>
              <Field label="Notes / remarques">
                <textarea style={{...S.input,minHeight:70,resize:"vertical"}}
                  value={form.notes} onChange={set("notes")} placeholder="Instructions particulières..."/>
              </Field>
            </Card>

            <button style={{...S.btnBig,...(!isValid||submitting?S.btnDis:{})}}
              onClick={soumettre} disabled={!isValid||submitting}>
              {submitting?<Spinner/>:"📤 Envoyer la commande"}
            </button>
          </div>
        )}

        {tab==="mes-commandes"&&(
          <div style={S.page}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
              <Stat label="Total" value={mesCommandes.length}/>
              <Stat label="En attente" value={nbAttente} color="#D4A853"/>
            </div>
            {loading?<Empty icon="⏳" text="Chargement..."/>:
             mesCommandes.length===0?<Empty icon="📭" text="Aucune commande envoyée"/>:
             mesCommandes.map(c=>(
              <Card key={c.id}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                  <div>
                    <div style={{fontSize:11,color:"#6a5a4a",letterSpacing:"0.08em"}}>{c.id}</div>
                    <div style={{fontWeight:700,color:"#e8ddd0",fontSize:15}}>{c.client}</div>
                  </div>
                  <Badge status={c.statut||"attente"}/>
                </div>
                <div style={{fontSize:13,color:"#a09080",marginBottom:4}}>
                  {c.produit}{c.essence?` · ${c.essence}`:""}{c.qualite?` · ${c.qualite}`:""}
                </div>
                {c.epaisseur&&<div style={{fontSize:12,color:"#6a5a4a",fontFamily:"monospace",marginBottom:4}}>
                  {c.epaisseur}×{c.largeur}mm · {c.longueur}m · {c.quantite} u.
                </div>}
                <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"#6a5a4a"}}>
                  <span>Livraison : <strong style={{color:"#c4b09a"}}>{c.dateLivraison}</strong></span>
                  <span>{c.dateCreation}</span>
                </div>
              </Card>
             ))
            }
          </div>
        )}
      </main>

      <nav style={S.nav}>
        {[["new","✚","Commande"],["mes-commandes","📋",`Mes cmds${nbAttente?` (${nbAttente})`:""}`]].map(([k,ic,lb])=>(
          <button key={k} style={{...S.navBtn,...(tab===k?S.navBtnActive:{})}} onClick={()=>setTab(k)}>
            <span style={S.navIcon}>{ic}</span>
            <span style={S.navLabel}>{lb}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// ─── APP SCIEUR ───────────────────────────────────────────────────────────────
function AppScieur({scriptUrl,setScriptUrl,onLogout,showToast}){
  const [tab,setTab]          = useState("commandes");
  const [commandes,setCmd]    = useState([]);
  const [loading,setLoading]  = useState(false);
  const [selected,setSelected]= useState(null);
  const [cubeForm,setCube]    = useState(initCube);
  const [cubeView,setCubeView]= useState("form"); // form | result
  const [cubeResult,setCubeRes]= useState(null);
  const [history,setHistory]  = useState(()=>JSON.parse(localStorage.getItem("cube_history")||"[]"));
  const [exporting,setExp]    = useState({});
  const [exportedIds]         = useState(()=>new Set(JSON.parse(localStorage.getItem("exported_ids")||"[]")));
  const pollingRef            = useRef(null);

  const markExp=(id)=>{
    exportedIds.add(id);
    localStorage.setItem("exported_ids",JSON.stringify([...exportedIds]));
  };

  // Charger commandes depuis Sheet via Apps Script
  const loadCommandes=useCallback(async(silent=false)=>{
    if(!scriptUrl){ return; }
    if(!silent) setLoading(true);
    try{
      // GET request pour lire le sheet
      const url=`${scriptUrl}?action=getCommandes&t=${Date.now()}`;
      const r=await fetch(url);
      const data=await r.json();
      if(data.commandes) setCmd(data.commandes);
    }catch(e){
      // Si CORS bloque, on utilise les données locales comme fallback
      const local=JSON.parse(localStorage.getItem("all_commandes")||"[]");
      if(local.length) setCmd(local);
    }
    if(!silent) setLoading(false);
  },[scriptUrl]);

  useEffect(()=>{
    loadCommandes();
    // Polling toutes les 30s pour multi-utilisateurs
    pollingRef.current=setInterval(()=>loadCommandes(true),30000);
    return ()=>clearInterval(pollingRef.current);
  },[loadCommandes]);

  // Changer statut commande
  const updateStatut=async(id,statut)=>{
    if(!scriptUrl){ showToast("URL Apps Script manquante","error"); return; }
    try{
      await fetch(scriptUrl,{method:"POST",mode:"no-cors",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({type:"updateStatut",id,statut,date:fmtDate()})});
      setCmd(c=>c.map(x=>x.id===id?{...x,statut}:x));
      showToast(statut==="valide"?"Commande validée ✓":"En production");
    }catch(e){ showToast("Erreur réseau","error"); }
  };

  // Cubage
  const setC=f=>e=>setCube(p=>({...p,[f]:e.target.value}));
  const cubeRes=calcul(cubeForm);
  const cubeValid=cubeRes&&cubeForm.produit&&cubeForm.essence&&cubeForm.qualite;

  const addCube=()=>{
    if(!cubeValid) return;
    const entry={...cubeForm,...cubeRes,
      id:Date.now(),cmdId:selected?.id||null,
      date:fmtDate()};
    const nh=[entry,...history];
    setHistory(nh);
    localStorage.setItem("cube_history",JSON.stringify(nh));
    setCubeRes(entry);
    setCubeView("result");
    showToast("Charge cubée ✓");
  };

  const exportCube=async(entry)=>{
    if(!scriptUrl){ showToast("URL Apps Script manquante","error"); return; }
    if(exportedIds.has(String(entry.id))){ showToast("Déjà exporté !","warn"); return; }
    setExp(e=>({...e,[entry.id]:true}));
    const row=[entry.date,entry.cmdId||"",entry.produit,entry.essence,entry.qualite,
      entry.epaisseur,entry.largeur,entry.longueur,entry.nbUnites,
      entry.volumeGrume,entry.volumeUnit,entry.volumeCharge,entry.rendement,entry.perte];
    try{
      await fetch(scriptUrl,{method:"POST",mode:"no-cors",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({type:"cubage",row,id:String(entry.id)})});
      markExp(String(entry.id));
      setHistory(h=>h.map(e=>e.id===entry.id?{...e,exported:true}:e));
      showToast("Exporté vers Google Sheets ✓");
    }catch(e){ showToast("Envoyé (vérifier le Sheet)"); markExp(String(entry.id)); }
    setExp(e=>({...e,[entry.id]:false}));
  };

  const cmdAttente   =commandes.filter(c=>c.statut==="attente");
  const cmdProduction=commandes.filter(c=>c.statut==="production");
  const cmdValidees  =commandes.filter(c=>c.statut==="valide");

  return (
    <div style={S.root}>
      <header style={{...S.header,background:"linear-gradient(135deg,rgba(6,10,14,0.97),rgba(5,15,20,0.97))"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:"#5bb8d4",boxShadow:"0 0 8px #5bb8d4"}}/>
          <span style={{...S.logoText,color:"#5bb8d4"}}>SCIEUR</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          {cmdAttente.length>0&&<div style={{...S.alertBadge}}>{cmdAttente.length} en attente</div>}
          <button style={S.btnLogout} onClick={onLogout}>⇤</button>
        </div>
      </header>

      <main style={S.main}>

        {/* ── COMMANDES ── */}
        {tab==="commandes"&&(
          <div style={S.page}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
              <Stat label="Attente"    value={cmdAttente.length}    color="#D4A853"/>
              <Stat label="Prod."      value={cmdProduction.length} color="#5bb8d4"/>
              <Stat label="Validées"   value={cmdValidees.length}   color="#6dbf7e"/>
            </div>

            <button style={{...S.btnRefresh}} onClick={()=>loadCommandes()}>
              {loading?"⏳ Chargement...":"↻ Actualiser"}
            </button>

            {loading&&commandes.length===0?<Empty icon="⏳" text="Chargement des commandes..."/>:
             commandes.length===0?<Empty icon="📭" text="Aucune commande reçue"/>:<>

              {cmdAttente.length>0&&<SHead title="En attente" color="#D4A853"/>}
              {cmdAttente.map(c=><ScCmd key={c.id} cmd={c} onStatut={updateStatut} onSelect={()=>{setSelected(c);setTab("cubage");setCubeView("form");}}/>)}

              {cmdProduction.length>0&&<SHead title="En production" color="#5bb8d4"/>}
              {cmdProduction.map(c=><ScCmd key={c.id} cmd={c} onStatut={updateStatut} onSelect={()=>{setSelected(c);setTab("cubage");setCubeView("form");}}/>)}

              {cmdValidees.length>0&&<SHead title="Validées" color="#6dbf7e"/>}
              {cmdValidees.map(c=><ScCmd key={c.id} cmd={c} onStatut={updateStatut} onSelect={null}/>)}
            </>}
          </div>
        )}

        {/* ── CUBAGE ── */}
        {tab==="cubage"&&(
          <div style={S.page}>
            {selected&&(
              <div style={{background:"rgba(91,184,212,0.06)",border:"1px solid rgba(91,184,212,0.2)",
                borderRadius:10,padding:"10px 14px",marginBottom:14}}>
                <div style={{fontSize:10,color:"#5bb8d4",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:4}}>Commande liée</div>
                <div style={{fontWeight:700,color:"#e8ddd0"}}>{selected.id} — {selected.client}</div>
                <div style={{fontSize:12,color:"#8a7a68"}}>{selected.produit} · {selected.essence} · {selected.quantite} u.</div>
                <button style={{...S.btnSmall,marginTop:8,color:"#a09080"}} onClick={()=>setSelected(null)}>✕ Détacher</button>
              </div>
            )}

            {cubeView==="form"&&<>
              <Card title="Produit">
                <Row2 style={{marginBottom:12}}>
                  <Field label="Produit"><Sel value={cubeForm.produit} onChange={setC("produit")} opts={PRODUITS}/></Field>
                  <Field label="Essence"><Sel value={cubeForm.essence} onChange={setC("essence")} opts={ESSENCES}/></Field>
                </Row2>
                <Field label="Qualité"><Sel value={cubeForm.qualite} onChange={setC("qualite")} opts={QUALITES}/></Field>
              </Card>
              <Card title="Dimensions">
                <Row3>
                  <Field label="Ép. (mm)"><Num value={cubeForm.epaisseur} onChange={setC("epaisseur")} ph="27"/></Field>
                  <Field label="Larg. (mm)"><Num value={cubeForm.largeur} onChange={setC("largeur")} ph="120"/></Field>
                  <Field label="Long. (m)"><Num value={cubeForm.longueur} onChange={setC("longueur")} ph="2.4" step="0.1"/></Field>
                </Row3>
              </Card>
              <Card title="Charge">
                <Row2>
                  <Field label="Nb unités"><Num value={cubeForm.nbUnites} onChange={setC("nbUnites")} ph="200" step="1"/></Field>
                  <Field label="Vol. grume (m³)"><Num value={cubeForm.volumeGrume} onChange={setC("volumeGrume")} ph="2.5" step="0.01"/></Field>
                </Row2>
              </Card>

              {cubeRes?(
                <div style={{...S.resultBox}}>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
                    <RItem label="Vol. unitaire"  value={m3f(cubeRes.volumeUnit)}/>
                    <RItem label="Vol. charge"    value={m3f(cubeRes.volumeCharge)} big/>
                    <RItem label="Rendement"      value={pct(cubeRes.rendement)} color="#6dbf7e"/>
                    <RItem label="Perte"          value={pct(cubeRes.perte)} color="#e07a5f"/>
                  </div>
                  <div style={S.rendBar}><div style={{...S.rendFill,width:pct(cubeRes.rendement)}}/></div>
                </div>
              ):<div style={S.hint}>Remplis les champs pour calculer</div>}

              <button style={{...S.btnBig,...(!cubeValid?S.btnDis:{})}} onClick={addCube} disabled={!cubeValid}>
                Cuber cette charge
              </button>
            </>}

            {cubeView==="result"&&cubeResult&&(
              <div>
                <div style={{textAlign:"center",padding:"10px 0 20px"}}>
                  <div style={{fontSize:40}}>✅</div>
                  <div style={{fontWeight:700,color:"#D4A853",fontSize:18,marginTop:8}}>Charge cubée</div>
                </div>
                <Card>
                  <RRow label="Produit"      value={`${cubeResult.produit} · ${cubeResult.essence}`}/>
                  <RRow label="Vol. unitaire" value={m3f(cubeResult.volumeUnit)}/>
                  <RRow label="Vol. charge"   value={m3f(cubeResult.volumeCharge)} big/>
                  <RRow label="Rendement"     value={pct(cubeResult.rendement)} color="#6dbf7e"/>
                  <RRow label="Perte"         value={pct(cubeResult.perte)} color="#e07a5f"/>
                </Card>
                <button style={S.btnBig} onClick={()=>exportCube(cubeResult)}>
                  {exportedIds.has(String(cubeResult.id))?"✓ Déjà exporté":"↑ Exporter vers Google Sheets"}
                </button>
                <button style={{...S.btnBig,background:"rgba(212,168,83,0.1)",color:"#D4A853",
                  border:"1px solid rgba(212,168,83,0.3)",marginTop:8}}
                  onClick={()=>{ setCube(initCube); setCubeView("form"); setCubeRes(null); }}>
                  + Nouvelle charge
                </button>
                {selected&&(
                  <button style={{...S.btnBig,background:"linear-gradient(135deg,#0a1f0a,#6dbf7e)",color:"#fff",marginTop:8}}
                    onClick={()=>{ updateStatut(selected.id,"valide"); setSelected(null); setTab("commandes"); }}>
                    ✓ Valider la commande {selected.id}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── HISTORIQUE CUBAGE ── */}
        {tab==="historique"&&(
          <div style={S.page}>
            {history.length===0?<Empty icon="📋" text="Aucun cubage enregistré"/>:<>
              <div style={{color:"#8a7a68",fontSize:12,marginBottom:12}}>
                {history.length} charge{history.length>1?"s":""} ·{" "}
                Total : {m3f(history.reduce((s,e)=>s+e.volumeCharge,0))}
              </div>
              {history.map(e=>(
                <div key={e.id} style={{...S.card,borderColor:exportedIds.has(String(e.id))?"rgba(109,191,126,0.2)":"rgba(212,168,83,0.12)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                    <div>
                      <span style={{fontWeight:700,color:"#D4A853"}}>{e.produit}</span>
                      <span style={{color:"#a09080"}}> · {e.essence}</span>
                    </div>
                    {exportedIds.has(String(e.id))&&<span style={{fontSize:11,color:"#6dbf7e"}}>✓ exporté</span>}
                  </div>
                  {e.cmdId&&<div style={{fontSize:11,color:"#5bb8d4",marginBottom:4}}>→ {e.cmdId}</div>}
                  <div style={{fontSize:12,color:"#6a5a4a",fontFamily:"monospace",marginBottom:8}}>
                    {e.epaisseur}×{e.largeur}mm · {e.longueur}m · {e.nbUnites}u · {m3f(e.volumeCharge)}
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    {exportedIds.has(String(e.id))?(
                      <div style={{flex:1,textAlign:"center",fontSize:12,color:"#6dbf7e",
                        padding:"8px",border:"1px solid rgba(109,191,126,0.15)",borderRadius:7}}>
                        ✓ Exporté
                      </div>
                    ):(
                      <button style={{...S.btnExport,flex:1}} onClick={()=>exportCube(e)} disabled={exporting[e.id]}>
                        {exporting[e.id]?"…":"↑ Google Sheets"}
                      </button>
                    )}
                    <button style={S.btnDel} onClick={()=>{
                      const nh=history.filter(x=>x.id!==e.id);
                      setHistory(nh); localStorage.setItem("cube_history",JSON.stringify(nh));
                    }}>🗑</button>
                  </div>
                </div>
              ))}
            </>}
          </div>
        )}

        {/* ── CONFIG ── */}
        {tab==="config"&&(
          <div style={S.page}>
            <Card title="Apps Script Web App">
              <p style={{fontSize:13,color:"#a09080",lineHeight:1.7,marginBottom:14}}>
                Colle l'URL de ton Apps Script. Elle permet de lire et écrire dans le Google Sheet.
              </p>
              <Field label="URL Apps Script">
                <Inp value={scriptUrl} onChange={e=>{ setScriptUrl(e.target.value); localStorage.setItem(APPS_SCRIPT_URL_KEY,e.target.value); }}
                  ph="https://script.google.com/macros/s/..."/>
              </Field>
              {scriptUrl&&<div style={{fontSize:12,color:"#6dbf7e",marginTop:8}}>✓ URL enregistrée</div>}
            </Card>

            <Card title="Script à coller dans Apps Script">
              <pre style={S.pre}>{`function doGet(e) {
  var action = e.parameter.action;
  var ss = SpreadsheetApp.openById("${SHEET_ID}");
  
  if(action === "getCommandes") {
    var sheet = ss.getSheetByName("Vendeur");
    if(!sheet) return json([]);
    var rows = sheet.getDataRange().getValues();
    var headers = rows[0];
    var commandes = rows.slice(1).map(function(r){
      var obj={};
      headers.forEach(function(h,i){ obj[h.toLowerCase()]=r[i]; });
      return obj;
    });
    return json({commandes: commandes});
  }
  return json({ok:true});
}

function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var ss = SpreadsheetApp.openById("${SHEET_ID}");
  
  if(data.type === "commande") {
    var sheet = ss.getSheetByName("Vendeur") || ss.insertSheet("Vendeur");
    if(sheet.getLastRow()===0){
      sheet.appendRow(["id","client","produit","essence","qualite",
        "epaisseur","largeur","longueur","quantite",
        "dateLivraison","notes","statut","dateCreation"]);
    }
    // Anti-doublon : vérifier si l'ID existe déjà
    var ids = sheet.getRange(2,1,Math.max(sheet.getLastRow()-1,1),1).getValues().flat();
    if(ids.indexOf(data.id) === -1) {
      sheet.appendRow(data.row);
    }
  }
  
  if(data.type === "updateStatut") {
    var sheet = ss.getSheetByName("Vendeur");
    if(sheet) {
      var ids = sheet.getRange(2,1,Math.max(sheet.getLastRow()-1,1),1).getValues().flat();
      var idx = ids.indexOf(data.id);
      if(idx !== -1) sheet.getRange(idx+2, 12).setValue(data.statut);
    }
  }
  
  if(data.type === "cubage") {
    var sheet = ss.getSheetByName("Scieur") || ss.insertSheet("Scieur");
    if(sheet.getLastRow()===0){
      sheet.appendRow(["Date","Cmd ID","Produit","Essence","Qualité",
        "Ép.mm","Larg.mm","Long.m","Nb unités","Vol.Grume m³",
        "Vol.Unitaire m³","Vol.Charge m³","Rendement","Perte"]);
    }
    // Anti-doublon cubage
    var ids = sheet.getRange(2,1,Math.max(sheet.getLastRow()-1,1),1).getValues().flat();
    if(ids.indexOf(data.id) === -1) {
      var row = [data.id].concat(data.row);
      sheet.appendRow(row);
    }
  }
  
  return ContentService
    .createTextOutput(JSON.stringify({ok:true}))
    .setMimeType(ContentService.MimeType.JSON);
}`}</pre>
            </Card>

            <div style={{background:"#1a1510",border:"1px solid rgba(212,168,83,0.1)",
              borderRadius:8,padding:14,fontSize:12,color:"#8a7a68",lineHeight:1.9}}>
              <strong style={{color:"#D4A853",display:"block",marginBottom:6}}>Sheet ID utilisé :</strong>
              <code style={{color:"#c4b09a",fontSize:11,wordBreak:"break-all"}}>{SHEET_ID}</code>
              <strong style={{color:"#D4A853",display:"block",margin:"10px 0 6px"}}>Onglets créés automatiquement :</strong>
              • <strong>Vendeur</strong> — commandes reçues des vendeurs<br/>
              • <strong>Scieur</strong> — cubages exportés<br/>
              <strong style={{color:"#D4A853",display:"block",margin:"10px 0 6px"}}>Anti-doublon :</strong>
              Commandes et cubages : chaque ID est unique dans le Sheet.
            </div>
          </div>
        )}
      </main>

      <nav style={S.nav}>
        {[
          ["commandes","📦",`Commandes${cmdAttente.length?` (${cmdAttente.length})`:""}`],
          ["cubage","📐","Cubage"],
          ["historique","📋","Historique"],
          ["config","⚙","Config"],
        ].map(([k,ic,lb])=>(
          <button key={k} style={{...S.navBtn,...(tab===k?{...S.navBtnActive,color:"#5bb8d4"}:{})}} onClick={()=>setTab(k)}>
            <span style={S.navIcon}>{ic}</span>
            <span style={S.navLabel}>{lb}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// ─── SOUS-COMPOSANTS SCIEUR ───────────────────────────────────────────────────
function ScCmd({cmd,onStatut,onSelect}){
  return (
    <div style={S.card}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
        <div>
          <div style={{fontSize:11,color:"#6a5a4a",letterSpacing:"0.08em"}}>{cmd.id}</div>
          <div style={{fontWeight:700,color:"#e8ddd0",fontSize:15}}>{cmd.client}</div>
        </div>
        <Badge status={cmd.statut||"attente"}/>
      </div>
      <div style={{fontSize:13,color:"#a09080",marginBottom:4}}>
        {cmd.produit}{cmd.essence?` · ${cmd.essence}`:""}{cmd.qualite?` · ${cmd.qualite}`:""}
      </div>
      {cmd.epaisseur&&<div style={{fontSize:12,color:"#6a5a4a",fontFamily:"monospace",marginBottom:6}}>
        {cmd.epaisseur}×{cmd.largeur}mm · {cmd.longueur}m · {cmd.quantite} u.
      </div>}
      <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"#6a5a4a",marginBottom:10}}>
        <span>Livraison : <strong style={{color:"#c4b09a"}}>{cmd.dateLivraison||cmd.datelivraison}</strong></span>
      </div>
      {cmd.notes&&<div style={{fontSize:12,color:"#8a7a68",marginBottom:10,fontStyle:"italic"}}>"{cmd.notes}"</div>}
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {onSelect&&cmd.statut!=="valide"&&(
          <button style={{...S.btnSmall,flex:1,background:"rgba(91,184,212,0.08)",color:"#5bb8d4",border:"1px solid rgba(91,184,212,0.25)"}}
            onClick={onSelect}>📐 Cuber</button>
        )}
        {cmd.statut==="attente"&&(
          <button style={{...S.btnSmall,flex:1,background:"rgba(91,184,212,0.06)",color:"#5bb8d4",border:"1px solid rgba(91,184,212,0.2)"}}
            onClick={()=>onStatut(cmd.id,"production")}>🔨 Lancer</button>
        )}
        {cmd.statut==="production"&&(
          <button style={{...S.btnSmall,flex:1,background:"rgba(109,191,126,0.06)",color:"#6dbf7e",border:"1px solid rgba(109,191,126,0.2)"}}
            onClick={()=>onStatut(cmd.id,"valide")}>✓ Valider</button>
        )}
      </div>
    </div>
  );
}
function SHead({title,color}){
  return <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.15em",textTransform:"uppercase",
    color,marginTop:18,marginBottom:8,paddingBottom:5,borderBottom:`1px solid ${color}30`}}>{title}</div>;
}
function RItem({label,value,big,color}){
  return <div>
    <div style={{fontSize:10,color:"#6a5a4a",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:3}}>{label}</div>
    <div style={{fontSize:big?18:14,fontWeight:big?700:600,color:color||"#e8ddd0",fontVariantNumeric:"tabular-nums"}}>{value}</div>
  </div>;
}
function RRow({label,value,big,color}){
  return <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
    <span style={{fontSize:12,color:"#6a5a4a",textTransform:"uppercase",letterSpacing:"0.06em"}}>{label}</span>
    <span style={{fontSize:big?16:13,fontWeight:big?700:400,color:color||"#c4b09a"}}>{value}</span>
  </div>;
}

// ─── APP ROOT ─────────────────────────────────────────────────────────────────
export default function App(){
  const [role,setRole]         = useState(()=>sessionStorage.getItem("role")||null);
  const [scriptUrl,setScriptUrl]= useState(()=>localStorage.getItem(APPS_SCRIPT_URL_KEY)||"");
  const [toast,setToast]       = useState(null);

  const showToast=(msg,type="success")=>{ setToast({msg,type}); setTimeout(()=>setToast(null),3000); };
  const login=(r)=>{ setRole(r); sessionStorage.setItem("role",r); };
  const logout=()=>{ setRole(null); sessionStorage.removeItem("role"); };

  if(!role) return <Login onLogin={login}/>;

  return (
    <>
      <Toast toast={toast}/>
      {role==="vendeur"&&<AppVendeur scriptUrl={scriptUrl} onLogout={logout} showToast={showToast}/>}
      {role==="scieur" &&<AppScieur  scriptUrl={scriptUrl} setScriptUrl={setScriptUrl} onLogout={logout} showToast={showToast}/>}
    </>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const S={
  root:{minHeight:"100vh",background:"#141210",color:"#e8ddd0",
    fontFamily:"Georgia,'Times New Roman',serif",display:"flex",
    flexDirection:"column",maxWidth:480,margin:"0 auto",position:"relative"},
  bg:{position:"fixed",top:0,left:0,right:0,bottom:0,
    backgroundImage:`repeating-linear-gradient(90deg,transparent,transparent 40px,rgba(212,168,83,0.015) 40px,rgba(212,168,83,0.015) 41px)`,
    pointerEvents:"none",zIndex:0},

  // Login
  loginRoot:{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",
    background:"#0e0c0a",padding:20},
  loginBg:{position:"fixed",top:0,left:0,right:0,bottom:0,
    background:"radial-gradient(ellipse at 50% 40%, rgba(212,168,83,0.08) 0%, transparent 70%)",
    pointerEvents:"none"},
  loginCard:{position:"relative",background:"rgba(30,24,16,0.95)",
    border:"1px solid rgba(212,168,83,0.25)",borderRadius:16,
    padding:"36px 28px",width:"100%",maxWidth:360,textAlign:"center",
    boxShadow:"0 20px 60px rgba(0,0,0,0.6)"},
  loginLogo:{marginBottom:16,display:"flex",justifyContent:"center"},
  loginTitle:{fontSize:28,fontWeight:700,letterSpacing:"0.2em",color:"#D4A853",marginBottom:4},
  loginSubtitle:{fontSize:12,color:"#6a5a4a",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:24},
  loginDivider:{height:1,background:"rgba(212,168,83,0.15)",margin:"0 0 24px"},
  loginLabel:{fontSize:11,color:"#8a7a68",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8,textAlign:"left"},
  loginInput:{width:"100%",boxSizing:"border-box",background:"#1a1510",
    border:"1px solid rgba(212,168,83,0.2)",borderRadius:8,color:"#e8ddd0",
    padding:"14px 16px",fontSize:20,textAlign:"center",letterSpacing:"0.3em",
    outline:"none",fontFamily:"Georgia,serif"},
  loginError:{color:"#e07a5f",fontSize:13,marginTop:8},
  loginBtn:{width:"100%",marginTop:16,padding:"13px",fontSize:14,fontWeight:700,
    background:"linear-gradient(135deg,#8B5E2A,#D4A853)",color:"#141210",
    border:"none",borderRadius:8,cursor:"pointer",letterSpacing:"0.08em",
    fontFamily:"Georgia,serif"},
  loginHint:{marginTop:20,fontSize:11,color:"#4a3a2a"},
  shake:{animation:"shake 0.4s ease"},

  // Layout
  header:{position:"sticky",top:0,zIndex:20,display:"flex",alignItems:"center",
    justifyContent:"space-between",padding:"12px 18px",
    background:"rgba(10,8,6,0.97)",borderBottom:"1px solid rgba(212,168,83,0.15)",
    backdropFilter:"blur(8px)"},
  logoText:{fontSize:18,fontWeight:700,letterSpacing:"0.15em",color:"#D4A853"},
  alertBadge:{background:"rgba(212,168,83,0.12)",border:"1px solid rgba(212,168,83,0.3)",
    color:"#D4A853",padding:"4px 10px",borderRadius:20,fontSize:11,fontWeight:700},
  btnLogout:{padding:"6px 12px",fontSize:12,background:"rgba(255,255,255,0.04)",
    color:"#6a5a4a",border:"1px solid rgba(255,255,255,0.06)",borderRadius:6,cursor:"pointer"},
  toast:{position:"fixed",top:65,left:"50%",transform:"translateX(-50%)",zIndex:200,
    padding:"10px 20px",borderRadius:20,fontSize:13,fontWeight:600,
    whiteSpace:"nowrap",boxShadow:"0 4px 20px rgba(0,0,0,0.6)"},
  toastOk:{background:"#1a3a22",color:"#6dbf7e",border:"1px solid #2d6640"},
  toastErr:{background:"#3a1a1a",color:"#e07a5f",border:"1px solid #6a2a2a"},
  toastWarn:{background:"#2a2010",color:"#D4A853",border:"1px solid #6a5020"},
  main:{position:"relative",zIndex:1,flex:1,overflowY:"auto",paddingBottom:90},
  page:{padding:"14px 14px 8px"},

  // Cards
  card:{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(212,168,83,0.12)",
    borderRadius:12,padding:"14px 12px",marginBottom:10},
  cardTitle:{fontSize:10,fontWeight:700,letterSpacing:"0.15em",textTransform:"uppercase",
    color:"#D4A853",marginBottom:10,opacity:0.8},

  // Form
  label:{fontSize:10,color:"#8a7a68",letterSpacing:"0.08em",textTransform:"uppercase"},
  select:{background:"#1e1a14",border:"1px solid rgba(212,168,83,0.2)",borderRadius:8,
    color:"#e8ddd0",padding:"11px 10px",fontSize:14,width:"100%",outline:"none",
    fontFamily:"Georgia,serif",appearance:"none"},
  input:{background:"#1e1a14",border:"1px solid rgba(212,168,83,0.2)",borderRadius:8,
    color:"#e8ddd0",padding:"11px 10px",fontSize:14,width:"100%",outline:"none",
    boxSizing:"border-box",fontFamily:"Georgia,serif"},

  // Results
  resultBox:{background:"rgba(30,24,16,0.9)",border:"1px solid rgba(212,168,83,0.3)",
    borderRadius:12,padding:"14px",marginBottom:12},
  rendBar:{height:6,background:"rgba(255,255,255,0.06)",borderRadius:3,overflow:"hidden"},
  rendFill:{height:"100%",background:"linear-gradient(90deg,#8B5E2A,#D4A853)",borderRadius:3,transition:"width 0.4s"},
  hint:{textAlign:"center",color:"#5a4a3a",fontSize:13,padding:"16px 0"},

  // Buttons
  btnBig:{width:"100%",padding:"14px",fontSize:14,fontWeight:700,
    background:"linear-gradient(135deg,#8B5E2A,#D4A853)",color:"#141210",
    border:"none",borderRadius:10,cursor:"pointer",letterSpacing:"0.06em",
    fontFamily:"Georgia,serif",boxShadow:"0 4px 16px rgba(212,168,83,0.2)",marginBottom:8,
    display:"flex",alignItems:"center",justifyContent:"center",gap:8},
  btnDis:{opacity:0.3,cursor:"not-allowed"},
  btnSmall:{padding:"8px 14px",fontSize:12,border:"1px solid rgba(212,168,83,0.2)",
    background:"rgba(212,168,83,0.06)",color:"#D4A853",borderRadius:7,
    cursor:"pointer",fontFamily:"Georgia,serif"},
  btnRefresh:{width:"100%",padding:"10px",fontSize:13,background:"rgba(255,255,255,0.03)",
    color:"#8a7a68",border:"1px solid rgba(255,255,255,0.06)",borderRadius:8,
    cursor:"pointer",fontFamily:"Georgia,serif",marginBottom:14},
  btnExport:{padding:"9px",fontSize:12,background:"rgba(212,168,83,0.06)",color:"#D4A853",
    border:"1px solid rgba(212,168,83,0.25)",borderRadius:7,cursor:"pointer",fontFamily:"Georgia,serif"},
  btnDel:{padding:"9px 12px",fontSize:13,background:"rgba(200,80,60,0.05)",
    color:"#e07a5f",border:"1px solid rgba(200,80,60,0.2)",borderRadius:7,cursor:"pointer"},

  // Nav
  nav:{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",
    maxWidth:480,zIndex:20,display:"flex",background:"rgba(8,6,4,0.98)",
    borderTop:"1px solid rgba(212,168,83,0.15)",backdropFilter:"blur(12px)",
    paddingBottom:"env(safe-area-inset-bottom,0px)"},
  navBtn:{flex:1,padding:"12px 4px 10px",display:"flex",flexDirection:"column",
    alignItems:"center",gap:3,background:"transparent",border:"none",
    color:"#4a3a2a",cursor:"pointer"},
  navBtnActive:{color:"#D4A853"},
  navIcon:{fontSize:17},
  navLabel:{fontSize:9,letterSpacing:"0.04em",textTransform:"uppercase",fontFamily:"Georgia,serif"},

  // Misc
  pre:{background:"#0a0806",border:"1px solid rgba(212,168,83,0.12)",borderRadius:6,
    padding:"10px",fontSize:10,color:"#a09070",overflowX:"auto",lineHeight:1.7,
    marginTop:8,fontFamily:"monospace",whiteSpace:"pre-wrap",wordBreak:"break-all"},
  spinner:{width:16,height:16,border:"2px solid rgba(0,0,0,0.2)",
    borderTop:"2px solid #141210",borderRadius:"50%",animation:"spin 0.8s linear infinite"},
};
