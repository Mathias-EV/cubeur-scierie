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
const initLigne = { produit:"",essence:"",qualite:"",epaisseur:"",largeur:"",longueur:"",quantite:"",unite:"m³",prixUnitaire:"",typePrix:"m³",typeTaxe:"HT" };
const initCmd   = { client:"",dateLivraison:"",notes:"",adresseClient:"",adresseLivraison:"",lignes:[{...initLigne}] };
const initCube  = { produit:"",essence:"",epaisseur:"",largeur:"",longueur:"",qualite:"",nbUnites:"",volumeGrume:"",unite:"m³" };

// ─── UTILS ───────────────────────────────────────────────────────────────────
const round=(n,d=6)=>Math.round(n*10**d)/10**d;
// parseFloat qui accepte les virgules françaises (1,5 → 1.5)
const pf=(v)=>parseFloat(String(v||"").replace(",","."));
const pct=(n)=>(n*100).toFixed(1)+" %";
const m3f=(n,u="m³")=>parseFloat(n).toFixed(4)+" "+(u||"m³");
const genId=()=>"CMD-"+Date.now().toString(36).toUpperCase().slice(-6);
const today=()=>new Date().toISOString().split("T")[0];
const fmtDate=()=>new Date().toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"});
const prodId=(cmdId,idx)=>`${cmdId}-P${idx+1}`;

// ── Calcul pour le formulaire commande ──
// Pour m³ : volume = ep×la×lo×nb
// Pour m²  : quantite = total m² commandé → volume m³ = m²×ep (si ep dispo)
//            sinon on affiche juste les m² commandés
// Pour mL  : quantite = total mL commandé → volume m³ = mL×ep×la (si ep+la dispo)
function volLigneM3(l){
  const u=l.unite||"m³";
  const ep=pf(l.epaisseur)/1000;
  const la=pf(l.largeur)/1000;
  const lo=pf(l.longueur);
  const nb=pf(l.quantite);
  if(!nb||nb<=0) return null;
  if(u==="m³"){
    // Mode classique : volume = ep×la×lo×nb (nb = nb de pièces)
    if(ep>0&&la>0&&lo>0) return round(ep*la*lo*nb,4);
    return null;
  } else if(u==="m³direct"){
    // Mode m³ direct : quantite = total m³ commandé
    return round(nb,4);
  } else if(u==="m²"){
    // quantite = total m² → volume m³ = m²×ep
    if(ep>0) return round(nb*ep,4);
    return null;
  } else if(u==="mL"){
    // quantite = total mL → volume m³ = mL×ep×la
    if(ep>0&&la>0) return round(nb*ep*la,4);
    return null;
  } else {
    // unité : pas de conversion m³ (on facture à la pièce)
    return null;
  }
}

// Surface/linéaire commandé (pour l'affichage et le devis)
function qteCommandee(l){
  const nb=parseFloat(l.quantite);
  if(!nb||nb<=0) return null;
  return nb;
}

// Calcul HT selon le type de prix choisi (gère HT et TTC)
function ligneHT(l){
  let p=pf(l.prixUnitaire);
  if(!p||p<=0) return null;
  // Si le prix saisi est TTC, le ramener en HT
  if((l.typeTaxe||"HT")==="TTC") p=round(p/1.2,4);
  const tp=l.typePrix||l.unite||"m³";
  const nb=pf(l.quantite);
  if(!nb||nb<=0) return null;

  if(tp==="m³"){
    const v=volLigneM3(l);
    if(v==null) return null;
    return round(v*p,2);
  } else if(tp==="m³direct"){
    // Prix au m³, quantite = volume total commandé
    if(!nb||nb<=0) return null;
    return round(nb*p,2);
  } else if(tp==="m²"){
    return round(nb*p,2);
  } else if(tp==="mL"){
    return round(nb*p,2);
  } else {
    return round(nb*p,2);
  }
}

