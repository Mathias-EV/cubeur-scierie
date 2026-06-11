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
const initCmd   = { client:"",dateLivraison:"",notes:"",adresseClient:"",adresseLivraison:"",remise:"",livraisonType:"",livraisonVal:"",lignes:[{...initLigne}] };
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
  const PAGE_H = 297; // A4 hauteur mm
  const MARGIN_BOTTOM = 30; // zone réservée en bas (footer + mentions)
  const MAX_Y = PAGE_H - MARGIN_BOTTOM;

  // Nouvelle page si nécessaire, retourne le nouveau y
  const checkPage = (yPos, neededH=10) => {
    if(yPos + neededH > MAX_Y){
      doc.addPage();
      // Footer sur la nouvelle page aussi
      doc.setFontSize(7); doc.setFont("helvetica","normal");
      doc.setTextColor(140,140,140);
      doc.text("EXPLOITATION VERDON | Entrepreneur individuel | N° SIREN 881.432.348 | N° de TVA FR38881432348", 105, 290, {align:"center"});
      doc.setDrawColor(200,200,200); doc.setLineWidth(0.2);
      doc.line(14, 285, 196, 285);
      return 14; // y repart du haut
    }
    return yPos;
  };
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

  // ── LOGO centré à gauche avec texte aligné ──
  const LOGO_DATA = "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";
  const LOGO_X=14, LOGO_W=28, LOGO_H=29;
  try {
    doc.addImage("data:image/png;base64,"+LOGO_DATA, "PNG", LOGO_X, 8, LOGO_W, LOGO_H);
  } catch(e) { console.warn("Logo PDF:", e); }
  // "EXPLOITATION" et "VERDON" en noir gras, centrés sous le logo
  const logoCenter = LOGO_X + LOGO_W/2;
  doc.setFont("helvetica","bold");
  doc.setFontSize(8);
  doc.setTextColor(30,30,30);
  doc.text("EXPLOITATION", logoCenter, 40, {align:"center"});
  doc.setFontSize(12);
  doc.setTextColor(30,30,30);
  doc.text("VERDON", logoCenter, 46, {align:"center"});

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

    // Désignation : ep×larg essence long (si longueur absente → date de livraison)
    let desig = "";
    if(l.epaisseur&&l.largeur) desig+=`${l.epaisseur}x${l.largeur}`;
    if(l.essence) desig+=` ${l.essence}`;
    if(l.longueur){ desig+=` ${l.longueur}m`; }
    if(!desig) desig=l.produit||"—";

    // Quantité
    let qteStr="";
    if(u==="m³"){ const nbPcs=Math.round(nb); qteStr=vol!=null&&nbPcs>0?`${vol} m³ (${nbPcs} pcs)`:vol!=null?`${vol} m³`:`${nb} u.`; }
    else if(u==="m³direct") qteStr=`${nb} m³`;
    else if(u==="m²") qteStr=vol!=null?`${nb} m² (${vol} m³)`:`${nb} m²`;
    else if(u==="mL") qteStr=vol!=null?`${nb} mL (${vol} m³)`:`${nb} mL`;
    else qteStr=`${nb} u.`;

    // Nouvelle page si besoin
    y = checkPage(y, 9);
    // Ré-afficher l'en-tête tableau si on vient de changer de page
    if(y < 20){
      doc.setFillColor(240,236,228);
      doc.rect(14, y, 182, 7, "F");
      doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(...NOIR);
      doc.text("Produits", CL.prod+1, y+5);
      doc.text("Qté", (CL.qte+CL.pu)/2, y+5, {align:"center"});
      doc.text("Prix u. HT", (CL.pu+CL.tva)/2, y+5, {align:"center"});
      doc.text("TVA (%)", (CL.tva+CL.total)/2-4, y+5, {align:"center"});
      doc.text("Total HT", CL.total, y+5, {align:"right"});
      y += 7;
    }

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

  y = checkPage(y, 90);

  // ── Ligne livraison (si définie) ──
  const livrType = form.livraisonType||"";
  const livrVal  = pf(form.livraisonVal)||0;
  let livrHT = 0;
  if(livrType==="km"&&livrVal>0)   livrHT = round(livrVal,2);
  if(livrType==="prix"&&livrVal>0) livrHT = round(livrVal,2);
  if(livrType==="km"||livrType==="prix"||livrType==="offert"){
    doc.setFillColor(248,248,255);
    doc.rect(14, y, 182, 8, "F");
    doc.setFont("helvetica","italic");
    doc.setFontSize(8.5);
    doc.setTextColor(...GRIS);
    const livrLabel = livrType==="offert"?"🎁 Livraison offerte":
                      livrType==="km"?`Livraison (${livrVal} km × 1 €/km)`:"Livraison";
    doc.text(livrLabel, CL.prod+1, y+5.5);
    if(livrType==="offert"){
      doc.setTextColor(0,150,80);
      doc.setFont("helvetica","bold");
      doc.text("Offerte", CL.total, y+5.5, {align:"right"});
    } else if(livrHT>0){
      doc.setTextColor(...NOIR);
      doc.setFont("helvetica","normal");
      doc.text(`${fmtNum(livrHT)} €`, CL.total, y+5.5, {align:"right"});
      totalHT += livrHT;
    }
    doc.setDrawColor(...GRIS_CLAIR); doc.setLineWidth(0.2);
    doc.line(14, y+8, 196, y+8);
    y += 10;
  }

  const remisePct = pf(form.remise)||0;
  const remiseMt  = remisePct>0 ? round(totalHT*remisePct/100, 2) : 0;
  const baseHTApres = round(totalHT - remiseMt, 2);
  const tva = round(baseHTApres*0.20, 2);
  const ttc = round(baseHTApres+tva, 2);

  // ── Ligne remise séparée sous le tableau ──
  if(remiseMt>0){
    y += 4; // espace après le tableau
    doc.setFillColor(255,245,242);
    doc.roundedRect(14, y, 182, 9, 1, 1, "F");
    doc.setFont("helvetica","italic");
    doc.setFontSize(8.5);
    doc.setTextColor(...GRIS);
    doc.text(`Remise commerciale ${remisePct}%`, CL.prod+1, y+6);
    doc.setTextColor(200,60,40);
    doc.setFont("helvetica","bold");
    doc.text(`- ${fmtNum(remiseMt)} €`, CL.total, y+6, {align:"right"});
    y += 14; // espace après la ligne remise
  } else {
    y += 8;
  }

  // ── Détails TVA + Récapitulatif côte à côte ──
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
  doc.text(`${fmtNum(baseHTApres)} €`, 80, y+15);

  // Récapitulatif (droite)
  doc.setFont("helvetica","bold");
  doc.setFontSize(11);
  doc.setTextColor(OR_R, OR_G, OR_B);
  doc.text("Récapitulatif", 130, y);
  doc.setFontSize(8.5);
  doc.setTextColor(...NOIR);
  doc.setFont("helvetica","normal");
  doc.text("Total HT brut", 130, y+8);
  doc.text(`${fmtNum(totalHT)} €`, 196, y+8, {align:"right"});
  let yRecap = y+8;
  if(remiseMt>0){
    yRecap+=6;
    doc.setTextColor(200,60,40);
    doc.text(`Remise ${remisePct}%`, 130, yRecap);
    doc.text(`- ${fmtNum(remiseMt)} €`, 196, yRecap, {align:"right"});
    yRecap+=6;
    doc.setTextColor(...NOIR);
    doc.text("Total HT net", 130, yRecap);
    doc.text(`${fmtNum(baseHTApres)} €`, 196, yRecap, {align:"right"});
    yRecap+=6;
  } else {
    yRecap+=6;
  }
  doc.text("Total TVA", 130, yRecap);
  doc.text(`${fmtNum(tva)} €`, 196, yRecap, {align:"right"});
  doc.setDrawColor(...GRIS_CLAIR); doc.setLineWidth(0.3);
  doc.line(130, yRecap+2, 196, yRecap+2);
  doc.setFont("helvetica","bold");
  doc.setFontSize(10);
  doc.text("Total TTC", 130, yRecap+8);
  doc.text(`${fmtSpace(ttc)} €`, 196, yRecap+8, {align:"right"});

  y = yRecap+20;

  // ── Livraison ──
  if(form.dateLivraison){
    doc.setFont("helvetica","bold");
    doc.setFontSize(9);
    doc.setTextColor(...NOIR);
    doc.text(`Livraison souhaitée : ${fmtDate(form.dateLivraison)}`, 14, y);
    y += 8;
  }

  // ── Mentions légales ──
  y = checkPage(y, 40); // s'assurer assez de place
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

  // ── Footer sur la dernière page ──
  const totalPages = doc.getNumberOfPages();
  for(let pg=1; pg<=totalPages; pg++){
    doc.setPage(pg);
    doc.setFontSize(7); doc.setFont("helvetica","normal");
    doc.setTextColor(...GRIS);
    doc.text("EXPLOITATION VERDON | Entrepreneur individuel | N° SIREN 881.432.348 | N° de TVA FR38881432348", 105, 290, {align:"center"});
    doc.setDrawColor(...GRIS_CLAIR); doc.setLineWidth(0.2);
    doc.line(14, 285, 196, 285);
    if(totalPages>1){
      doc.text(`Page ${pg}/${totalPages}`, 196, 290, {align:"right"});
    }
  }

  // ── Téléchargement ──
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Devis_${cmdId}_${(form.client||"client").replace(/[^a-zA-Z0-9]/g,'_')}.pdf`;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
}


async function genererFacturePDF(form, cmdId){
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
    s.onload = () => { if(window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF); else reject(new Error('jsPDF non defini')); };
    s.onerror = () => reject(new Error('Erreur chargement'));
    document.head.appendChild(s);
  });
  let JsPDF;
  try { JsPDF = await loadJsPDF(); } catch(e) { alert("PDF indisponible : "+e.message); return; }
  const doc = new JsPDF({ unit:"mm", format:"a4" });

  // Palette (fond blanc, textes noirs/gris, accent orange Pennylane)
  const NOIR=[30,30,30], GRIS=[120,120,120], GRIS_L=[200,200,200];
  const ORANGE=[196,144,74]; // couleur accent titre comme le modèle
  const BG_TABLE=[245,245,245]; // fond en-tête tableau
  const BG_ALT=[252,250,248];   // fond lignes alternées
  const BG_RECAP=[248,248,250]; // fond recap

  const fmtNum=(n)=>n.toFixed(2).replace(".",",");
  const fmtSpace=(n)=>{const s=fmtNum(n);const[a,b]=s.split(",");return a.replace(/\B(?=(\d{3})+(?!\d))/g," ")+","+b;};
  const fmtDate=(d)=>{if(!d)return "—";try{return new Date(d).toLocaleDateString("fr-FR",{day:"2-digit",month:"short",year:"numeric"});}catch(e){return d;}};
  const today=new Date();
  const echeance=new Date(today); echeance.setMonth(echeance.getMonth()+1);

  // Numéro facture (F- + date + id court)
  const numFact="F-"+today.getFullYear()+"-"+cmdId.slice(-3);

  // ── LOGO haut gauche ──
  const LOGO_DATA="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mXcfGb3/gUc2blh34YUbXFJzVnRYYLI3v/n2Y0eP7d2zuxZJVsFIWeIlS8PAwaYAWIMJPp2ZidcZ1txn/Rz2YPYgAlKXXn3pef/unrfPWzDfTU2K2LCQ81GEQMGJeK+CUCMXNZIXX9r2wEOPJilKpZLzYl3dW0eeiKEgK1b0nb/pnNHhk889/3KmBORFbr/15qXLlj762KM7du4sFvNiXZQkADnv29tb165Z093dmS/k0zQ9eerUjld37tt/IDtWxWDFWeqNVMaUgvNNyC2X0yxIKxWtiJUWkewWgsoywW7G6xDAiC0AUqZZIpIN19RunDNzTc7CnDxhtjcEgZQOAYGbyX4QCA5AUMpFjQqiRuu8ee++5+5SIf9Hf/HpB598HorfffD4i9t2jo6OZ0RDghO4GakPD4YO2Rg9MV555pnnrEvf9lN3//TP3POZT3/utV37hChnOE4ds2LwnoP9//jZL/3ar/7y29/2Uwf2H5qcnGCtG41o585dcRTfeP21N1x3dbFQePLJp2ycFsIwiuPQmBe37vnS1791zqa1uXw+npqK40ZgQlMI777j+r279nzsa48AyBuy1jdZD5lGU6icTTJpKswop541ziwund1SkgBCTJloz+rFLW99x92bz7+odvIU2UTnAzBzLqBM8IqU9whzhRefeeHe+x4CKWb2XillZmafrRXN/h1vvaNQKH7u818ol4LQsFJ69apV11x33YsvvfjUU88FxhjNQuQFXmReT9fll11y+eWXLVy48MjhI5/57Be++tVv7Nt/INBKqUyMn+F9LpcrtbQEuUKWZWGmjD3HJN47551kYmuzt0rTS82e84zoI3GTup3ZSvZkk30755Fl4QVz8v+zmcw5Wevm3/IE0aEhxS5uuFoljeXOt7/5b/70N9584/rvPfbsB37xN7/0xa+EiplIbEJNPh1nazEBgI/jlLXK5YMXnt/yiU9+hrV617veunHDaieSKct5cZpATHv27n/wgYeVCu5599vbW0v1RpQLTDHU+w8c/OIX/2lqfPy9737nRRdcYILAeUtAoHByePzeb37n4e8+YtkEpba40RC4eHho2fp1P/2B96+e362ZnBeCNKsFnCXndRiwUt7Bfj9li7MN68yhWGWkg/e9757rb7mFCrkw01kUwNrsW70XkGIdVqamv/KVb33zgUcJYOZ6vVqtVJq3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";
  try{ doc.addImage("data:image/png;base64,"+LOGO_DATA,"PNG",14,14,22,22); }catch(e){}

  // "EXPLOITATION" et "VERDON" sous le logo
  doc.setFont("helvetica","bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...NOIR);
  doc.text("EXPLOITATION",14,40);
  doc.setFontSize(11);
  doc.text("VERDON",14,46);

  // ── ÉMETTEUR haut droite ──
  doc.setFont("helvetica","normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...GRIS);
  doc.text("Emetteur ou Emettrice",110,16);
  doc.setFont("helvetica","bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...ORANGE);
  doc.text("EXPLOITATION VERDON",110,21);
  doc.setFont("helvetica","normal");
  doc.setFontSize(8);
  doc.setTextColor(...NOIR);
  doc.text("236 RUE DES TISSERANDS",110,26);
  doc.text("73540 LA BATHIE - France",110,30);
  doc.text("etf.verdon@gmail.com",110,34);

  // ── CLIENT haut droite (sous émetteur) ──
  doc.setFont("helvetica","normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...GRIS);
  doc.text("Client ou Cliente",110,42);
  doc.setFont("helvetica","bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...ORANGE);
  doc.text(form.client||"—",110,47);
  let yc=52;
  doc.setFont("helvetica","normal");
  doc.setFontSize(8);
  doc.setTextColor(...NOIR);
  if(form.adresseClient){ doc.splitTextToSize(form.adresseClient,80).forEach(l=>{doc.text(l,110,yc);yc+=4;}); }

  // ── Titre FACTURE + numéro/dates (colonne gauche) ──
  doc.setFont("helvetica","normal");
  doc.setFontSize(14);
  doc.setTextColor(...GRIS);
  doc.text("Facture",14,60);

  doc.setFont("helvetica","bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...NOIR);
  doc.text("Numero",14,68);
  doc.text("Date d'emission",14,73);
  doc.text("Date d'echeance",14,78);
  doc.setFont("helvetica","normal");
  doc.text(numFact,55,68);
  doc.text(fmtDate(today),55,73);
  doc.text(fmtDate(echeance),55,78);

  // ── Ligne séparatrice ──
  let y=Math.max(84,yc+8);
  doc.setDrawColor(...GRIS_L); doc.setLineWidth(0.3);
  doc.line(14,y,196,y); y+=4;

  // ── Titre groupe (notes ou client) ──
  if(form.notes){
    doc.setFont("helvetica","bold");
    doc.setFontSize(10);
    doc.setTextColor(...NOIR);
    doc.text(form.notes.slice(0,80),14,y+5);
    y+=10;
  }

  // ── TABLEAU PRODUITS ──
  const CL={prod:14,qte:100,pu:130,tva:162,total:196};

  // En-tête fond gris
  doc.setFillColor(...BG_TABLE);
  doc.rect(14,y,182,7,"F");
  doc.setFont("helvetica","bold");
  doc.setFontSize(8);
  doc.setTextColor(...NOIR);
  doc.text("Produits",CL.prod+1,y+5);
  doc.text("Qte",(CL.qte+CL.pu)/2,y+5,{align:"center"});
  doc.text("Prix u. HT",(CL.pu+CL.tva)/2,y+5,{align:"center"});
  doc.text("TVA (%)",(CL.tva+CL.total)/2-4,y+5,{align:"center"});
  doc.text("Total HT",CL.total,y+5,{align:"right"});
  y+=7;

  let totalHT=0;
  (form.lignes||[]).forEach((l,i)=>{
    const u=l.unite||"m3";
    const nb=pf(l.quantite)||0;
    const isTTC=(l.typeTaxe||"HT")==="TTC";
    let puNum=pf(l.prixUnitaire)||0;
    if(isTTC) puNum=round(puNum/1.2,4);
    const vol=volLigneM3(l);
    const htRaw=ligneHT(l);
    const htVal=htRaw!=null?(isTTC?round(htRaw/1.2,2):htRaw):null;

    // Désignation : produit + essence
    let desig=(l.produit||"")+(l.essence?" "+l.essence:"");
    if(!desig) desig="—";

    // Quantité
    let qteStr="";
    if(u==="m3"||u==="m³") qteStr=vol!=null?`${vol} m³`:`${nb} u.`;
    else if(u==="m³direct") qteStr=`${nb} m³`;
    else if(u==="m²") qteStr=vol!=null?`${nb} m² (${vol} m³)`:`${nb} m²`;
    else if(u==="mL") qteStr=vol!=null?`${nb} mL (${vol} m³)`:`${nb} mL`;
    else qteStr=`${nb} u.`;

    // Alternance fond
    if(i%2===1){doc.setFillColor(...BG_ALT);doc.rect(14,y,182,8,"F");}
    doc.setFont("helvetica","normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...NOIR);
    doc.text(desig.slice(0,35),CL.prod+1,y+5.5);
    doc.text(qteStr,(CL.qte+CL.pu)/2,y+5.5,{align:"center"});
    if(puNum>0) doc.text(`${fmtNum(puNum)} €`,(CL.pu+CL.tva)/2,y+5.5,{align:"center"});
    doc.text("20%",(CL.tva+CL.total)/2-4,y+5.5,{align:"center"});
    if(htVal!=null){
      totalHT+=htVal;
      doc.text(`${fmtNum(htVal)} €`,CL.total,y+5.5,{align:"right"});
    }
    doc.setDrawColor(...GRIS_L); doc.setLineWidth(0.2);
    doc.line(14,y+8,196,y+8);
    y+=8;
  });

  y+=6;

  // Ligne livraison
  const livrType=form.livraisonType||"";
  const livrVal=pf(form.livraisonVal)||0;
  let livrHT=0;
  if(livrType==="km"&&livrVal>0) livrHT=round(livrVal,2);
  if(livrType==="prix"&&livrVal>0) livrHT=round(livrVal,2);
  if(livrType==="km"||livrType==="prix"||livrType==="offert"){
    doc.setFont("helvetica","italic"); doc.setFontSize(8.5); doc.setTextColor(...GRIS);
    const livrLabel=livrType==="offert"?"Livraison offerte":livrType==="km"?`Livraison (${livrVal} km)`:"Livraison";
    doc.text(livrLabel,CL.prod+1,y);
    if(livrType==="offert"){ doc.setTextColor(0,150,80); doc.text("Offerte",CL.total,y,{align:"right"}); }
    else if(livrHT>0){ doc.setTextColor(...NOIR); doc.text(`${fmtNum(livrHT)} €`,CL.total,y,{align:"right"}); totalHT+=livrHT; }
    doc.setDrawColor(...GRIS_L); doc.line(14,y+3,196,y+3);
    y+=8;
  }

  // Remise
  const remisePct=pf(form.remise)||0;
  const remiseMt=remisePct>0?round(totalHT*remisePct/100,2):0;
  const baseHT=round(totalHT-remiseMt,2);
  const tva=round(baseHT*0.20,2);
  const ttc=round(baseHT+tva,2);

  if(remiseMt>0){
    doc.setFont("helvetica","italic"); doc.setFontSize(8.5); doc.setTextColor(...GRIS);
    doc.text(`Remise ${remisePct}%`,CL.prod+1,y);
    doc.setTextColor(200,60,40); doc.setFont("helvetica","bold");
    doc.text(`- ${fmtNum(remiseMt)} €`,CL.total,y,{align:"right"});
    doc.setDrawColor(...GRIS_L); doc.line(14,y+3,196,y+3);
    y+=8;
  }

  y+=4;

  // ── DÉTAILS TVA + RÉCAPITULATIF côte à côte ──
  doc.setFont("helvetica","bold"); doc.setFontSize(10); doc.setTextColor(...NOIR);
  doc.text("Details TVA",14,y);
  doc.text("Recapitulatif",115,y);
  y+=5;

  // Ligne titre colonnes TVA
  doc.setFont("helvetica","bold"); doc.setFontSize(8.5); doc.setTextColor(...NOIR);
  doc.text("Taux",14,y+5);
  doc.text("Montant TVA",45,y+5);
  doc.text("Base HT",85,y+5);
  doc.setDrawColor(...GRIS_L); doc.setLineWidth(0.3);
  doc.line(14,y+7,100,y+7);

  // Valeurs TVA
  doc.setFont("helvetica","normal"); doc.setFontSize(8.5);
  doc.text("20%",14,y+14);
  doc.text(`${fmtNum(tva)} €`,45,y+14);
  doc.text(`${fmtNum(baseHT)} €`,85,y+14);

  // Récap (colonne droite)
  doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(...NOIR);
  doc.text("Total HT",115,y+5);
  doc.text(`${fmtNum(baseHT)} €`,196,y+5,{align:"right"});
  doc.text("Total TVA",115,y+11);
  doc.text(`${fmtNum(tva)} €`,196,y+11,{align:"right"});
  doc.setDrawColor(...GRIS_L); doc.line(115,y+14,196,y+14);
  doc.setFont("helvetica","bold"); doc.setFontSize(10);
  doc.text("Total TTC",115,y+21);
  doc.text(`${fmtSpace(ttc)} €`,196,y+21,{align:"right"});
  y+=32;

  // ── BLOC PAIEMENT ──
  y+=6;
  doc.setFillColor(245,245,248);
  doc.roundedRect(14,y,90,38,2,2,"F");
  doc.setFont("helvetica","bold"); doc.setFontSize(10); doc.setTextColor(...NOIR);
  doc.text("Paiement",18,y+7);
  doc.setFont("helvetica","normal"); doc.setFontSize(7.5);
  const pays=[
    ["Moyen de paiement","Virement"],
    ["Etablissement","Credit Agricole des Savoie"],
    ["IBAN","FR76 1810 6008 1096 7636 2109 772"],
    ["BIC","AGRIFRPP881"],
  ];
  let yp=y+13;
  pays.forEach(([k,v])=>{
    doc.setFont("helvetica","bold"); doc.setTextColor(...NOIR); doc.text(k,18,yp);
    doc.setFont("helvetica","normal"); doc.setTextColor(...GRIS); doc.text(v,52,yp,{maxWidth:50});
    yp+=5.5;
  });
  y+=44;

  // ── MENTIONS LÉGALES ──
  y=Math.max(y,245);
  doc.setDrawColor(...GRIS_L); doc.line(14,y,196,y); y+=4;
  doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(...GRIS);
  doc.text("Penalites de retard : trois fois le taux annuel d'interet legal en vigueur calcule depuis la date d'echeance jusqu'a complet paiement du prix.",14,y); y+=4;
  doc.text("Indemnite forfaitaire pour frais de recouvrement en cas de retard de paiement : 40 €",14,y);

  // ── FOOTER ──
  doc.setFontSize(7); doc.setTextColor(...GRIS);
  doc.text("EXPLOITATION VERDON | Entrepreneur individuel | N° SIREN 881.432.348 | N° de TVA FR38881432348",105,290,{align:"center"});
  doc.setDrawColor(...GRIS_L); doc.setLineWidth(0.2); doc.line(14,285,196,285);

  // Téléchargement
  const blob=doc.output('blob');
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=`Facture_${numFact}_${(form.client||"client").replace(/[^a-zA-Z0-9]/g,'_')}.pdf`;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{document.body.removeChild(a);URL.revokeObjectURL(url);},1000);
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
  const map={attente:["#2D2208","#FF9F0A"],production:["#0A1F35","#0A84FF"],valide:["#0A2E18","#34C759"],annule:["#2E0A0A","#FF453A"],brouillon:["#1A1A2E","#9B59F7"]};
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


const APPS_SCRIPT_TEXT = "function doGet(e) {\n  var ss = SpreadsheetApp.openById(\"1vBmNCK0vmQRIHy6S1btXgSWugznmr_L-P3wkH7Xj_w4\");\n  var action = e.parameter.action;\n\n  if(action === \"getCommandes\") {\n    var sheet = ss.getSheetByName(\"Vendeur\");\n    if(!sheet||sheet.getLastRow()<2) return json({commandes:[]});\n    var rows = sheet.getDataRange().getValues();\n    var h = rows[0].map(String), map={}, order=[];\n    rows.slice(1).forEach(function(r){\n      var o={}; h.forEach(function(k,i){o[k]=String(r[i]===null||r[i]===undefined?\"\":r[i]);});\n      var id=o[\"id\"].trim();\n      if(id){\n        map[id]={id:id,client:o[\"client\"],\n          dateLivraison:o[\"dateLivraison\"],notes:o[\"notes\"],\n          statut:o[\"statut\"]||\"attente\",\n          dateCreation:o[\"dateCreation\"],lignes:[]};\n        order.push(id);\n      }\n      var cid=id||order[order.length-1];\n      if(cid&&map[cid]) map[cid].lignes.push({\n        produit:o[\"produit\"],essence:o[\"essence\"],\n        qualite:o[\"qualite\"],epaisseur:o[\"epaisseur\"],\n        largeur:o[\"largeur\"],longueur:o[\"longueur\"],\n        quantite:o[\"quantite\"],prodId:o[\"prodId\"]||\"\",\n        unite:o[\"unite\"]||\"m3\",\n        prixUnitaire:o[\"prixUnitaire\"]||\"\",\n        typePrix:o[\"typePrix\"]||o[\"unite\"]||\"m3\",\n        typeTaxe:o[\"typeTaxe\"]||\"HT\"\n      });\n      if(o[\"id\"].trim()&&map[cid]){\n        if(o[\"adresseClient\"]) map[cid].adresseClient=o[\"adresseClient\"];\n        if(o[\"adresseLivraison\"]) map[cid].adresseLivraison=o[\"adresseLivraison\"];\n        map[cid].remise=o[\"remise\"]||\"\";\n        map[cid].livraisonType=o[\"livraisonType\"]||\"\";\n        map[cid].livraisonVal=o[\"livraisonVal\"]||\"\";\n      }\n    });\n    return json({commandes:order.map(function(id){return map[id];})});\n  }\n\n  if(action === \"getHistorique\") {\n    var sheet = ss.getSheetByName(\"Historique\");\n    if(!sheet||sheet.getLastRow()<2) return json({historique:[]});\n    var data = sheet.getRange(2,1,sheet.getLastRow()-1,1).getValues().flat();\n    var historique = data.map(function(cell){\n      try{ return JSON.parse(cell); }catch(e){ return null; }\n    }).filter(Boolean);\n    return json({historique:historique});\n  }\n\n  return json({ok:true});\n}\n\nfunction doPost(e) {\n  var d=JSON.parse(e.postData.contents);\n  var ss=SpreadsheetApp.openById(\"1vBmNCK0vmQRIHy6S1btXgSWugznmr_L-P3wkH7Xj_w4\");\n\n  if(d.type===\"commande\"){\n    var s=ss.getSheetByName(\"Vendeur\")||ss.insertSheet(\"Vendeur\");\n    var header=[\"id\",\"client\",\"produit\",\"essence\",\"qualite\",\n      \"epaisseur\",\"largeur\",\"longueur\",\"quantite\",\n      \"dateLivraison\",\"notes\",\"statut\",\"dateCreation\",\"prodId\",\"unite\",\n      \"prixUnitaire\",\"typePrix\",\"typeTaxe\",\"adresseClient\",\"adresseLivraison\",\"remise\",\"livraisonType\",\"livraisonVal\"];\n    if(s.getLastRow()===0){\n      s.appendRow(header);\n    } else {\n      var existingHeader=s.getRange(1,1,1,s.getLastColumn()).getValues()[0].map(String);\n      if(existingHeader.indexOf(\"remise\")===-1){\n        s.getRange(1,existingHeader.length+1).setValue(\"remise\");\n      }\n    }\n    var ids=s.getLastRow()>1\n      ?s.getRange(2,1,s.getLastRow()-1,1).getValues().flat().map(String):[];\n    if(ids.indexOf(String(d.id))===-1)\n      d.rows.forEach(function(row){s.appendRow(row);});\n  }\n\n  if(d.type===\"updateStatut\"){\n    var s=ss.getSheetByName(\"Vendeur\");\n    if(s&&s.getLastRow()>1){\n      var v=s.getRange(2,1,s.getLastRow()-1,13).getValues();\n      var inBlock=false;\n      for(var i=0;i<v.length;i++){\n        var cid=String(v[i][0]).trim();\n        if(cid===String(d.id).trim()){s.getRange(i+2,12).setValue(d.statut);inBlock=true;}\n        else if(inBlock&&cid===\"\"){s.getRange(i+2,12).setValue(d.statut);}\n        else if(inBlock&&cid!==\"\"){break;}\n      }\n    }\n  }\n\n  if(d.type===\"deleteCommande\"){\n    var s=ss.getSheetByName(\"Vendeur\");\n    if(s&&s.getLastRow()>1){\n      var v=s.getRange(2,1,s.getLastRow()-1,1).getValues();\n      var start=-1,end=-1;\n      for(var i=0;i<v.length;i++){\n        var c=String(v[i][0]).trim();\n        if(c===String(d.id).trim()){start=i+2;end=i+2;}\n        else if(start>0&&c===\"\"){end=i+2;}\n        else if(start>0&&c!==\"\"){break;}\n      }\n      if(start>0){for(var r=end;r>=start;r--)s.deleteRow(r);}\n    }\n  }\n\n  if(d.type===\"cubageProduit\"){\n    var s=ss.getSheetByName(\"Scieur\")||ss.insertSheet(\"Scieur\");\n    if(s.getLastRow()===0)\n      s.appendRow([\"Date\",\"Cmd ID\",\"Prod ID\",\"Produit\",\"Essence\",\n        \"Qualite\",\"Ep.mm\",\"Larg.mm\",\"Long.m\",\"Nb unites\",\n        \"Vol.Grume m3\",\"Vol.Unitaire\",\"Vol.Charge\",\"Rendement\",\"Perte\",\"Unite\"]);\n    var col3=s.getLastRow()>1\n      ?s.getRange(2,3,s.getLastRow()-1,1).getValues().flat().map(String):[];\n    if(col3.indexOf(String(d.id))===-1) s.appendRow(d.row);\n  }\n\n  if(d.type===\"saveHistorique\"){\n    var s=ss.getSheetByName(\"Historique\")||ss.insertSheet(\"Historique\");\n    if(s.getLastRow()===0) s.appendRow([\"data_json\"]);\n    var existing=s.getLastRow()>1\n      ?s.getRange(2,1,s.getLastRow()-1,1).getValues().flat():[];\n    var alreadyIn=existing.some(function(cell){\n      try{return JSON.parse(cell).id===d.entry.id;}catch(e){return false;}\n    });\n    if(!alreadyIn) s.appendRow([JSON.stringify(d.entry)]);\n  }\n\n  return ContentService.createTextOutput(JSON.stringify({ok:true}))\n    .setMimeType(ContentService.MimeType.JSON);\n}\nfunction json(o){\n  return ContentService.createTextOutput(JSON.stringify(o))\n    .setMimeType(ContentService.MimeType.JSON);\n}";
// ─── APP ─────────────────────────────────────────────────────────────────────
export default function App(){
  const [tab,setTab]=useState("commande");
  const [scriptUrl,setScriptUrl]=useState(()=>localStorage.getItem(APPS_SCRIPT_URL_KEY)||"");
  const [toast,setToast]=useState(null);
  const showToast=(msg,type="success")=>{setToast({msg,type});setTimeout(()=>setToast(null),3500);};

  // ── Tarifs par essence (stockés localement) ──
  const [tarifs,setTarifs]=useState(()=>{
    try{ return JSON.parse(localStorage.getItem("cubeur_tarifs")||"{}"); }
    catch(e){ return {}; }
  });
  const [newTarifEss,setNewTarifEss]=useState("");
  const saveTarif=(essence,prix)=>{
    const t={...tarifs};
    if(prix===""){ delete t[essence]; }
    else { t[essence]=prix; }
    setTarifs(t);
    localStorage.setItem("cubeur_tarifs",JSON.stringify(t));
  };

  // ── Commande ──
  const [form,setForm]=useState(()=>{
    try{ const d=JSON.parse(localStorage.getItem("cubeur_draft")||"null"); return d||initCmd; }catch(e){ return initCmd; }
  });
  const [submitting,setSub]=useState(false);
  const [confirmDel,setConfirmDel]=useState(null);
  const [deleting,setDeleting]=useState(false);
  const [editCmd,setEditCmd]=useState(null); // id de la commande en cours d'édition

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
  const [loadError,setLoadError]=useState(null);
  const load=useCallback(async(silent=false)=>{
    if(!scriptUrl)return;
    if(!silent){setLoading(true);setLoadError(null);}
    try{
      const r=await fetch(`${scriptUrl}?action=getCommandes&t=${Date.now()}`);
      const text=await r.text();
      let d;
      try{ d=JSON.parse(text); }catch(e){ setLoadError("Réponse invalide: "+text.slice(0,100)); return; }
      if(d.error){ setLoadError("Erreur Apps Script: "+d.error); return; }
      if(d.commandes)setCmd(d.commandes);
      else setLoadError("Pas de commandes dans la réponse");
    }catch(e){ setLoadError("Erreur réseau: "+e.message); }
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
  const sl=(i,f)=>e=>{
    const val=e.target.value;
    setForm(p=>{
      const ls=[...p.lignes];
      ls[i]={...ls[i],[f]:val};
      // Auto-remplir le prix si on change l'essence et qu'un tarif existe
      if(f==="essence"&&tarifs[val]&&(!ls[i].prixUnitaire||ls[i].prixUnitaire==="0")){
        ls[i]={...ls[i],prixUnitaire:String(tarifs[val])};
      }
      return{...p,lignes:ls};
    });
  };
  const slv=(i,v)=>{const tp=v==="m³direct"?"m³direct":v; setForm(p=>{const ls=[...p.lignes];ls[i]={...ls[i],unite:v,typePrix:tp,epaisseur:"",largeur:"",longueur:"",quantite:""};return{...p,lignes:ls};});};
  const addL=()=>setForm(p=>({...p,lignes:[...p.lignes,{...initLigne}]}));
  const delL=i=>setForm(p=>({...p,lignes:p.lignes.filter((_,j)=>j!==i)}));
  const formValid=form.client&&form.dateLivraison&&form.lignes.every(l=>l.produit&&l.essence&&l.quantite);

  const envoyer=async()=>{
    if(!formValid||!scriptUrl){if(!scriptUrl)showToast("URL Apps Script manquante","error");return;}
    setSub(true);
    // Si édition : conserver le même id, supprimer l'ancienne commande d'abord
    const id = editCmd || genId();
    const dc = fmtDate();
    if(editCmd){
      try{ await callScript(scriptUrl,{type:"deleteCommande",id:editCmd}); }catch(e){}
    }
    const rows=form.lignes.map((l,i)=>[
      i===0?id:"", form.client, l.produit, l.essence, l.qualite,
      l.epaisseur, l.largeur, l.longueur, l.quantite,
      form.dateLivraison, i===0?form.notes:"", "attente", i===0?dc:"",
      prodId(id,i), l.unite||"m³",
      l.prixUnitaire||"",
      l.typePrix||l.unite||"m³",
      l.typeTaxe||"HT",
      i===0?form.adresseClient||"":"",
      i===0?form.adresseLivraison||"":"",
      i===0?form.remise||"":"",
      i===0?form.livraisonType||"":"",
      i===0?form.livraisonVal||"":""
    ]);
    try{
      await callScript(scriptUrl,{type:"commande",rows,id});
      try{ await genererDevisPDF({...form,lignes:[...form.lignes]}, id); }catch(pdfErr){ console.warn("PDF:",pdfErr); }
      setForm(initCmd); setEditCmd(null);
      localStorage.removeItem("cubeur_draft");
      showToast(editCmd?`Commande ${id} modifiée ✓`:`Commande ${id} envoyée ✓`);
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

  const cmdBrouillon=commandes.filter(c=>c.statut==="brouillon");
  const cmdAtt=commandes.filter(c=>["attente","En attente"].includes(c.statut));
  const cmdProd=commandes.filter(c=>["production","En production"].includes(c.statut));
  const cmdVal=commandes.filter(c=>["valide","Validée"].includes(c.statut));
  const aRealiser=[...cmdAtt,...cmdProd]; // brouillon exclu volontairement

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
          {editCmd&&<div style={{background:"rgba(255,159,10,.08)",border:"1px solid rgba(255,159,10,.3)",borderRadius:10,padding:"10px 14px",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontSize:11,color:"#FF9F0A",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>Mode édition</div>
              <div style={{fontSize:12,color:"#E8ECEF",marginTop:2}}>Commande <strong>{editCmd}</strong> — renvoyez pour remplacer</div>
            </div>
            <button style={{...S.btnSmall,fontSize:11,color:"#FF453A",borderColor:"rgba(255,69,58,.2)"}} onClick={()=>{setEditCmd(null);setForm(initCmd);}}>✕ Annuler</button>
          </div>}
          {!editCmd&&form.client&&localStorage.getItem("cubeur_draft")&&
            <div style={{background:"rgba(10,132,255,.07)",border:"1px solid rgba(10,132,255,.25)",borderRadius:10,padding:"10px 14px",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontSize:11,color:"#0A84FF",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>📋 Brouillon en cours</div>
                <div style={{fontSize:12,color:"#E8ECEF",marginTop:2}}>Client : <strong>{form.client||"—"}</strong> · {form.lignes.length} produit{form.lignes.length>1?"s":""}</div>
              </div>
              <button style={{...S.btnSmall,fontSize:11,color:"#FF453A",borderColor:"rgba(255,69,58,.2)"}}
                onClick={()=>{setForm(initCmd);localStorage.removeItem("cubeur_draft");}}>
                🗑 Effacer
              </button>
            </div>
          }
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

          {/* ── Tarifs par essence (pré-remplissage dynamique) ── */}
          <Card title="Tarifs par essence (optionnel)">
            <div style={{fontSize:12,color:"#8A9BB0",marginBottom:10}}>
              Pré-rempli automatiquement dans chaque produit · Prix modifiable individuellement
            </div>
            {(()=>{
              // Construire la liste : les essences déjà configurées + une ligne vide à la fin
              const configured = ESSENCES.filter(e=>tarifs[e]&&tarifs[e]!=="");
              const available  = ESSENCES.filter(e=>!tarifs[e]||tarifs[e]==="");
              const showNew    = available.length>0;
              return <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {/* Lignes configurées */}
                {configured.map(ess=>(
                  <div key={ess} style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:8,alignItems:"center"}}>
                    <select value={ess}
                      onChange={ev=>{
                        const nv=ev.target.value; if(!nv||nv===ess) return;
                        const t={...tarifs,[nv]:tarifs[ess]}; delete t[ess];
                        setTarifs(t); localStorage.setItem("cubeur_tarifs",JSON.stringify(t));
                      }}
                      style={{...S.input,color:"#E8ECEF",fontSize:13}}>
                      {[ess,...available].map(e=><option key={e} value={e}>{e}</option>)}
                    </select>
                    <Num value={tarifs[ess]||""} onChange={ev=>saveTarif(ess,ev.target.value)} ph="€/m³"/>
                    <button type="button" onClick={()=>saveTarif(ess,"")}
                      style={{background:"transparent",border:"none",color:"#FF453A",cursor:"pointer",fontSize:16,padding:"0 4px"}}>✕</button>
                  </div>
                ))}
                {/* Ligne nouvelle essence — s'affiche seulement si il reste des essences */}
                {showNew&&(
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:8,alignItems:"center"}}>
                    <select value={newTarifEss}
                      onChange={ev=>setNewTarifEss(ev.target.value)}
                      style={{...S.input,color:newTarifEss?"#E8ECEF":"#8A9BB0",fontSize:13}}>
                      <option value="">— Essence —</option>
                      {available.map(e=><option key={e} value={e}>{e}</option>)}
                    </select>
                    <Num value="" ph="€/m³"
                      onChange={ev=>{
                        if(!newTarifEss||!ev.target.value) return;
                        saveTarif(newTarifEss, ev.target.value);
                        setNewTarifEss("");
                      }}
                      disabled={!newTarifEss}
                    />
                    <div style={{width:24}}/>
                  </div>
                )}
              </div>;
            })()}
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
                        if(u==="m³"){
                          // mode Unité : nb de pièces = quantite saisie directement
                          const nb2=pf(lg.quantite);
                          if(nb2>0) n=nb2;
                        } else if(u==="m³direct") n=nbUnitesM3Direct(lg);
                        else if(u==="m²") n=nbUnitesM2(lg);
                        else if(u==="mL") n=nbUnitesMl(lg);
                        if(n==null) return null;
                        return <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontSize:10,color:"#8A9BB0",textTransform:"uppercase"}}>Nb de pièces</span>
                          <span style={{fontSize:14,fontWeight:700,color:"#0A84FF"}}>{n} pièce{n>1?"s":""}</span>
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
              <div style={{display:"flex",gap:8,marginTop:10}}>
                {form.lignes.length>1&&<button style={{...S.btnDel,flex:1,textAlign:"center"}} onClick={()=>delL(i)}>🗑 Supprimer</button>}
                <button style={{...S.btnSmall,flex:1,textAlign:"center"}} onClick={()=>setForm(p=>({...p,lignes:[...p.lignes,{...p.lignes[i]}]}))}>⧉ Dupliquer</button>
              </div>
            </Card>
          ))}

          <button style={{...S.btnBig,background:"rgba(212,168,83,.08)",color:"#34C759",border:"1px solid rgba(212,168,83,.3)",marginBottom:10}} onClick={addL}>
            + Ajouter un produit
          </button>
          <Card title="Notes">
            <textarea style={{...S.input,minHeight:60,resize:"vertical"}} value={form.notes} onChange={sf("notes")} placeholder="Instructions particulières..."/>
          </Card>

          {/* Livraison */}
          <Card title="Livraison (optionnel)">
            {/* 3 boutons type */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:10}}>
              {[["km","📍 Distance (km)"],["prix","💶 Prix fixe (€)"],["offert","🎁 Offerte"]].map(([v,lb])=>(
                <button key={v} type="button"
                  onClick={()=>setForm(p=>({...p,livraisonType:p.livraisonType===v?"":v,livraisonVal:""}))}
                  style={{padding:"8px 4px",fontSize:11,fontWeight:600,fontFamily:"inherit",
                    borderRadius:7,cursor:"pointer",textAlign:"center",
                    background:form.livraisonType===v?"#2D6A4F":"rgba(255,255,255,.04)",
                    color:form.livraisonType===v?"#FFFFFF":"#8A9BB0",
                    border:form.livraisonType===v?"1px solid #2D6A4F":"1px solid rgba(255,255,255,.08)"}}>
                  {lb}
                </button>
              ))}
            </div>
            {/* Champ valeur selon type */}
            {form.livraisonType==="km"&&
              <div>
                <Field label="Nombre de km">
                  <Num value={form.livraisonVal||""} onChange={sf("livraisonVal")} ph="ex: 45"/>
                </Field>
                {pf(form.livraisonVal)>0&&
                  <div style={{marginTop:6,fontSize:13,color:"#34C759",fontWeight:600}}>
                    → Frais de livraison : {pf(form.livraisonVal).toFixed(2)} € HT
                  </div>
                }
              </div>
            }
            {form.livraisonType==="prix"&&
              <Field label="Prix de la livraison (€ HT)">
                <Num value={form.livraisonVal||""} onChange={sf("livraisonVal")} ph="ex: 80"/>
              </Field>
            }
            {form.livraisonType==="offert"&&
              <div style={{fontSize:13,color:"#34C759",fontWeight:600,padding:"6px 0"}}>
                🎁 Livraison offerte — s'affichera sur le devis
              </div>
            }
          </Card>

          {/* Remise */}
          <Card title="Remise (optionnel)">
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <Field label="% de remise" style={{flex:1}}>
                <Num value={form.remise||""} onChange={sf("remise")} ph="ex: 10"/>
              </Field>
              <div style={{flex:1,fontSize:11,color:"#8A9BB0",paddingTop:18,lineHeight:1.5}}>
                Sera affiché sur le devis et déduit du total HT
              </div>
            </div>
          </Card>

          {/* Récapitulatif commande */}
          {(()=>{
            const lignesAvecPrix=form.lignes.filter(l=>l.prixUnitaire&&pf(l.prixUnitaire)>0);
            const totalVol=form.lignes.reduce((acc,l)=>{const v=volLigneM3(l);return acc+(v||0);},0);
            const totalVolRound=round(totalVol,4);
            const totalHT=form.lignes.reduce((acc,l)=>{
              const h=ligneHT(l);
              const isTTC=(l.typeTaxe||"HT")==="TTC";
              if(h==null) return acc;
              return acc+round(isTTC?round(h/1.2,2):h,2);
            },0);
            const remisePct=pf(form.remise);
            const remiseMt=remisePct>0?round(totalHT*remisePct/100,2):0;
            const livrHT=form.livraisonType==="km"?round(pf(form.livraisonVal),2):form.livraisonType==="prix"?round(pf(form.livraisonVal),2):0;
            const totalApresRemise=round(totalHT-remiseMt+livrHT,2);
            const totalTTC=round(totalApresRemise*1.2,2);
            if(totalVol===0&&lignesAvecPrix.length===0) return null;
            return <div style={{background:"rgba(255,255,255,.03)",border:"1px solid rgba(212,168,83,.2)",borderRadius:12,padding:"14px 16px",marginBottom:4}}>
              <div style={{fontSize:11,fontWeight:700,color:"#C4904A",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:12}}>📊 Récapitulatif commande</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                {totalVolRound>0&&<div style={{background:"rgba(52,199,89,.06)",borderRadius:8,padding:"10px 12px"}}>
                  <div style={{fontSize:10,color:"#8A9BB0",textTransform:"uppercase",marginBottom:4}}>Volume total m³</div>
                  <div style={{fontSize:22,fontWeight:700,color:"#34C759"}}>{totalVolRound} m³</div>
                </div>}
                {totalHT>0&&<div style={{background:"rgba(255,159,10,.06)",borderRadius:8,padding:"10px 12px"}}>
                  <div style={{fontSize:10,color:"#8A9BB0",textTransform:"uppercase",marginBottom:4}}>Total HT</div>
                  <div style={{fontSize:22,fontWeight:700,color:"#FF9F0A"}}>{totalHT.toFixed(2)} €</div>
                  <div style={{fontSize:11,color:"#8A9BB0",marginTop:2}}>TTC : {round(totalHT*1.2,2).toFixed(2)} €</div>
                </div>}
                {remiseMt>0&&<div style={{background:"rgba(255,69,58,.06)",borderRadius:8,padding:"10px 12px"}}>
                  <div style={{fontSize:10,color:"#8A9BB0",textTransform:"uppercase",marginBottom:4}}>Remise {remisePct}%</div>
                  <div style={{fontSize:18,fontWeight:700,color:"#FF453A"}}>- {remiseMt.toFixed(2)} €</div>
                </div>}
                {remiseMt>0&&<div style={{background:"rgba(10,132,255,.06)",borderRadius:8,padding:"10px 12px"}}>
                  <div style={{fontSize:10,color:"#8A9BB0",textTransform:"uppercase",marginBottom:4}}>Après remise HT</div>
                  <div style={{fontSize:18,fontWeight:700,color:"#0A84FF"}}>{totalApresRemise.toFixed(2)} €</div>
                  <div style={{fontSize:11,color:"#8A9BB0",marginTop:2}}>TTC : {totalTTC.toFixed(2)} €</div>
                </div>}
              </div>
            </div>;
          })()}

          {/* Boutons Mettre de côté + Envoyer */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:4}}>
            <button style={{...S.btnBig,marginBottom:0,background:"rgba(155,89,247,.08)",color:"#9B59F7",border:"1px solid rgba(155,89,247,.3)",...(!form.client?S.btnDis:{})}}
              disabled={!form.client}
              onClick={async()=>{
                // Sauvegarder localement
                localStorage.setItem("cubeur_draft",JSON.stringify(form));
                // Si scriptUrl dispo, envoyer en Sheet avec statut brouillon
                if(scriptUrl&&form.client){
                  const bid=editCmd||genId();
                  const dc=fmtDate();
                  if(editCmd){ try{ await callScript(scriptUrl,{type:"deleteCommande",id:editCmd}); }catch(e){} }
                  const rows=form.lignes.map((l,i)=>[
                    i===0?bid:"", form.client, l.produit||"", l.essence||"", l.qualite||"",
                    l.epaisseur||"", l.largeur||"", l.longueur||"", l.quantite||"",
                    form.dateLivraison||"", i===0?form.notes||"":"", "brouillon", i===0?dc:"",
                    prodId(bid,i), l.unite||"m³",
                    l.prixUnitaire||"", l.typePrix||l.unite||"m³", l.typeTaxe||"HT",
                    i===0?form.adresseClient||"":"", i===0?form.adresseLivraison||"":"",
                    i===0?form.remise||"":"",
                    i===0?form.livraisonType||"":"",
                    i===0?form.livraisonVal||"":""
                  ]);
                  try{
                    await callScript(scriptUrl,{type:"commande",rows,id:bid});
                    setEditCmd(bid);
                    showToast("Commande mise de côté ✓","warn");
                    setTimeout(()=>load(true),800);
                  }catch(e){ showToast("Sauvegardé localement seulement","warn"); }
                } else {
                  showToast("Brouillon sauvegardé localement ✓","warn");
                }
              }}>
              ⏸ Mettre de côté
            </button>
            <button style={{...S.btnBig,marginBottom:0,...(!formValid||submitting?S.btnDis:{})}} onClick={envoyer} disabled={!formValid||submitting}>
              {submitting?<Spinner/>:"📤 Envoyer"}
            </button>
          </div>
          {/* Bouton effacer brouillon */}
          <button style={{...S.btnSmall,width:"100%",textAlign:"center",marginBottom:10,fontSize:11,color:"#FF453A",borderColor:"rgba(255,69,58,.2)"}}
            onClick={()=>{setForm(initCmd);localStorage.removeItem("cubeur_draft");showToast("Brouillon effacé");}}>
            🗑 Effacer le formulaire
          </button>

          <div style={{margin:"20px 0 10px",display:"flex",justifyContent:"space-between",alignItems:"center",paddingBottom:5,borderBottom:"1px solid rgba(255,255,255,.07)"}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.15em",textTransform:"uppercase",color:"#8A9BB0"}}>Commandes</div>
            <button style={S.btnRefresh} onClick={()=>load()}>{loading?"⏳ Chargement...":"↻ Actualiser"}</button>
          </div>
          {!scriptUrl&&<div style={{textAlign:"center",padding:12,color:"#FF9F0A",fontSize:12}}>⚠ Configure l'URL Apps Script dans ⚙ Config</div>}
          {scriptUrl&&commandes.length===0&&!loading&&<div style={{textAlign:"center",padding:12,color:"#4A5568",fontSize:12}}>Aucune commande — appuie sur ↻ pour charger</div>}
          {loadError&&<div style={{background:"rgba(255,69,58,.08)",border:"1px solid rgba(255,69,58,.3)",borderRadius:8,padding:"10px 12px",marginBottom:8,fontSize:11,color:"#FF453A"}}>
            ⚠ {loadError}
          </div>}
          {commandes.length>0&&<>
            {cmdBrouillon.length>0&&<>
              <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.15em",textTransform:"uppercase",color:"#9B59F7",margin:"20px 0 8px",paddingBottom:5,borderBottom:"1px solid rgba(155,89,247,.15)"}}>✏️ À finaliser ({cmdBrouillon.length})</div>
              {cmdBrouillon.map(c=>(
                <Card key={c.id} accent="rgba(155,89,247,.25)">
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
                        <div><div style={{fontSize:11,color:"#9B59F7",fontWeight:500}}>{c.id}</div><div style={{fontWeight:600,color:"#E8ECEF",fontSize:15}}>{c.client}</div></div>
                        <div style={{display:"flex",alignItems:"center",gap:8}}><Badge status="brouillon"/><button style={{...S.btnDel,padding:"4px 8px",fontSize:12}} onClick={()=>setConfirmDel(c.id)}>🗑</button></div>
                      </div>
                      {(c.lignes||[]).map((l,i)=>(
                        <div key={i} style={{fontSize:12,color:"#a09080",marginBottom:2}}>
                          • <strong style={{color:"#9B59F7"}}>{l.produit||"—"}</strong>{l.essence?` · ${l.essence}`:""}
                          <span style={{color:"#5bb8d4",fontSize:11}}> [{l.unite||"m³"}]</span>
                        </div>
                      ))}
                      {c.dateLivraison&&<div style={{fontSize:12,color:"#8A9BB0",marginTop:6,marginBottom:6}}>Livraison : <strong style={{color:"#E8ECEF",fontWeight:500,fontSize:13}}>{(d=>d?new Date(d).toLocaleDateString("fr-FR"):"—")(c.dateLivraison)}</strong></div>}
                      <button style={{...S.btnBig,marginBottom:0,background:"rgba(155,89,247,.1)",color:"#9B59F7",border:"1px solid rgba(155,89,247,.3)",fontSize:13}}
                        onClick={()=>{
                          setForm({
                            client:c.client||"",dateLivraison:c.dateLivraison||c.datelivraison||"",
                            notes:c.notes||"",adresseClient:c.adresseClient||"",adresseLivraison:c.adresseLivraison||"",remise:c.remise||"",
                            lignes:(c.lignes||[]).map(l=>({
                              produit:l.produit||"",essence:l.essence||"",qualite:l.qualite||"",
                              epaisseur:l.epaisseur||"",largeur:l.largeur||"",longueur:l.longueur||"",
                              quantite:l.quantite||"",unite:l.unite||"m³",
                              prixUnitaire:l.prixUnitaire||"",typePrix:l.typePrix||l.unite||"m³",typeTaxe:l.typeTaxe||"HT"
                            }))
                          });
                          setEditCmd(c.id);
                          setTab("commande");
                          window.scrollTo(0,0);
                          showToast(`Brouillon ${c.id} chargé — finalisez et envoyez`,"warn");
                        }}>
                        ✏️ Reprendre et finaliser
                      </button>
                    </>
                  )}
                </Card>
              ))}
            </>}
            {(cmdAtt.length>0||cmdProd.length>0||cmdVal.length>0)&&<div style={{fontSize:10,fontWeight:700,letterSpacing:"0.15em",textTransform:"uppercase",color:"#8A9BB0",margin:"20px 0 10px",paddingBottom:5,borderBottom:"1px solid rgba(255,255,255,.07)"}}>Commandes envoyées</div>}
            {commandes.filter(c=>c.statut!=='brouillon').map(c=>(
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
                    <div style={{fontSize:12,color:"#8A9BB0",marginTop:6,marginBottom:6}}>Livraison : <strong style={{color:"#E8ECEF",fontWeight:500,fontSize:13}}>{(d=>d?new Date(d).toLocaleDateString('fr-FR'):"—")(c.dateLivraison||c.datelivraison)}</strong></div>
                    <div style={{display:"flex",gap:6}}>
                      <button style={{...S.btnExport,flex:1,fontSize:11,padding:"6px 8px",textAlign:"center"}}
                        onClick={()=>genererDevisPDF({...c,adresseClient:c.adresseClient||'',adresseLivraison:c.adresseLivraison||'',remise:c.remise||''},c.id).catch(e=>alert('Erreur PDF: '+e.message))}>📄 Devis</button>
                      <button style={{...S.btnSmall,flex:1,fontSize:11,padding:"6px 8px",textAlign:"center",color:"#0A84FF",borderColor:"rgba(10,132,255,.3)"}}
                        onClick={()=>genererFacturePDF({...c,adresseClient:c.adresseClient||'',adresseLivraison:c.adresseLivraison||'',remise:c.remise||'',livraisonType:c.livraisonType||'',livraisonVal:c.livraisonVal||''},c.id).catch(e=>alert('Erreur Facture: '+e.message))}>🧾 Facture</button>
                      {["attente","En attente"].includes(c.statut||"attente")&&
                        <button style={{...S.btnSmall,flex:1,fontSize:11,padding:"6px 8px",textAlign:"center",color:"#FF9F0A",borderColor:"rgba(255,159,10,.3)"}}
                          onClick={()=>{
                            // Charger la commande dans le formulaire pour édition
                            setForm({
                              client:c.client||"",
                              dateLivraison:c.dateLivraison||c.datelivraison||"",
                              notes:c.notes||"",
                              adresseClient:c.adresseClient||"",
                              adresseLivraison:c.adresseLivraison||"",
                              remise:c.remise||"",
                              livraisonType:c.livraisonType||"",
                              livraisonVal:c.livraisonVal||"",
                              lignes:(c.lignes||[]).map(l=>({
                                produit:l.produit||"",essence:l.essence||"",qualite:l.qualite||"",
                                epaisseur:l.epaisseur||"",largeur:l.largeur||"",longueur:l.longueur||"",
                                quantite:l.quantite||"",unite:l.unite||"m³",
                                prixUnitaire:l.prixUnitaire||"",typePrix:l.typePrix||l.unite||"m³",typeTaxe:l.typeTaxe||"HT"
                              }))
                            });
                            setEditCmd(c.id);
                            setTab("commande");
                            window.scrollTo(0,0);
                            showToast(`Commande ${c.id} chargée — modifiez et renvoyez`,"warn");
                          }}>
                          ✏️ Modifier
                        </button>
                      }
                    </div>
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
                        remise:histDetail.remise||"",
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
            <pre style={S.pre}>{APPS_SCRIPT_TEXT.replace(/\\n/g,"\n")}</pre>
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
