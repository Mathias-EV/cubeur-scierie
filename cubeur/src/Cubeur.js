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

// Nb d'unités pour m³direct : ceil(total_m³ / vol_unitaire)
function nbUnitesM3Direct(l){
  const ep=pf(l.epaisseur)/1000, la=pf(l.largeur)/1000, lo=pf(l.longueur);
  const totalM3=pf(l.quantite);
  if(!ep||!la||!lo||!totalM3||totalM3<=0) return null;
  const volUnit=round(ep*la*lo,6);
  if(volUnit<=0) return null;
  return Math.ceil(totalM3/volUnit);
}

// Nb d'unités pour m² : ceil(total_m² / (la×lo))
function nbUnitesM2(l){
  const la=pf(l.largeur)/1000, lo=pf(l.longueur);
  const totalM2=pf(l.quantite);
  if(!la||!lo||!totalM2||totalM2<=0) return null;
  const surfUnit=round(la*lo,6);
  if(surfUnit<=0) return null;
  return Math.ceil(totalM2/surfUnit);
}

// Nb d'unités pour mL : ceil(total_mL / lo)
function nbUnitesMl(l){
  const lo=pf(l.longueur);
  const totalMl=pf(l.quantite);
  if(!lo||!totalMl||totalMl<=0) return null;
  return Math.ceil(totalMl/lo);
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
  const loadJsPDF = () => new Promise((resolve, reject) => {
    if(window.jspdf && window.jspdf.jsPDF){ resolve(window.jspdf.jsPDF); return; }
    const existing = document.querySelector('script[data-jspdf]');
    if(existing){
      const wait = setInterval(()=>{ if(window.jspdf && window.jspdf.jsPDF){ clearInterval(wait); resolve(window.jspdf.jsPDF); } }, 50);
      setTimeout(()=>{ clearInterval(wait); reject(new Error('Timeout')); }, 5000); return;
    }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.setAttribute('data-jspdf','1');
    s.onload = () => { if(window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF); else reject(new Error('jsPDF non défini')); };
    s.onerror = () => reject(new Error('Erreur chargement'));
    document.head.appendChild(s);
  });
  let JsPDF;
  try { JsPDF = await loadJsPDF(); } catch(e) { alert("PDF indisponible : "+e.message); return; }

  const doc = new JsPDF({ unit:"mm", format:"a4" });

  // ── Palette ──
  const OR_R=196, OR_G=144, OR_B=74;   // #C4904A
  const BRUN_R=44, BRUN_G=26, BRUN_B=10;
  const GRIS=[140,140,140], NOIR=[30,30,30], GRIS_CLAIR=[200,200,200];
  const BG_LIGNE1=[252,248,242], BG_LIGNE2=[255,255,255];

  // ── Helpers ──
  const fmtNum = (n) => n.toFixed(2).replace(".", ",");
  const fmtSpace = (n) => {
    const s=fmtNum(n); const [int,dec]=s.split(",");
    return int.replace(/\B(?=(\d{3})+(?!\d))/g," ")+","+dec;
  };
  const fmtDate = (d) => {
    if(!d) return "—";
    try{ return new Date(d).toLocaleDateString("fr-FR",{day:"2-digit",month:"long",year:"numeric"}); }
    catch(e){ return d; }
  };
  const today = new Date();
  const expiry = new Date(today); expiry.setMonth(expiry.getMonth()+1);

  // ── LOGO ──
  const LOGO_DATA = "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";
  try {
    doc.addImage("data:image/png;base64,"+LOGO_DATA, "PNG", 14, 12, 22, 23);
  } catch(e) { console.warn("Logo PDF:", e); }

  // ── Nom entreprise sous le logo ──
  doc.setFont("helvetica","bold");
  doc.setFontSize(9);
  doc.setTextColor(OR_R, OR_G, OR_B);
  doc.text("EXPLOITATION", 14, 39);
  doc.setFontSize(13);
  doc.text("VERDON", 14, 45);

  // ── Titre "Devis" + Numéro + Dates (colonne gauche) ──
  doc.setFontSize(18);
  doc.setTextColor(OR_R, OR_G, OR_B);
  doc.text("Devis", 14, 60);

  doc.setFontSize(8.5);
  doc.setFont("helvetica","bold");
  doc.setTextColor(...NOIR);
  doc.text("Numéro", 14, 68);
  doc.text("Date d'émission", 14, 73);
  doc.text("Date d'expiration", 14, 78);
  doc.setFont("helvetica","normal");
  doc.text(cmdId, 50, 68);
  doc.text(fmtDate(today), 50, 73);
  doc.text(fmtDate(expiry), 50, 78);

  // ── ÉMETTEUR (colonne droite haut) ──
  doc.setFont("helvetica","normal");
  doc.setFontSize(8);
  doc.setTextColor(...GRIS);
  doc.text("Émetteur ou Émettrice", 112, 16);
  doc.setFont("helvetica","bold");
  doc.setFontSize(9);
  doc.setTextColor(OR_R, OR_G, OR_B);
  doc.text("EXPLOITATION VERDON", 112, 21);
  doc.setFont("helvetica","normal");
  doc.setFontSize(8);
  doc.setTextColor(...NOIR);
  doc.text("236 RUE DES TISSERANDS", 112, 26);
  doc.text("73540 LA BATHIE - France", 112, 30);
  doc.text("etf.verdon@gmail.com", 112, 34);

  // ── CLIENT (colonne droite bas) ──
  doc.setFont("helvetica","normal");
  doc.setFontSize(8);
  doc.setTextColor(...GRIS);
  doc.text("Client ou Cliente", 112, 42);
  doc.setFont("helvetica","bold");
  doc.setFontSize(9);
  doc.setTextColor(OR_R, OR_G, OR_B);
  doc.text(form.client||"—", 112, 47);
  let yc = 52;
  doc.setFont("helvetica","normal");
  doc.setFontSize(8);
  doc.setTextColor(...NOIR);
  if(form.adresseClient){
    doc.splitTextToSize(form.adresseClient, 84).forEach(l=>{ doc.text(l,112,yc); yc+=4; });
  }
  if(form.adresseLivraison && form.adresseLivraison !== form.adresseClient){
    yc+=1;
    doc.setTextColor(...GRIS);
    doc.text("Adresse de livraison :", 112, yc); yc+=4;
    doc.setTextColor(...NOIR);
    doc.splitTextToSize(form.adresseLivraison, 84).forEach(l=>{ doc.text(l,112,yc); yc+=4; });
  }

  // ── Ligne de séparation ──
  let y = Math.max(82, yc + 6);
  doc.setDrawColor(...GRIS_CLAIR);
  doc.setLineWidth(0.3);
  doc.line(14, y, 196, y);
  y += 6;

  // ── Groupe essence (titre de section) ──
  const essenceGroupe = (form.lignes||[]).map(l=>l.essence||"").filter(Boolean);
  const essenceUnique = [...new Set(essenceGroupe)].join(", ");
  if(essenceUnique){
    doc.setFont("helvetica","bold");
    doc.setFontSize(11);
    doc.setTextColor(OR_R, OR_G, OR_B);
    doc.text(essenceUnique, 14, y);
    y += 6;
  }

  // ── TABLEAU ──
  const CL = { prod:14, qte:96, pu:128, tva:160, total:196 };

  // En-tête
  doc.setFillColor(240,236,228);
  doc.rect(14, y, 182, 7, "F");
  doc.setFont("helvetica","bold");
  doc.setFontSize(8);
  doc.setTextColor(...NOIR);
  doc.text("Produits", CL.prod+1, y+5);
  doc.text("Qté", (CL.qte+CL.pu)/2, y+5, {align:"center"});
  doc.text("Prix u. HT", (CL.pu+CL.tva)/2, y+5, {align:"center"});
  doc.text("TVA (%)", (CL.tva+CL.total)/2-4, y+5, {align:"center"});
  doc.text("Total HT", CL.total, y+5, {align:"right"});
  y += 7;

  let totalHT = 0;
  (form.lignes||[]).forEach((l,i)=>{
    const u = l.unite||"m³";
    const nb = pf(l.quantite)||0;
    const isTTC = (l.typeTaxe||"HT")==="TTC";
    let puNum = pf(l.prixUnitaire)||0;
    if(isTTC) puNum = round(puNum/1.2, 4);
    const tp = (l.typePrix||u)==="m³direct"?"m³":l.typePrix||u;
    const vol = volLigneM3(l);
    const htRaw = ligneHT(l);
    const htVal = htRaw!=null?(isTTC?round(htRaw/1.2,2):htRaw):null;

    // Désignation : ep×larg essence long
    let desig = "";
    if(l.epaisseur&&l.largeur) desig+=`${l.epaisseur}x${l.largeur}`;
    if(l.essence) desig+=` ${l.essence}`;
    if(l.longueur) desig+=` ${l.longueur}m`;
    if(!desig) desig=l.produit||"—";

    // Quantité
    let qteStr="";
    if(u==="m³") qteStr=vol!=null?`${vol} m³`:`${nb} u.`;
    else if(u==="m³direct") qteStr=`${nb} m³`;
    else if(u==="m²") qteStr=vol!=null?`${nb} m² (${vol} m³)`:`${nb} m²`;
    else if(u==="mL") qteStr=vol!=null?`${nb} mL (${vol} m³)`:`${nb} mL`;
    else qteStr=`${nb} u.`;

    const bg = i%2===0 ? BG_LIGNE1 : BG_LIGNE2;
    doc.setFillColor(...bg);
    doc.rect(14, y, 182, 8, "F");
    doc.setFont("helvetica","normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...NOIR);
    doc.text(desig.slice(0,32), CL.prod+1, y+5.5);
    doc.text(qteStr, (CL.qte+CL.pu)/2, y+5.5, {align:"center"});
    if(puNum>0) doc.text(`${fmtNum(puNum)} €`, (CL.pu+CL.tva)/2, y+5.5, {align:"center"});
    doc.text("20%", (CL.tva+CL.total)/2-4, y+5.5, {align:"center"});
    if(htVal!=null){
      totalHT += htVal;
      doc.text(`${fmtNum(htVal)} €`, CL.total, y+5.5, {align:"right"});
    }
    doc.setDrawColor(...GRIS_CLAIR);
    doc.setLineWidth(0.2);
    doc.line(14, y+8, 196, y+8);
    y += 8;
  });

  y += 8;
  const tva = round(totalHT*0.20, 2);
  const ttc = round(totalHT+tva, 2);

  // ── Détails TVA + Récapitulatif côte à côte ──
  // Détails TVA (gauche)
  doc.setFont("helvetica","bold");
  doc.setFontSize(11);
  doc.setTextColor(OR_R, OR_G, OR_B);
  doc.text("Détails TVA", 14, y);

  doc.setFont("helvetica","bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...NOIR);
  doc.text("Taux", 14, y+8);
  doc.text("Montant TVA", 40, y+8);
  doc.text("Base HT", 80, y+8);
  doc.setDrawColor(...GRIS_CLAIR); doc.setLineWidth(0.3);
  doc.line(14, y+9.5, 100, y+9.5);
  doc.setFont("helvetica","normal");
  doc.text("20%", 14, y+15);
  doc.text(`${fmtNum(tva)} €`, 40, y+15);
  doc.text(`${fmtNum(totalHT)} €`, 80, y+15);

  // Récapitulatif (droite)
  doc.setFont("helvetica","bold");
  doc.setFontSize(11);
  doc.setTextColor(OR_R, OR_G, OR_B);
  doc.text("Récapitulatif", 130, y);
  doc.setFontSize(8.5);
  doc.setTextColor(...NOIR);
  doc.setFont("helvetica","normal");
  doc.text("Total HT", 130, y+8);
  doc.text(`${fmtNum(totalHT)} €`, 196, y+8, {align:"right"});
  doc.text("Total TVA", 130, y+14);
  doc.text(`${fmtNum(tva)} €`, 196, y+14, {align:"right"});
  doc.setDrawColor(...GRIS_CLAIR); doc.setLineWidth(0.3);
  doc.line(130, y+16, 196, y+16);
  doc.setFont("helvetica","bold");
  doc.setFontSize(10);
  doc.text("Total TTC", 130, y+22);
  doc.text(`${fmtSpace(ttc)} €`, 196, y+22, {align:"right"});

  y += 35;

  // ── Livraison ──
  if(form.dateLivraison){
    doc.setFont("helvetica","normal");
    doc.setFontSize(8);
    doc.setTextColor(...GRIS);
    doc.text(`Livraison souhaitée : ${fmtDate(form.dateLivraison)}`, 14, y);
    y += 8;
  }

  // ── Mentions légales ──
  y = Math.max(y, 230);
  doc.setDrawColor(...GRIS_CLAIR); doc.setLineWidth(0.3);
  doc.line(14, y, 196, y); y+=5;
  doc.setFont("helvetica","normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...GRIS);
  doc.text("Pénalités de retard : trois fois le taux annuel d'intérêt légal en vigueur calculé depuis la date d'échéance jusqu'à complet", 14, y); y+=4;
  doc.text("paiement du prix.", 14, y); y+=4;
  doc.text("Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40 €", 14, y); y+=8;

  // ── Signature ──
  doc.setFont("helvetica","normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...NOIR);
  doc.text("Date et signature précédées de la mention", 14, y); y+=5;
  doc.setFont("helvetica","italic");
  doc.text("« Bon pour accord »", 14, y);

  // ── Footer ──
  doc.setFontSize(7);
  doc.setFont("helvetica","normal");
  doc.setTextColor(...GRIS);
  doc.text("EXPLOITATION VERDON | Entrepreneur individuel | N° SIREN 881.432.348 | N° de TVA FR38881432348", 105, 290, {align:"center"});
  doc.setDrawColor(...GRIS_CLAIR); doc.setLineWidth(0.2);
  doc.line(14, 285, 196, 285);

  // ── Téléchargement ──
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Devis_${cmdId}_${(form.client||"client").replace(/[^a-zA-Z0-9]/g,'_')}.pdf`;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
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
                    {/* Colonne gauche : même layout pour toutes les unités */}
                    <div style={{display:"flex",flexDirection:"column",gap:4}}>
                      {/* Ligne 1 : volume / total commandé */}
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:10,color:"#8A9BB0",textTransform:"uppercase"}}>
                          {u==="m³"?"Volume charge":u==="m³direct"?"Volume commandé":u==="m²"?"Total m²":"Total mL"}
                        </span>
                        <span style={{fontSize:14,fontWeight:700,color:"#34C759"}}>
                          {u==="m³"?(vol!=null?vol+" m³":"—"):u==="m³direct"?`${pf(lg.quantite)||0} m³`:`${nb} ${u}`}
                        </span>
                      </div>
                      {/* Ligne 2 : volume m³ équivalent (pour m²/mL seulement) */}
                      {(u==="m²"||u==="mL")&&vol!=null&&
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontSize:10,color:"#8A9BB0",textTransform:"uppercase"}}>Vol. m³ équiv.</span>
                          <span style={{fontSize:14,fontWeight:700,color:"#34C759"}}>{vol} m³</span>
                        </div>
                      }
                      {(u==="m²"||u==="mL")&&vol==null&&
                        <div style={{fontSize:11,color:"#FF9F0A"}}>
                          ⚠ Renseignez {u==="m²"?"l'épaisseur":"l'épaisseur + largeur"} pour le vol. m³
                        </div>
                      }
                      {/* Ligne 3 : nb de pièces */}
                      {(()=>{
                        let n=null;
                        if(u==="m³direct") n=nbUnitesM3Direct(lg);
                        else if(u==="m²") n=nbUnitesM2(lg);
                        else if(u==="mL") n=nbUnitesMl(lg);
                        if(n==null) return null;
                        return <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontSize:10,color:"#8A9BB0",textTransform:"uppercase"}}>Nb de pièces</span>
                          <span style={{fontSize:14,fontWeight:700,color:"#0A84FF"}}>{n} pièces</span>
                        </div>;
                      })()}
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
                <div style={{display:"flex",gap:10,marginTop:8}}>
                  {histDetail.type!=="libre"&&
                    <button style={{...S.btnBig,marginBottom:0,flex:1}}
                      onClick={()=>genererDevisPDF({
                        client:histDetail.client,
                        dateLivraison:histDetail.dateLivraison,
                        notes:histDetail.notes||"",
                        adresseClient:histDetail.adresseClient||"",
                        adresseLivraison:histDetail.adresseLivraison||"",
                        lignes:(histDetail.lignes||[]).map(l=>({
                          produit:l.produit, essence:l.essence, qualite:l.qualite,
                          epaisseur:l.epaisseur, largeur:l.largeur, longueur:l.longueur,
                          quantite:l.nbUnites||l.quantite||l.volCharge,
                          unite:l.unite||"m³", prixUnitaire:l.prixUnitaire||"",
                          typePrix:l.typePrix||l.unite||"m³", typeTaxe:l.typeTaxe||"HT"
                        }))
                      }, histDetail.id).catch(e=>alert("Erreur PDF: "+e.message))}>
                      📄 Télécharger le devis
                    </button>
                  }
                  <button style={{...S.btnSmall,fontSize:14,padding:"12px 20px"}} onClick={()=>setHistDetail(null)}>✕ Fermer</button>
                </div>
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