// ─── CALCUL selon unité ───────────────────────────────────────────────────────
// Toutes les dimensions sont toujours stockées.
// Le calcul de la valeur principale change selon l'unité :
//   m³ : ep×la×lo×nb (volume)  + rendement vs grume
//   m²  : la×lo×nb (surface)
//   mL  : lo×nb (linéaire)
function calculParUnite(p){
  const ep=pf(p.epaisseur)/1000;
  const la=pf(p.largeur)/1000;
  const lo=pf(p.longueur);
  const nb=pf(p.nbUnites);
  const vg=pf(p.volumeGrume);
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

// ─── GÉNÉRATION DEVIS PDF ─────────────────────────────────────────────────────
async function genererDevisPDF(form, cmdId){
  // Charger jsPDF depuis CDN (compatible CRA / React)
  const loadJsPDF = () => new Promise((resolve, reject) => {
    // Déjà chargé ?
    if(window.jspdf && window.jspdf.jsPDF){ resolve(window.jspdf.jsPDF); return; }
    // Script déjà dans le DOM mais pas encore prêt ?
    const existing = document.querySelector('script[data-jspdf]');
    if(existing){
      // Attendre qu'il soit prêt
      const wait = setInterval(()=>{
        if(window.jspdf && window.jspdf.jsPDF){
          clearInterval(wait); resolve(window.jspdf.jsPDF);
        }
      }, 50);
      setTimeout(()=>{ clearInterval(wait); reject(new Error('Timeout jsPDF')); }, 5000);
      return;
    }
    // Injecter le script
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.setAttribute('data-jspdf','1');
    s.onload = () => {
      if(window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
      else reject(new Error('jsPDF non défini après chargement'));
    };
    s.onerror = () => reject(new Error('Erreur de chargement jsPDF'));
    document.head.appendChild(s);
  });

  let JsPDF;
  try {
    JsPDF = await loadJsPDF();
  } catch(e) {
    alert("Impossible de charger le générateur PDF.\nVérifiez votre connexion et réessayez.\n\nErreur : " + e.message);
    return;
  }
  const doc = new JsPDF({ unit:"mm", format:"a4" });
  const TVA=0.20;

  // Couleurs
  const BRUN=[44,26,10], OR=[196,144,74], GRIS=[100,100,100], NOIR=[20,20,20];

  // ── En-tête ──
  doc.setFillColor(...BRUN);
  doc.rect(0,0,210,32,"F");

  doc.setTextColor(250,243,232);
  doc.setFont("helvetica","bold");
  doc.setFontSize(20);
  doc.text("EXPLOITATION VERDON",14,13);
  doc.setFontSize(9);
  doc.setFont("helvetica","normal");
  doc.setTextColor(196,164,122);
  doc.text("236 rue des Tisserands · 73540 La Bathie · France",14,19);
  doc.text("etf.verdon@gmail.com",14,24);
  doc.text("SIREN 881 432 348 · N° TVA FR38881432348",14,29);

  // Titre DEVIS à droite
  doc.setTextColor(196,144,74);
  doc.setFont("helvetica","bold");
  doc.setFontSize(26);
  doc.text("DEVIS",196,18,{align:"right"});

  // Numéro & date
  const today=new Date();
  const dd=String(today.getDate()).padStart(2,"0");
  const mm=String(today.getMonth()+1).padStart(2,"0");
  const yyyy=today.getFullYear();
  const expiry=new Date(today); expiry.setMonth(expiry.getMonth()+1);
  const de=String(expiry.getDate()).padStart(2,"0");
  const me=String(expiry.getMonth()+1).padStart(2,"0");
  const ye=expiry.getFullYear();

  doc.setFontSize(9);
  doc.setFont("helvetica","normal");
  doc.setTextColor(196,164,122);
  doc.text(`N° ${cmdId}`,196,25,{align:"right"});
  doc.text(`Émis le ${dd}/${mm}/${yyyy}`,196,30,{align:"right"});

  // ── Infos client ──
  let y=42;
  // Calculer la hauteur selon les infos dispo
  const hasAddr = form.adresseClient && form.adresseClient.trim();
  const hasLivr = form.adresseLivraison && form.adresseLivraison.trim();
  const clientH = 22 + (hasAddr?10:0) + (hasLivr?10:0);
  doc.setFillColor(245,237,224);
  doc.roundedRect(120,y-5,80,clientH,2,2,"F");
  doc.setTextColor(...BRUN);
  doc.setFont("helvetica","bold");
  doc.setFontSize(9);
  doc.text("Client",122,y+1);
  doc.setFont("helvetica","normal");
  doc.setTextColor(...NOIR);
  doc.text(form.client||"—",122,y+7);
  doc.setTextColor(...GRIS);
  // Formater la date proprement (ISO → DD/MM/YYYY)
  const fmtDateLivr = (d) => {
    if(!d) return "—";
    try{ const dt=new Date(d); return dt.toLocaleDateString("fr-FR",{day:"2-digit",month:"2-digit",year:"numeric"}); }
    catch(e){ return d; }
  };
  doc.text(`Livraison souhaitée : ${fmtDateLivr(form.dateLivraison)}`,122,y+13);
  let yClient = y+13;
  if(hasAddr){
    yClient+=5;
    doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(...BRUN);
    doc.text("Adresse :",122,yClient);
    doc.setFont("helvetica","normal"); doc.setTextColor(...NOIR);
    doc.text(form.adresseClient,140,yClient,{maxWidth:58});
    yClient+=7;
  }
  if(hasLivr){
    yClient+=3;
    doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(...BRUN);
    doc.text("Livraison :",122,yClient);
    doc.setFont("helvetica","normal"); doc.setTextColor(...NOIR);
    doc.text(form.adresseLivraison,143,yClient,{maxWidth:55});
    yClient+=7;
  }
  if(form.notes){
    doc.setFontSize(7.5); doc.setTextColor(...GRIS); doc.setFont("helvetica","italic");
    doc.text(form.notes,122,yClient+3,{maxWidth:76});
  }

  // ── Tableau produits ──
  // y positionné APRÈS le bloc client avec marge de sécurité
  y = Math.max(y + clientH + 12, 42 + clientH + 12);
  // Colonnes (modèle devis client) :
  // Désignation(14-80) | Essence(81-110) | Qté(111-130) | P.U.HT(131-155) | TVA%(156-168) | Total HT(169-196)
  const COL={
    desc:14, essence:81, qte:111, pu:131, tva:156, total:169, end:196
  };

  // En-tête tableau
  doc.setFillColor(...BRUN);
  doc.rect(14,y,182,8,"F");
  doc.setTextColor(250,243,232);
  doc.setFont("helvetica","bold");
  doc.setFontSize(8);
  doc.text("Désignation",    COL.desc+1,    y+5.5);
  doc.text("Essence",        COL.essence+1, y+5.5);
  doc.text("Quantité",       COL.qte+10,    y+5.5, {align:"center"});
  doc.text("P.U. HT",        COL.pu+12,     y+5.5, {align:"center"});
  doc.text("TVA",            COL.tva+6,     y+5.5, {align:"center"});
  doc.text("Total HT",       COL.end,       y+5.5, {align:"right"});
  y+=8;

  let totalHT=0;
  (form.lignes||[]).forEach((l,i)=>{
    const ht=ligneHT(l);
    const vol=volLigneM3(l);
    const u=l.unite||"m³";
    const nb=pf(l.quantite)||0;
    const tp=l.typePrix||u;
    const isTTCpdf=(l.typeTaxe||"HT")==="TTC";
    const htVal=ht!=null?(isTTCpdf?round(ht/1.2,2):ht):null;

    // ── Désignation = produit + dims sur 2 lignes ──
    const prodTxt=(l.produit||"—").slice(0,20);
    let dimTxt="";
    if(l.epaisseur&&l.largeur&&l.longueur) dimTxt=`${l.epaisseur}×${l.largeur}mm · ${l.longueur}m`;
    else if(l.epaisseur&&l.largeur) dimTxt=`${l.epaisseur}×${l.largeur}mm`;
    else if(l.longueur) dimTxt=`${l.longueur}m`;
    const twoLines = dimTxt!=="";
    const rowH = twoLines ? 13 : 9;

    // ── Quantité ──
    let qTxt="";
    if(u==="m³") qTxt=vol!=null?`${vol} m³`:`${nb} u.`;
    else if(u==="m³direct") qTxt=`${nb} m³`;
    else if(u==="m²") qTxt=`${nb} m²${vol!=null?" ("+vol+" m³)":""}`;
    else if(u==="mL") qTxt=`${nb} mL${vol!=null?" ("+vol+" m³)":""}`;
    else qTxt=`${nb} u.`;

    // Fond alternant
    const bg = i%2===0 ? [255,250,244] : [250,243,232];
    doc.setFillColor(...bg);
    doc.rect(14,y,182,rowH,"F");

    const midY = y + (twoLines ? 5 : 6);

    doc.setFont("helvetica","normal");
    doc.setFontSize(8);
    doc.setTextColor(...NOIR);

    // Désignation ligne 1 : produit
    doc.setFont("helvetica","bold");
    doc.text(prodTxt, COL.desc+1, twoLines?y+4.5:midY);

    // Désignation ligne 2 : dimensions
    if(twoLines){
      doc.setFont("helvetica","normal");
      doc.setFontSize(7);
      doc.setTextColor(...GRIS);
      doc.text(dimTxt, COL.desc+1, y+9.5);
      doc.setFontSize(8);
      doc.setTextColor(...NOIR);
    }

    // Essence
    doc.setFont("helvetica","normal");
    doc.text((l.essence||"—").slice(0,14), COL.essence+1, midY);

    // Quantité (centré)
    doc.setFont("helvetica","bold");
    doc.setTextColor(...BRUN);
    doc.setFontSize(7.5);
    doc.text(qTxt, COL.qte+10, midY, {align:"center", maxWidth:18});
    doc.setFontSize(8);

    // P.U. HT (centré)
    doc.setFont("helvetica","normal");
    doc.setTextColor(...NOIR);
    if(l.prixUnitaire){
      const puNum=pf(l.prixUnitaire);
      const puHT=isTTCpdf?round(puNum/1.2,2):puNum;
      doc.text(`${puHT.toFixed(2)} €`, COL.pu+12, midY, {align:"center"});
      doc.setFontSize(6.5);
      doc.setTextColor(...GRIS);
      const tpLbl=tp==="m³direct"?"m³":tp;
      doc.text(`/${tpLbl}`, COL.pu+12, midY+3.5, {align:"center"});
      doc.setFontSize(8);
      doc.setTextColor(...NOIR);
    } else {
      doc.setTextColor(...GRIS);
      doc.setFontSize(7);
      doc.text("—", COL.pu+12, midY, {align:"center"});
      doc.setFontSize(8);
      doc.setTextColor(...NOIR);
    }

    // TVA%
    doc.setFont("helvetica","normal");
    doc.setFontSize(8);
    doc.text("20 %", COL.tva+6, midY, {align:"center"});

    // Total HT
    if(htVal!=null){
      totalHT+=htVal;
      doc.setFont("helvetica","bold");
      doc.setTextColor(...BRUN);
      doc.text(`${htVal.toFixed(2)} €`, COL.end, midY, {align:"right"});
    } else {
      doc.setFont("helvetica","normal");
      doc.setTextColor(...GRIS);
      doc.setFontSize(7);
      doc.text("—", COL.end, midY, {align:"right"});
    }
    doc.setFont("helvetica","normal");
    doc.setTextColor(...NOIR);
    doc.setFontSize(8);

    // Filet séparateur
    doc.setDrawColor(...OR);
    doc.setLineWidth(0.2);
    doc.line(14, y+rowH, 196, y+rowH);
    y+=rowH;
  });

  // ── Récapitulatif TVA ──
  y+=6;
  if(totalHT>0){
    const tva=round(totalHT*TVA,2);
    const ttc=round(totalHT+tva,2);
    doc.setFillColor(245,237,224);
    doc.roundedRect(110,y,84,34,2,2,"F");
    // Labels colonne gauche
    doc.setFont("helvetica","normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...GRIS);
    doc.text("Total HT",112,y+8);
    doc.text("TVA 20%",112,y+15);
    doc.setFont("helvetica","bold");
    doc.setTextColor(...BRUN);
    doc.text("Total TTC",112,y+25);
    // Valeurs colonne droite
    doc.setFont("helvetica","normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...NOIR);
    doc.text(`${totalHT.toFixed(2)} €`,192,y+8,{align:"right"});
    doc.text(`${tva.toFixed(2)} €`,192,y+15,{align:"right"});
    // Ligne séparatrice avant TTC
    doc.setDrawColor(...OR); doc.setLineWidth(0.3);
    doc.line(110,y+19,194,y+19);
    doc.setFont("helvetica","bold");
    doc.setFontSize(11);
    doc.setTextColor(...OR);
    doc.text(`${ttc.toFixed(2)} €`,192,y+27,{align:"right"});
    y+=40;
  }

  // ── Mentions légales ──
  y=Math.max(y+10,240);
  doc.setDrawColor(...OR);
  doc.setLineWidth(0.5);
  doc.line(14,y,196,y);
  y+=5;
  doc.setFont("helvetica","normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...GRIS);
  doc.text("Pénalités de retard : trois fois le taux annuel d'intérêt légal en vigueur calculé depuis la date d'échéance jusqu'à complet paiement.",14,y);
  doc.text("Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40 €",14,y+5);

  // ── Signature ──
  y+=14;
  doc.setFillColor(245,237,224);
  doc.roundedRect(120,y,76,28,2,2,"F");
  doc.setFont("helvetica","italic");
  doc.setFontSize(8);
  doc.setTextColor(...GRIS);
  doc.text("Date et signature précédées de la mention",122,y+7);
  doc.setFont("helvetica","bold");
  doc.setTextColor(...BRUN);
  doc.text("« Bon pour accord »",122,y+13);

  // ── Footer ──
  doc.setFillColor(...BRUN);
  doc.rect(0,287,210,10,"F");
  doc.setFont("helvetica","normal");
  doc.setFontSize(7.5);
  doc.setTextColor(196,164,122);
  doc.text("EXPLOITATION VERDON · Entrepreneur individuel · SIREN 881 432 348 · N° TVA FR38881432348",105,293,{align:"center"});

  // Ouvrir dans un nouvel onglet (fonctionne sur mobile et Vercel)
  const pdfBlob = doc.output('blob');
  const blobUrl = URL.createObjectURL(pdfBlob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = `Devis_${cmdId}_${(form.client||"client").replace(/[^a-zA-Z0-9]/g,'_')}.pdf`;
  link.target = '_blank';
  document.body.appendChild(link);
  link.click();
  setTimeout(()=>{ document.body.removeChild(link); URL.revokeObjectURL(blobUrl); }, 1000);
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
        style={{flex:1,padding:"9px 4px",fontSize:13,fontWeight:700,fontFamily:"inherit",
          borderRadius:7,cursor:"pointer",transition:"all 0.15s",
          background:value===u?"#2D6A4F":"rgba(255,255,255,.05)",
          color:value===u?"#FFFFFF":"#8A9BB0",
          border:value===u?"1px solid #2D6A4F":"1px solid rgba(255,255,255,.1)"}}>
        {u}
      </button>
    ))}
  </div>;
}

function Card({title,children,accent,style}){ return <div style={{...S.card,...(accent?{borderColor:accent}:{}),...(style||{})}}>{title&&<div style={S.cardTitle}>{title}</div>}{children}</div>; }
function Badge({status}){
  const map={attente:["#2D2208","#FF9F0A"],production:["#0A1F35","#0A84FF"],valide:["#0A2E18","#34C759"],annule:["#2E0A0A","#FF453A"]};
  const [bg,fg]=map[status]||map.attente;
  return <span style={{background:bg,color:fg,padding:"3px 9px",borderRadius:20,fontSize:11,fontWeight:600,whiteSpace:"nowrap",letterSpacing:"0.02em"}}>{{attente:"En attente",production:"En production",valide:"✓ Validée",annule:"Annulée"}[status]||status}</span>;
}
function Stat({label,value,color}){ return <div style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:10,padding:"10px 8px",textAlign:"center"}}><div style={{fontSize:20,fontWeight:700,color:color||"#34C759"}}>{value}</div><div style={{fontSize:9,color:"#8A9BB0",textTransform:"uppercase",letterSpacing:"0.07em",marginTop:2}}>{label}</div></div>; }
function Empty({icon,text}){ return <div style={{textAlign:"center",padding:"50px 20px",color:"#4A5568"}}><div style={{fontSize:36,marginBottom:10}}>{icon}</div><div style={{fontSize:14,color:"#8A9BB0"}}>{text}</div></div>; }
function Spinner(){ return <div style={S.spinner}/>; }
function Mini({label,value,color}){ return <div style={{textAlign:"center"}}><div style={{fontSize:9,color:"#8A9BB0",textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:2}}>{label}</div><div style={{fontSize:12,fontWeight:600,color:color||"#E8ECEF"}}>{value}</div></div>; }
function RItem({label,value,big,color}){ return <div><div style={{fontSize:10,color:"#8A9BB0",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:3,fontWeight:500}}>{label}</div><div style={{fontSize:big?18:14,fontWeight:big?700:600,color:color||"#E8ECEF"}}>{value}</div></div>; }

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
  const [freeSub,setFreeSub]=useState(false);
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
  const slv=(i,v)=>{const tp=v==="m³direct"?"m³direct":v; setForm(p=>{const ls=[...p.lignes];ls[i]={...ls[i],unite:v,typePrix:tp,epaisseur:"",largeur:"",longueur:"",quantite:""};return{...p,lignes:ls};});};
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
      prodId(id,i), l.unite||"m³",          // col 15 = unité
      l.prixUnitaire||"",                    // col 16 = prix unitaire
      l.typePrix||l.unite||"m³",             // col 17 = type prix
      l.typeTaxe||"HT",                      // col 18 = type taxe
      i===0?form.adresseClient||"":"",       // col 19 = adresse client
      i===0?form.adresseLivraison||"":""     // col 20 = adresse livraison
    ]);
    try{
      await callScript(scriptUrl,{type:"commande",rows,id});
      try{ await genererDevisPDF({...form,lignes:[...form.lignes]}, id); }catch(pdfErr){ console.warn("PDF:",pdfErr); }
      setForm(initCmd);
      showToast(`Commande ${id} envoyée — devis téléchargé ✓`);
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
    if(!freeOk||freeSub)return;
    setFreeSub(true);
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
    setFreeSub(false);
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
          <div style={{width:8,height:8,borderRadius:"50%",background:"#34C759",boxShadow:"0 0 8px rgba(52,199,89,.6)"}}/>
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
            <Field label="Date de livraison souhaitée" style={{marginBottom:12}}>
              <Inp type="date" value={form.dateLivraison} onChange={sf("dateLivraison")} min={today()}/>
            </Field>
            <Field label="Adresse client (optionnel)" style={{marginBottom:12}}>
              <Inp value={form.adresseClient||""} onChange={sf("adresseClient")} ph="Ex: 15 rue du Moulin, 73000 Chambéry"/>
            </Field>
            <Field label="Adresse de livraison (optionnel)">
              <Inp value={form.adresseLivraison||""} onChange={sf("adresseLivraison")} ph="Identique ou différente"/>
            </Field>
          </Card>

          {form.lignes.map((lg,i)=>(
            <Card key={i} title={`Produit ${form.lignes.length>1?i+1:""}`} accent={i===0?"rgba(212,168,83,.3)":"rgba(212,168,83,.12)"}>
              {/* Unité de mesure */}
              <Field label="Unité de mesure" style={{marginBottom:12}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:5}}>
                  {[["m³","Unité"],["m³direct","m³"],["m²","m²"],["mL","mL"]].map(([v,lb])=>(
                    <button key={v} type="button" onClick={()=>slv(i,v)}
                      style={{padding:"7px 2px",fontSize:11,fontWeight:600,fontFamily:"inherit",
                        borderRadius:7,cursor:"pointer",lineHeight:1.3,
                        background:(lg.unite||"m³")===v?"#2D6A4F":"rgba(255,255,255,.05)",
                        color:(lg.unite||"m³")===v?"#FFFFFF":"#8A9BB0",
                        border:(lg.unite||"m³")===v?"1px solid #2D6A4F":"1px solid rgba(255,255,255,.08)"}}>
                      {lb}
                    </button>
                  ))}
                </div>
              </Field>
              <Row2 style={{marginBottom:10}}>
                <Field label="Produit"><Sel value={lg.produit} onChange={sl(i,"produit")} opts={PRODUITS}/></Field>
                <Field label="Essence"><Sel value={lg.essence} onChange={sl(i,"essence")} opts={ESSENCES}/></Field>
              </Row2>
              <Field label="Qualité" style={{marginBottom:10}}>
                <Sel value={lg.qualite} onChange={sl(i,"qualite")} opts={QUALITES}/>
              </Field>
              {/* Dimensions selon unité — toujours affichées */}
              {false?null:(
                (lg.unite==="m³"||lg.unite==="m³direct")?(
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
                )
              )}
              {/* Quantité / Total commandé */}
              {(()=>{
                const u=lg.unite||"m³";
                const lbl=u==="m³"?"Quantité (nb d'unités)":u==="m³direct"?"Total commandé (m³)":u==="m²"?"Total commandé (m²)":"Total commandé (mL)";
                const ph=u==="m³"?"100":u==="m³direct"?"ex: 2.5":u==="m²"?"ex: 15":"ex: 50";
                return <Field label={lbl} style={{marginTop:10}}>
                  <Num value={lg.quantite} onChange={sl(i,"quantite")} ph={ph}/>
                </Field>;
              })()}

              {/* Prix : type de tarification + HT/TTC + saisie */}
              <div style={{marginTop:10,background:"rgba(255,255,255,.03)",borderRadius:9,padding:"10px 12px",border:"1px solid rgba(255,255,255,.07)"}}>
                {/* Type de prix (base de calcul) */}
                <div style={{fontSize:11,color:"#8A9BB0",fontWeight:500,marginBottom:6}}>Base de tarification</div>
                <div style={{display:"flex",gap:5,marginBottom:10}}>
                  {(()=>{
                    const u=lg.unite||"m³";
                    const opts=u==="m³"?["m³"]:u==="m³direct"?["m³"]:u==="m²"?["m²","m³"]:["mL","m³"];
                    return opts.map(tp=>(
                      <button key={tp} type="button"
                        onClick={()=>setForm(p=>{const ls=[...p.lignes];ls[i]={...ls[i],typePrix:tp};return{...p,lignes:ls};})}
                        style={{flex:1,padding:"6px 4px",fontSize:12,fontWeight:600,fontFamily:"inherit",
                          borderRadius:6,cursor:"pointer",
                          background:(lg.typePrix||u)===tp?"#2D6A4F":"rgba(255,255,255,.04)",
                          color:(lg.typePrix||u)===tp?"#FFFFFF":"#8A9BB0",
                          border:(lg.typePrix||u)===tp?"1px solid #2D6A4F":"1px solid rgba(255,255,255,.08)"}}>
                        €/{tp}
                      </button>
                    ));
                  })()}
                </div>
                {/* HT ou TTC */}
                <div style={{fontSize:11,color:"#8A9BB0",fontWeight:500,marginBottom:6}}>Type de prix saisi</div>
                <div style={{display:"flex",gap:5,marginBottom:8}}>
                  {["HT","TTC"].map(tt=>(
                    <button key={tt} type="button"
                      onClick={()=>setForm(p=>{const ls=[...p.lignes];ls[i]={...ls[i],typeTaxe:tt};return{...p,lignes:ls};})}
                      style={{flex:1,padding:"6px 4px",fontSize:12,fontWeight:600,fontFamily:"inherit",
                        borderRadius:6,cursor:"pointer",
                        background:(lg.typeTaxe||"HT")===tt?"#0A84FF":"rgba(255,255,255,.04)",
                        color:(lg.typeTaxe||"HT")===tt?"#FFFFFF":"#8A9BB0",
                        border:(lg.typeTaxe||"HT")===tt?"1px solid #0A84FF":"1px solid rgba(255,255,255,.08)"}}>
                      {tt}
                    </button>
                  ))}
                </div>
                <Num value={lg.prixUnitaire||""} onChange={sl(i,"prixUnitaire")} ph={`Ex: ${(lg.typeTaxe||"HT")==="TTC"?"660":"550"} €/${lg.typePrix||lg.unite||"m³"} (${lg.typeTaxe||"HT"})`}/>
              </div>

              {/* Résultat : m³ + montant en temps réel */}
              {(()=>{
                const u=lg.unite||"m³";
                const vol=volLigneM3(lg);
                const ht=ligneHT(lg);
                const nb=pf(lg.quantite);
                const hasQte=nb>0;
                if(!hasQte) return null;
                return <div style={{background:"rgba(52,199,89,.06)",border:"1px solid rgba(52,199,89,.15)",borderRadius:8,padding:"10px 12px",marginTop:8}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8}}>
                    {/* Colonne gauche : quantité + volume */}
                    <div style={{display:"flex",flexDirection:"column",gap:3}}>
                      {u!=="m³"&&<div>
                        <span style={{fontSize:10,color:"#8A9BB0",textTransform:"uppercase"}}>Commandé </span>
                        <span style={{fontSize:15,fontWeight:700,color:"#0A84FF"}}>{nb} {u}</span>
                      </div>}
                      {(u==="m³direct"||vol!=null)&&<div>
                        <span style={{fontSize:10,color:"#8A9BB0",textTransform:"uppercase"}}>
                          {u==="m³"?"Volume charge":u==="m³direct"?"Volume commandé":"Volume m³ équiv."}
                        </span>
                        <span style={{fontSize:16,fontWeight:700,color:"#34C759",marginLeft:4}}>
                          {u==="m³direct"?`${parseFloat(lg.quantite)||0} m³`:vol+" m³"}
                        </span>
                      </div>}
                      {u!=="m³"&&vol==null&&<div style={{fontSize:11,color:"#FF9F0A",marginTop:2}}>
                        ⚠ Renseignez {u==="m²"?"l'épaisseur":"l'épaisseur + largeur"} pour le volume m³
                      </div>}
                    </div>
                    {/* Colonne droite : HT + TTC */}
                    {ht!=null&&(()=>{
                      const isTTC=(lg.typeTaxe||"HT")==="TTC";
                      const htVal=isTTC?round(ht/1.2,2):ht;
                      const ttcVal=isTTC?ht:round(ht*1.2,2);
                      return <div style={{textAlign:"right"}}>
                        <div style={{fontSize:10,color:"#8A9BB0"}}>HT</div>
                        <div style={{fontSize:14,fontWeight:700,color:"#FF9F0A"}}>{htVal.toFixed(2)} €</div>
                        <div style={{fontSize:10,color:"#8A9BB0",marginTop:3}}>TTC</div>
                        <div style={{fontSize:14,fontWeight:700,color:"#34C759"}}>{ttcVal.toFixed(2)} €</div>
                      </div>;
                    })()}
                  </div>
                </div>;
              })()}
              {form.lignes.length>1&&<button style={{...S.btnDel,marginTop:10,width:"100%",textAlign:"center"}} onClick={()=>delL(i)}>🗑 Supprimer ce produit</button>}
            </Card>
          ))}

          <button style={{...S.btnBig,background:"rgba(212,168,83,.08)",color:"#34C759",border:"1px solid rgba(212,168,83,.3)",marginBottom:10}} onClick={addL}>
            + Ajouter un produit
          </button>
          <Card title="Notes">
            <textarea style={{...S.input,minHeight:60,resize:"vertical"}} value={form.notes} onChange={sf("notes")} placeholder="Instructions particulières..."/>
          </Card>
          <button style={{...S.btnBig,...(!formValid||submitting?S.btnDis:{})}} onClick={envoyer} disabled={!formValid||submitting}>
            {submitting?<Spinner/>:"📤 Envoyer la commande"}
          </button>

          {commandes.length>0&&<>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.15em",textTransform:"uppercase",color:"#8A9BB0",margin:"20px 0 10px",paddingBottom:5,borderBottom:"1px solid rgba(255,255,255,.07)"}}>Commandes envoyées</div>
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
                      <div><div style={{fontSize:11,color:"#8A9BB0",fontWeight:500}}>{c.id}</div><div style={{fontWeight:600,color:"#E8ECEF",fontSize:15}}>{c.client}</div></div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}><Badge status={c.statut||"attente"}/><button style={{...S.btnDel,padding:"4px 8px",fontSize:12}} onClick={()=>setConfirmDel(c.id)}>🗑</button></div>
                    </div>
                    {(c.lignes||[]).map((l,i)=>(
                      <div key={i} style={{fontSize:12,color:"#a09080",marginBottom:2}}>
                        • <strong style={{color:"#34C759"}}>{l.produit}</strong>{l.essence?` · ${l.essence}`:""}{l.qualite?` · ${l.qualite}`:""}
                        <span style={{color:"#5bb8d4",fontSize:11}}> [{l.unite||"m³"}]</span>
                        <span style={{color:"#8A9BB0",fontFamily:"monospace",fontSize:11}}> — {dimLabel(l)}</span>
                      </div>
                    ))}
                    <div style={{fontSize:12,color:"#8A9BB0",marginTop:6}}>Livraison : <strong style={{color:"#E8ECEF",fontWeight:500}}>{(d=>d?new Date(d).toLocaleDateString('fr-FR'):"—")(c.dateLivraison||c.datelivraison)}</strong></div>
                      <button style={{...S.btnExport,fontSize:11,padding:"4px 10px",marginTop:4}}
                        onClick={()=>genererDevisPDF({...c,adresseClient:c.adresseClient||'',adresseLivraison:c.adresseLivraison||''},c.id).catch(e=>alert('Erreur PDF: '+e.message))}>📄 Devis PDF</button>
                  </>
                )}
              </Card>
            ))}
          </>}
        </div>}

        {/* ══ À RÉALISER ══ */}
        {tab==="arealiser"&&<div style={S.page}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
            <Stat label="Attente" value={cmdAtt.length} color="#34C759"/>
            <Stat label="Prod." value={cmdProd.length} color="#5bb8d4"/>
            <Stat label="Validées" value={cmdVal.length} color="#6dbf7e"/>
          </div>
          <button style={S.btnRefresh} onClick={()=>load()}>{loading?"⏳ Chargement...":"↻ Actualiser"}</button>
          {!scriptUrl&&<div style={{textAlign:"center",padding:16,color:"#34C759",fontSize:13}}>⚠ Configure l'URL Apps Script dans ⚙ Config</div>}
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
                  <div><div style={{fontSize:11,color:"#0A84FF",fontWeight:500}}>{cmd.id}</div><div style={{fontWeight:600,color:"#E8ECEF",fontSize:15}}>{cmd.client}</div></div>
                  <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
                    <Badge status={cmd.statut||"attente"}/>
                    {cubeCmd&&<span style={{fontSize:10,color:"#6dbf7e"}}>{nbExp}/{nbTot} validé{nbTot>1?"s":""}</span>}
                  </div>
                </div>
                <div style={{fontSize:12,color:"#8A9BB0",marginBottom:6}}>📅 <strong style={{color:"#E8ECEF",fontWeight:500}}>{cmd.dateLivraison||cmd.datelivraison}</strong>{cmd.notes&&<span style={{color:"#8A9BB0",fontStyle:"italic"}}> · "{cmd.notes}"</span>}</div>
                <div style={{marginBottom:10}}>
                  {(cmd.lignes||[]).map((l,i)=>{
                    const pid=prodId(cmd.id,i);
                    const exp=cubeCmd?.[pid]?.exported;
                    const u=l.unite||"m³";
                    return (
                      <div key={i} style={{fontSize:12,marginBottom:3,padding:"4px 8px",borderRadius:6,display:"flex",justifyContent:"space-between",alignItems:"center",background:exp?"rgba(109,191,126,.06)":"rgba(255,255,255,.02)",border:`1px solid ${exp?"rgba(109,191,126,.2)":"transparent"}`}}>
                        <span>
                          <span style={{color:exp?"#6dbf7e":"#34C759",fontWeight:700}}>{exp?"✓ ":""}{l.produit}</span>
                          <span style={{color:"#8A9BB0"}}>{l.essence?` · ${l.essence}`:""}</span>
                          <span style={{color:"#5bb8d4",fontSize:10}}> [{u}]</span>
                          <span style={{color:"#5a4a3a",fontFamily:"monospace",fontSize:11}}> {dimLabel(l)}</span>
                        </span>
                        <span style={{fontSize:10,color:"#5bb8d4",fontFamily:"monospace",background:"rgba(91,184,212,.08)",padding:"2px 5px",borderRadius:4}}>{pid.split("-").slice(-1)[0]}</span>
                      </div>
                    );
                  })}
                </div>
                <button style={{...S.btnSmall,width:"100%",textAlign:"center",background:isOpen?"rgba(91,184,212,.12)":"rgba(212,168,83,.06)",color:isOpen?"#5bb8d4":"#34C759",borderColor:isOpen?"rgba(91,184,212,.3)":"rgba(212,168,83,.2)"}}
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
                            <div style={{fontSize:12,fontWeight:700,color:p.exported?"#6dbf7e":"#34C759",textTransform:"uppercase",letterSpacing:"0.07em"}}>
                              {p.exported?"✓ ":""}{p.produit} · {p.essence}
                              {p.qualite&&<span style={{color:"#8A9BB0",fontWeight:400}}> · {p.qualite}</span>}
                              <span style={{color:"#5bb8d4",fontSize:11,fontWeight:400,textTransform:"none",letterSpacing:0}}> [{u}]</span>
                            </div>
                            <span style={{fontSize:10,color:"#5bb8d4",fontFamily:"monospace",background:"rgba(91,184,212,.08)",padding:"2px 6px",borderRadius:4}}>{pid}</span>
                          </div>
                          {p.exported?(
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6}}>
                              {u==="m³"&&<Mini label="Grume" value={m3f(parseFloat(p.volumeGrume)||0)} color="#a09080"/>}
                              <Mini label={u==="mL"?"Linéaire":"Volume/Surface"} value={m3f(p.volCharge||0,u)} color="#34C759"/>
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
                                  {(u==="m³"||p.volUnit!=null)&&<Mini label={u==="m³"?"Vol. unit.":"Dim. unit."} value={m3f(p.volUnit||0,u)} color="#E8ECEF"/>}
                                  <Mini label={u==="mL"?"Total (mL)":u==="m²"?"Total (m²)":"Vol. charge"} value={m3f(p.volCharge,u)} color="#34C759"/>
                                  {u!=="m³"&&p.volReel!=null&&<Mini label="Vol. réel m³" value={m3f(p.volReel)} color="#FF9F0A"/>}
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
            <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.15em",textTransform:"uppercase",color:"#34C759",marginTop:20,marginBottom:8,paddingBottom:5,borderBottom:"1px solid rgba(52,199,89,.15)"}}>Validées récentes</div>
            {cmdVal.map(cmd=>(
              <div key={cmd.id} style={{...S.card,borderColor:"rgba(109,191,126,.15)",opacity:0.7}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div><div style={{fontSize:11,color:"#0A84FF",fontWeight:500}}>{cmd.id}</div><div style={{fontWeight:700,color:"#E8ECEF"}}>{cmd.client}</div></div>
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
                    <div style={{fontWeight:700,color:"#E8ECEF",fontSize:18}}>{histDetail.type==="libre"?"📐 Cubage libre":histDetail.client}</div>
                  </div>
                  <button style={{...S.btnSmall,fontSize:16,padding:"6px 14px"}} onClick={()=>setHistDetail(null)}>✕</button>
                </div>
                <div style={{fontSize:12,color:"#8A9BB0",marginBottom:14}}>
                  📅 Livraison : <strong style={{color:"#c4b09a"}}>{histDetail.dateLivraison}</strong>
                  {" · "}Validée le <strong style={{color:"#c4b09a"}}>{histDetail.dateValidation}</strong>
                  {histDetail.notes&&<div style={{marginTop:4,color:"#8A9BB0",fontStyle:"italic"}}>"{histDetail.notes}"</div>}
                </div>
                {/* Totaux globaux */}
                {histDetail.lignes&&(()=>{
                  const m3lines=histDetail.lignes.filter(l=>(l.unite||"m³")==="m³");
                  const m2lines=histDetail.lignes.filter(l=>l.unite==="m²");
                  const mLlines=histDetail.lignes.filter(l=>l.unite==="mL");
                  return <div style={{background:"rgba(212,168,83,.06)",borderRadius:10,padding:"10px 12px",marginBottom:14,display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
                    {m3lines.length>0&&<Stat label="Total m³" value={m3f(m3lines.reduce((s,l)=>s+(l.volCharge||0),0))} color="#34C759"/>}
                    {m2lines.length>0&&<Stat label="Total m²" value={m3f(m2lines.reduce((s,l)=>s+(l.volCharge||0),0),"m²")} color="#5bb8d4"/>}
                    {mLlines.length>0&&<Stat label="Total mL" value={m3f(mLlines.reduce((s,l)=>s+(l.volCharge||0),0),"mL")} color="#9A7A54"/>}
                  </div>;
                })()}
                {(histDetail.lignes||[]).map((l,i)=>{
                  const u=l.unite||"m³";
                  return (
                    <div key={i} style={{background:"rgba(30,22,12,.95)",border:"1px solid rgba(212,168,83,.3)",borderRadius:10,padding:"12px",marginBottom:8}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                        <div style={{fontWeight:700,color:"#34C759",fontSize:13}}>{l.produit} · {l.essence}{l.qualite&&<span style={{color:"#8A9BB0",fontWeight:400}}> · {l.qualite}</span>}</div>
                        <span style={{background:"rgba(91,184,212,.12)",color:"#5bb8d4",padding:"2px 8px",borderRadius:12,fontSize:11,fontWeight:700}}>{u}</span>
                      </div>
                      <div style={{fontSize:11,color:"#8A9BB0",fontFamily:"monospace",marginBottom:8}}>
                        {`${l.epaisseur||"—"}mm × ${l.largeur||"—"}mm · ${l.longueur||"—"}m · ${l.nbUnites||"—"}u.`}
                      </div>
                      {(()=>{
                        const cols=u==="m³"?4:(l.volUnit&&l.rend!=null?5:l.volUnit?3:2);
                        return <div style={{display:"grid",gridTemplateColumns:`repeat(${cols},1fr)`,gap:8}}>
                          {u==="m³"&&<Mini label="Grume" value={m3f(l.volumeGrume||0)} color="#a09080"/>}
                          {u!=="m³"&&l.volUnit&&<Mini label="Dim. unit." value={m3f(l.volUnit,u)} color="#E8ECEF"/>}
                          <Mini label={u==="mL"?"Total mL":u==="m²"?"Total m²":"Volume"} value={m3f(l.volCharge||0,u)} color="#34C759"/>
                          {u!=="m³"&&l.volReel!=null&&<Mini label="Vol. réel m³" value={m3f(l.volReel)} color="#FF9F0A"/>}
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
            <div style={{color:"#8A9BB0",fontSize:12}}>{histCmds.length} commande{histCmds.length>1?"s":""} réalisée{histCmds.length>1?"s":""}</div>
            <button style={S.btnRefresh} onClick={loadHist}>{histLoading?"⏳":"↻ Actualiser"}</button>
          </div>
          {!scriptUrl&&<div style={{textAlign:"center",padding:16,color:"#34C759",fontSize:13}}>⚠ Configure l'URL Apps Script dans ⚙ Config</div>}
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
                  <div style={{fontSize:11,color:"#0A84FF",fontWeight:500}}>{h.id}</div>
                  <div style={{fontWeight:700,color:"#E8ECEF",fontSize:14}}>{isLibre?"Cubage libre":h.client}</div>
                </div>
                <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
                  <span style={{fontSize:11,color:accentC,background:`rgba(${isLibre?"154,122,84":"109,191,126"},.1)`,padding:"3px 8px",borderRadius:12,border:`1px solid rgba(${isLibre?"154,122,84":"109,191,126"},.2)`}}>
                    {isLibre?"📐 Libre":"✓ Réalisée"}
                  </span>
                  <span style={{fontSize:10,color:"#8A9BB0"}}>{h.dateValidation}</span>
                </div>
              </div>
              <div style={{fontSize:12,color:"#8A9BB0",marginBottom:6}}>📅 <strong style={{color:"#c4b09a"}}>{isLibre?h.dateValidation:h.dateLivraison}</strong></div>
              {/* Résumé compact */}
              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:6}}>
                {(h.lignes||[]).map((l,i)=>(
                  <span key={i} style={{fontSize:11,color:"#B0BEC5",background:"rgba(255,255,255,.05)",padding:"2px 8px",borderRadius:10,border:"1px solid rgba(255,255,255,.08)"}}>
                    {l.produit} <span style={{color:"#5bb8d4"}}>[{l.unite||"m³"}]</span>
                  </span>
                ))}
              </div>
              <div style={{fontSize:11,color:"#8A9BB0"}}>
                Total : <strong style={{color:"#34C759"}}>{m3f((h.lignes||[]).filter(l=>(l.unite||"m³")==="m³").reduce((s,l)=>s+(l.volCharge||0),0))}</strong>
                {(h.lignes||[]).some(l=>l.unite==="m²")&&<span> · <strong style={{color:"#5bb8d4"}}>{m3f((h.lignes||[]).filter(l=>l.unite==="m²").reduce((s,l)=>s+(l.volCharge||0),0),"m²")}</strong></span>}
                {(h.lignes||[]).some(l=>l.unite==="mL")&&<span> · <strong style={{color:"#9A7A54"}}>{m3f((h.lignes||[]).filter(l=>l.unite==="mL").reduce((s,l)=>s+(l.volCharge||0),0),"mL")}</strong></span>}
              </div>
              <div style={{fontSize:10,color:"#0A84FF",marginTop:6,textAlign:"right"}}>Appuyer pour voir le détail →</div>
            </div>
            );
          })}
        </div>}

        {/* ══ CUBAGE LIBRE ══ */}
        {tab==="libre"&&<div style={S.page}>
          <div style={{fontSize:12,color:"#8A9BB0",marginBottom:14,textAlign:"center"}}>Cubage hors commande — sciage libre</div>

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
                  {u!=="m³"&&freeRes.volReel!=null&&<RItem label="Vol. réel m³" value={m3f(freeRes.volReel)} color="#FF9F0A"/>}
                  {freeRes.rend!=null&&<RItem label="Rendement" value={pct(freeRes.rend)} color="#6dbf7e"/>}
                  {freeRes.perte!=null&&<RItem label="Perte" value={pct(freeRes.perte)} color="#e07a5f"/>}
                </div>
                {freeRes.rend!=null&&<div style={S.rendBar}><div style={{...S.rendFill,width:pct(freeRes.rend)}}/></div>}
              </div>
            );
          })()}
          {!freeRes&&<div style={S.hint}>Remplis les champs pour calculer</div>}

          <button style={{...S.btnBig,...(!freeOk||freeSub?S.btnDis:{})}} onClick={addFree} disabled={!freeOk||freeSub}>
            {freeSub?<Spinner/>:"Cuber et sauvegarder dans l'historique"}
          </button>

          {/* Historique local récent */}
          {freeHistory.length>0&&<>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.15em",textTransform:"uppercase",color:"#9A7A54",margin:"20px 0 10px",paddingBottom:5,borderBottom:"1px solid rgba(154,122,84,.2)"}}>
              Sessions récentes (local)
            </div>
            {freeHistory.slice(0,5).map(e=>{
              const u=e.unite||"m³";
              return (
                <div key={e.id} style={{...S.card,borderColor:"rgba(52,199,89,.15)",borderLeft:"3px solid rgba(52,199,89,.4)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <div>
                      <span style={{fontWeight:700,color:"#34C759"}}>{e.produit} · {e.essence}</span>
                      <span style={{marginLeft:6,fontSize:11,color:"#5bb8d4",background:"rgba(91,184,212,.08)",padding:"1px 6px",borderRadius:8}}>{u}</span>
                    </div>
                    <span style={{fontSize:10,color:"#FF9F0A",background:"rgba(255,159,10,.1)",padding:"2px 7px",borderRadius:8,border:"1px solid rgba(255,159,10,.2)"}}>Libre</span>
                  </div>
                  <div style={{fontSize:11,color:"#8A9BB0",fontFamily:"monospace",marginBottom:6}}>
                    {e.epaisseur&&`${e.epaisseur}×${e.largeur}mm · `}{e.longueur&&`${e.longueur}m · `}
                    <strong style={{color:"#34C759"}}>{m3f(e.volCharge||0,u)}</strong>
                    {e.volReel!=null&&<span style={{color:"#FF9F0A"}}> · réel {m3f(e.volReel)}</span>}
                    {e.rend!=null&&<span style={{color:"#34C759"}}> · {pct(e.rend)}</span>}
                  </div>
                  <div style={{fontSize:10,color:"#5a4a3a"}}>{e.date}</div>
                </div>
              );
            })}
            {freeHistory.length>5&&<div style={{fontSize:11,color:"#8A9BB0",textAlign:"center",marginTop:6}}>+ {freeHistory.length-5} autres · voir l'onglet Historique</div>}
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
        unite:o["unite"]||"m³",
        prixUnitaire:o["prixUnitaire"]||"",
        typePrix:o["typePrix"]||o["unite"]||"m³",
        typeTaxe:o["typeTaxe"]||"HT"
      });
      // Adresses sur la 1ère ligne du bloc
      if(String(o["id"]||"").trim()&&map[cid]){
        if(o["adresseClient"]) map[cid].adresseClient=o["adresseClient"];
        if(o["adresseLivraison"]) map[cid].adresseLivraison=o["adresseLivraison"];
      }
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
        "dateLivraison","notes","statut","dateCreation","prodId","unite",
        "prixUnitaire","typePrix","typeTaxe","adresseClient","adresseLivraison"]);
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
          <div style={{background:"#1A1D20",border:"1px solid rgba(255,255,255,.07)",borderRadius:8,padding:14,fontSize:12,color:"#8A9BB0",lineHeight:1.9}}>
            <strong style={{color:"#34C759",display:"block",marginBottom:6}}>⚠ Nouveau déploiement requis</strong>
            Extensions → Apps Script → remplace tout → <strong style={{color:"#34C759"}}>Nouveau déploiement</strong> → App Web → Tout le monde → Déployer → copier l'URL.<br/>
            <strong style={{color:"#34C759",display:"block",margin:"8px 0 4px"}}>Nouvel onglet Sheet :</strong>
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
  root:{minHeight:"100vh",background:"#1E2023",color:"#E8ECEF",fontFamily:"-apple-system,'Inter',BlinkMacSystemFont,'Segoe UI',sans-serif",display:"flex",flexDirection:"column",maxWidth:480,margin:"0 auto"},
  header:{position:"sticky",top:0,zIndex:20,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"13px 18px",background:"rgba(22,25,28,.98)",borderBottom:"1px solid rgba(255,255,255,.07)",backdropFilter:"blur(10px)"},
  logoText:{fontSize:16,fontWeight:700,letterSpacing:"0.06em",color:"#FFFFFF"},
  alertBadge:{background:"rgba(52,199,89,.15)",border:"1px solid rgba(52,199,89,.35)",color:"#34C759",padding:"4px 10px",borderRadius:20,fontSize:11,fontWeight:600},
  toast:{position:"fixed",top:65,left:"50%",transform:"translateX(-50%)",zIndex:200,padding:"10px 20px",borderRadius:10,fontSize:13,fontWeight:600,whiteSpace:"nowrap",boxShadow:"0 4px 24px rgba(0,0,0,.5)"},
  toastOk:{background:"#1C3A25",color:"#34C759",border:"1px solid rgba(52,199,89,.4)"},
  toastErr:{background:"#3A1C1C",color:"#FF453A",border:"1px solid rgba(255,69,58,.4)"},
  toastWarn:{background:"#3A2E1C",color:"#FF9F0A",border:"1px solid rgba(255,159,10,.4)"},
  main:{flex:1,overflowY:"auto",paddingBottom:80},
  page:{padding:"16px 14px 8px"},
  card:{background:"#272B2F",border:"1px solid rgba(255,255,255,.08)",borderRadius:14,padding:"16px 14px",marginBottom:10,boxShadow:"0 2px 8px rgba(0,0,0,.25)"},
  cardTitle:{fontSize:11,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:"#8A9BB0",marginBottom:12},
  label:{fontSize:11,color:"#8A9BB0",letterSpacing:"0.03em",fontWeight:500},
  select:{background:"#1A1D20",border:"1px solid rgba(255,255,255,.12)",borderRadius:9,color:"#E8ECEF",padding:"11px 12px",fontSize:14,width:"100%",outline:"none",appearance:"none",transition:"border-color .15s"},
  input:{background:"#1A1D20",border:"1px solid rgba(255,255,255,.12)",borderRadius:9,color:"#E8ECEF",padding:"11px 12px",fontSize:14,width:"100%",outline:"none",boxSizing:"border-box",transition:"border-color .15s"},
  numInput:{MozAppearance:"textfield",WebkitAppearance:"none",appearance:"none"},
  resultBox:{background:"#1F2D22",border:"1px solid rgba(52,199,89,.2)",borderRadius:12,padding:"16px",marginBottom:12},
  rendBar:{height:5,background:"rgba(255,255,255,.08)",borderRadius:3,overflow:"hidden"},
  rendFill:{height:"100%",background:"linear-gradient(90deg,#1A5C35,#34C759)",borderRadius:3,transition:"width .4s"},
  hint:{textAlign:"center",color:"#4A5568",fontSize:13,padding:"20px 0"},
  btnBig:{width:"100%",padding:"14px",fontSize:14,fontWeight:600,background:"#2D6A4F",color:"#FFFFFF",border:"none",borderRadius:10,cursor:"pointer",letterSpacing:"0.02em",boxShadow:"0 2px 12px rgba(45,106,79,.35)",marginBottom:8,display:"flex",alignItems:"center",justifyContent:"center",gap:8,transition:"opacity .15s"},
  btnDis:{opacity:.35,cursor:"not-allowed"},
  btnSmall:{padding:"8px 14px",fontSize:12,fontWeight:500,border:"1px solid rgba(255,255,255,.12)",background:"rgba(255,255,255,.05)",color:"#B0BEC5",borderRadius:8,cursor:"pointer"},
  btnRefresh:{padding:"8px 14px",fontSize:12,background:"rgba(255,255,255,.04)",color:"#8A9BB0",border:"1px solid rgba(255,255,255,.07)",borderRadius:8,cursor:"pointer"},
  btnExport:{padding:"9px",fontSize:12,background:"rgba(52,199,89,.08)",color:"#34C759",border:"1px solid rgba(52,199,89,.25)",borderRadius:8,cursor:"pointer",fontWeight:500},
  btnDel:{padding:"9px 12px",fontSize:13,background:"rgba(255,69,58,.06)",color:"#FF453A",border:"1px solid rgba(255,69,58,.2)",borderRadius:8,cursor:"pointer"},
  nav:{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,zIndex:20,display:"flex",background:"rgba(22,25,28,.98)",borderTop:"1px solid rgba(255,255,255,.07)",backdropFilter:"blur(12px)",paddingBottom:"env(safe-area-inset-bottom,0px)"},
  navBtn:{flex:1,padding:"11px 2px 9px",display:"flex",flexDirection:"column",alignItems:"center",gap:3,background:"transparent",border:"none",color:"#4A5568",cursor:"pointer",transition:"color .15s"},
  navBtnActive:{color:"#34C759"},
  navIcon:{fontSize:18},
  navLabel:{fontSize:9,letterSpacing:"0.05em",textTransform:"uppercase",fontWeight:500},
  pre:{background:"#141618",border:"1px solid rgba(255,255,255,.07)",borderRadius:8,padding:"12px",fontSize:10,color:"#8A9BB0",overflowX:"auto",lineHeight:1.75,marginTop:8,fontFamily:"'SF Mono','Fira Code',monospace",whiteSpace:"pre-wrap",wordBreak:"break-all"},
  spinner:{width:16,height:16,border:"2px solid rgba(255,255,255,.15)",borderTop:"2px solid #FFFFFF",borderRadius:"50%",animation:"spin .8s linear infinite"},
};
