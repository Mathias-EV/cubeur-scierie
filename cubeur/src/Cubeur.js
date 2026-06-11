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
async function imprimerCommande(cmd){
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
    s.onload = () => { if(window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF); else reject(new Error('Erreur')); };
    s.onerror = () => reject(new Error('Erreur chargement'));
    document.head.appendChild(s);
  });
  let JsPDF;
  try { JsPDF = await loadJsPDF(); } catch(e) { alert("PDF indisponible : "+e.message); return; }
  const doc = new JsPDF({ unit:"mm", format:"a4" });

  const NOIR=[30,30,30], GRIS=[100,100,100], GRIS_L=[200,200,200];
  const VERT=[45,106,79], VERT_L=[240,255,245];
  const BRUN=[44,26,10], OR=[196,144,74];

  const fmtDateDoc=(d)=>{
    if(!d)return"—";
    try{
      const dt=new Date(d);
      if(isNaN(dt.getTime())) return d;
      return dt.toLocaleDateString("fr-FR",{day:"2-digit",month:"2-digit",year:"numeric"});
    }catch(e){return d;}
  };
  const today=new Date().toLocaleDateString("fr-FR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});

  // ── EN-TÊTE ──
  doc.setFillColor(...BRUN);
  doc.rect(0,0,210,22,"F");
  doc.setTextColor(250,243,232);
  doc.setFont("helvetica","bold");
  doc.setFontSize(14);
  doc.text("EXPLOITATION VERDON",14,10);
  doc.setFontSize(8);
  doc.setFont("helvetica","normal");
  doc.setTextColor(196,164,122);
  doc.text("Bon de sciage — à remettre au scieur",14,16);
  doc.setTextColor(220,200,160);
  doc.text(`Imprimé le ${today}`,196,16,{align:"right"});

  // ── INFOS COMMANDE ──
  let y=30;
  doc.setFillColor(...VERT_L);
  doc.roundedRect(14,y,182,22,2,2,"F");
  doc.setFont("helvetica","bold");
  doc.setFontSize(11);
  doc.setTextColor(...BRUN);
  doc.text(`Commande : ${cmd.id}`,18,y+8);
  doc.setFont("helvetica","normal");
  doc.setFontSize(9);
  doc.setTextColor(...NOIR);
  doc.text(`Client : ${cmd.client||"—"}`,18,y+15);
  if(cmd.dateLivraison){
    doc.setFont("helvetica","bold");
    doc.setTextColor(...VERT);
    doc.text(`Livraison souhaitée : ${fmtDateDoc(cmd.dateLivraison)}`,115,y+15);
  }
  if(cmd.notes){
    doc.setFont("helvetica","italic");
    doc.setFontSize(8);
    doc.setTextColor(...GRIS);
    doc.text(`Note : ${cmd.notes}`,18,y+20);
  }
  y+=28;

  // ── TABLEAU PRODUITS ──
  // Colonnes : N° | Produit | Essence | Qualité | Ép.mm | Larg.mm | Long.m | Quantité/Volume | ✓
  const cols={n:14,prod:22,ess:58,qual:86,ep:110,la:124,lo:138,qte:155,check:191,end:206};

  // En-tête
  doc.setFillColor(...BRUN);
  doc.rect(14,y,192,8,"F");
  doc.setFont("helvetica","bold");
  doc.setFontSize(7.5);
  doc.setTextColor(250,243,232);
  doc.text("N°",cols.n+1,y+5.5);
  doc.text("Produit",cols.prod+1,y+5.5);
  doc.text("Essence",cols.ess+1,y+5.5);
  doc.text("Qualité",cols.qual+1,y+5.5);
  doc.text("Ép.",cols.ep+1,y+5.5);
  doc.text("Larg.",cols.la+1,y+5.5);
  doc.text("Long.",cols.lo+1,y+5.5);
  doc.text("Qté / Vol.",cols.qte+1,y+5.5);
  doc.text("✓",cols.check+6,y+5.5,{align:"center"});
  y+=8;

  (cmd.lignes||[]).forEach((l,i)=>{
    const u=l.unite||"m³";
    const nb=pf(l.quantite)||0;
    const vol=volLigneM3(l);
    const rowH=13;
    const bg=i%2===0?[255,255,255]:[248,250,245];
    doc.setFillColor(...bg);
    doc.rect(14,y,192,rowH,"F");

    doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(...BRUN);
    doc.text(String(i+1),cols.n+2,y+4);

    doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...NOIR);
    doc.text((l.produit||"—").slice(0,16),cols.prod+1,y+4);
    doc.text((l.essence||"—").slice(0,10),cols.ess+1,y+4);
    doc.text((l.qualite||"—").slice(0,9),cols.qual+1,y+4);

    // Dimensions
    doc.setFont("helvetica","bold"); doc.setTextColor(...BRUN);
    if(l.epaisseur) doc.text(String(l.epaisseur),cols.ep+1,y+4);
    if(l.largeur)   doc.text(String(l.largeur),cols.la+1,y+4);
    // Longueur : afficher seulement si c'est un nombre valide (pas une date)
    if(l.longueur&&!isNaN(pf(l.longueur))&&pf(l.longueur)>0)
      doc.text(pf(l.longueur)+"m",cols.lo+1,y+4);

    // Quantité uniquement (nb de pièces ou valeur commandée, sans m³)
    doc.setFont("helvetica","normal"); doc.setTextColor(...NOIR);
    let qStr="";
    if(u==="m³"){
      // mode Unité : nb = nb de pièces
      qStr=nb>0?`${Math.round(nb)} pcs`:"—";
    } else if(u==="m³direct"){
      // nb pièces calculé depuis dims si possible
      const nbU=nbUnitesM3Direct(l);
      qStr=nbU!=null?`${nbU} pcs`:(nb>0?`${nb} m³`:"—");
    } else if(u==="m²"){
      const nbU=nbUnitesM2(l);
      qStr=nbU!=null?`${nbU} pcs`:(nb>0?`${nb} m²`:"—");
    } else if(u==="mL"){
      const nbU=nbUnitesMl(l);
      qStr=nbU!=null?`${nbU} pcs`:(nb>0?`${nb} mL`:"—");
    } else {
      qStr=nb>0?`${Math.round(nb)} pcs`:"—";
    }
    doc.text(qStr.slice(0,14),cols.qte+1,y+4);

    doc.setFontSize(8); doc.setTextColor(...NOIR);

    // Case à cocher
    doc.setDrawColor(...GRIS_L); doc.setLineWidth(0.4);
    doc.rect(cols.check+3,y+2,7,7);

    // Ligne séparatrice
    doc.setLineWidth(0.2);
    doc.line(14,y+rowH,206,y+rowH);
    y+=rowH;

    // Nouvelle page si besoin
    if(y>260){
      doc.addPage();
      y=14;
      // Répéter l'en-tête
      doc.setFillColor(...BRUN);
      doc.rect(14,y,192,8,"F");
      doc.setFont("helvetica","bold"); doc.setFontSize(7.5); doc.setTextColor(250,243,232);
      doc.text("N°",cols.n+1,y+5.5);doc.text("Produit",cols.prod+1,y+5.5);
      doc.text("Essence",cols.ess+1,y+5.5);doc.text("Qualité",cols.qual+1,y+5.5);
      doc.text("Ép.",cols.ep+1,y+5.5);doc.text("Larg.",cols.la+1,y+5.5);
      doc.text("Long.",cols.lo+1,y+5.5);doc.text("Qté / Vol.",cols.qte+1,y+5.5);
      doc.text("✓",cols.check+6,y+5.5,{align:"center"});
      y+=8;
    }
  });

  y+=8;

  // ── TOTAUX ──
  const totalVol=(cmd.lignes||[]).reduce((acc,l)=>{const v=volLigneM3(l);return acc+(v||0);},0);
  if(totalVol>0){
    doc.setFillColor(240,248,240);
    doc.roundedRect(14,y,192,10,2,2,"F");
    doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(...VERT);
    doc.text(`Volume total : ${round(totalVol,4)} m³`,18,y+7);
    doc.text(`Nombre de produits : ${(cmd.lignes||[]).length}`,110,y+7);
    y+=16;
  }

  // ── ZONE SIGNATURE ──
  y=Math.max(y,230);
  doc.setDrawColor(...GRIS_L); doc.setLineWidth(0.4); doc.line(14,y,206,y); y+=8;
  doc.setFont("helvetica","bold"); doc.setFontSize(8.5); doc.setTextColor(...NOIR);
  doc.text("Signature du scieur",14,y);
  doc.text("Observations / Remarques",115,y);
  y+=4;
  // Boîte signature
  doc.setFillColor(252,252,252);
  doc.setDrawColor(...GRIS_L); doc.setLineWidth(0.5);
  doc.roundedRect(14,y,90,28,1,1,"FD");
  doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(...GRIS);
  doc.text("Nom :",16,y+6);
  doc.line(16,y+7,100,y+7);
  doc.text("Date :",16,y+14);
  doc.line(16,y+15,100,y+15);
  doc.text("Signature :",16,y+22);
  doc.line(16,y+23,100,y+23);
  // Boîte observations
  doc.setFillColor(252,252,252);
  doc.roundedRect(115,y,91,28,1,1,"FD");
  doc.setTextColor(...GRIS);
  doc.text("",117,y+6);

  // ── FOOTER ──
  doc.setFontSize(7); doc.setTextColor(...GRIS);
  doc.text(`EXPLOITATION VERDON · ${cmd.id} · Bon de sciage`,105,291,{align:"center"});

  const blob=doc.output('blob');
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=`Bon_sciage_${cmd.id}_${(cmd.client||"client").replace(/[^a-zA-Z0-9]/g,'_')}.pdf`;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{document.body.removeChild(a);URL.revokeObjectURL(url);},1000);
}

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
    const loNumD=pf(l.longueur);
    if(loNumD>0){ desig+=` ${loNumD}m`; }
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
  const LOGO_DATA="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mKEjle9xDkYDEHLBOai6NU4oNu3mOx+69drD9t3pmpn3b7fz7lbv256clHLbnffo1bf/+N22Wb5s6QY+02osc7hu6NK1y8WXXVbZschhfiqdcrnjhEJARMogETCjtCYix3EwFJHZrMykQ67HBCciRkCAhMRaY37zuSPGuVba96Xn+Jttvc3dDw+q7NDptptuvunaa/UGgYfjukrKRHHJDbMfrWx/9tMP3b5yRXWvtk0664fCYQBKJIp79Wl330MPO7Jh5oPPOo4bBP56uuSpZKpzGbvqxut32+/Ipupv41EPsoFwQwAMAgKpyCAxTpYczp6upbVDACFiiUQYoCwCoUgMwAMhyA/AmFwKstXmxs6TBAS2dzN/MLAijVJCoJAxJxoF19OppEylDzlsYihWmbvltgic5/+dfct11956b88KMev2W7bedgf7iH703lsnH3HQ0np5zhnHnX/5DYzzB+68ZcrJp7dk5WVXX3LMqefYDhZHrKMaUVxS2rGqvee5CCqPmGk9TZKtEyHjgdRUu3jnvQ7Y9YDThBBApvUKbhtNtM20PffkMzddfbVbUi5KewSBNiYvcygYoiHlA2ohIrGo29jQGARrQ5O1h2OsfcdOHTp2euy5Vy4664S6mjX27CHXLdSqKxnx1ulXTJ92TrceVYmKjqql0WVccAaGIC8ICUQcUdjiT+BzMq5dAXMp5DyizKLqCYDQxliBMnWNTb6BaLtNRKxXY1P6nNNO33nXA1atqr7z0ReHbT7CYghaP5126+c47tEnnHr6BVefcPTxd8+4tqhqZKiyg26p7dC79/W33zJxnx0fefyVMUP6Ll4wH1Rw1nGHvvrck3abf9WFZ8/58LVn33537EEHu66s6NSeccRYiSjbhEVid91x36knnb1kyUqMt9MaFJFBACHQEbZzipC7oXAsGolFI24kSsSDlFSKgHMgsgVvKyKMKBAYGkKjSSulAh0EYDQ4DiFoJUkIEIIQQThaKZ1JuQIqO2+Sql115rETX3rmCZvtL0TD+02afP+DD9756EujttuRMZ7JpBGRVDbw5bRplxx1wmnCcRhjKpvmTF55/XUTDpkshIP5mUhrLYSzcP5PZxxzcNeu7a+57Q7BMWipiUZjjHEpdaAUcARuA2DI+j6PlynFLr/4uocfespmedW6/ZMWoqWJKAj89958/YZbn3hg1j0r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";
  const LOGO_W=28,LOGO_H=28,LOGO_X=11;
  doc.setFillColor(255,255,255); doc.rect(LOGO_X,10,LOGO_W,LOGO_H,"F");
  try{ doc.addImage("data:image/png;base64,"+LOGO_DATA,"PNG",LOGO_X,10,LOGO_W,LOGO_H); }catch(e){}
  const logoMidX=LOGO_X+LOGO_W/2;
  doc.setFont("helvetica","bold");
  doc.setFontSize(7); doc.setTextColor(...NOIR);
  doc.text("EXPLOITATION",logoMidX,42,{align:"center"});
  doc.setFontSize(11);
  doc.text("VERDON",logoMidX,48,{align:"center"});

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
  const MAX_Y_FACT = 210;
  const reHeaderFact = () => {
    doc.setFillColor(...BG_TABLE);
    doc.rect(14,y,182,7,"F");
    doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(...NOIR);
    doc.text("Produits",CL.prod+1,y+5);
    doc.text("Qte",(CL.qte+CL.pu)/2,y+5,{align:"center"});
    doc.text("Prix u. HT",(CL.pu+CL.tva)/2,y+5,{align:"center"});
    doc.text("TVA (%)",(CL.tva+CL.total)/2-4,y+5,{align:"center"});
    doc.text("Total HT",CL.total,y+5,{align:"right"});
    y+=7;
  };
  (form.lignes||[]).forEach((l,i)=>{
    if(y+8>MAX_Y_FACT){ doc.addPage(); y=14; reHeaderFact(); }
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
    const loNumF=pf(l.longueur);
    if(loNumF>0) desig+=` ${loNumF}m`;
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
  // S'assurer qu'il reste au moins 90mm pour TVA+récap+paiement+mentions
  if(y > 200){
    doc.setFontSize(7); doc.setTextColor(...GRIS);
    doc.text("EXPLOITATION VERDON | Entrepreneur individuel | N° SIREN 881.432.348 | N° de TVA FR38881432348",105,290,{align:"center"});
    doc.setDrawColor(...GRIS_L); doc.setLineWidth(0.2); doc.line(14,285,196,285);
    doc.addPage(); y=14;
  }

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

  // ── FOOTER toutes pages ──
  const totalPagesFact=doc.getNumberOfPages();
  for(let pg=1;pg<=totalPagesFact;pg++){
    doc.setPage(pg);
    doc.setFontSize(7); doc.setTextColor(...GRIS);
    doc.text("EXPLOITATION VERDON | Entrepreneur individuel | N° SIREN 881.432.348 | N° de TVA FR38881432348",105,290,{align:"center"});
    doc.setDrawColor(...GRIS_L); doc.setLineWidth(0.2); doc.line(14,285,196,285);
    if(totalPagesFact>1) doc.text(`Page ${pg}/${totalPagesFact}`,196,290,{align:"right"});
  }

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


const APPS_SCRIPT_TEXT = "function doGet(e) {\n  var ss = SpreadsheetApp.openById(\"1vBmNCK0vmQRIHy6S1btXgSWugznmr_L-P3wkH7Xj_w4\");\n  var action = e.parameter.action;\n\n  if(action === \"getCommandes\") {\n    var sheet = ss.getSheetByName(\"Vendeur\");\n    if(!sheet||sheet.getLastRow()<2) return json({commandes:[]});\n    var rows = sheet.getDataRange().getValues();\n    var h = rows[0].map(String), map={}, order=[];\n    rows.slice(1).forEach(function(r){\n      var o={}; h.forEach(function(k,i){o[k]=String(r[i]===null||r[i]===undefined?\"\":r[i]);});\n      var id=o[\"id\"].trim();\n      if(id){\n        map[id]={id:id,client:o[\"client\"],\n          dateLivraison:o[\"dateLivraison\"],notes:o[\"notes\"],\n          statut:o[\"statut\"]||\"attente\",\n          dateCreation:o[\"dateCreation\"],lignes:[]};\n        order.push(id);\n      }\n      var cid=id||order[order.length-1];\n      if(cid&&map[cid]) map[cid].lignes.push({\n        produit:o[\"produit\"],essence:o[\"essence\"],\n        qualite:o[\"qualite\"],epaisseur:o[\"epaisseur\"],\n        largeur:o[\"largeur\"],\n        longueur:(function(){var v=o[\"longueur\"];var n=parseFloat(v);return(!isNaN(n)&&n>0)?String(n):\"\";})(),\n        quantite:(function(){var v=o[\"quantite\"];var n=parseFloat(v);return(!isNaN(n)&&n>0)?String(n):\"\";})(),prodId:o[\"prodId\"]||\"\",\n        unite:o[\"unite\"]||\"m\u00b3\",\n        prixUnitaire:o[\"prixUnitaire\"]||\"\",\n        typePrix:o[\"typePrix\"]||o[\"unite\"]||\"m\u00b3\",\n        typeTaxe:o[\"typeTaxe\"]||\"HT\"\n      });\n      if(o[\"id\"].trim()&&map[cid]){\n        if(o[\"adresseClient\"]) map[cid].adresseClient=o[\"adresseClient\"];\n        if(o[\"adresseLivraison\"]) map[cid].adresseLivraison=o[\"adresseLivraison\"];\n        map[cid].remise=o[\"remise\"]||\"\";\n        map[cid].livraisonType=o[\"livraisonType\"]||\"\";\n        map[cid].livraisonVal=o[\"livraisonVal\"]||\"\";\n      }\n    });\n    return json({commandes:order.map(function(id){return map[id];})});\n  }\n\n  if(action === \"getHistorique\") {\n    var sheet = ss.getSheetByName(\"Historique\");\n    if(!sheet||sheet.getLastRow()<2) return json({historique:[]});\n    var data = sheet.getRange(2,1,sheet.getLastRow()-1,1).getValues().flat();\n    var historique = data.map(function(cell){\n      try{ return JSON.parse(cell); }catch(e){ return null; }\n    }).filter(Boolean);\n    return json({historique:historique});\n  }\n\n  return json({ok:true});\n}\n\nfunction doPost(e) {\n  var d=JSON.parse(e.postData.contents);\n  var ss=SpreadsheetApp.openById(\"1vBmNCK0vmQRIHy6S1btXgSWugznmr_L-P3wkH7Xj_w4\");\n\n  if(d.type===\"commande\"){\n    var s=ss.getSheetByName(\"Vendeur\")||ss.insertSheet(\"Vendeur\");\n    var header=[\"id\",\"client\",\"produit\",\"essence\",\"qualite\",\n      \"epaisseur\",\"largeur\",\"longueur\",\"quantite\",\n      \"dateLivraison\",\"notes\",\"statut\",\"dateCreation\",\"prodId\",\"unite\",\n      \"prixUnitaire\",\"typePrix\",\"typeTaxe\",\"adresseClient\",\"adresseLivraison\",\"remise\",\"livraisonType\",\"livraisonVal\"];\n    if(s.getLastRow()===0){\n      s.appendRow(header);\n    } else {\n      var existingHeader=s.getRange(1,1,1,s.getLastColumn()).getValues()[0].map(String);\n      if(existingHeader.indexOf(\"remise\")===-1){\n        s.getRange(1,existingHeader.length+1).setValue(\"remise\");\n      }\n    }\n    var ids=s.getLastRow()>1\n      ?s.getRange(2,1,s.getLastRow()-1,1).getValues().flat().map(String):[];\n    if(ids.indexOf(String(d.id))===-1)\n      d.rows.forEach(function(row){s.appendRow(row);});\n  }\n\n  if(d.type===\"updateStatut\"){\n    var s=ss.getSheetByName(\"Vendeur\");\n    if(s&&s.getLastRow()>1){\n      var v=s.getRange(2,1,s.getLastRow()-1,13).getValues();\n      var inBlock=false;\n      for(var i=0;i<v.length;i++){\n        var cid=String(v[i][0]).trim();\n        if(cid===String(d.id).trim()){s.getRange(i+2,12).setValue(d.statut);inBlock=true;}\n        else if(inBlock&&cid===\"\"){s.getRange(i+2,12).setValue(d.statut);}\n        else if(inBlock&&cid!==\"\"){break;}\n      }\n    }\n  }\n\n  if(d.type===\"deleteCommande\"){\n    var s=ss.getSheetByName(\"Vendeur\");\n    if(s&&s.getLastRow()>1){\n      var v=s.getRange(2,1,s.getLastRow()-1,1).getValues();\n      var start=-1,end=-1;\n      for(var i=0;i<v.length;i++){\n        var c=String(v[i][0]).trim();\n        if(c===String(d.id).trim()){start=i+2;end=i+2;}\n        else if(start>0&&c===\"\"){end=i+2;}\n        else if(start>0&&c!==\"\"){break;}\n      }\n      if(start>0){for(var r=end;r>=start;r--)s.deleteRow(r);}\n    }\n  }\n\n  if(d.type===\"cubageProduit\"){\n    var s=ss.getSheetByName(\"Scieur\")||ss.insertSheet(\"Scieur\");\n    if(s.getLastRow()===0)\n      s.appendRow([\"Date\",\"Cmd ID\",\"Prod ID\",\"Produit\",\"Essence\",\n        \"Qualite\",\"Ep.mm\",\"Larg.mm\",\"Long.m\",\"Nb unites\",\n        \"Vol.Grume m3\",\"Vol.Unitaire\",\"Vol.Charge\",\"Rendement\",\"Perte\",\"Unite\"]);\n    var col3=s.getLastRow()>1\n      ?s.getRange(2,3,s.getLastRow()-1,1).getValues().flat().map(String):[];\n    if(col3.indexOf(String(d.id))===-1) s.appendRow(d.row);\n  }\n\n  if(d.type===\"saveHistorique\"){\n    var s=ss.getSheetByName(\"Historique\")||ss.insertSheet(\"Historique\");\n    if(s.getLastRow()===0) s.appendRow([\"data_json\"]);\n    var existing=s.getLastRow()>1\n      ?s.getRange(2,1,s.getLastRow()-1,1).getValues().flat():[];\n    var alreadyIn=existing.some(function(cell){\n      try{return JSON.parse(cell).id===d.entry.id;}catch(e){return false;}\n    });\n    if(!alreadyIn) s.appendRow([JSON.stringify(d.entry)]);\n  }\n\n  return ContentService.createTextOutput(JSON.stringify({ok:true}))\n    .setMimeType(ContentService.MimeType.JSON);\n}\nfunction json(o){\n  return ContentService.createTextOutput(JSON.stringify(o))\n    .setMimeType(ContentService.MimeType.JSON);\n}";
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
                    <input
                      key={ess+"_"+tarifs[ess]}
                      defaultValue={tarifs[ess]||""}
                      onBlur={ev=>saveTarif(ess,ev.target.value)}
                      placeholder="€/m³"
                      style={{...S.input,width:"100%"}}
                    />
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
                    <input
                      key={"new_"+newTarifEss}
                      defaultValue=""
                      onBlur={ev=>{
                        if(!newTarifEss||!ev.target.value) return;
                        saveTarif(newTarifEss, ev.target.value);
                        setNewTarifEss("");
                        ev.target.value="";
                      }}
                      disabled={!newTarifEss}
                      placeholder={newTarifEss?"Ex: 550":"€/m³"}
                      style={{...S.input,width:"100%",opacity:newTarifEss?1:0.4}}
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
                              epaisseur:l.epaisseur||"",largeur:l.largeur||"",
                              longueur:(pf(l.longueur)>0)?String(pf(l.longueur)):"",
                              quantite:(pf(l.quantite)>0)?String(pf(l.quantite)):"",unite:l.unite||"m³",
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
                                epaisseur:l.epaisseur||"",largeur:l.largeur||"",
                                longueur:(pf(l.longueur)>0)?String(pf(l.longueur)):"",
                                quantite:(pf(l.quantite)>0)?String(pf(l.quantite)):"",unite:l.unite||"m³",
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
                <div style={{display:"flex",gap:8}}>
                  <button style={{...S.btnSmall,flex:1,textAlign:"center",background:isOpen?"rgba(91,184,212,.12)":"rgba(212,168,83,.06)",color:isOpen?"#5bb8d4":"#34C759",borderColor:isOpen?"rgba(91,184,212,.3)":"rgba(212,168,83,.2)"}}
                    onClick={()=>{if(!isOpen){initCubeCmd(cmd);setExpand(cmd.id);}else setExpand(null);}}>
                    {isOpen?"▲ Fermer":"👁 Voir commande"}
                  </button>
                  <button style={{...S.btnSmall,padding:"8px 12px",textAlign:"center",color:"#8A9BB0",borderColor:"rgba(255,255,255,.1)"}}
                    onClick={()=>imprimerCommande(cmd)}
                    title="Imprimer la liste de sciage">
                    🖨
                  </button>
                </div>

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
