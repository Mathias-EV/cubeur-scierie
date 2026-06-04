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
function fmtDate(){ return new Date().toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"}); }

// ─── APPEL API SCRIPT (avec gestion CORS propre) ──────────────────────────────
async function callScript(url, body){
  // On tente d'abord avec credentials omit pour éviter les preflight CORS
  try {
    const r = await fetch(url, {
      method:"POST",
      mode:"no-cors",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify(body)
    });
    return { ok: true };
  } catch(e) {
    throw e;
  }
}

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
function Card({title,children,accent,style}){
  return <div style={{...S.card,...(accent?{borderColor:accent}:{}),...(style||{})}}>
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
  const [code,setCode]=useState(""); const [error,setError]=useState(""); const [shake,setShake]=useState(false);
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
        <input style={{...S.loginInput,...(error?{borderColor:"#e07a5f"}:{})}}
          type="password" value={code} onChange={e=>setCode(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&tryLogin()} placeholder="••••" maxLength={8} autoFocus/>
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
  const [tab,setTab]=useState("new");
  const [form,setForm]=useState(initCmd);
  const [mesCommandes,setMes]=useState([]);
  const [submitting,setSub]=useState(false);
  const [confirmDel,setConfirmDel]=useState(null);
  const [deleting,setDeleting]=useState(false);

  const setField=f=>e=>setForm(p=>({...p,[f]:e.target.value}));
  const setLigne=(idx,field)=>e=>{
    setForm(p=>{ const ls=[...p.lignes]; ls[idx]={...ls[idx],[field]:e.target.value}; return {...p,lignes:ls}; });
  };
  const addLigne=()=>setForm(p=>({...p,lignes:[...p.lignes,{...initLigne}]}));
  const removeLigne=idx=>setForm(p=>({...p,lignes:p.lignes.filter((_,i)=>i!==idx)}));
  const isValid=form.client&&form.dateLivraison&&form.lignes.length>0&&form.lignes.every(l=>l.produit&&l.essence&&l.quantite);

  useEffect(()=>{ setMes(JSON.parse(localStorage.getItem("mes_commandes")||"[]")); },[]);

  const soumettre=async()=>{
    if(!isValid||!scriptUrl){ if(!scriptUrl) showToast("URL Apps Script manquante","error"); return; }
    setSub(true);
    const id=genId(), dateCreation=fmtDate();
    const rows=form.lignes.map((l,i)=>[
      i===0?id:"", form.client, l.produit,l.essence,l.qualite,
      l.epaisseur,l.largeur,l.longueur,l.quantite,
      form.dateLivraison, i===0?form.notes:"", "attente", i===0?dateCreation:""
    ]);
    try{
      await callScript(scriptUrl,{type:"commande",rows,id});
      const cmd={...form,id,statut:"attente",dateCreation};
      const saved=JSON.parse(localStorage.getItem("mes_commandes")||"[]");
      saved.unshift(cmd); localStorage.setItem("mes_commandes",JSON.stringify(saved));
      setMes(saved); setForm(initCmd); setTab("mes-commandes");
      showToast(`Commande ${id} envoyée ✓`);
    }catch(e){ showToast("Erreur d'envoi","error"); }
    setSub(false);
  };

  const supprimerCommande=async(id)=>{
    setDeleting(true);
    if(scriptUrl){
      try{ await callScript(scriptUrl,{type:"deleteCommande",id}); }catch(e){}
    }
    const saved=JSON.parse(localStorage.getItem("mes_commandes")||"[]");
    const updated=saved.filter(c=>c.id!==id);
    localStorage.setItem("mes_commandes",JSON.stringify(updated));
    setMes(updated); setConfirmDel(null); setDeleting(false);
    showToast("Commande supprimée");
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
      <main style={S.main}>

        {/* ── NOUVELLE COMMANDE ── */}
        {tab==="new"&&(
          <div style={S.page}>
            <Card title="Informations commande">
              <Field label="Nom du client / chantier" style={{marginBottom:12}}>
                <Inp value={form.client} onChange={setField("client")} ph="Ex: Dupont - Chalet Megève"/>
              </Field>
              <Field label="Date de livraison souhaitée">
                <Inp type="date" value={form.dateLivraison} onChange={setField("dateLivraison")} min={today()}/>
              </Field>
            </Card>
            {form.lignes.map((lg,idx)=>(
              <Card key={idx} title={`Produit ${form.lignes.length>1?idx+1:""}`}
                accent={idx===0?"rgba(212,168,83,0.3)":"rgba(212,168,83,0.12)"}>
                <Row2 style={{marginBottom:10}}>
                  <Field label="Produit"><Sel value={lg.produit} onChange={setLigne(idx,"produit")} opts={PRODUITS}/></Field>
                  <Field label="Essence"><Sel value={lg.essence} onChange={setLigne(idx,"essence")} opts={ESSENCES}/></Field>
                </Row2>
                <Field label="Qualité" style={{marginBottom:10}}>
                  <Sel value={lg.qualite} onChange={setLigne(idx,"qualite")} opts={QUALITES}/>
                </Field>
                <Row3>
                  <Field label="Ép. mm"><Num value={lg.epaisseur} onChange={setLigne(idx,"epaisseur")} ph="27"/></Field>
                  <Field label="Larg. mm"><Num value={lg.largeur} onChange={setLigne(idx,"largeur")} ph="120"/></Field>
                  <Field label="Long. m"><Num value={lg.longueur} onChange={setLigne(idx,"longueur")} ph="2.4" step="0.1"/></Field>
                </Row3>
                <Field label="Quantité (unités)" style={{marginTop:10}}>
                  <Num value={lg.quantite} onChange={setLigne(idx,"quantite")} ph="100" step="1"/>
                </Field>
                {form.lignes.length>1&&(
                  <button style={{...S.btnDel,marginTop:10,width:"100%",textAlign:"center"}}
                    onClick={()=>removeLigne(idx)}>🗑 Supprimer ce produit</button>
                )}
              </Card>
            ))}
            <button style={{...S.btnBig,background:"rgba(212,168,83,0.08)",color:"#D4A853",
              border:"1px solid rgba(212,168,83,0.3)",marginBottom:10}} onClick={addLigne}>
              + Ajouter un produit
            </button>
            <Card title="Notes">
              <textarea style={{...S.input,minHeight:60,resize:"vertical"}}
                value={form.notes} onChange={setField("notes")} placeholder="Instructions particulières..."/>
            </Card>
            <button style={{...S.btnBig,...(!isValid||submitting?S.btnDis:{})}}
              onClick={soumettre} disabled={!isValid||submitting}>
              {submitting?<Spinner/>:"📤 Envoyer la commande"}
            </button>
          </div>
        )}

        {/* ── MES COMMANDES ── */}
        {tab==="mes-commandes"&&(
          <div style={S.page}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
              <Stat label="Total" value={mesCommandes.length}/>
              <Stat label="En attente" value={nbAttente} color="#D4A853"/>
            </div>
            {mesCommandes.length===0?<Empty icon="📭" text="Aucune commande envoyée"/>:
             mesCommandes.map(c=>(
              <Card key={c.id}>
                {confirmDel===c.id?(
                  <div style={{textAlign:"center",padding:"8px 0"}}>
                    <div style={{color:"#e07a5f",fontSize:13,marginBottom:12}}>
                      Supprimer <strong>{c.id}</strong> ?<br/>
                      <span style={{fontSize:11,color:"#6a5a4a"}}>Suppression locale + dans le Sheet</span>
                    </div>
                    <div style={{display:"flex",gap:10,justifyContent:"center"}}>
                      <button style={{...S.btnSmall,color:"#e07a5f",borderColor:"rgba(224,122,95,0.4)"}}
                        onClick={()=>supprimerCommande(c.id)} disabled={deleting}>
                        {deleting?<Spinner/>:"Confirmer"}
                      </button>
                      <button style={S.btnSmall} onClick={()=>setConfirmDel(null)}>Annuler</button>
                    </div>
                  </div>
                ):(
                  <>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                      <div>
                        <div style={{fontSize:11,color:"#6a5a4a",letterSpacing:"0.08em"}}>{c.id}</div>
                        <div style={{fontWeight:700,color:"#e8ddd0",fontSize:15}}>{c.client}</div>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <Badge status={c.statut||"attente"}/>
                        <button style={{...S.btnDel,padding:"4px 8px",fontSize:12}} onClick={()=>setConfirmDel(c.id)}>🗑</button>
                      </div>
                    </div>
                    {c.lignes&&c.lignes.length>0?(
                      <div style={{marginBottom:8}}>
                        {c.lignes.map((l,i)=>(
                          <div key={i} style={{fontSize:12,color:"#a09080",marginBottom:2}}>
                            • {l.produit}{l.essence?` · ${l.essence}`:""}{l.qualite?` · ${l.qualite}`:""}
                            {l.epaisseur&&<span style={{color:"#6a5a4a",fontFamily:"monospace"}}> — {l.epaisseur}×{l.largeur}mm · {l.longueur}m · {l.quantite} u.</span>}
                          </div>
                        ))}
                      </div>
                    ):(
                      <div style={{fontSize:13,color:"#a09080",marginBottom:4}}>{c.produit}{c.essence?` · ${c.essence}`:""}</div>
                    )}
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"#6a5a4a"}}>
                      <span>Livraison : <strong style={{color:"#c4b09a"}}>{c.dateLivraison}</strong></span>
                      <span>{c.dateCreation}</span>
                    </div>
                  </>
                )}
              </Card>
             ))}
          </div>
        )}
      </main>
      <nav style={S.nav}>
        {[["new","✚","Commande"],["mes-commandes","📋",`Mes cmds${nbAttente?` (${nbAttente})`:""}`]].map(([k,ic,lb])=>(
          <button key={k} style={{...S.navBtn,...(tab===k?S.navBtnActive:{})}} onClick={()=>setTab(k)}>
            <span style={S.navIcon}>{ic}</span><span style={S.navLabel}>{lb}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// ─── APP SCIEUR ───────────────────────────────────────────────────────────────
function AppScieur({scriptUrl,setScriptUrl,onLogout,showToast}){
  const [tab,setTab]       = useState("arealiser");
  const [commandes,setCmd] = useState([]);
  const [loading,setLoading]= useState(false);
  const [expandCmd,setExpand]= useState(null);

  // realiser[cmdId] = { lignes:[{...ligneData, nbUnites, volumeGrume, volUnit, volCharge, rend, perte, exporting, exported}] }
  const [realiser,setRealiser] = useState({});

  // Cubage libre
  const [cubeForm,setCube] = useState(initCube);
  const [history,setHistory]= useState(()=>JSON.parse(localStorage.getItem("cube_history")||"[]"));
  const [exporting,setExp] = useState({});
  const [exportedIds]      = useState(()=>new Set(JSON.parse(localStorage.getItem("exported_ids")||"[]")));

  // Historique commandes réalisées (local)
  const [historiqueCmds,setHistCmds] = useState(()=>JSON.parse(localStorage.getItem("historique_cmds")||"[]"));

  const pollingRef = useRef(null);
  const markExp=(id)=>{ exportedIds.add(id); localStorage.setItem("exported_ids",JSON.stringify([...exportedIds])); };

  // ── Charger commandes depuis Sheet ──
  const loadCommandes=useCallback(async(silent=false)=>{
    if(!scriptUrl) return;
    if(!silent) setLoading(true);
    try{
      const r=await fetch(`${scriptUrl}?action=getCommandes&t=${Date.now()}`);
      const data=await r.json();
      if(data.commandes) setCmd(data.commandes);
    }catch(e){
      const local=JSON.parse(localStorage.getItem("all_commandes")||"[]");
      if(local.length) setCmd(local);
    }
    if(!silent) setLoading(false);
  },[scriptUrl]);

  useEffect(()=>{
    loadCommandes();
    pollingRef.current=setInterval(()=>loadCommandes(true),30000);
    return ()=>clearInterval(pollingRef.current);
  },[loadCommandes]);

  // ── Initialiser cubage d'une commande ──
  const initRealiser=(cmd)=>{
    if(realiser[cmd.id]) return;
    const lignes=(cmd.lignes||[]).map(l=>({
      ...l,
      nbUnites: l.quantite||"",
      volumeGrume: "",
      volUnit: null, volCharge: null, rend: null, perte: null,
      exporting: false, exported: false
    }));
    setRealiser(r=>({...r,[cmd.id]:{lignes}}));
  };

  // ── Mettre à jour une ligne ──
  const setLigneVal=(cmdId,idx,field,value)=>{
    setRealiser(r=>{
      const ls=[...r[cmdId].lignes];
      const l={...ls[idx],[field]:value};
      // recalcul auto
      const ep=parseFloat(field==="epaisseur"?value:l.epaisseur)/1000;
      const la=parseFloat(field==="largeur"?value:l.largeur)/1000;
      const lo=parseFloat(field==="longueur"?value:l.longueur);
      const nb=parseFloat(field==="nbUnites"?value:l.nbUnites);
      const vg=parseFloat(field==="volumeGrume"?value:l.volumeGrume);
      if(ep>0&&la>0&&lo>0&&nb>0){
        l.volUnit=round(ep*la*lo,6);
        l.volCharge=round(ep*la*lo*nb,4);
        if(vg>0){ l.rend=round(l.volCharge/vg,4); l.perte=round(1-l.rend,4); }
        else { l.rend=null; l.perte=null; }
      }
      ls[idx]=l;
      return {...r,[cmdId]:{...r[cmdId],lignes:ls}};
    });
  };

  const lignePrete=(l)=> l.nbUnites && l.epaisseur && l.largeur && l.longueur && l.volumeGrume && !l.exported;

  // ── Valider UN produit ──
  const validerLigne=async(cmd, idx)=>{
    const st=realiser[cmd.id];
    if(!st||!scriptUrl){ showToast("URL Apps Script manquante","error"); return; }
    const l=st.lignes[idx];
    if(!lignePrete(l)) return;

    // Marquer exporting
    setRealiser(r=>{ const ls=[...r[cmd.id].lignes]; ls[idx]={...ls[idx],exporting:true}; return {...r,[cmd.id]:{...r[cmd.id],lignes:ls}}; });

    const date=fmtDate();
    const ep=parseFloat(l.epaisseur)/1000, la=parseFloat(l.largeur)/1000,
          lo=parseFloat(l.longueur), nb=parseFloat(l.nbUnites), vg=parseFloat(l.volumeGrume);
    const vu=round(ep*la*lo,6), vc=round(ep*la*lo*nb,4);
    const rend=vg>0?round(vc/vg,4):0, perte=round(1-rend,4);

    const row=[date, cmd.id, l.produit, l.essence, l.qualite||"",
      l.epaisseur, l.largeur, l.longueur, nb, vg, vu, vc, rend, perte];
    const ligneId=`${cmd.id}-${idx}-${Date.now()}`;

    try{
      await callScript(scriptUrl,{type:"cubage",row,id:ligneId});
      // Vérifier si toutes les lignes sont exportées après celle-ci
      const lignesAjour=[...st.lignes];
      lignesAjour[idx]={...lignesAjour[idx],exported:true,exporting:false,volUnit:vu,volCharge:vc,rend,perte};
      const toutesValidees=lignesAjour.every(l2=>l2.exported);

      if(toutesValidees){
        // Mettre statut commande → valide dans Sheet
        try{ await callScript(scriptUrl,{type:"updateStatut",id:cmd.id,statut:"valide",date}); }catch(e){}
        setCmd(c=>c.map(x=>x.id===cmd.id?{...x,statut:"valide"}:x));
        // Sauvegarder dans historique local
        const hEntry={
          id:cmd.id, client:cmd.client, dateLivraison:cmd.dateLivraison||cmd.datelivraison,
          dateValidation:date,
          lignes:lignesAjour.map(l2=>({
            produit:l2.produit,essence:l2.essence,qualite:l2.qualite,
            epaisseur:l2.epaisseur,largeur:l2.largeur,longueur:l2.longueur,
            nbUnites:l2.nbUnites,volumeGrume:l2.volumeGrume,
            volUnit:l2.volUnit,volCharge:l2.volCharge,rend:l2.rend,perte:l2.perte
          }))
        };
        const hist=[hEntry,...JSON.parse(localStorage.getItem("historique_cmds")||"[]")];
        localStorage.setItem("historique_cmds",JSON.stringify(hist));
        setHistCmds(hist);
        showToast(`✓ Commande ${cmd.id} entièrement validée !`);
        setExpand(null);
      } else {
        setRealiser(r=>{ const ls=[...r[cmd.id].lignes]; ls[idx]={...ls[idx],exported:true,exporting:false,volUnit:vu,volCharge:vc,rend,perte}; return {...r,[cmd.id]:{...r[cmd.id],lignes:ls}}; });
        showToast(`Produit ${idx+1} exporté ✓`);
      }
    }catch(e){
      setRealiser(r=>{ const ls=[...r[cmd.id].lignes]; ls[idx]={...ls[idx],exporting:false}; return {...r,[cmd.id]:{...r[cmd.id],lignes:ls}}; });
      showToast("Erreur réseau — réessaie","error");
    }
  };

  // ── Cubage libre ──
  const setC=f=>e=>setCube(p=>({...p,[f]:e.target.value}));
  const cubeRes=calcul(cubeForm);
  const cubeValid=cubeRes&&cubeForm.produit&&cubeForm.essence&&cubeForm.qualite;
  const addCube=()=>{
    if(!cubeValid) return;
    const entry={...cubeForm,...cubeRes,id:Date.now(),cmdId:null,date:fmtDate()};
    const nh=[entry,...history];
    setHistory(nh); localStorage.setItem("cube_history",JSON.stringify(nh));
    showToast("Charge cubée ✓"); setCube(initCube);
  };
  const exportCube=async(entry)=>{
    if(!scriptUrl){ showToast("URL Apps Script manquante","error"); return; }
    if(exportedIds.has(String(entry.id))){ showToast("Déjà exporté !","warn"); return; }
    setExp(e=>({...e,[entry.id]:true}));
    const row=[entry.date,"",entry.produit,entry.essence,entry.qualite,
      entry.epaisseur,entry.largeur,entry.longueur,entry.nbUnites,
      entry.volumeGrume,entry.volumeUnit,entry.volumeCharge,entry.rendement,entry.perte];
    try{
      await callScript(scriptUrl,{type:"cubage",row,id:String(entry.id)});
      markExp(String(entry.id));
      setHistory(h=>h.map(e=>e.id===entry.id?{...e,exported:true}:e));
      showToast("Exporté vers Google Sheets ✓");
    }catch(e){ showToast("Envoyé (vérifier le Sheet)"); markExp(String(entry.id)); }
    setExp(e=>({...e,[entry.id]:false}));
  };

  const cmdAttente   =commandes.filter(c=>["attente","En attente"].includes(c.statut));
  const cmdProduction=commandes.filter(c=>["production","En production"].includes(c.statut));
  const cmdValidees  =commandes.filter(c=>["valide","Validée"].includes(c.statut));
  const cmdARealiser =[...cmdAttente,...cmdProduction];

  return (
    <div style={S.root}>
      <header style={{...S.header,background:"linear-gradient(135deg,rgba(6,10,14,0.97),rgba(5,15,20,0.97))"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:"#5bb8d4",boxShadow:"0 0 8px #5bb8d4"}}/>
          <span style={{...S.logoText,color:"#5bb8d4"}}>SCIEUR</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          {cmdAttente.length>0&&<div style={S.alertBadge}>{cmdAttente.length} en attente</div>}
          <button style={S.btnLogout} onClick={onLogout}>⇤</button>
        </div>
      </header>

      <main style={S.main}>

        {/* ══════════════════════════════════════════
            ONGLET À RÉALISER
        ══════════════════════════════════════════ */}
        {tab==="arealiser"&&(
          <div style={S.page}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
              <Stat label="Attente"  value={cmdAttente.length}    color="#D4A853"/>
              <Stat label="Prod."    value={cmdProduction.length} color="#5bb8d4"/>
              <Stat label="Validées" value={cmdValidees.length}   color="#6dbf7e"/>
            </div>
            <button style={S.btnRefresh} onClick={()=>loadCommandes()}>
              {loading?"⏳ Chargement...":"↻ Actualiser"}
            </button>
            {!scriptUrl&&<div style={{textAlign:"center",padding:16,color:"#D4A853",fontSize:13}}>
              ⚠ Configure l'URL Apps Script dans l'onglet ⚙ Config
            </div>}
            {cmdARealiser.length===0&&scriptUrl&&!loading&&<Empty icon="✅" text="Aucune commande à réaliser"/>}

            {cmdARealiser.map(cmd=>{
              const isOpen=expandCmd===cmd.id;
              const st=realiser[cmd.id];
              const nbExported=st?st.lignes.filter(l=>l.exported).length:0;
              const nbTotal=(cmd.lignes||[]).length;

              return (
                <div key={cmd.id} style={{...S.card,marginBottom:12,
                  borderColor:isOpen?"rgba(91,184,212,0.4)":"rgba(212,168,83,0.12)"}}>

                  {/* Entête */}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                    <div>
                      <div style={{fontSize:11,color:"#5bb8d4",letterSpacing:"0.08em"}}>{cmd.id}</div>
                      <div style={{fontWeight:700,color:"#e8ddd0",fontSize:15}}>{cmd.client}</div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
                      <Badge status={cmd.statut||"attente"}/>
                      {st&&<span style={{fontSize:10,color:"#6dbf7e"}}>{nbExported}/{nbTotal} produit{nbTotal>1?"s":""}</span>}
                    </div>
                  </div>
                  <div style={{fontSize:12,color:"#6a5a4a",marginBottom:6}}>
                    📅 <strong style={{color:"#c4b09a"}}>{cmd.dateLivraison||cmd.datelivraison}</strong>
                    {cmd.notes&&<span style={{color:"#8a7a68",fontStyle:"italic"}}> · "{cmd.notes}"</span>}
                  </div>

                  {/* Résumé produits */}
                  <div style={{marginBottom:10}}>
                    {(cmd.lignes||[]).map((l,i)=>{
                      const ligneExp=st?.lignes[i]?.exported;
                      return (
                        <div key={i} style={{fontSize:12,marginBottom:3,padding:"4px 8px",borderRadius:6,
                          background:ligneExp?"rgba(109,191,126,0.06)":"rgba(255,255,255,0.02)",
                          border:`1px solid ${ligneExp?"rgba(109,191,126,0.2)":"transparent"}`}}>
                          <span style={{color:ligneExp?"#6dbf7e":"#D4A853",fontWeight:700}}>
                            {ligneExp?"✓ ":""}{l.produit}
                          </span>
                          <span style={{color:"#8a7a68"}}>{l.essence?` · ${l.essence}`:""}{l.qualite?` · ${l.qualite}`:""}</span>
                          {l.epaisseur&&<span style={{color:"#5a4a3a",fontFamily:"monospace"}}> — {l.epaisseur}×{l.largeur}mm · {l.longueur}m · {l.quantite} u.</span>}
                        </div>
                      );
                    })}
                  </div>

                  {/* Bouton ouvrir cubage */}
                  <button style={{...S.btnSmall,width:"100%",textAlign:"center",
                    background:isOpen?"rgba(91,184,212,0.12)":"rgba(212,168,83,0.06)",
                    color:isOpen?"#5bb8d4":"#D4A853",
                    borderColor:isOpen?"rgba(91,184,212,0.3)":"rgba(212,168,83,0.2)"}}
                    onClick={()=>{
                      if(!isOpen){ initRealiser(cmd); setExpand(cmd.id); }
                      else setExpand(null);
                    }}>
                    {isOpen?"▲ Fermer":"📐 Cuber les produits"}
                  </button>

                  {/* ── FORMULAIRE CUBAGE PAR PRODUIT ── */}
                  {isOpen&&st&&(
                    <div style={{marginTop:14,borderTop:"1px solid rgba(91,184,212,0.15)",paddingTop:14}}>
                      {st.lignes.map((l,idx)=>{
                        const pret=lignePrete(l);
                        return (
                          <div key={idx} style={{
                            background: l.exported?"rgba(109,191,126,0.04)":"rgba(255,255,255,0.02)",
                            border:`1px solid ${l.exported?"rgba(109,191,126,0.3)":"rgba(212,168,83,0.15)"}`,
                            borderRadius:10,padding:"12px",marginBottom:12}}>

                            {/* Titre produit */}
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                              <div style={{fontSize:12,fontWeight:700,color:l.exported?"#6dbf7e":"#D4A853",
                                textTransform:"uppercase",letterSpacing:"0.07em"}}>
                                {l.exported?"✓ ":""}{l.produit} · {l.essence}
                                {l.qualite&&<span style={{color:"#6a5a4a",fontWeight:400}}> · {l.qualite}</span>}
                              </div>
                            </div>

                            {l.exported?(
                              /* Résumé si déjà exporté */
                              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                                <div style={{textAlign:"center"}}>
                                  <div style={{fontSize:10,color:"#6a5a4a",textTransform:"uppercase"}}>Vol. charge</div>
                                  <div style={{fontSize:13,fontWeight:700,color:"#D4A853"}}>{m3f(l.volCharge||0)}</div>
                                </div>
                                <div style={{textAlign:"center"}}>
                                  <div style={{fontSize:10,color:"#6a5a4a",textTransform:"uppercase"}}>Rendement</div>
                                  <div style={{fontSize:13,fontWeight:700,color:"#6dbf7e"}}>{l.rend!=null?pct(l.rend):"—"}</div>
                                </div>
                                <div style={{textAlign:"center"}}>
                                  <div style={{fontSize:10,color:"#6a5a4a",textTransform:"uppercase"}}>Perte</div>
                                  <div style={{fontSize:13,fontWeight:700,color:"#e07a5f"}}>{l.perte!=null?pct(l.perte):"—"}</div>
                                </div>
                              </div>
                            ):(
                              <>
                                {/* Dimensions */}
                                <Row3>
                                  <Field label="Ép. mm">
                                    <Num value={l.epaisseur} onChange={e=>setLigneVal(cmd.id,idx,"epaisseur",e.target.value)} ph="27"/>
                                  </Field>
                                  <Field label="Larg. mm">
                                    <Num value={l.largeur} onChange={e=>setLigneVal(cmd.id,idx,"largeur",e.target.value)} ph="120"/>
                                  </Field>
                                  <Field label="Long. m">
                                    <Num value={l.longueur} onChange={e=>setLigneVal(cmd.id,idx,"longueur",e.target.value)} ph="2.4" step="0.1"/>
                                  </Field>
                                </Row3>

                                {/* Nb unités + Vol grume — propre à CE produit */}
                                <Row2 style={{marginTop:10}}>
                                  <Field label="Nb unités prod.">
                                    <Num value={l.nbUnites} onChange={e=>setLigneVal(cmd.id,idx,"nbUnites",e.target.value)} ph={l.quantite||"200"} step="1"/>
                                  </Field>
                                  <Field label="Vol. grume (m³)">
                                    <Num value={l.volumeGrume} onChange={e=>setLigneVal(cmd.id,idx,"volumeGrume",e.target.value)} ph="2.5" step="0.01"/>
                                  </Field>
                                </Row2>

                                {/* Résultats temps réel */}
                                {l.volCharge!=null&&(
                                  <div style={{marginTop:10,background:"rgba(212,168,83,0.04)",
                                    borderRadius:8,padding:"8px 10px",display:"grid",
                                    gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8}}>
                                    <div style={{textAlign:"center"}}>
                                      <div style={{fontSize:9,color:"#6a5a4a",textTransform:"uppercase"}}>Vol. unit.</div>
                                      <div style={{fontSize:12,fontWeight:600,color:"#e8ddd0"}}>{m3f(l.volUnit)}</div>
                                    </div>
                                    <div style={{textAlign:"center"}}>
                                      <div style={{fontSize:9,color:"#6a5a4a",textTransform:"uppercase"}}>Vol. charge</div>
                                      <div style={{fontSize:13,fontWeight:700,color:"#D4A853"}}>{m3f(l.volCharge)}</div>
                                    </div>
                                    <div style={{textAlign:"center"}}>
                                      <div style={{fontSize:9,color:"#6a5a4a",textTransform:"uppercase"}}>Rendement</div>
                                      <div style={{fontSize:12,fontWeight:700,color:"#6dbf7e"}}>{l.rend!=null?pct(l.rend):"—"}</div>
                                    </div>
                                    <div style={{textAlign:"center"}}>
                                      <div style={{fontSize:9,color:"#6a5a4a",textTransform:"uppercase"}}>Perte</div>
                                      <div style={{fontSize:12,fontWeight:700,color:"#e07a5f"}}>{l.perte!=null?pct(l.perte):"—"}</div>
                                    </div>
                                  </div>
                                )}
                                {l.volCharge!=null&&l.rend!=null&&(
                                  <div style={{...S.rendBar,marginTop:6}}>
                                    <div style={{...S.rendFill,width:pct(l.rend)}}/>
                                  </div>
                                )}

                                {/* Bouton valider CE produit */}
                                <button
                                  style={{...S.btnBig,...(!pret||l.exporting?S.btnDis:{}),
                                    marginTop:10,marginBottom:0,fontSize:13,padding:"11px",
                                    background:pret?"linear-gradient(135deg,#0a1f0a,#6dbf7e)":"rgba(255,255,255,0.05)",
                                    color:pret?"#fff":"#4a3a2a",
                                    boxShadow:pret?"0 4px 12px rgba(109,191,126,0.2)":"none"}}
                                  onClick={()=>validerLigne(cmd,idx)}
                                  disabled={!pret||l.exporting}>
                                  {l.exporting?<Spinner/>:`✓ Valider produit ${idx+1}`}
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

            {/* Commandes validées (condensées) */}
            {cmdValidees.length>0&&<>
              <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.15em",textTransform:"uppercase",
                color:"#6dbf7e",marginTop:20,marginBottom:8,paddingBottom:5,
                borderBottom:"1px solid rgba(109,191,126,0.2)"}}>Validées récentes</div>
              {cmdValidees.map(cmd=>(
                <div key={cmd.id} style={{...S.card,borderColor:"rgba(109,191,126,0.15)",opacity:0.7}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <div style={{fontSize:11,color:"#5bb8d4"}}>{cmd.id}</div>
                      <div style={{fontWeight:700,color:"#e8ddd0"}}>{cmd.client}</div>
                    </div>
                    <Badge status="valide"/>
                  </div>
                </div>
              ))}
            </>}
          </div>
        )}

        {/* ══════════════════════════════════════════
            ONGLET HISTORIQUE COMMANDES
        ══════════════════════════════════════════ */}
        {tab==="historique"&&(
          <div style={S.page}>
            {historiqueCmds.length===0?<Empty icon="📚" text="Aucune commande validée pour l'instant"/>:(
              <>
                <div style={{color:"#8a7a68",fontSize:12,marginBottom:14}}>
                  {historiqueCmds.length} commande{historiqueCmds.length>1?"s":""} réalisée{historiqueCmds.length>1?"s":""}
                </div>
                {historiqueCmds.map(h=>(
                  <div key={h.id} style={{...S.card,borderColor:"rgba(109,191,126,0.2)"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                      <div>
                        <div style={{fontSize:11,color:"#5bb8d4",letterSpacing:"0.08em"}}>{h.id}</div>
                        <div style={{fontWeight:700,color:"#e8ddd0",fontSize:14}}>{h.client}</div>
                      </div>
                      <span style={{fontSize:11,color:"#6dbf7e",background:"rgba(109,191,126,0.1)",
                        padding:"3px 8px",borderRadius:12,border:"1px solid rgba(109,191,126,0.2)"}}>✓ Réalisée</span>
                    </div>
                    <div style={{fontSize:12,color:"#6a5a4a",marginBottom:8}}>
                      📅 Livraison : <strong style={{color:"#c4b09a"}}>{h.dateLivraison}</strong>
                      {h.dateValidation&&<span> · Validée le {h.dateValidation}</span>}
                    </div>
                    {/* Détail par produit */}
                    {(h.lignes||[]).map((l,i)=>(
                      <div key={i} style={{background:"rgba(109,191,126,0.03)",
                        border:"1px solid rgba(109,191,126,0.1)",borderRadius:7,
                        padding:"8px 10px",marginBottom:6}}>
                        <div style={{fontSize:12,fontWeight:700,color:"#D4A853",marginBottom:4}}>
                          {l.produit} · {l.essence}
                          {l.qualite&&<span style={{color:"#6a5a4a",fontWeight:400}}> · {l.qualite}</span>}
                        </div>
                        <div style={{fontSize:11,color:"#6a5a4a",fontFamily:"monospace",marginBottom:6}}>
                          {l.epaisseur}×{l.largeur}mm · {l.longueur}m · {l.nbUnites} u.
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6}}>
                          <div style={{textAlign:"center"}}>
                            <div style={{fontSize:9,color:"#6a5a4a",textTransform:"uppercase"}}>Grume</div>
                            <div style={{fontSize:11,fontWeight:600,color:"#a09080"}}>{m3f(l.volumeGrume||0)}</div>
                          </div>
                          <div style={{textAlign:"center"}}>
                            <div style={{fontSize:9,color:"#6a5a4a",textTransform:"uppercase"}}>Vol.</div>
                            <div style={{fontSize:11,fontWeight:700,color:"#D4A853"}}>{m3f(l.volCharge||0)}</div>
                          </div>
                          <div style={{textAlign:"center"}}>
                            <div style={{fontSize:9,color:"#6a5a4a",textTransform:"uppercase"}}>Rend.</div>
                            <div style={{fontSize:11,fontWeight:700,color:"#6dbf7e"}}>{l.rend!=null?pct(l.rend):"—"}</div>
                          </div>
                          <div style={{textAlign:"center"}}>
                            <div style={{fontSize:9,color:"#6a5a4a",textTransform:"uppercase"}}>Perte</div>
                            <div style={{fontSize:11,fontWeight:700,color:"#e07a5f"}}>{l.perte!=null?pct(l.perte):"—"}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {/* Vol total commande */}
                    {h.lignes&&h.lignes.length>1&&(
                      <div style={{textAlign:"right",fontSize:12,color:"#D4A853",marginTop:4,fontWeight:700}}>
                        Total : {m3f(h.lignes.reduce((s,l)=>s+(l.volCharge||0),0))}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════
            ONGLET CUBAGE LIBRE
        ══════════════════════════════════════════ */}
        {tab==="cubage"&&(
          <div style={S.page}>
            <div style={{fontSize:12,color:"#6a5a4a",marginBottom:14,textAlign:"center"}}>
              Cubage hors commande — sciage libre
            </div>
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
              <div style={S.resultBox}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
                  <RItem label="Vol. unitaire" value={m3f(cubeRes.volumeUnit)}/>
                  <RItem label="Vol. charge"   value={m3f(cubeRes.volumeCharge)} big/>
                  <RItem label="Rendement"     value={pct(cubeRes.rendement)} color="#6dbf7e"/>
                  <RItem label="Perte"         value={pct(cubeRes.perte)} color="#e07a5f"/>
                </div>
                <div style={S.rendBar}><div style={{...S.rendFill,width:pct(cubeRes.rendement)}}/></div>
              </div>
            ):<div style={S.hint}>Remplis les champs pour calculer</div>}
            <button style={{...S.btnBig,...(!cubeValid?S.btnDis:{})}} onClick={addCube} disabled={!cubeValid}>
              Cuber et sauvegarder
            </button>
            {history.length>0&&<>
              <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.15em",textTransform:"uppercase",
                color:"#D4A853",margin:"20px 0 10px",paddingBottom:5,
                borderBottom:"1px solid rgba(212,168,83,0.15)"}}>
                Historique ({history.length})
              </div>
              {history.map(e=>(
                <div key={e.id} style={{...S.card,
                  borderColor:exportedIds.has(String(e.id))?"rgba(109,191,126,0.2)":"rgba(212,168,83,0.12)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <span style={{fontWeight:700,color:"#D4A853"}}>{e.produit} · {e.essence}</span>
                    {exportedIds.has(String(e.id))&&<span style={{fontSize:11,color:"#6dbf7e"}}>✓ exporté</span>}
                  </div>
                  <div style={{fontSize:12,color:"#6a5a4a",fontFamily:"monospace",marginBottom:8}}>
                    {e.epaisseur}×{e.largeur}mm · {e.longueur}m · {e.nbUnites}u · {m3f(e.volumeCharge)}
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    {exportedIds.has(String(e.id))?(
                      <div style={{flex:1,textAlign:"center",fontSize:12,color:"#6dbf7e",
                        padding:"8px",border:"1px solid rgba(109,191,126,0.15)",borderRadius:7}}>✓ Exporté</div>
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

        {/* ══════════════════════════════════════════
            ONGLET CONFIG
        ══════════════════════════════════════════ */}
        {tab==="config"&&(
          <div style={S.page}>
            <Card title="Apps Script Web App">
              <p style={{fontSize:13,color:"#a09080",lineHeight:1.7,marginBottom:14}}>
                Colle l'URL de ton Apps Script déployée.
              </p>
              <Field label="URL Apps Script">
                <Inp value={scriptUrl}
                  onChange={e=>{ setScriptUrl(e.target.value); localStorage.setItem(APPS_SCRIPT_URL_KEY,e.target.value); }}
                  ph="https://script.google.com/macros/s/..."/>
              </Field>
              {scriptUrl&&<div style={{fontSize:12,color:"#6dbf7e",marginTop:8}}>✓ URL enregistrée</div>}
            </Card>

            <Card title="Script Apps Script — Version complète">
              <pre style={S.pre}>{`function doGet(e) {
  var action = e.parameter.action;
  var ss = SpreadsheetApp.openById("${SHEET_ID}");
  if(action === "getCommandes") {
    var sheet = ss.getSheetByName("Vendeur");
    if(!sheet||sheet.getLastRow()<2) return json({commandes:[]});
    var rows = sheet.getDataRange().getValues();
    var headers = rows[0];
    var map={}, order=[];
    rows.slice(1).forEach(function(r){
      var obj={};
      headers.forEach(function(h,i){ obj[h]=r[i]; });
      var id=String(obj["id"]||"").trim();
      if(id){ map[id]={id,client:obj["client"],
        dateLivraison:obj["dateLivraison"],notes:obj["notes"],
        statut:obj["statut"]||"attente",
        dateCreation:obj["dateCreation"],lignes:[]};
        order.push(id); }
      var cmdId=id||order[order.length-1];
      if(cmdId&&map[cmdId]) map[cmdId].lignes.push({
        produit:obj["produit"],essence:obj["essence"],
        qualite:obj["qualite"],epaisseur:obj["epaisseur"],
        largeur:obj["largeur"],longueur:obj["longueur"],
        quantite:obj["quantite"]});
    });
    return json({commandes:order.map(function(id){return map[id];})});
  }
  return json({ok:true});
}

function doPost(e) {
  var data=JSON.parse(e.postData.contents);
  var ss=SpreadsheetApp.openById("${SHEET_ID}");

  if(data.type==="commande"){
    var s=ss.getSheetByName("Vendeur")||ss.insertSheet("Vendeur");
    if(s.getLastRow()===0)
      s.appendRow(["id","client","produit","essence","qualite",
        "epaisseur","largeur","longueur","quantite",
        "dateLivraison","notes","statut","dateCreation"]);
    var ids=s.getLastRow()>1?s.getRange(2,1,s.getLastRow()-1,1).getValues().flat().map(String):[];
    if(ids.indexOf(String(data.id))===-1)
      data.rows.forEach(function(row){s.appendRow(row);});
  }

  if(data.type==="updateStatut"){
    var s=ss.getSheetByName("Vendeur");
    if(s&&s.getLastRow()>1){
      var vals=s.getRange(2,1,s.getLastRow()-1,1).getValues();
      for(var i=0;i<vals.length;i++){
        if(String(vals[i][0]).trim()===String(data.id).trim()){
          s.getRange(i+2,12).setValue(data.statut); break;
        }
      }
    }
  }

  if(data.type==="deleteCommande"){
    var s=ss.getSheetByName("Vendeur");
    if(s&&s.getLastRow()>1){
      // Trouver la ligne du CMD ID et toutes les lignes produits après
      var allVals=s.getRange(2,1,s.getLastRow()-1,1).getValues();
      var startRow=-1, endRow=-1;
      for(var i=0;i<allVals.length;i++){
        var cellId=String(allVals[i][0]).trim();
        if(cellId===String(data.id).trim()){startRow=i+2;endRow=i+2;}
        else if(startRow>0&&cellId===""){endRow=i+2;}
        else if(startRow>0&&cellId!==""){break;}
      }
      if(startRow>0){
        // Supprimer de bas en haut pour ne pas décaler les indices
        for(var r=endRow;r>=startRow;r--) s.deleteRow(r);
      }
    }
  }

  if(data.type==="cubage"){
    var s=ss.getSheetByName("Scieur")||ss.insertSheet("Scieur");
    if(s.getLastRow()===0)
      s.appendRow(["Date","Cmd ID","Produit","Essence","Qualité",
        "Ép.mm","Larg.mm","Long.m","Nb unités","Vol.Grume m³",
        "Vol.Unitaire m³","Vol.Charge m³","Rendement","Perte"]);
    s.appendRow(data.row);
  }

  return ContentService.createTextOutput(JSON.stringify({ok:true}))
    .setMimeType(ContentService.MimeType.JSON);
}
function json(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}`}</pre>
            </Card>

            <div style={{background:"#1a1510",border:"1px solid rgba(212,168,83,0.1)",
              borderRadius:8,padding:14,fontSize:12,color:"#8a7a68",lineHeight:1.9}}>
              <strong style={{color:"#e07a5f",display:"block",marginBottom:6}}>⚠ Mettre à jour Apps Script obligatoire</strong>
              La suppression Sheet nécessite ce nouveau script.<br/>
              Extensions → Apps Script → remplace tout → <strong style={{color:"#D4A853"}}>Nouveau déploiement</strong> (pas "mettre à jour") → Application Web → Accès : Tout le monde → Déployer → copier l'URL.<br/>
              <strong style={{color:"#D4A853",display:"block",margin:"8px 0 4px"}}>Nouveautés :</strong>
              • Suppression correcte multi-lignes dans Vendeur<br/>
              • Cubage : une ligne par produit, pas d'anti-doublon (chaque validation est unique)<br/>
              • Historique commandes conservé localement sur cet appareil
            </div>
          </div>
        )}

      </main>

      <nav style={S.nav}>
        {[
          ["arealiser","🪚",`À réaliser${cmdARealiser.length?` (${cmdARealiser.length})`:""}`],
          ["historique","📚","Historique"],
          ["cubage","📐","Cubage libre"],
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

// ─── SOUS-COMPOSANTS ─────────────────────────────────────────────────────────
function RItem({label,value,big,color}){
  return <div>
    <div style={{fontSize:10,color:"#6a5a4a",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:3}}>{label}</div>
    <div style={{fontSize:big?18:14,fontWeight:big?700:600,color:color||"#e8ddd0",fontVariantNumeric:"tabular-nums"}}>{value}</div>
  </div>;
}

// ─── APP ROOT ─────────────────────────────────────────────────────────────────
export default function App(){
  const [role,setRole]          = useState(()=>sessionStorage.getItem("role")||null);
  const [scriptUrl,setScriptUrl]= useState(()=>localStorage.getItem(APPS_SCRIPT_URL_KEY)||"");
  const [toast,setToast]        = useState(null);
  const showToast=(msg,type="success")=>{ setToast({msg,type}); setTimeout(()=>setToast(null),3500); };
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
  loginRoot:{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#0e0c0a",padding:20},
  loginBg:{position:"fixed",top:0,left:0,right:0,bottom:0,
    background:"radial-gradient(ellipse at 50% 40%, rgba(212,168,83,0.08) 0%, transparent 70%)",pointerEvents:"none"},
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
    border:"none",borderRadius:8,cursor:"pointer",letterSpacing:"0.08em",fontFamily:"Georgia,serif"},
  loginHint:{marginTop:20,fontSize:11,color:"#4a3a2a"},
  shake:{animation:"shake 0.4s ease"},
  header:{position:"sticky",top:0,zIndex:20,display:"flex",alignItems:"center",
    justifyContent:"space-between",padding:"12px 18px",
    background:"rgba(10,8,6,0.97)",borderBottom:"1px solid rgba(212,168,83,0.15)",backdropFilter:"blur(8px)"},
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
  card:{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(212,168,83,0.12)",
    borderRadius:12,padding:"14px 12px",marginBottom:10},
  cardTitle:{fontSize:10,fontWeight:700,letterSpacing:"0.15em",textTransform:"uppercase",
    color:"#D4A853",marginBottom:10,opacity:0.8},
  label:{fontSize:10,color:"#8a7a68",letterSpacing:"0.08em",textTransform:"uppercase"},
  select:{background:"#1e1a14",border:"1px solid rgba(212,168,83,0.2)",borderRadius:8,
    color:"#e8ddd0",padding:"11px 10px",fontSize:14,width:"100%",outline:"none",
    fontFamily:"Georgia,serif",appearance:"none"},
  input:{background:"#1e1a14",border:"1px solid rgba(212,168,83,0.2)",borderRadius:8,
    color:"#e8ddd0",padding:"11px 10px",fontSize:14,width:"100%",outline:"none",
    boxSizing:"border-box",fontFamily:"Georgia,serif"},
  resultBox:{background:"rgba(30,24,16,0.9)",border:"1px solid rgba(212,168,83,0.3)",
    borderRadius:12,padding:"14px",marginBottom:12},
  rendBar:{height:6,background:"rgba(255,255,255,0.06)",borderRadius:3,overflow:"hidden"},
  rendFill:{height:"100%",background:"linear-gradient(90deg,#8B5E2A,#D4A853)",borderRadius:3,transition:"width 0.4s"},
  hint:{textAlign:"center",color:"#5a4a3a",fontSize:13,padding:"16px 0"},
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
  pre:{background:"#0a0806",border:"1px solid rgba(212,168,83,0.12)",borderRadius:6,
    padding:"10px",fontSize:10,color:"#a09070",overflowX:"auto",lineHeight:1.7,
    marginTop:8,fontFamily:"monospace",whiteSpace:"pre-wrap",wordBreak:"break-all"},
  spinner:{width:16,height:16,border:"2px solid rgba(0,0,0,0.2)",
    borderTop:"2px solid #141210",borderRadius:"50%",animation:"spin 0.8s linear infinite"},
};
