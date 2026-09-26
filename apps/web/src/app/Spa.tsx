"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import jsQR from "jsqr";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
/** URL d'un média envoyé (image/vidéo) : le stockage objet (Vercel Blob) renvoie déjà une URL absolue,
 * l'ancien stockage disque local renvoyait un chemin relatif "/uploads/..." à préfixer par l'API. */
function mediaUrl(path?: string | null): string { return !path ? "" : /^https?:\/\//.test(path) ? path : `${API}${path}`; }

/** Taille maximale d'un envoi. Contrainte par la plateforme, pas par l'application : l'API tourne en
 * fonction serverless (Vercel), qui refuse tout corps de requête au-delà d'environ 4,5 Mo avec un 413
 * « FUNCTION_PAYLOAD_TOO_LARGE » — avant même d'atteindre notre code. On reste donc sous ce plafond. */
const MAX_UPLOAD_MB = 4;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

/* ===== Optimisation des images avant envoi =====
 * Une photo de téléphone dépasse facilement la limite ci-dessus (et alourdit inutilement le site).
 * On la redimensionne et la ré-encode dans le navigateur avant l'envoi : l'utilisateur n'a plus à
 * compresser quoi que ce soit à la main. Ne concerne QUE les images matricielles réencodables —
 * les vidéos et les GIF (animation perdue au réencodage) sont laissés intacts. */
const IMG_MAX_DIM = 1920; // suffisant pour un affichage plein écran, y compris en écran dense
const IMG_COMPRESS_ABOVE = 1.2 * 1024 * 1024; // en dessous, l'image part telle quelle
const COMPRESSIBLE = ["image/jpeg", "image/png", "image/webp"];

/** Dessine le bitmap redimensionné et renvoie le meilleur encodage tenant sous la limite. */
async function encodeBelowLimit(bitmap: ImageBitmap, hasAlpha: boolean): Promise<{ blob: Blob; ext: string } | null> {
  // WebP conserve la transparence et compresse mieux ; JPEG sert de repli (navigateurs anciens).
  const type = hasAlpha ? "image/webp" : "image/jpeg";
  const ext = hasAlpha ? ".webp" : ".jpg";
  for (const maxDim of [IMG_MAX_DIM, 1440, 1080]) {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    if (!hasAlpha) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); } // évite un fond noir sur les PNG transparents aplatis
    ctx.drawImage(bitmap, 0, 0, w, h);
    for (const quality of [0.85, 0.75, 0.65]) {
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, quality));
      if (!blob) return null;
      if (blob.size <= MAX_UPLOAD_BYTES) return { blob, ext };
    }
  }
  return null;
}

/** Renvoie une version allégée du fichier si c'est utile et possible ; sinon le fichier d'origine. */
async function optimizeImage(file: File): Promise<File> {
  if (!COMPRESSIBLE.includes(file.type)) return file;
  if (typeof createImageBitmap !== "function") return file;
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { return file; }
  try {
    const tooBig = file.size > IMG_COMPRESS_ABOVE;
    const tooWide = Math.max(bitmap.width, bitmap.height) > IMG_MAX_DIM;
    if (!tooBig && !tooWide) return file;
    const out = await encodeBelowLimit(bitmap, file.type === "image/png" || file.type === "image/webp");
    // Si le réencodage ne fait pas mieux que l'original, on garde l'original.
    if (!out || out.blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + out.ext;
    return new File([out.blob], name, { type: out.blob.type });
  } finally {
    bitmap.close?.();
  }
}

function token(): string | null { return typeof window !== "undefined" ? localStorage.getItem("vlome_token") : null; }
function authHeaders(): Record<string, string> { const t = token(); return t ? { Authorization: "Bearer " + t } : {}; }

/** Télécharge un export (Excel) protégé par le token de l'organisateur (le navigateur ne peut pas
 * envoyer d'en-tête Authorization sur un simple lien) : on récupère le fichier en mémoire, puis on
 * déclenche le téléchargement via une ancre <a download> jetable, avant de libérer l'URL objet. */
async function downloadExport(url: string): Promise<void> {
  try {
    const r = await fetch(url, { headers: authHeaders() });
    if (!r.ok) return;
    const disp = r.headers.get("Content-Disposition") || "";
    const m = /filename="([^"]+)"/.exec(disp);
    const blob = await r.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl; a.download = m ? m[1] : "export.xlsx";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(objUrl);
  } catch { /* ignore */ }
}

/* ================= Données ================= */
// cagnotte: null hors Survival (voir TournamentsService.toCard) — ne concerne que ce format.
type TournCard = { id?: string; name: string; format: string; game: string; players: number; date: string; place: string; live: boolean; cagnotte: number | null; status: string; imageUrl?: string | null };
/* eslint-disable @typescript-eslint/no-explicit-any */
type Detail = any; // DTO cockpit renvoyé par l'API (/tournaments/:id/state)
type CartItem = { name: string; price: number; id?: string };
type AuthUser = { id?: string; displayName: string; role: string; email: string; organizerStatus?: string; clubStatus?: string; clubRequested?: string | null; clubBlocking?: boolean };
type State = {
  page: string; slide: number; fmt: string; scope: string; game: string; cat: string; tournStatus: string;
  tourns: TournCard[] | null; creating: boolean; busy: boolean; leaderboard: Detail[] | null;
  playerProfile: Detail | null; h2hOpponent: string; h2hData: Detail | null; h2hBusy: boolean;
  eventStandings: Detail[] | null;
  embedTarget: { code: string; copied?: boolean } | null;
  productOpen: string | null;
  evGame: string; // filtre par jeu des tournois d'un événement (console)
  toast: string | null;
  myNext: Detail[] | null;
  predBoard: Detail | null; myPreds: Detail[] | null; predictors: Detail[] | null; // pronostics : matchs ouverts, mes choix, classement des pronostiqueurs
  teamDraft: { name: string; members: string[] } | null; // saisie du capitaine (survit aux re-rendus, ex. ouverture du choix de paiement)
  cartItems: CartItem[]; cartOpen: boolean; products: { id: string; cat: string; name: string; price: number; ph: string; img?: string | null; stock?: number; loyaltyEligible?: boolean; showOnHome?: boolean; description?: string | null }[] | null; boutiqueInStock: boolean;
  cartPayPick: string; cartBusy: boolean; lastOrder: { reference: string; totalXof: number; paymentMethod: string } | null;
  cartPointsToRedeem: number; // points fidélité que l'utilisateur choisit d'appliquer au panier
  regPointsToRedeem: number; // idem, pour réduire les frais d'inscription à un tournoi
  loyaltySettings: { pointValueXof: number; maxRedeemPercent: number } | null;
  loyaltyHistory: Detail[] | null; loyaltyBalance: number;
  creditsMe: { balance: number; freeTournamentsUsed: number; freeTournaments: number; priceXof: number; history: Detail[]; purchases: Detail[] } | null;
  creditBuyQty: number; creditBuyPay: string; creditBuyBusy: boolean;
  // Passerelles de paiement en ligne activées côté API (GET /api/payments/config) — null tant que non chargé.
  payConfig: { fedapay: boolean; kkiapay: { publicKey: string; sandbox: boolean } | null } | null;
  // Fenêtre « Choisis ton moyen de paiement » ouverte depuis l'inscription, le panier ou l'achat de crédits.
  payModal: "reg" | "cart" | "credit" | null;
  // Événements : liste publique, page ouverte, et gestion (console organisateur/admin).
  events: Detail[] | null; eventDetail: Detail | null; openEventId: string | null;
  myEvents: Detail[] | null; eventEdit: Detail | null; eventManage: Detail | null; eventMsg: string;
  wizEventId: string | null; // événement dans lequel l'assistant crée le tournoi (null = tournoi indépendant)
  scanOpen: boolean; // scanner de billets (check-in) ouvert par l'organisateur
  theme: "dark" | "light"; // sombre par défaut — le choix est appliqué au <html> et mémorisé (voir l'effet de montage)
  shareTarget: { url: string; title: string; copied?: boolean } | null; // fenêtre de partage (lien public d'un tournoi/événement)
  evShow: { event: Detail; states: Record<string, Detail> } | null; // écran de diffusion d'un événement
  user: AuthUser | null; authTab: "login" | "register" | "forgot" | "reset"; authBusy: boolean; authError: string; authNotice: string; resetToken: string; authRole: string;
  q: string;
  openId: string | null; detail: Detail | null; detailBusy: boolean; editing: boolean;
  admin: { overview: Detail; users: Detail[]; news: Detail[]; products: Detail[]; orders: Detail[]; payments: Detail[]; creditPurchases: Detail[]; organizers: Detail[]; clubRequests?: Detail[] } | null;
  adminTab: string; adminSearch: string; newsEdit: Detail | null; prodEdit: Detail | null;
  prodCat: string; prodSort: string; prodSortDir: "asc" | "desc";
  confirmBox: { title: string; message: string; okLabel: string; action: string } | null;
  site: Detail | null; siteMsg: string;
  news: Detail[] | null;
  me: Detail | null; myRegs: Detail[] | null; myOrders: Detail[] | null; myTourns: Detail[] | null; myResults: Detail[] | null;
  regIds: { id: string; status: string; amountXof: number; regId?: string; method?: string | null; code?: string; checkedIn?: boolean }[]; profileMsg: string; passMsg: string; profileEdit: boolean;
  payPick: string; // moyen de paiement choisi sur la page d'un tournoi payant
  gallery: Detail[] | null; galleryEdit: Detail | null; galleryFilter: string; galleryOpen: string | null; galleryType: "" | "video" | "image";
  galleryBusy: string | null; // progression de l'ajout en masse ("3/12"), null hors envoi
  albums: Detail[] | null; // catalogues de la galerie
  albumEdit: Detail | null; // catalogue en cours de création/renommage (admin)
  albumOpen: string | null; // catalogue ouvert sur la galerie publique (null = vue des catalogues)
  partnersEdit: { key: string; name: string; logoUrl: string | null; display: "both" | "logo" | "name" }[] | null;
  slidesEdit: { key: string; tag: string; title: string; sub: string; cta: string; imageUrl: string | null }[] | null;
  adsEdit: { key: string; label: string; linkUrl: string; imageUrl: string | null; page: string }[] | null;
  adSlide: number;
  regsPanel: Detail[] | null; // inscriptions du tournoi ouvert (cockpit organisateur)
  editingPlayerId: string | null; // joueur en cours d'édition (renommer/club/ajustement) dans le panneau Joueurs
  brActiveGame: string | null; // onglet de partie affiché (Battle Royale) — null = la prochaine à jouer
  // Matchs mis en avant dans le panneau de contrôle de la régie — plusieurs à la fois, une carte par
  // match (plusieurs confrontations peuvent réellement se jouer en même temps sur des tables/écrans
  // différents). Vide = auto (le premier jouable). Id = matchId (phase finale) ou poolId (poule).
  activeMatchIds: string[];
  // Score en cours de saisie (stepper), par match actif — plus un seul global, sinon deux contrôles
  // simultanés partageraient la même saisie. Clé = même id que activeMatchIds.
  matchScores: Record<string, { a: number; b: number }>;
  // Match DÉJÀ joué en cours de correction (crayon) — id de son entrée de journal (t.log), ou null.
  // Distinct de activeMatchIds/matchScores (qui concernent les matchs à VENIR) : une correction remet
  // en cause un résultat déjà acquis, potentiellement suivi d'autres matchs (cascade, voir
  // Engine.correctResult) — le score en cours de saisie pour la correction réutilise matchScores avec
  // ce même id comme clé, préfixé "c:" pour ne jamais entrer en collision avec un match actif.
  correctingId: string | null;
  regiePanel: "joueurs" | "paiements" | "reglages" | null; // overlay ouvert depuis le bas du rail de régie
  bracketView: "tree" | "list" | "pools"; // bascule d'affichage de la phase finale (régie + page publique) — "pools" revient au tableau des poules une fois en phase finale
  rosterQ: string; // recherche dans le panneau Joueurs de la régie
  showSlide: number; // diapositive active du Mode Show (classement / matchs en direct / derniers résultats…), tourne automatiquement
  consoleMenuOpen: boolean; // tiroir de navigation de la console admin/organisateur ouvert (mobile/tablette uniquement)
  // Assistant de création (5 étapes) — accumule les champs au fil des étapes avant l'envoi final.
  wizStep: number;
  wizData: {
    name: string; game: string; date: string; place: string; format: string; teamSize: number; // 0 = individuel ; sinon joueurs par équipe (fixé à la création)
    pointsPerPlayer: number; nbPools: number; players: string[]; entryFeeXof: number; givesLoyaltyPoint: boolean;
    survWin: number; loserWin: number; poolFinalWin: number; finalsWin: number; championBonus: number; streakBonus: number;
    finalsFormat: string; // mode de phase finale (Survival) : choisi à la création, non modifiable ensuite (voir wizScoringStep)
    poolFormat: "survival" | "double" | "roundrobin"; // mode des poules (Survival) : classique ou mini-bracket double élim
    qualifyPerPool: number; // qualifiés par poule envoyés en phase finale
    streakLength: 3 | 5; // longueur de série pour le bonus striker — un seul palier actif par tournoi
    matchMode: "bo" | "ft"; // format de manche appliqué à tous les matchs — Best of (majorité) ou First To (course)
    matchValue: number; // Bo1/3/5/7/9, ou la cible en First To
    countGoalDiff: boolean; // départage des égalités de victoires par différence de buts (Round Robin — poules et phase finale)
    brPoints: number[]; // Battle Royale : points par palier de classement (index 0 = 1er), réglable avant lancement (voir wizScoringStep)
    brKillPoints: number; // Battle Royale : points par élimination, en plus du palier de classement
    imageUrl: string | null;
  };
  wizRosterSearch: string;
  wizEditId: string | null; // id du tournoi en cours de modification via l'assistant (null = création)
  // true = "Changer le format" a rouvert l'assistant complet (toutes les étapes, format inclus) sur un
  // tournoi existant, plutôt que le petit raccourci "Modifier" (barème uniquement) — voir wizSteps().
  wizFullEdit: boolean;
  // Base de joueurs & clubs (site-wide, gérée depuis l'admin — aussi utilisée par l'assistant de création).
  roster: Detail[] | null; clubs: Detail[] | null;
  rosterEdit: Detail | null; clubEdit: Detail | null; rosterTab: "joueurs" | "clubs" | "jeux";
  classementView: "joueurs" | "clubs" | "equipes" | "pronos"; // bascule joueurs / clubs sur la page Classements
  // Catalogue des jeux (site-wide, géré depuis l'admin) — noms canoniques proposés à la création
  // d'un tournoi pour éviter les doublons de casse/orthographe qui fausseraient classements/stats.
  games: Detail[] | null; gameEdit: Detail | null;
  // Fiche complète d'un joueur de la base, ouverte depuis Admin → Joueurs (stats, commandes, inscriptions).
  playerDetail: Detail | null; playerDetailBusy: boolean;
};

const NAV = ["Accueil", "Tournois", "Classements", "Galerie", "Boutique", "Profil"];
// Pages simples (sans paramètre) dont le hash d'URL correspond directement à la clé de page.
const SIMPLE_PAGES = ["accueil", "tournois", "evenements", "classements", "galerie", "boutique", "profil", "mentions-legales", "confidentialite"];

const SLIDES = [
  { tag: "Grand tournoi", title: "SURVIVAL CUP LOMÉ 2026", sub: "32 joueurs, mode Survival — le vainqueur reste sur le terrain. Cagnotte 160 points.", cta: "S'inscrire" },
  { tag: "Nouveau", title: "FREE FIRE TOGO SERIES", sub: "48 joueurs en Battle Royale sur 3 jours. Qualifications en ligne ouvertes.", cta: "Voir le tournoi" },
  { tag: "Communauté", title: "GAMING ARENA LOMÉ", sub: "LAN mensuelle : viens jouer, streamer et rencontrer la communauté esport togolaise.", cta: "Découvrir" },
];

const PARTNERS = ["Gaming Arena Lomé", "Yas Togo", "Moov Africa", "Université de Lomé", "CIC Lomé", "Togocom"];

const PAYMENTS = ["Flooz", "Mixx by Yas", "Visa", "Mastercard", "PayPal", "Espèces"];
/** Moyens de paiement en ligne (passerelles) — le libellé est aussi la valeur enregistrée dans paymentMethod côté API. */
const ONLINE_PAY = ["FedaPay", "KkiaPay"];
/** Moyens proposés à l'utilisateur : paiement en ligne (seulement les passerelles configurées) puis moyens manuels. */
function onlinePayOn(S: State): boolean { const c = S.payConfig; return !!(c && (c.fedapay || c.kkiapay)); }
/** Fenêtre de partage d'un tournoi ou d'un événement — le lien pointe vers sa page publique (/tournois/<id>
 * ou /evenements/<id>), consultable par n'importe qui sans compte, comme un lien de partage Challonge. */
function shareModal(S: State): string {
  const s = S.shareTarget;
  if (!s) return "";
  const enc = encodeURIComponent(s.url);
  const text = encodeURIComponent(s.title);
  const row = (href: string, color: string, label: string, icon: string) =>
    `<a href="${href}" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:14px;width:100%;text-align:left;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px 16px;cursor:pointer;font-family:inherit;color:var(--text);text-decoration:none">
      <span style="flex:none;width:8px;align-self:stretch;border-radius:99px;background:${color}"></span>
      <span style="flex:1;min-width:0;font-weight:750;font-size:14.5px">${label}</span>
      <span style="flex:none;color:${color};font-weight:800">${icon}</span></a>`;
  return `<div data-shareclose="1" style="position:fixed;inset:0;z-index:320;display:grid;place-items:center;padding:20px;background:rgba(6,6,10,.72);backdrop-filter:blur(6px)">
    <div data-stop="1" style="width:min(440px,100%);background:var(--surface-2);border:1px solid var(--border);border-radius:18px;padding:22px 22px 20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px"><span style="font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:1px">Partager</span><span data-shareclose="1" style="color:var(--text-muted);cursor:pointer">${ic(I.x, 18)}</span></div>
      <div style="display:flex;align-items:center;gap:8px;border:1px solid var(--border);border-radius:11px;background:var(--surface);padding:9px 10px;margin-bottom:14px">
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;color:var(--text-muted);font-family:'JetBrains Mono',monospace">${escHtml(s.url)}</span>
        <button data-sharecopy="1" style="flex:none;background:${s.copied ? "#34D399" : "#22D3EE"};color:#04222a;border:0;border-radius:9px;padding:8px 13px;font-weight:750;font-size:12.5px;cursor:pointer">${s.copied ? "Copié !" : "Copier"}</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${row(`https://wa.me/?text=${text}%20${enc}`, "#25D366", "WhatsApp", ic(I.share, 15))}
        ${row(`https://www.facebook.com/sharer/sharer.php?u=${enc}`, "#1877F2", "Facebook", ic(I.share, 15))}
        ${row(`https://twitter.com/intent/tweet?text=${text}&url=${enc}`, "var(--text)", "X (Twitter)", ic(I.share, 15))}
      </div>
      <p style="margin:14px 0 0;font-size:12px;color:var(--text-faint);line-height:1.6">Ce lien est public : n'importe qui peut le consulter sans se connecter.</p>
    </div></div>`;
}

/** Code d'intégration (iframe) d'un bracket — même URL chromeless que "Mode Show" (#show=), déjà
 * pensée pour un grand écran sans le site autour : intégrable telle quelle ailleurs (Discord, un
 * site de club…), comme le permettent Challonge/start.gg. */
/** Petite pastille de confirmation en bas d'écran (disparaît seule, voir showToast). */
function toastHtml(S: State): string {
  return S.toast ? `<div style="position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:400;max-width:min(92vw,520px);background:var(--surface-2);border:1px solid var(--border-strong);color:var(--text);border-radius:12px;padding:12px 18px;font-size:13.5px;font-weight:600;box-shadow:0 12px 40px rgba(0,0,0,.5)">${escHtml(S.toast)}</div>` : "";
}
function embedModal(S: State): string {
  const e = S.embedTarget;
  if (!e) return "";
  return `<div data-embedclose="1" style="position:fixed;inset:0;z-index:320;display:grid;place-items:center;padding:20px;background:rgba(6,6,10,.72);backdrop-filter:blur(6px)">
    <div data-stop="1" style="width:min(520px,100%);background:var(--surface-2);border:1px solid var(--border);border-radius:18px;padding:22px 22px 20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><span style="font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:1px">Code d'intégration</span><span data-embedclose="1" style="color:var(--text-muted);cursor:pointer">${ic(I.x, 18)}</span></div>
      <p style="color:var(--text-muted);font-size:12.5px;line-height:1.6;margin:0 0 14px">Colle ce code dans une page web (site de club, forum…) pour afficher le bracket en direct, sans le reste du site autour.</p>
      <div style="display:flex;align-items:flex-start;gap:8px;border:1px solid var(--border);border-radius:11px;background:var(--surface);padding:10px">
        <textarea readonly style="flex:1;min-width:0;height:84px;resize:none;background:transparent;border:0;color:var(--text-muted);font-family:'JetBrains Mono',monospace;font-size:11.5px;line-height:1.5" onclick="this.select()">${escHtml(e.code)}</textarea>
      </div>
      <button data-embedcopy="1" style="width:100%;margin-top:12px;background:${e.copied ? "#34D399" : "#22D3EE"};color:#04222a;border:0;border-radius:9px;padding:10px;font-weight:750;font-size:13px;cursor:pointer">${e.copied ? "Copié !" : "Copier le code"}</button>
    </div></div>`;
}

function payChoiceModal(S: State): string {
  if (!S.payModal) return "";
  const c = S.payConfig;
  const opt = (key: string, title: string, sub: string, color: string) => `<button data-paychoose="${key}" style="display:flex;align-items:center;gap:14px;width:100%;text-align:left;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px 16px;cursor:pointer;font-family:inherit;color:var(--text)">
      <span style="flex:none;width:8px;align-self:stretch;border-radius:99px;background:${color}"></span>
      <span style="flex:1;min-width:0"><span style="display:block;font-weight:750;font-size:15px">${title}</span><span style="display:block;font-size:12.5px;color:var(--text-muted);margin-top:3px;line-height:1.5">${sub}</span></span>
      <span style="flex:none;color:#22D3EE;font-weight:800">›</span></button>`;
  // KkiaPay retiré de la sélection (option désactivée à la demande — l'intégration reste en place,
  // voir startOnlinePay/verifyOnlinePayment, pour une réactivation future sans tout reconstruire).
  const options = [
    c?.fedapay ? opt("FedaPay", "FedaPay", "Paiement mobile de la sous-région (Mobile Money : Flooz, Mixx by Yas, MTN, Moov…).", "#22D3EE") : "",
    c?.fedapay ? opt("Visa", "Visa · carte bancaire", "Carte Visa ou Mastercard, réglée sur la page sécurisée de FedaPay.", "#34D399") : "",
  ].join("");
  return `<div data-payclose="1" style="position:fixed;inset:0;z-index:320;display:grid;place-items:center;padding:20px;background:rgba(6,6,10,.72);backdrop-filter:blur(6px)">
    <div data-stop="1" style="width:min(460px,100%);background:var(--surface-2);border:1px solid var(--border);border-radius:18px;padding:22px 22px 20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px"><span style="font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:1px">Choisis ton moyen de paiement</span><span data-payclose="1" style="color:var(--text-muted);cursor:pointer">${ic(I.x, 18)}</span></div>
      <p style="color:var(--text-muted);font-size:12.5px;line-height:1.6;margin:0 0 16px"><b style="color:var(--text)">FedaPay</b> correspond aux paiements mobiles de la sous-région (Mobile Money) et carte bancaire. Tu es redirigé(e) vers une page sécurisée, puis ton paiement est confirmé automatiquement.</p>
      <div style="display:flex;flex-direction:column;gap:10px">${options}</div>
    </div></div>`;
}
function payMethods(S: State): string[] {
  const c = S.payConfig;
  // KkiaPay retiré de la sélection (option désactivée à la demande — l'intégration reste en place,
  // voir startOnlinePay/verifyOnlinePayment, pour une réactivation future sans tout reconstruire).
  const online = c?.fedapay ? ["FedaPay"] : [];
  return [...online, ...PAYMENTS];
}

const FORMATS = ["Tous", "Survival", "Bracket simple", "Double élim", "Swiss", "Round Robin", "Poules", "Battle Royale"];

/** Formats sélectionnables à la création : [étiquette DB envoyée à l'API, libellé, explication courte du déroulé]. */
const WIZ_FORMATS: [string, string, string][] = [
  ["SURVIVAL", "Survival", "Poules avec repêchage, puis phase finale — le format historique Miabe, barème détaillé réglable."],
  ["SINGLE_ELIM", "Bracket simple", "Élimination directe : une défaite et c'est terminé. Rapide, un seul vainqueur possible par match."],
  ["DOUBLE_ELIM", "Double élim", "Deux brackets (vainqueurs/perdants) : il faut deux défaites pour être éliminé."],
  ["ROUND_ROBIN", "Round Robin", "Tout le monde affronte tout le monde. Classement final aux victoires."],
  ["SWISS", "Swiss", "Rondes appariées selon le classement courant, sans reproduire les mêmes duels. Plusieurs rondes, pas d'élimination directe."],
  ["BATTLE_ROYALE", "Battle Royale", "Parties à plusieurs joueurs classées du 1er au dernier, points par palier de classement cumulés sur plusieurs parties."],
];
const ENGINE_TO_DB_FORMAT: Record<string, string> = {
  survival: "SURVIVAL", single: "SINGLE_ELIM", double: "DOUBLE_ELIM", roundrobin: "ROUND_ROBIN", swiss: "SWISS", battle_royale: "BATTLE_ROYALE",
};
const GAMES = ["Tous", "EA FC 26", "Tekken 8", "Free Fire", "Valorant"];
const CATS = ["Tous", "Vêtements", "Goodies", "Billets", "Cartes cadeaux"];

/* ================= Icônes SVG (aucun emoji) ================= */
function ic(p: string, s = 18) { return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`; }
/** I.arrow pointe à droite (utilisé partout pour "suivant/continuer") — retourné horizontalement pour les actions "retour/précédent/annuler". */
function icBack(s = 18) { return `<span style="display:inline-flex;transform:scaleX(-1)">${ic(I.arrow, s)}</span>`; }
const I = {
  bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>', search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  cart: '<path d="M4 5h2l1.6 10h9L18 8H7"/><circle cx="9" cy="20" r="1.4"/><circle cx="16" cy="20" r="1.4"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
  flame: '<path d="M12 3c1 3 4 4.5 4 8a4 4 0 0 1-8 0c0-1.2.4-2 1-2.8C8.8 9.8 9 11 10 11c0-2.2 1-4.2 2-8Z"/>',
  medal: '<circle cx="12" cy="9" r="5"/><path d="M8.5 13 6 22l6-3 6 3-2.5-9"/>', crown: '<path d="M4 8l3.5 3L12 5l4.5 6L20 8l-1.5 10h-13L4 8Z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.5-4.5L6 21"/>',
  warn: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 9v5M12 17.5v.5"/>',
  printer: '<path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2"/><rect x="6" y="14" width="12" height="7"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.6 15.4 6.4M8.6 13.4l6.8 4.2"/>',
  extlink: '<path d="M14 4h6v6M20 4 10 14M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 19h16"/>',
};
const money = (n: number) => n.toLocaleString("fr-FR") + " F";

/** Aperçu (pur, non autoritaire) de la répartition en poules — même formule que le moteur. */
function balancedSizesPreview(nPlayers: number, nbPools: number): number[] {
  const nb = Math.max(1, Math.min(nbPools, Math.max(nPlayers, 1)));
  const base = Math.floor(nPlayers / nb), extra = nPlayers % nb;
  return Array.from({ length: nb }, (_, i) => base + (i < extra ? 1 : 0));
}
/** Aperçu (pur, non autoritaire) de la cagnotte programmée — même formule que Engine.cagnotte, pour prévisualiser dans l'assistant avant la création réelle côté serveur.
 * Expose aussi le détail par catégorie (nb de matchs prévus + points qu'elle programme) pour l'affichage du barème et la barre de répartition de la jauge. */
/** Nombre de matchs de phase finale (hors bye) pour `q` qualifiés, selon le format choisi — même
 * intention que Engine.finalsMatchCount côté serveur. 'double' utilise une borne sûre (majorant,
 * y compris la 2e petite finale en cas de bracket reset) plutôt qu'une simulation complète de
 * bracket ici : ne sous-estime jamais, donc n'autorise jamais un barème qui dépasserait vraiment
 * la cagnotte une fois envoyé au serveur (qui, lui, simule le bracket exactement). */
function finalsMatchesPreview(q: number, finalsFormat: string): number {
  if (q < 2) return 0;
  if (finalsFormat === "roundrobin") return (q * (q - 1)) / 2;
  if (finalsFormat === "double") return 2 * q - 1; // majorant sûr (avec reset)
  return q - 1;
}
function cagnottePreview(nPlayers: number, nbPools: number, pointsPerPlayer: number, scoring: { survWin: number; loserWin: number; poolFinalWin: number; finalsWin: number; championBonus: number; streakBonus?: number }, finalsFormat = "double", poolFormat: "survival" | "double" | "roundrobin" = "survival", qualifyPerPool = 2) {
  const total = nPlayers * pointsPerPlayer;
  const sizes = balancedSizesPreview(nPlayers, nbPools);
  let surv = 0, los = 0, pf = 0, nRealPools = 0;
  sizes.forEach((n) => {
    if (n < 2) return;
    nRealPools++;
    // Poule en double élim : même borne sûre que la phase finale (2n-1 rencontres, reset inclus) —
    // répartie sur les 3 mêmes catégories que le mode Survival classique (bracket vainqueurs/perdants/finale).
    // Round robin de poule : chacun affronte tous les autres, toutes les rencontres au tarif survWin.
    if (poolFormat === "roundrobin") { surv += (n * (n - 1)) / 2; }
    else if (poolFormat === "double") { surv += n - 1; los += Math.max(0, n - 2); pf += 2; }
    else { surv += n - 1; los += Math.max(0, n - 2); pf += 1; }
  });
  // Qualifiés : N par poule, borné seulement par l effectif de la poule, quel que soit le mode de
  // poule (miroir de Engine.cagnotte) — auparavant figé à 2 (ou 4 en Round Robin), ce qui sous-estimait
  // la phase finale dès qu'on en qualifiait davantage.
  const perPool = qualifyPerPool || 2;
  const q = sizes.filter((n) => n >= 2).reduce((acc, n) => acc + Math.min(perPool, n), 0)
    + sizes.filter((n) => n === 1).length;
  // Phase finale en Survival : une grande poule Survival réunissant tous les qualifiés (voir
  // Engine.startFinalsSurvivalPool) — ses matchs se paient aux tarifs de poule (survWin/loserWin/
  // poolFinalWin), pas au tarif finalsWin, et elle compte comme une poule de plus pour le bonus striker.
  const finalsMatches = finalsFormat === "survival" ? 0 : finalsMatchesPreview(q, finalsFormat);
  if (finalsFormat === "survival" && q >= 2) { surv += q - 1; los += Math.max(0, q - 2); pf += 1; nRealPools++; }
  const streakBonus = scoring.streakBonus ?? 0;
  const breakdown = {
    survWin: { matches: surv, pts: Math.round(surv * scoring.survWin * 100) / 100 },
    loserWin: { matches: los, pts: Math.round(los * scoring.loserWin * 100) / 100 },
    poolFinalWin: { matches: pf, pts: Math.round(pf * scoring.poolFinalWin * 100) / 100 },
    finalsWin: { matches: finalsMatches, pts: Math.round(finalsMatches * scoring.finalsWin * 100) / 100 },
    championBonus: { matches: 1, pts: Math.round(scoring.championBonus * 100) / 100 },
    streakBonus: { matches: nRealPools, pts: Math.round(nRealPools * streakBonus * 100) / 100 },
  };
  const programmed = Math.round((surv * scoring.survWin + los * scoring.loserWin + pf * scoring.poolFinalWin + finalsMatches * scoring.finalsWin + scoring.championBonus + nRealPools * streakBonus) * 100) / 100;
  return { total, programmed, gap: Math.round((total - programmed) * 100) / 100, valid: programmed <= total, sizes, breakdown };
}

/** Partenaires normalisés (compat : d'anciens réglages stockaient de simples chaînes, ou pas de mode d'affichage). */
function normPartners(S: State): { name: string; logoUrl: string | null; display: "both" | "logo" | "name" }[] {
  const raw: Detail[] = S.site?.partners?.length ? S.site.partners : PARTNERS;
  return raw.map((p: Detail) => (typeof p === "string" ? { name: p, logoUrl: null, display: "both" } : { name: p.name, logoUrl: p.logoUrl ?? null, display: p.display || "both" }));
}

/** Logo du site : image envoyée depuis l'admin, sinon l'éclair par défaut. */
function brandLogo(S: State, size = 34, iconSize = 20) {
  const url = S.site?.brand?.logoUrl;
  if (url) return `<img src="${mediaUrl(url)}" alt="logo" style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.3)}px;object-fit:cover;box-shadow:0 0 30px rgba(34,211,238,.25)" />`;
  return `<span style="display:grid;place-items:center;width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.3)}px;background:linear-gradient(140deg,#22D3EE,#7C82FF);color:#04222a;box-shadow:0 0 30px rgba(34,211,238,.35)">${ic(I.bolt, iconSize)}</span>`;
}

/* ================= En-tête ================= */
function header(S: State) {
  // « Profil » (espace membre) n'apparaît que pour un utilisateur connecté.
  const items = S.user ? NAV : NAV.filter((n) => n !== "Profil");
  const nav = items.map((n) => {
    const key = n.toLowerCase(); const on = S.page === key || (key === "profil" && S.page === "profil");
    const label = n === "Profil" ? "Mon espace" : n;
    return `<button class="hbtn" data-go="${key}" style="position:relative;background:transparent;border:0;padding:10px 14px;cursor:pointer">
      <span style="color:${on ? "#22D3EE" : "var(--text-muted)"};font-weight:${on ? 700 : 600};font-size:13.5px;letter-spacing:.3px">${label}</span>
      ${on ? '<span style="position:absolute;left:14px;right:14px;bottom:-14px;height:2px;background:#22D3EE;border-radius:2px"></span>' : ""}</button>`;
  }).join("");
  return `<header style="position:sticky;top:0;z-index:50;display:flex;align-items:center;gap:18px;flex-wrap:wrap;padding:13px 22px;border-bottom:1px solid var(--border);background:var(--bar-bg-1);backdrop-filter:blur(12px)">
    <div data-go="accueil" style="display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none">
      ${brandLogo(S, 34, 20)}
      <span style="font-family:'Bebas Neue',sans-serif;font-size:25px;letter-spacing:1.6px">${escHtml(S.site?.brand?.name1 ?? "Miabe")} <span style="color:#22D3EE">${escHtml(S.site?.brand?.name2 ?? "ESPORT")}</span></span></div>
    <nav style="display:flex;gap:2px;flex-wrap:wrap">${nav}</nav>
    <div style="flex:1;min-width:12px"></div>
    <div style="position:relative;min-width:170px">
      <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text-faint);pointer-events:none">${ic(I.search, 16)}</span>
      <input id="hsearch" value="${(S.q || "").replace(/"/g, "&quot;")}" placeholder="Tournoi, jeu… (Entrée)" style="width:100%;background:var(--surface-3);border:1px solid var(--border);border-radius:11px;color:var(--text);font-family:inherit;font-size:13px;padding:9px 12px 9px 36px" /></div>
    ${themeToggleBtn(S, 42, 18)}
    <button data-cart-open="1" style="position:relative;display:grid;place-items:center;width:42px;height:42px;background:var(--surface-3);border:1px solid var(--border-strong);border-radius:11px;color:var(--text);cursor:pointer">${ic(I.cart, 19)}
      ${S.cartItems.length ? `<span style="position:absolute;top:-6px;right:-6px;min-width:19px;height:19px;padding:0 5px;display:grid;place-items:center;background:#F43F7E;color:#fff;font-size:11px;font-weight:800;border-radius:99px">${S.cartItems.length}</span>` : ""}</button>
    ${S.user
      ? `<button data-menu-user="1" style="display:inline-flex;align-items:center;gap:9px;background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:11px;padding:7px 13px 7px 8px;font-weight:700;font-size:13.5px;cursor:pointer"><span style="display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#22D3EE,#7C82FF);color:#04222a;font-weight:800;font-size:13px">${(S.user.displayName || "?").charAt(0).toUpperCase()}</span>${S.user.displayName}<span data-logout="1" title="Déconnexion" style="color:var(--text-muted);margin-left:2px">${ic(I.logout, 15)}</span></button>`
      : `<button data-auth-open="1" style="background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:11px;padding:10px 16px;font-weight:750;font-size:13.5px;cursor:pointer;box-shadow:0 0 30px rgba(34,211,238,.22)">Connexion</button>`}
    </header>`;
}

/* ================= Shell rail (module Tournois/Classements/Galerie/Boutique) ================= */
const RAIL_NAV: [string, string, string][] = [
  ["accueil", "Accueil", I.bolt],
  ["tournois", "Tournois", I.flame],
  ["evenements", "Événements", I.crown],
  ["classements", "Classements", I.medal],
  ["galerie", "Galerie", I.image],
  ["boutique", "Boutique", I.cart],
];

/** Barre "en direct" épinglée en haut du shell rail — pointe vers le premier tournoi live trouvé (rien si aucun). */
function railLiveBar(S: State): string {
  const live = (S.tourns ?? []).find((t) => t.live);
  if (!live) return "";
  return `<div data-open="${live.id}" class="rise live-bar" style="display:flex;align-items:center;gap:14px;height:46px;padding:0 20px;background:#04222a;border-bottom:1px solid rgba(34,211,238,.35);cursor:pointer;flex:none;overflow:hidden">
    <span style="display:inline-flex;align-items:center;gap:8px;flex:none;white-space:nowrap;font-size:11.5px;font-weight:800;letter-spacing:1.6px;text-transform:uppercase;color:#22D3EE"><span style="width:7px;height:7px;border-radius:50%;background:#22D3EE;animation:blink 1.2s infinite"></span>En direct</span>
    <span style="color:#D5F6FC;font-size:13px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(live.name)}${live.game ? " · " + escHtml(live.game) : ""}</span>
    <span style="flex:1"></span>
    <span style="font-size:12.5px;color:#63C6DA;font-weight:700;white-space:nowrap;flex:none">Suivre →</span>
  </div>`;
}

/** Bouton de bascule thème clair/sombre — un seul endroit à changer si l'icône ou la taille par défaut évolue. */
function themeToggleBtn(S: State, size = 38, iconSize = 17): string {
  const light = S.theme === "light";
  return `<button data-themetoggle="1" title="${light ? "Passer en sombre" : "Passer en clair"}" style="display:grid;place-items:center;width:${size}px;height:${size}px;border-radius:${Math.round(size * .29)}px;background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);cursor:pointer;flex:none">${ic(light ? I.moon : I.sun, iconSize)}</button>`;
}

/** Rail de navigation à icônes (88px) — remplace le header public sur les pages du module contenu. */
function railNav(S: State, activeKey: string): string {
  const items = RAIL_NAV.map(([key, label, icon]) => {
    const on = key === activeKey;
    return `<button data-go="${key}" class="hbtn" style="display:flex;flex-direction:column;align-items:center;gap:4px;width:100%;padding:10px 0;border:0;border-left:2px solid ${on ? "#22D3EE" : "transparent"};background:${on ? "linear-gradient(90deg,rgba(34,211,238,.12),transparent)" : "transparent"};cursor:pointer">
      <span style="color:${on ? "#22D3EE" : "var(--text-muted)"}">${ic(icon, 20)}</span>
      <span style="font-size:9.5px;font-weight:${on ? 800 : 700};letter-spacing:.6px;color:${on ? "#22D3EE" : "var(--text-muted)"};text-transform:uppercase">${label}</span>
    </button>`;
  }).join("");
  const cartBtn = `<button data-cart-open="1" title="Panier" style="position:relative;display:grid;place-items:center;width:38px;height:38px;border-radius:11px;background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);cursor:pointer">${ic(I.cart, 17)}
    ${S.cartItems.length ? `<span style="position:absolute;top:-6px;right:-6px;min-width:17px;height:17px;padding:0 4px;display:grid;place-items:center;background:#F43F7E;color:#fff;font-size:10px;font-weight:800;border-radius:99px">${S.cartItems.length}</span>` : ""}</button>`;
  const userBtn = S.user
    ? `<button data-go="profil" title="${escAttr(S.user.displayName)}" style="display:grid;place-items:center;width:38px;height:38px;border-radius:11px;background:linear-gradient(135deg,#22D3EE,#7C82FF);color:#04222a;font-weight:800;font-size:15px;border:0;cursor:pointer">${(S.user.displayName || "?").charAt(0).toUpperCase()}</button>`
    : `<button data-auth-open="1" title="Connexion" style="display:grid;place-items:center;width:38px;height:38px;border-radius:11px;background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);cursor:pointer">${ic(I.user, 18)}</button>`;
  return `<div class="rail-desktop" style="position:fixed;top:0;left:0;bottom:0;width:88px;z-index:40;overflow-y:auto;border-right:1px solid var(--surface-3);display:flex;flex-direction:column;align-items:center;padding:18px 0 24px;gap:6px;background:var(--bg)">
    <div data-go="accueil" class="hbtn" style="display:grid;place-items:center;margin-bottom:16px;cursor:pointer">${brandLogo(S, 40, 22)}</div>
    ${items}
    <div style="width:32px;height:1px;background:var(--surface-3);margin:10px 0"></div>
    ${themeToggleBtn(S, 38, 17)}
    ${cartBtn}
    ${userBtn}
  </div>`;
}

/** Équivalent mobile du rail d'icônes : bandeau haut compact (logo + panier + profil) + barre d'onglets fixée en bas
 * (les 5 destinations de RAIL_NAV). Toujours émis, masqué en CSS au-dessus de 1024px (voir globals.css). */
function railMobileBars(S: State, activeKey: string): string {
  const top = `<div class="rail-mobile-top" style="position:sticky;top:0;z-index:45;align-items:center;gap:10px;padding:11px 16px;border-bottom:1px solid var(--surface-3);background:var(--bar-bg-2);backdrop-filter:blur(10px)">
    <div data-go="accueil" style="display:flex;align-items:center;gap:8px;cursor:pointer;flex:1;min-width:0">${brandLogo(S, 28, 16)}<span style="font-family:'Bebas Neue',sans-serif;font-size:17px;letter-spacing:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(S.site?.brand?.name1 ?? "Miabe")} <span style="color:#22D3EE">${escHtml(S.site?.brand?.name2 ?? "ESPORT")}</span></span></div>
    ${themeToggleBtn(S, 36, 15)}
    <button data-cart-open="1" title="Panier" style="position:relative;display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);cursor:pointer;flex:none">${ic(I.cart, 16)}
      ${S.cartItems.length ? `<span style="position:absolute;top:-5px;right:-5px;min-width:16px;height:16px;padding:0 4px;display:grid;place-items:center;background:#F43F7E;color:#fff;font-size:9.5px;font-weight:800;border-radius:99px">${S.cartItems.length}</span>` : ""}</button>
    ${S.user
      ? `<button data-go="profil" title="${escAttr(S.user.displayName)}" style="display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#22D3EE,#7C82FF);color:#04222a;font-weight:800;font-size:14px;border:0;cursor:pointer;flex:none">${(S.user.displayName || "?").charAt(0).toUpperCase()}</button>`
      : `<button data-auth-open="1" title="Connexion" style="display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);cursor:pointer;flex:none">${ic(I.user, 16)}</button>`}
  </div>`;
  const tabs = RAIL_NAV.map(([key, label, icon]) => {
    const on = key === activeKey;
    return `<button data-go="${key}" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;flex:1 1 0;min-width:0;height:100%;border:0;background:transparent;cursor:pointer;padding:0 1px">
      <span style="color:${on ? "#22D3EE" : "var(--text-muted)"}">${ic(icon, 19)}</span>
      <span style="font-size:8.5px;font-weight:${on ? 800 : 700};letter-spacing:0;color:${on ? "#22D3EE" : "var(--text-muted)"};text-transform:uppercase;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${label}</span>
    </button>`;
  }).join("");
  const bottom = `<div class="rail-mobile-bottom" style="position:fixed;left:0;right:0;bottom:0;z-index:45;height:64px;border-top:1px solid var(--surface-3);background:var(--bar-bg-3);backdrop-filter:blur(10px);padding-bottom:env(safe-area-inset-bottom)">${tabs}</div>`;
  return top + bottom;
}

/** Shell rail complet : barre live + rail d'icônes + contenu de la page. Utilisé par Tournois/Classements/Galerie/Boutique.
 * Sous 1024px, le rail à icônes cède la place à railMobileBars() (bandeau haut + barre d'onglets bas), voir globals.css. */
function railShell(S: State, activeKey: string, body: string): string {
  return `${railNav(S, activeKey)}${railMobileBars(S, activeKey)}
  <div class="rail-content" style="margin-left:88px;min-height:100vh;display:flex;flex-direction:column">
    ${railLiveBar(S)}
    <div style="flex:1;min-width:0">${body}</div>
    ${siteFooter()}
  </div>`;
}


/** Pied de page du site : mentions légales obligatoires. Partagé entre le shell rail (accueil,
 * tournois, galerie, boutique, classements) et la page d'accueil de repli — il était auparavant
 * cantonné à cette dernière, donc invisible sur toutes les pages réellement visitées. */
function siteFooter(): string {
  const link = (page: string, label: string) =>
    `<button data-go="${page}" style="background:none;border:0;color:var(--text-muted);font-size:12.5px;font-family:inherit;cursor:pointer;text-decoration:underline;padding:0">${label}</button>`;
  return `<footer style="border-top:1px solid var(--border);padding:26px 22px;text-align:center;color:var(--text-faint);font-size:12.5px">
    © ${new Date().getFullYear()} MIABE ESPORT · Le hub de l'esport togolais &amp; ouest-africain
    <div style="margin-top:10px;display:flex;gap:18px;justify-content:center;flex-wrap:wrap">${link("mentions-legales", "Mentions légales")}${link("confidentialite", "Politique de confidentialité")}</div>
  </footer>`;
}

/** En-tête de page réutilisé par les pages du shell rail : titre + sous-titre + zone d'actions (recherche, boutons…). */
function railPageHead(title: string, sub: string, actions = ""): string {
  return `<div class="rise page-hpad" style="display:flex;align-items:flex-end;gap:20px;padding:32px 44px 20px;flex-wrap:wrap">
    <div><h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(38px,4.5vw,56px);letter-spacing:1.5px;margin:0;line-height:.92">${title}</h1><p style="color:var(--text-muted);font-size:14px;margin:8px 0 0;max-width:640px">${sub}</p></div>
    <span style="flex:1"></span>
    ${actions}
  </div>`;
}

/* ================= Composants ================= */
function tournCard(t: TournCard, big: boolean) {
  const badge = t.live ? '<span style="display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:800;white-space:nowrap;letter-spacing:1px;text-transform:uppercase;color:#04222a;background:#22D3EE;border-radius:99px;padding:4px 9px"><span style="width:6px;height:6px;border-radius:50%;background:#04222a;animation:blink 1.2s infinite"></span>Live</span>' : "";
  const foot = t.live ? '<span style="font-size:12px;color:#22D3EE;font-weight:700">En direct</span>' : `<span style="font-size:12px;color:var(--text-muted);font-weight:600">${t.status}</span>`;
  const openAttr = t.id ? `data-open="${t.id}"` : `data-go="tournois"`;
  // Bandeau : image du tournoi si fournie, sinon dégradé par défaut.
  const bannerBg = t.imageUrl
    ? `background-image:linear-gradient(180deg,rgba(11,11,17,.15),rgba(11,11,17,.55)),url('${mediaUrl(t.imageUrl)}');background-size:cover;background-position:center`
    : "background:linear-gradient(135deg,rgba(34,211,238,.16),rgba(124,130,255,.11))";
  return `<div ${openAttr} class="hcard" style="border:1px solid var(--border);border-radius:16px;overflow:hidden;cursor:pointer;background:linear-gradient(180deg,var(--surface),var(--surface-2))">
    <div class="zoom" style="height:${t.imageUrl ? (big ? 130 : 110) : big ? 80 : 74}px;display:flex;align-items:flex-start;justify-content:space-between;padding:13px 14px;${bannerBg}">
      <span style="font-size:11px;font-weight:700;color:#04222a;background:rgba(255,255,255,.55);border-radius:99px;padding:3px 9px">${t.format}</span>${badge}</div>
    <div style="padding:${big ? "15px 16px 17px" : "14px 15px 16px"}">
      <h4 style="margin:0 0 6px;font-size:${big ? 18 : 17}px">${t.name}</h4>
      <div style="color:var(--text-muted);font-size:12.5px;line-height:1.7">${t.game} · ${t.players} joueurs<br>${t.date} · ${t.place}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:13px;padding-top:13px;border-top:1px solid var(--border)">${foot}
        ${t.cagnotte !== null ? `<span style="font-size:12px;color:#FBBF24;font-weight:700">${big ? "Cagnotte " : ""}<span style="font-family:'JetBrains Mono',monospace">${t.cagnotte}</span> pts</span>` : ""}</div></div></div>`;
}
/** Sélecteur de fichier stylé : input masqué + bouton + nom du fichier choisi. */
function filePicker(id: string, label = "Choisir une image", accept = "image/*", existingUrl?: string | null, multiple = false) {
  const isVideo = !!existingUrl && /\.(mp4|webm)$/i.test(existingUrl);
  const preview = `<div id="pv-${id}" style="width:50px;height:50px;border-radius:11px;border:1px solid var(--border);overflow:hidden;flex:none;display:flex;align-items:center;justify-content:center;color:var(--text-faint);background:${existingUrl && !isVideo ? `url('${mediaUrl(existingUrl)}') center/cover` : "var(--surface-3)"}">${isVideo ? ic(I.tv, 18) : !existingUrl ? ic(I.image, 18) : ""}</div>`;
  return `<div style="display:flex;align-items:center;gap:10px;margin-top:6px;min-width:0;flex-wrap:wrap">
    ${preview}
    <input id="${id}" type="file" accept="${accept}" ${multiple ? "multiple" : ""} style="display:none" />
    <button data-filepick="${id}" style="display:inline-flex;align-items:center;gap:8px;background:var(--surface-3);border:1px dashed var(--border-strong);color:#22D3EE;border-radius:11px;padding:11px 16px;font-weight:700;font-size:13px;cursor:pointer;flex:none">${ic(I.image, 16)}${label}</button>
    <span id="${id}-name" style="font-size:12.5px;color:${existingUrl ? "#34D399" : "var(--text-faint)"};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${existingUrl ? "Image enregistrée" : "Aucun fichier"}</span>
  </div>`;
}

function chips(list: string[], active: string, attr: string, color = "#22D3EE") {
  return list.map((l) => {
    const on = l === active;
    return `<button class="chip" data-${attr}="${l}" style="font-family:inherit;font-size:12.5px;font-weight:${on ? 700 : 600};color:${on ? color : "var(--text-muted)"};background:${on ? "rgba(34,211,238,.08)" : "var(--surface)"};border:1px solid ${on ? color : "var(--border)"};border-radius:999px;padding:8px 15px;cursor:pointer;flex:none;white-space:nowrap">${l}</button>`;
  }).join("");
}

/* ================= Pages ================= */
function pAccueil(S: State) {
  // Tant que les réglages du site n'ont pas encore été chargés depuis l'API, on affiche un état de
  // chargement plutôt que le contenu de secours (titre/stats/slide par défaut) — sinon ce contenu
  // fictif s'affiche brièvement avant d'être remplacé par le vrai, à chaque ouverture de la page.
  if (!S.site) {
    return `<main style="width:100%;padding:28px clamp(22px,3vw,64px) 60px"><div style="border-radius:20px;border:1px solid var(--border);background:var(--surface);min-height:340px;display:grid;place-items:center;color:var(--text-faint)">Chargement…</div></main>`;
  }
  const slides: Detail[] = (S.site?.slides && S.site.slides.length ? S.site.slides : SLIDES) as Detail[];
  const s = slides[S.slide] || slides[0];
  const hero0 = S.site?.hero;
  const heroTitle = escHtml(hero0?.title ?? "LE HUB DE L'ESPORT\nTOGOLAIS & OUEST-AFRICAIN").replace(/\r?\n/g, "<br>");
  const heroKicker = escHtml(hero0?.kicker ?? "Miabe Esport · Togo");
  const heroSub = escHtml(hero0?.subtitle ?? "Compétitions, classements, communauté et boutique — une seule plateforme pour fédérer les gamers du Togo et professionnaliser l'esport de la région.");
  const heroStats: { v: string; k: string }[] = hero0?.stats?.length ? hero0.stats : [{ v: "2 400+", k: "Joueurs" }, { v: "18", k: "Tournois / an" }, { v: "24", k: "Clubs" }];
  const tourns = S.tourns ?? [];
  const dots = slides.map((_, i) => { const on = i === S.slide; return `<span data-slide="${i}" style="width:${on ? 26 : 10}px;height:6px;border-radius:99px;background:${on ? "#22D3EE" : "var(--border-strong)"};cursor:pointer"></span>`; }).join("");
  // Fond du héro : vidéo ou image (réglages admin), sinon halos lumineux animés.
  const heroBg = hero0?.bgUrl as string | undefined;
  const heroIsVideo = !!heroBg && /\.(mp4|webm)$/i.test(heroBg);
  // Sur une image/vidéo, le texte reste clair quel que soit le thème (la surimpression sombre ci-dessous
  // ne bouge pas non plus) — sans image, il suit le thème comme le reste de la page.
  const heroTextColor = heroBg ? "#fff" : "var(--text)";
  const heroSubColor = heroBg ? "rgba(255,255,255,.78)" : "var(--text-muted)";
  const heroStatColor = heroBg ? "rgba(255,255,255,.7)" : "var(--text-muted)";
  // Même règle pour la carte « À la une » : texte clair fixe si elle a une image, sinon suit le thème.
  const slideTextColor = s.imageUrl ? "#fff" : "var(--text)";
  const slideSubColor = s.imageUrl ? "rgba(255,255,255,.78)" : "var(--text-muted)";
  const heroMedia = heroBg
    ? (heroIsVideo
      ? `<video class="heromedia" src="${mediaUrl(heroBg)}" autoplay muted loop playsinline></video>`
      : `<div class="heromedia kb" style="background-image:url('${mediaUrl(heroBg)}');background-size:cover;background-position:center"></div>`)
      + `<div style="position:absolute;inset:0;background:linear-gradient(105deg,rgba(11,11,17,.92) 25%,rgba(11,11,17,.55) 60%,rgba(11,11,17,.3));pointer-events:none"></div>`
    : `<span class="blob b1"></span><span class="blob b2"></span><span class="blob b3"></span>`;
  const hero = `<section class="grid2 rise" style="display:grid;grid-template-columns:1.35fr 1fr;gap:20px;align-items:stretch;margin-bottom:20px">
    <div style="display:flex;flex-direction:column;justify-content:center;padding:34px 32px;border-radius:20px;border:1px solid var(--border);background:linear-gradient(150deg,rgba(34,211,238,.10),rgba(124,130,255,.06) 55%,var(--surface-2));position:relative;overflow:hidden">
      ${heroMedia}
      <div style="position:relative;z-index:1">
      <span style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#22D3EE;font-weight:800">${heroKicker}</span>
      <h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(40px,6vw,72px);letter-spacing:1.5px;line-height:.92;margin:12px 0 0;color:${heroTextColor}">${heroTitle}</h1>
      <p style="color:${heroSubColor};font-size:15px;line-height:1.6;max-width:560px;margin:16px 0 24px">${heroSub}</p>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <button data-go="tournois" class="glow" style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:14px 22px;font-weight:750;font-size:15px;cursor:pointer">Voir les tournois ${ic(I.arrow)}</button>
        ${S.user ? `<button data-go="profil" style="background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:12px;padding:14px 22px;font-weight:700;font-size:15px;cursor:pointer">Mon espace</button>` : `<button data-auth-open="1" style="background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:12px;padding:14px 22px;font-weight:700;font-size:15px;cursor:pointer">Rejoindre la communauté</button>`}</div>
      <div style="display:flex;gap:30px;margin-top:30px;flex-wrap:wrap">
        ${heroStats.map((st, i) => `<div><div style="font-family:'Bebas Neue',sans-serif;font-size:34px;line-height:1;color:${i === 0 ? "#22D3EE" : heroTextColor}">${escHtml(st.v)}</div><div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${heroStatColor};font-weight:700">${escHtml(st.k)}</div></div>`).join("")}</div>
      </div></div>
    <div style="border-radius:20px;border:1px solid var(--border);background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:22px;display:flex;flex-direction:column;position:relative;overflow:hidden">
      ${s.imageUrl
        ? `<div class="kb" style="position:absolute;inset:0;background-image:url('${mediaUrl(s.imageUrl)}');background-size:cover;background-position:center"></div><div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(11,11,17,.5),rgba(11,11,17,.86) 78%);pointer-events:none"></div>`
        : `<div style="position:absolute;inset:0;background:linear-gradient(135deg,rgba(34,211,238,.14),transparent 55%);pointer-events:none"></div>`}
      <div style="display:flex;align-items:center;justify-content:space-between;position:relative;z-index:1"><span style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:#22D3EE;font-weight:800">À la une</span><span style="font-size:11px;color:var(--text-faint);font-weight:600">${S.slide + 1} / ${slides.length}</span></div>
      <div class="slidein" style="flex:1;display:flex;flex-direction:column;justify-content:center;padding:26px 4px;position:relative;z-index:1;min-height:240px">
        <span style="align-self:flex-start;font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#04222a;background:#22D3EE;border-radius:99px;padding:5px 11px">${escHtml(s.tag)}</span>
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(30px,4vw,46px);letter-spacing:1px;line-height:.95;margin:14px 0 8px;color:${slideTextColor}">${escHtml(s.title)}</h2>
        <p style="color:${slideSubColor};font-size:14px;line-height:1.55;margin:0">${escHtml(s.sub)}</p>
        <button data-go="tournois" style="align-self:flex-start;margin-top:20px;display:inline-flex;align-items:center;gap:7px;background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:11px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer">${escHtml(s.cta)} ${ic(I.arrow, 16)}</button></div>
      <div style="display:flex;gap:8px;position:relative;z-index:1">${dots}</div></div></section>`;

  // Tournoi en direct : barre fixe bien visible (au lieu du bandeau défilant) — sinon repli sur le bandeau des tournois à venir.
  const liveT = tourns.filter((t) => t.live);
  const liveBar = liveT.length ? `<div data-open="${liveT[0].id}" class="rise d1" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;border:1px solid rgba(34,211,238,.4);border-radius:14px;background:rgba(34,211,238,.08);margin-bottom:30px;padding:13px 18px;cursor:pointer">
    <span style="display:inline-flex;align-items:center;gap:7px;font-size:10.5px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#04222a;background:#22D3EE;border-radius:99px;padding:5px 11px;flex:none"><span style="width:6px;height:6px;border-radius:50%;background:#04222a;animation:blink 1.2s infinite"></span>En direct</span>
    <b style="font-size:14.5px">${escHtml(liveT[0].name)}</b>
    <span style="color:var(--text-muted);font-size:13px">${escHtml(liveT[0].game)}${liveT[0].place ? " · " + escHtml(liveT[0].place) : ""}</span>
    <span style="flex:1"></span>
    <span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:#22D3EE;flex:none">Suivre en direct ${ic(I.arrow, 14)}</span>
  </div>` : "";
  const tickerItems = tourns.slice(0, 4).map((t) =>
    `<span style="display:inline-flex;align-items:center;gap:8px;margin:0 26px"><span style="display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);background:var(--surface-4);border-radius:99px;padding:3px 9px">À venir</span><span style="font-weight:700;font-size:13px;color:var(--text)">${t.name}</span><span style="font-size:12px;color:var(--text-faint)">${t.game}${t.place ? " · " + t.place : ""}</span></span>`
  ).join(`<span style="color:var(--border-strong)">·</span>`);
  const ticker = !liveT.length && tourns.length ? `<div class="marquee rise d1" style="border:1px solid var(--border);border-radius:14px;background:linear-gradient(90deg,var(--surface),var(--surface-2));margin-bottom:30px;padding:11px 0">
    <div class="marquee-track">${tickerItems}${tickerItems}</div></div>` : "";

  // Événements à la une : les publiés, en direct d'abord (l'API les trie déjà), trois au maximum.
  const homeEvents = (S.events ?? []).filter((e: Detail) => e.state !== "ended").slice(0, 3);
  const eventsSec = homeEvents.length
    ? `<div class="rise d1" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px"><h3 style="font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:1px;margin:0;display:flex;align-items:center;gap:10px"><span style="width:5px;height:22px;border-radius:3px;background:#F43F7E;display:inline-block"></span>Événements${homeEvents.some((e: Detail) => e.state === "live") ? ` <span style="display:inline-flex;align-items:center;gap:6px;font-size:10.5px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#04222a;background:#22D3EE;border-radius:99px;padding:4px 10px"><span style="width:6px;height:6px;border-radius:50%;background:#04222a;animation:blink 1.2s infinite"></span>En direct</span>` : ""}</h3><a data-go="evenements" style="font-size:13px;font-weight:700;cursor:pointer">Tout voir →</a></div>
      <div class="rise d1" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:18px;margin-bottom:40px">${homeEvents.map(eventCard).join("")}</div>`
    : "";
  const tournHead = `<div class="rise d1" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px"><h3 style="font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:1px;margin:0;display:flex;align-items:center;gap:10px"><span style="width:5px;height:22px;border-radius:3px;background:#22D3EE;display:inline-block"></span>Tournois en cours</h3><a data-go="tournois" style="font-size:13px;font-weight:700;cursor:pointer">Tout voir <span class="more-arrow" style="display:inline-block;animation:nudge 1.2s ease-in-out infinite">→</span></a></div>`;
  const tournGrid = tourns.length
    ? `<div class="rise d2" style="display:flex;flex-wrap:wrap;justify-content:center;gap:16px;margin-bottom:40px">${tourns.slice(0, 3).map((t) => `<div style="flex:1 1 280px;max-width:380px;min-width:0">${tournCard(t, false)}</div>`).join("")}${tourns.length > 3 ? `<div data-go="tournois" class="more-cta" style="flex:1 1 280px;max-width:380px;min-width:0;cursor:pointer;border:1px dashed #22D3EE99;border-radius:14px;background:rgba(34,211,238,.06);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:24px;text-align:center"><span style="font-family:'Bebas Neue',sans-serif;font-size:38px;color:#22D3EE;line-height:1">+${tourns.length - 3}</span><span style="font-size:14px;font-weight:700">autre${tourns.length - 3 > 1 ? "s" : ""} tournoi${tourns.length - 3 > 1 ? "s" : ""} à découvrir</span><span style="font-size:13px;font-weight:750;color:#22D3EE">Tout voir <span class="more-arrow">→</span></span></div>` : ""}</div>`
    : `<div class="rise d2" style="border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:36px 24px;text-align:center;color:var(--text-muted);margin-bottom:40px">Aucun tournoi pour l'instant — reviens bientôt !</div>`;

  // Teaser d'accueil : la meilleure performance de chaque joueur (un seul jeu à la fois, jamais de points additionnés entre jeux).
  let rankSource: Detail[] = [];
  if (S.leaderboard?.length) {
    const bestByPlayer = new Map<string, Detail>();
    for (const r of S.leaderboard) { if (!bestByPlayer.has(r.name) || r.points > bestByPlayer.get(r.name)!.points) bestByPlayer.set(r.name, r); }
    rankSource = Array.from(bestByPlayer.values()).sort((a, b) => b.points - a.points);
  }
  const rankRows = rankSource.length
    ? rankSource.slice(0, 5).map((r: Detail, i: number) => `<tr style="border-top:1px solid var(--border)"><td style="padding:9px 6px;font-family:'Bebas Neue',sans-serif;font-size:18px;color:var(--text-faint);width:30px">${i + 1}</td><td style="padding:9px 6px"><div style="display:flex;align-items:center;gap:9px"><span style="display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:var(--surface-4);border:1px solid var(--border);font-size:11px;font-weight:800;color:var(--text-muted)">${r.name.charAt(0).toUpperCase()}</span><div><div style="font-weight:650">${escHtml(r.name)}</div><div style="font-size:11px;color:var(--text-faint)">${escHtml(r.city) || r.game || ""}</div></div></div></td><td style="padding:9px 6px;color:var(--text-muted);font-size:12.5px">${escHtml(r.game)}</td><td style="padding:9px 6px;text-align:right;font-weight:750;color:#22D3EE;font-family:'JetBrains Mono',monospace">${r.points}</td></tr>`).join("")
    : `<tr><td style="padding:16px 6px;color:var(--text-faint);font-size:13px" colspan="4">Aucun résultat pour l'instant.</td></tr>`;
  // Prochains tournois : dérivé des vrais tournois à venir (aucune donnée inventée) — les deux
  // premiers segments de la date déjà formatée côté API ("12 juil.") alimentent le badge jour/mois.
  const upcoming = tourns.filter((t) => t.status === "À venir" && t.date).slice(0, 4);
  const evRows = upcoming.length
    ? upcoming.map((t) => {
        const [d, moRaw] = t.date.split(" ");
        const mo = (moRaw || "").replace(/\.$/, "");
        return `<div data-open="${t.id}" style="display:flex;gap:13px;align-items:center;cursor:pointer"><div style="flex:none;width:52px;text-align:center;border:1px solid var(--border);border-radius:11px;padding:7px 4px;background:var(--surface)"><div style="font-family:'Bebas Neue',sans-serif;font-size:22px;line-height:1;color:#22D3EE">${escHtml(d) || "—"}</div><div style="font-size:9px;letter-spacing:1px;color:var(--text-muted);font-weight:700;text-transform:uppercase">${escHtml(mo)}</div></div><div style="min-width:0"><div style="font-weight:650;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(t.name)}</div><div style="font-size:12px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(t.format)}${t.place ? " · " + escHtml(t.place) : ""}</div></div></div>`;
      }).join("")
    : `<div style="color:var(--text-faint);font-size:13px">Aucun tournoi à venir pour l'instant.</div>`;
  const mid = `<section class="grid2b rise d3" style="display:grid;grid-template-columns:1.45fr 1fr;gap:18px;margin-bottom:40px"><div style="border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:20px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px"><h3 style="margin:0;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-muted);font-weight:750">Classement · Top joueurs</h3><a data-go="classements" style="font-size:12px;font-weight:700;cursor:pointer">Complet →</a></div><table style="width:100%;border-collapse:collapse;font-size:14px">${rankRows}</table></div><div style="border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:20px"><h3 style="margin:0 0 14px;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-muted);font-weight:750">Prochains tournois</h3><div style="display:flex;flex-direction:column;gap:12px">${evRows}</div></div></section>`;

  const newsItems: { cat: string; ph: string; t: string; date: string; img?: string | null }[] =
    (S.news ?? []).slice(0, 3).map((n: Detail) => ({ cat: n.category, ph: n.slug, t: n.title, date: n.date, img: n.imageUrl }));
  const newsGrid = `<div class="rise d4" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px"><h3 style="font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:1px;margin:0;display:flex;align-items:center;gap:10px"><span style="width:5px;height:22px;border-radius:3px;background:#7C82FF;display:inline-block"></span>Actualités</h3></div>${newsItems.length
    ? `<div class="rise d4" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;margin-bottom:44px">${newsItems.map((a) => `<div class="hcard" style="border:1px solid var(--border);border-radius:16px;overflow:hidden;background:linear-gradient(180deg,var(--surface),var(--surface-2))">${a.img ? `<div class="zoom" style="height:132px;background-image:url('${mediaUrl(a.img)}');background-size:cover;background-position:center"></div>` : `<div class="zoom" style="height:132px;background:repeating-linear-gradient(45deg,var(--surface-6),var(--surface-6) 12px,var(--surface) 12px,var(--surface) 24px);display:grid;place-items:center;color:var(--text-faint);font-family:monospace;font-size:11px;letter-spacing:1px">// ${a.ph}</div>`}<div style="padding:14px 15px 16px"><span style="font-size:11px;font-weight:700;color:#7C82FF;letter-spacing:.5px">${escHtml(a.cat)}</span><h4 style="margin:6px 0 0;font-size:15.5px;line-height:1.35">${escHtml(a.t)}</h4><div style="font-size:12px;color:var(--text-faint);margin-top:8px">${escHtml(a.date)}</div></div></div>`).join("")}</div>`
    : `<div class="rise d4" style="border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:30px 24px;text-align:center;color:var(--text-muted);margin-bottom:44px">Aucune actualité pour l'instant.</div>`}`;

  const shopProducts: { name: string; price: number; ph: string; img?: string | null; showOnHome?: boolean }[] = S.products ?? [];
  // Carrousel défilant en continu (pause au survol) — ne garde que les produits cochés
  // "Afficher sur l'accueil" côté admin ; si aucun n'est coché, retombe sur tout le catalogue.
  const shopHome = shopProducts.filter((p) => p.showOnHome);
  const shopFeatured = (shopHome.length ? shopHome : shopProducts).slice(0, 14);
  const shopCard = (p: Detail) => `<div class="hcard" style="flex:none;width:190px;border:1px solid var(--border);border-radius:14px;overflow:hidden;background:var(--surface)">${p.img ? `<div class="zoom" style="height:120px;background-image:url('${mediaUrl(p.img)}');background-size:cover;background-position:center"></div>` : `<div class="zoom" style="height:120px;background:repeating-linear-gradient(45deg,var(--surface-6),var(--surface-6) 12px,var(--surface) 12px,var(--surface) 24px);display:grid;place-items:center;color:var(--text-faint);font-family:monospace;font-size:10px;letter-spacing:1px">// ${p.ph}</div>`}<div style="padding:12px 13px"><div style="font-weight:650;font-size:13.5px">${escHtml(p.name)}</div><div style="font-weight:800;color:#22D3EE;font-size:13px;margin-top:5px">${money(p.price)}</div></div></div>`;
  const shopSec = shopProducts.length
    ? `<section class="rise d5" style="border:1px solid var(--border);border-radius:18px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:24px 0 24px;margin-bottom:40px;overflow:hidden"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:10px;padding:0 24px"><h3 style="font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:1px;margin:0">La boutique ${escHtml(S.site?.brand?.name1 ?? "Miabe")}</h3><a data-go="boutique" style="font-size:13px;font-weight:700;cursor:pointer">Voir la boutique →</a></div><div class="marquee" style="padding:0 24px"><div class="marquee-track" style="gap:16px;animation-duration:48s">${shopFeatured.map(shopCard).join("")}${shopFeatured.map(shopCard).join("")}</div></div></section>`
    : "";

  const partnerList = normPartners(S);
  const partners = `<div class="rise d6" style="border:1px solid var(--border);border-radius:16px;background:var(--surface-2);padding:22px 24px"><div style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:var(--text-muted);font-weight:750;margin-bottom:16px">Partenaires &amp; sponsors</div><div style="display:flex;gap:14px;flex-wrap:wrap">${partnerList.map((p) => `<span style="display:inline-flex;align-items:center;gap:12px;height:76px;padding:0 18px;border:1px solid var(--border);border-radius:13px;background:var(--surface);color:var(--text-muted);font-weight:700;font-size:14px" title="${escAttr(p.name)}">${p.logoUrl && p.display !== "name" ? `<span style="display:inline-flex;align-items:center;justify-content:center;height:52px;padding:6px 14px;border-radius:10px;background:#F4F5FB"><img src="${mediaUrl(p.logoUrl)}" alt="${escAttr(p.name)}" style="height:40px;width:auto;max-width:150px;object-fit:contain" /></span>` : ""}${p.display !== "logo" || !p.logoUrl ? escHtml(p.name) : ""}</span>`).join("")}</div></div>`;

  return `<main class="rise home-main" style="width:100%;padding:28px clamp(22px,3vw,64px) 60px">${hero}${liveBar}${ticker}${eventsSec}${tournHead}${tournGrid}${mid}${newsGrid}${shopSec}${partners}${adCarousel(S, "accueil")}</main>`;
}

/* ================= Assistant de création de tournoi (5 étapes) ================= */

const WIZ_INP = "width:100%;background:var(--surface-3);border:1px solid var(--border);border-radius:11px;color:var(--text);font-family:inherit;font-size:14px;padding:11px 13px";
const WIZ_LBL = "font-size:12px;color:var(--text-muted);font-weight:600;display:block;margin-bottom:6px";
const wizField = (label: string, inner: string, help?: string) => `<div><label style="${WIZ_LBL}">${label}</label>${inner}${help ? `<span style="display:block;font-size:11px;color:var(--text-faint);margin-top:5px">${help}</span>` : ""}</div>`;
const wizCard = (inner: string) => `<div style="border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:22px">${inner}</div>`;

/** Liste verticale des étapes (barre latérale de l'assistant) — coche + sous-titre contextuel pour les étapes déjà validées. */
/** true = le choix du format est proposé et pilote les étapes Poules/Barème affichées — soit une
 * vraie création, soit "Changer le format" (wizFullEdit) sur un tournoi existant. false = le
 * raccourci abrégé "Modifier" (barème uniquement, format figé). Dans les deux modes d'édition,
 * l'étape Participants reste sautée : les participants déjà saisis sont gérés depuis la page du
 * tournoi, pas re-proposés dans l'assistant. */
function wizFullFlow(S: State): boolean {
  return !S.wizEditId || S.wizFullEdit;
}
/** Formats qui proposent une étape « Poules ». Survival en a toujours ; Bracket simple, Double
 *  élim et Round Robin peuvent commencer par une phase de groupes (voir Engine.usesPools). Swiss
 *  n'en a pas (ses rondes appariées jouent déjà ce rôle) et Battle Royale utilise cette étape pour
 *  son nombre de parties. */
// Barème par défaut Battle Royale (palier de classement, 1er en premier) — même valeurs que
// Engine.DEFAULT_BR_POINTS, dupliquées ici pour préremplir l'assistant sans dépendre du moteur côté web.
const DEFAULT_BR_POINTS = [15, 12, 10, 8, 6, 4, 2, 1];
const DEFAULT_BR_KILL_POINTS = 1;
const WIZ_POOLED_FORMATS = ["SURVIVAL", "SINGLE_ELIM", "DOUBLE_ELIM", "ROUND_ROBIN"];
function wizHasPools(format: string): boolean { return WIZ_POOLED_FORMATS.indexOf(format) >= 0; }
/** Modes de poule proposés, et ce que chacun sait départager. */
const WIZ_POOL_MODES: [string, string, string][] = [
  ["roundrobin", "Round Robin", "Chacun affronte tous les autres de sa poule ; classement aux victoires."],
  ["survival", "Survival classique", "Le vainqueur reste sur le terrain et enchaîne les challengers ; les perdants sont repêchés."],
  ["double", "Double élimination", "Chaque poule est jouée en mini-bracket double élimination."],
];
/** Modes de poule proposés pour ce format — "survival" est la marque de fabrique du format
 *  Survival : aucune trace de ce mode (ni le mot lui-même) ne doit apparaître ailleurs, y compris
 *  quand une donnée ancienne l'a laissé enregistré (voir le retrofit côté API dans
 *  TournamentsService.applyEngineCompat, et la coercition au choix du format ci-dessous). */
function wizPoolModes(format: string): [string, string, string][] {
  return format === "SURVIVAL" ? WIZ_POOL_MODES : WIZ_POOL_MODES.filter(([key]) => key !== "survival");
}
/** Formats de phase finale — choisis indépendamment du mode des poules, à la création (voir
 *  wizPoolsStep pour les formats pilotés-poules, wizScoringStep pour Survival). "Survival" suppose
 *  des poules en Round Robin en amont (voir Engine.startFinalsSurvivalPool) : filtré ailleurs
 *  (wizFinalsFormatOptions) quand ce n'est pas le cas. */
const FINALS_FORMATS: [string, string, string][] = [
  ["double", "Double élimination", "Deux brackets (vainqueurs/perdants) : il faut deux défaites pour être éliminé — le format historique Survival."],
  ["single", "Bracket simple", "Élimination directe en finale : une défaite et c'est terminé."],
  ["roundrobin", "Round Robin", "Les qualifiés s'affrontent tous une fois en finale ; classement final aux victoires."],
  ["survival", "Survival", "Tous les qualifiés dans une seule grande poule Survival : le vainqueur reste sur le terrain face aux challengers, les perdants repêchés en dessous — jusqu'au champion."],
];
/** Options réellement proposables selon le mode des poules — "Survival" en finale suppose un
 *  classement par poule (Round Robin) pour fusionner tous les qualifiés en une seule grande poule ;
 *  sans ça (poules Survival ou double élim) il n'y a rien de cohérent à y fusionner. */
function wizFinalsFormatOptions(poolFormat: string): [string, string, string][] {
  return poolFormat === "roundrobin" ? FINALS_FORMATS : FINALS_FORMATS.filter(([k]) => k !== "survival");
}
/** Quel que soit le mode de poule (Round Robin, Survival classique, Double élimination), chaque poule
 *  produit un classement complet (voir Engine.poolQualified) : aucun plafond arbitraire, la seule vraie
 *  limite est l'effectif de la plus petite poule — impossible d'en qualifier plus qu'il n'y a de joueurs. */
function wizMaxQualify(nPlayers: number, nbPools: number): number {
  const sizes = balancedSizesPreview(Math.max(nPlayers, 1), nbPools);
  return Math.max(1, Math.min(...sizes));
}
/** Conseil affiché sous le réglage "Qualifiés par poule" une fois les poules réellement constituées
 * (tailles connues, pas seulement estimées) — dit précisément quelles poules sont trop petites pour
 * la valeur choisie plutôt que de laisser découvrir un total silencieusement réduit au lancement. */
function poolQualifyNote(pools: { name: string; size: number }[], q: number): string {
  const total = pools.reduce((acc, p) => acc + Math.min(q, p.size), 0);
  const short = pools.filter((p) => p.size < q);
  if (!short.length) return `${total} qualifiés au total (${q} par poule) rejoignent la phase finale.`;
  const detail = short.map((p) => `${p.name} : ${p.size} au lieu de ${q}`).join(", ");
  const safeMax = Math.max(1, Math.min(...pools.map((p) => p.size)));
  return `${short.length} poule${short.length > 1 ? "s" : ""} trop petite${short.length > 1 ? "s" : ""} pour ${q} qualifiés (${detail}) — ${total} qualifiés au total malgré tout, pas ${q * pools.length}. Choisis ${safeMax} ou moins pour que toutes les poules suivent.`;
}

function wizSteps(S: State) {
  const d = S.wizData;
  const isSurvival = d.format === "SURVIVAL";
  const isBR = d.format === "BATTLE_ROYALE";
  const editing = !!S.wizEditId;
  const subtitle = (n: number): string => {
    if (n === 1) return d.name || "—";
    if (n === 2) return `${d.players.length} joueur${d.players.length > 1 ? "s" : ""}`;
    if (n === 3) return isBR ? `${d.nbPools} partie${d.nbPools > 1 ? "s" : ""}` : `${d.nbPools} poule${d.nbPools > 1 ? "s" : ""} · ${balancedSizesPreview(d.players.length, d.nbPools).join("/")}`;
    if (n === 4) return "Barème réglé";
    return "";
  };
  const full = [["Infos générales", 1], ["Participants", 2], [isBR ? "Parties" : "Poules", 3], ["Barème des points", 4], ["Validation", 5]] as [string, number][];
  // Raccourci abrégé (Modifier) : format figé, Participants/Poules gérés depuis la page du tournoi —
  // on saute directement à Barème. "Changer le format" (wizFullEdit) : même principe mais le format
  // choisi pilote quelles étapes Poules/Barème apparaissent, comme en création (moins Participants).
  // Création pure : Survival et Battle Royale ont chacun leur propre barème détaillé (toutes les
  // étapes) ; les autres formats à poules gardent "Poules" mais sautent le barème (rien à y régler) ;
  // le reste saute les deux.
  const pooled = wizHasPools(d.format);
  const defs = editing
    ? (!S.wizFullEdit ? (isSurvival || isBR ? [full[0], full[3], full[4]] : [full[0], full[4]]) : isSurvival || isBR ? [full[0], full[2], full[3], full[4]] : pooled ? [full[0], full[2], full[4]] : [full[0], full[4]])
    : isSurvival || isBR ? full : pooled ? [full[0], full[1], full[2], full[4]] : [full[0], full[1], full[4]];
  return `<div style="padding:14px 0">${defs.map(([label, n]) => {
    const active = n === S.wizStep, done = n < S.wizStep;
    const sub = done ? subtitle(n) : active ? "En cours" : "";
    return `<button data-wizgoto="${n}" style="display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:${active ? "rgba(34,211,238,.08)" : "transparent"};border:0;border-left:2px solid ${active ? "#22D3EE" : "transparent"};padding:11px 18px;cursor:pointer">
      <span style="display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:${active ? "#22D3EE" : done ? "rgba(52,211,153,.14)" : "var(--surface-4)"};color:${active ? "#04222a" : done ? "#34D399" : "var(--text-faint)"};font-size:12px;font-weight:800;flex:none">${done ? "✓" : n}</span>
      <span style="min-width:0"><div style="font-size:13.5px;font-weight:${active ? 700 : 600};color:${active ? "var(--text)" : done ? "var(--text)" : "var(--text-faint)"};line-height:1.3">${label}</div>${sub ? `<div style="font-size:11px;color:${active ? "#22D3EE" : "var(--text-faint)"};margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(sub)}</div>` : ""}</span>
    </button>`;
  }).join("")}</div>`;
}

const wizFoot = (prevLabel: string, prev: number, next: number, nextLabel?: string) => `<div style="display:flex;justify-content:space-between;gap:10px;margin-top:20px">
  <button data-wizgoto="${prev}" style="display:inline-flex;align-items:center;gap:7px;background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:11px;padding:11px 18px;font-weight:700;font-size:13.5px;cursor:pointer">${icBack(15)}${prevLabel}</button>
  ${next ? `<button data-wizgoto="${next}" style="display:inline-flex;align-items:center;gap:7px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:11px;padding:11px 20px;font-weight:750;font-size:13.5px;cursor:pointer">${nextLabel || "Continuer"}${ic(I.arrow, 15)}</button>` : ""}
</div>`;

const WIZ_BREAKDOWN_SEGMENTS: [string, string, string][] = [
  ["survWin", "Survival", "#22D3EE"],
  ["loserWin", "Repêchage", "#7C82FF"],
  ["poolFinalWin", "Finales de poule", "#34D399"],
  ["finalsWin", "Phase finale", "#FBBF24"],
  ["championBonus", "Bonus", "#F43F7E"],
  ["streakBonus", "Striker", "#FB923C"],
];

/** Barre de répartition en pourcentage de la cagnotte programmée par catégorie de match — recalculée en direct par wizRecalcGauge. */
function wizBreakdownBar(breakdown: Record<string, { matches: number; pts: number }>, programmed: number) {
  const pct = (key: string) => programmed > 0 ? Math.round(((breakdown[key]?.pts ?? 0) / programmed) * 1000) / 10 : 0;
  const segs = WIZ_BREAKDOWN_SEGMENTS.map(([key, , color]) => `<span id="wiz-gauge-seg-${key}" style="width:${pct(key)}%;background:${color};display:flex;align-items:center;justify-content:center;overflow:hidden;transition:width .15s ease">${pct(key) >= 8 ? `<span id="wiz-gauge-seg-${key}-txt">${pct(key)}%</span>` : ""}</span>`).join("");
  const legend = WIZ_BREAKDOWN_SEGMENTS.map(([, label, color]) => `<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:2px;background:${color}"></span>${label}</span>`).join("");
  return `<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--surface-3)">
    <div style="font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-faint);font-weight:800;margin-bottom:10px">Répartition prévue</div>
    <div id="wiz-gauge-breakdown" style="display:flex;height:26px;border-radius:7px;overflow:hidden;font-size:10px;font-weight:800;color:#04222a">${segs}</div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:10px;font-size:11px;color:var(--text-muted)">${legend}</div>
  </div>`;
}

function wizGaugeCard(c: { total: number; programmed: number; gap: number; valid: boolean; breakdown?: Record<string, { matches: number; pts: number }> }, title = "Contrôle de la cagnotte") {
  const pct = Math.min(100, c.total ? (c.programmed / c.total) * 100 : 0);
  return wizCard(`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px"><h3 style="margin:0;font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:.5px">${title}</h3><span id="wiz-gauge-badge" style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:${c.valid ? "#34D399" : "#FB7185"};background:${c.valid ? "rgba(52,211,153,.08)" : "rgba(251,113,133,.08)"};border:1px solid ${c.valid ? "rgba(52,211,153,.35)" : "rgba(251,113,133,.35)"};border-radius:99px;padding:4px 10px"><span id="wiz-gauge-badge-icon" style="display:inline-flex">${ic(c.valid ? I.plus : I.warn, 12)}</span><span id="wiz-gauge-badge-txt">${c.valid ? "Valide" : "Dépassement"}</span></span></div>
    <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text-muted);margin-bottom:5px"><span>Points disponibles</span><b style="color:var(--text);font-family:'JetBrains Mono',monospace">${c.total}</b></div>
    <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text-muted);margin-bottom:10px"><span>Points programmés</span><b id="wiz-gauge-prog" style="color:var(--text);font-family:'JetBrains Mono',monospace">${c.programmed}</b></div>
    <div style="height:9px;border-radius:99px;background:var(--surface-4);border:1px solid var(--border);overflow:hidden"><span id="wiz-gauge-bar" style="display:block;height:100%;width:${pct}%;background:${c.valid ? "linear-gradient(90deg,#22D3EE,#7C82FF)" : "linear-gradient(90deg,#FB7185,#F43F7E)"};transition:width .15s ease"></span></div>
    <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text-muted);margin-top:10px"><span>Écart restant</span><b id="wiz-gauge-gap" style="color:${c.valid ? "#34D399" : "#FB7185"};font-family:'JetBrains Mono',monospace">${c.gap >= 0 ? "+" : ""}${c.gap}</b></div>
    <p style="color:var(--text-faint);font-size:11.5px;margin:12px 0 0">Le tournoi ne peut être lancé que si les points programmés tiennent dans la cagnotte.</p>
    ${c.breakdown ? wizBreakdownBar(c.breakdown, c.programmed) : ""}`);
}

/** Suggestions de jeu (catalogue) filtrées par ce qui est tapé — masquées tant que le champ est
 * vide, pour ne pas noyer la saisie sous des dizaines de jeux non pertinents (voir wizInfosStep). */
function filterGames(games: Detail[], query: string): Detail[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return games.filter((g) => g.name.toLowerCase().includes(q)).slice(0, 8);
}
function gameChipHtml(name: string, active: boolean): string {
  return `<button data-wizgame="${escAttr(name)}" style="font-size:11.5px;font-weight:700;border-radius:99px;padding:5px 11px;cursor:pointer;background:${active ? "rgba(34,211,238,.1)" : "var(--surface-3)"};border:1px solid ${active ? "#22D3EE" : "var(--border)"};color:${active ? "#22D3EE" : "var(--text-muted)"}">${escHtml(name)}</button>`;
}
const MATCH_FORMAT_BO_OPTIONS = [1, 3, 5, 7];
/** Explication du format de manche choisi — affichée sous le sélecteur, recalculée en direct à la
 * frappe (course à points) sans attendre un re-rendu complet. */
function matchFormatNote(mode: "bo" | "ft", value: number): string {
  return mode === "ft"
    ? `Le premier à ${value} point${value > 1 ? "s" : ""}/manche${value > 1 ? "s" : ""} gagné${value > 1 ? "s" : ""} remporte le match.`
    : value === 1
      ? "Un seul match tranche la rencontre."
      : `Le premier à ${Math.ceil(value / 2)} manches gagnées (sur ${value}) remporte le match.`;
}
function wizInfosStep(S: State) {
  const d = S.wizData;
  const editing = !!S.wizEditId;
  const full = wizFullFlow(S);
  const isSurvival = d.format === "SURVIVAL";
  const isBR = d.format === "BATTLE_ROYALE";
  const formatPicker = !full ? "" : `<div style="margin-top:14px">
    <label style="${WIZ_LBL}">Format</label>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px">
      ${WIZ_FORMATS.map(([key, label]) => {
        const on = d.format === key;
        return `<button data-wizformat="${key}" style="text-align:left;border-radius:11px;padding:11px 13px;cursor:pointer;background:${on ? "rgba(34,211,238,.1)" : "var(--surface-3)"};border:1px solid ${on ? "#22D3EE" : "var(--border)"};color:${on ? "#22D3EE" : "var(--text)"};font-family:inherit;font-weight:${on ? 700 : 600};font-size:13px">${label}</button>`;
      }).join("")}
    </div>
    ${editing ? `<p style="color:var(--text-faint);font-size:11.5px;margin-top:8px">Les participants déjà inscrits sont conservés. Le lancement répartit tout selon le nouveau format.</p>` : ""}
  </div>`;
  const chosen = WIZ_FORMATS.find(([key]) => key === d.format) || WIZ_FORMATS[0];
  // Raccourci abrégé (Modifier, format figé) : le barème détaillé n'a de sens qu'en Survival (seul
  // format à respecter une cagnotte) — les autres formats n'ont rien à régler ici, on saute direct à
  // la validation (voir la même règle dans wizSteps() et le backTarget de wizValidateStep()).
  const nextStep = !editing ? 2 : !S.wizFullEdit ? (isSurvival ? 4 : 5) : (isSurvival || isBR || wizHasPools(d.format) ? 3 : 5);
  return `<div class="grid2b" style="display:grid;grid-template-columns:1.4fr 1fr;gap:16px">
    ${wizCard(`<h3 style="margin:0 0 16px;font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:.5px;display:flex;align-items:center;gap:9px">${ic(I.bolt, 17)}${full ? "Étape 1 — Informations générales" : "Informations générales"}</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px">
        ${wizField("Nom du tournoi", `<input id="wz-name" value="${escAttr(d.name)}" placeholder="${d.format === "SURVIVAL" ? "Survival Summer Cup" : "Coupe de Lomé 2026"}" style="${WIZ_INP}" />`)}
        ${wizField("Jeu concerné", `<input id="wz-game" autocomplete="off" value="${escAttr(d.game)}" placeholder="EA FC 26, Tekken 8…" style="${WIZ_INP}" /><div id="wiz-game-suggestions" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${filterGames(S.games ?? [], d.game).map((g) => gameChipHtml(g.name, d.game.trim().toLowerCase() === g.name.toLowerCase())).join("")}</div>`, "Depuis le catalogue si possible — commence à taper pour voir les suggestions.")}
        ${wizField("Date", `<input id="wz-date" type="date" value="${escAttr(d.date)}" style="${WIZ_INP}" />`)}
        ${wizField("Lieu", `<input id="wz-place" value="${escAttr(d.place)}" placeholder="Salle, club, adresse…" style="${WIZ_INP}" />`)}
        ${wizField("Points en jeu par participant", `<input id="wz-pts" type="number" min="1" value="${d.pointsPerPlayer}" ${d.format === "SURVIVAL" ? "" : "disabled"} style="${WIZ_INP};${d.format === "SURVIVAL" ? "" : "opacity:.5;cursor:not-allowed"}" />`, d.format === "SURVIVAL" ? "Détermine la cagnotte totale." : "Ne s'applique pas à ce format — la cagnotte par point n'est utilisée que par certains formats.")}
        ${S.wizEditId ? "" : wizField("Type de tournoi", `<select id="wz-team" style="${WIZ_INP}">${[0, 2, 3, 4, 5].map((n) => `<option value="${n}" ${d.teamSize === n ? "selected" : ""}>${n === 0 ? "Individuel" : `Par équipes de ${n} joueurs`}</option>`).join("")}</select>`, "Par équipes : le capitaine inscrit son équipe (nom + joueurs), l'équipe joue comme un seul concurrent.")}
        ${wizField("Frais d'inscription (FCFA, 0 = gratuit)", `<input id="wz-fee" type="number" min="0" step="100" value="${d.entryFeeXof ?? 0}" style="${WIZ_INP}" />`)}
        ${wizField("Points fidélité", `<label style="display:flex;align-items:center;gap:8px;height:38px;cursor:pointer"><input id="wz-loyalty" type="checkbox" ${d.givesLoyaltyPoint !== false ? "checked" : ""} style="width:16px;height:16px;accent-color:#22D3EE" /><span style="font-size:13px;color:var(--text)">Ce tournoi rapporte 1 point</span></label>`, "Décoche si ce tournoi est organisé par un tiers.")}
      </div>
      <div style="margin-top:14px">${wizField("Affiche du tournoi (optionnel)", filePicker("wz-img", "Choisir l'affiche", "image/*", d.imageUrl))}</div>
      <div style="margin-top:14px">
        <label style="${WIZ_LBL}">Format des matchs</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          ${MATCH_FORMAT_BO_OPTIONS.map((n) => {
            const on = d.matchMode === "bo" && d.matchValue === n;
            return `<button data-wizmatchfmt="bo|${n}" style="font-size:12.5px;font-weight:700;border-radius:10px;padding:8px 14px;cursor:pointer;background:${on ? "rgba(34,211,238,.1)" : "var(--surface-3)"};border:1px solid ${on ? "#22D3EE" : "var(--border)"};color:${on ? "#22D3EE" : "var(--text-muted)"}">Bo${n}</button>`;
          }).join("")}
          <button data-wizmatchfmt="ft|${d.matchMode === "ft" ? d.matchValue : 10}" style="font-size:12.5px;font-weight:700;border-radius:10px;padding:8px 14px;cursor:pointer;background:${d.matchMode === "ft" ? "rgba(34,211,238,.1)" : "var(--surface-3)"};border:1px solid ${d.matchMode === "ft" ? "#22D3EE" : "var(--border)"};color:${d.matchMode === "ft" ? "#22D3EE" : "var(--text-muted)"}">Course à points</button>
          ${d.matchMode === "ft" ? `<input id="wz-matchvalue" type="number" min="1" max="99" value="${d.matchValue}" style="width:70px;text-align:center;background:var(--surface-3);border:1px solid var(--border);border-radius:9px;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:13px;padding:8px" />` : ""}
        </div>
        <p id="wiz-matchfmt-note" style="color:var(--text-faint);font-size:11.5px;margin-top:8px">${matchFormatNote(d.matchMode, d.matchValue)}</p>
      </div>
      <div style="margin-top:14px">
        <label style="display:flex;align-items:center;gap:8px;height:20px;cursor:pointer"><input id="wz-goaldiff" type="checkbox" ${d.countGoalDiff !== false ? "checked" : ""} style="width:16px;height:16px;accent-color:#22D3EE" /><span style="font-size:13px;color:var(--text)">Départager les égalités par différence de buts/manches</span></label>
        <p style="color:var(--text-faint);font-size:11.5px;margin-top:6px">Round Robin (poules et phase finale) : à égalité de victoires, celui qui a le meilleur écart entre buts marqués et encaissés passe devant. Décoché, seules les victoires comptent.</p>
      </div>
      ${formatPicker}`)}
    ${wizCard(`<h3 style="margin:0 0 14px;font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:.5px;display:flex;align-items:center;gap:9px">${ic(I.warn, 16)}Comment ça marche</h3>
      <div style="color:var(--text-muted);font-size:13px;line-height:1.9">${WIZ_FORMAT_EXPLAIN[chosen[0]] || ""}</div>`)}
  </div>${wizFoot("Annuler", 0, nextStep)}`;
}

const WIZ_FORMAT_EXPLAIN: Record<string, string> = {
  SURVIVAL: `<b style="color:var(--text)">Cagnotte</b> = participants × points en jeu.<br>Chaque victoire distribue une part de cette cagnotte selon le barème que tu définiras à l'étape 4.<br><br><b style="color:var(--text)">Déroulé</b> : dans chaque poule, le vainqueur reste sur le terrain et enchaîne les adversaires. Les perdants ont une seconde chance (repêchage), puis les meilleurs se rejoignent en phase finale.`,
  SINGLE_ELIM: `<b style="color:var(--text)">Bracket simple</b> : élimination directe — une défaite élimine. Chaque victoire vaut les points en jeu ; un bonus couronne le champion.<br><br>Par défaut tous les participants entrent directement dans le bracket. Une phase de groupes en amont reste possible (réglable à l'étape suivante) si tu préfères répartir en poules avant l'élimination directe.`,
  DOUBLE_ELIM: `<b style="color:var(--text)">Double élimination</b> : deux brackets (vainqueurs et perdants). Une première défaite fait basculer dans le bracket des perdants, une deuxième élimine. La grande finale peut se rejouer une fois si le finaliste du bracket des perdants gagne.<br><br>Par défaut tous les participants entrent directement dans le bracket. Une phase de groupes en amont reste possible (réglable à l'étape suivante) si tu préfères répartir en poules avant l'élimination.`,
  ROUND_ROBIN: `<b style="color:var(--text)">Round Robin</b> : chaque participant affronte tous les autres, une seule fois. Classement final aux victoires (départage à la différence de manches, puis aux buts marqués, puis à la confrontation directe).<br><br>Par défaut tout le monde s'affronte dans un seul groupe. Une phase de poules en amont reste possible (réglable à l'étape suivante) : les qualifiés de chaque poule se retrouvent alors dans un Round Robin final.`,
  SWISS: `<b style="color:var(--text)">Système suisse</b> : à chaque ronde, les joueurs sont réappariés selon leur classement du moment (le moteur évite de refaire jouer deux adversaires déjà rencontrés quand c'est possible). Le nombre de rondes est calculé automatiquement selon l'effectif. Pas d'élimination : tout le monde joue toutes les rondes.`,
  BATTLE_ROYALE: `<b style="color:var(--text)">Battle Royale</b> : des parties à plusieurs joueurs, classées du 1er au dernier à chaque fois. Des points sont attribués par palier de classement (1er, 2e, 3e…) et cumulés sur l'ensemble des parties. Le nombre de parties se règle à l'étape suivante.`,
};

/** Détecte les doublons de nom (même logique que Engine.setPlayers : comparaison insensible à la
 * casse sur la partie avant « @club », qui fusionne silencieusement les doublons à la création) —
 * pour prévenir plutôt que laisser l'utilisateur découvrir après coup que des lignes ont disparu. */
function findDuplicateNames(lines: string[]): string[] {
  // Même découpage que Engine.parseEntry : le club est ce qui suit le DERNIER « @ », et seulement
  // s'il n'est pas en tête (« @Lomé » est un nom, pas un club sans nom).
  const entryName = (raw: string) => {
    const s = raw.trim();
    const at = s.lastIndexOf("@");
    return (at > 0 ? s.slice(0, at) : s).trim();
  };
  const seen = new Map<string, string>();
  const dupes = new Set<string>();
  for (const raw of lines) {
    const name = entryName(raw);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) dupes.add(seen.get(key)!);
    else seen.set(key, name);
  }
  return Array.from(dupes);
}
function dupeWarningHtml(dupes: string[]): string {
  if (!dupes.length) return "";
  return `${ic(I.warn, 13)} Doublon${dupes.length > 1 ? "s" : ""} détecté${dupes.length > 1 ? "s" : ""} : <b>${dupes.map(escHtml).join(", ")}</b> — les lignes identiques seront fusionnées en une seule à la création.`;
}
function wizParticipantsStep(S: State) {
  const d = S.wizData;
  if (d.teamSize) return `<div style="border:1px dashed var(--border-strong);border-radius:14px;padding:26px;text-align:center;color:var(--text-muted);font-size:14px;line-height:1.7"><div style="font-family:'Bebas Neue',sans-serif;font-size:24px;color:var(--text);margin-bottom:6px">Tournoi par équipes de ${d.teamSize}</div>Les équipes s'inscrivent elles-mêmes (le capitaine donne le nom de l'équipe et ses ${d.teamSize} joueurs), ou tu les ajoutes depuis la fiche du tournoi après sa création. Passe à l'étape suivante.</div>`;
  const isSurvival = d.format === "SURVIVAL";
  const names = d.players.join("\n");
  const fullRoster: Detail[] = S.roster ?? [];
  const inList = (nm: string) => d.players.some((p) => p.split("@")[0].trim().toLowerCase() === nm.toLowerCase());
  const selCount = fullRoster.filter((p: Detail) => inList(p.name)).length;
  const q = S.wizRosterSearch.trim().toLowerCase();
  const roster = q ? fullRoster.filter((p: Detail) => `${p.name} ${p.clubName || ""} ${p.city || ""}`.toLowerCase().includes(q)) : fullRoster;
  const chip = (p: Detail) => {
    const on = inList(p.name);
    return `<button data-wiztoggleroster="${escAttr(p.name)}|${escAttr(p.clubName || "")}" style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;border-radius:999px;padding:6px 10px 6px 6px;cursor:pointer;background:${on ? "rgba(34,211,238,.1)" : "var(--surface-3)"};border:1px solid ${on ? "#22D3EE" : "var(--border)"};color:${on ? "#22D3EE" : "var(--text-muted)"}"><span style="display:grid;place-items:center;width:18px;height:18px;border-radius:50%;background:var(--surface-4);font-size:9px;font-weight:800;color:var(--text-muted);overflow:hidden">${p.clubLogoUrl ? `<img src="${mediaUrl(p.clubLogoUrl)}" style="width:100%;height:100%;object-fit:cover" />` : p.name.charAt(0).toUpperCase()}</span>${escHtml(p.name)}${ic(I.plus, 11)}</button>`;
  };
  // Regroupe par club (« Sans club » toujours en dernier) pour repérer vite une équipe entière.
  const byClub = new Map<string, Detail[]>();
  for (const p of roster) { const k = p.clubName || "Sans club"; if (!byClub.has(k)) byClub.set(k, []); byClub.get(k)!.push(p); }
  const clubKeys = Array.from(byClub.keys()).sort((a, b) => a === "Sans club" ? 1 : b === "Sans club" ? -1 : a.localeCompare(b));
  const groups = clubKeys.map((k) => `<div style="margin-bottom:12px">
      <div style="font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:var(--text-faint);margin-bottom:6px">${escHtml(k)} <span style="color:var(--border-strong)">· ${byClub.get(k)!.length}</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">${byClub.get(k)!.map(chip).join("")}</div>
    </div>`).join("");
  const rosterPanel = fullRoster.length ? wizCard(`<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <h3 style="margin:0;font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:.5px">Depuis la base de joueurs</h3>
        <button data-wizaddall="1" style="display:inline-flex;align-items:center;gap:5px;white-space:nowrap;font-size:12px;font-weight:700;color:#22D3EE;background:transparent;border:0;cursor:pointer">${ic(I.plus, 13)}Tout sélectionner</button>
      </div>
      <div style="position:relative;margin-bottom:12px;max-width:320px">
        <span style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--text-faint);pointer-events:none">${ic(I.search, 14)}</span>
        <input id="wiz-roster-search" value="${escAttr(S.wizRosterSearch)}" placeholder="Rechercher un joueur ou un club… (Entrée)" style="${WIZ_INP};padding-left:32px" />
      </div>
      <div style="max-height:260px;overflow-y:auto">${groups || `<p style="color:var(--text-faint);font-size:12.5px">Aucun joueur trouvé pour « ${escHtml(S.wizRosterSearch)} ».</p>`}</div>
      <p style="color:var(--text-faint);font-size:11.5px;margin:10px 0 0">${selCount} / ${fullRoster.length} sélectionné${selCount > 1 ? "s" : ""}. Clique un joueur pour l'ajouter ou le retirer.</p>`)
    : wizCard(`<h3 style="margin:0 0 8px;font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:.5px">Base de joueurs</h3><p style="color:var(--text-faint);font-size:12.5px">La base est vide pour l'instant. Les participants saisis ici pourront l'alimenter — gère-la depuis Admin → Joueurs.</p>`);
  const dupes = findDuplicateNames(d.players);
  const participantsCard = wizCard(`<h3 style="margin:0 0 16px;font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:.5px;display:flex;align-items:center;gap:9px">${ic(I.user, 17)}Étape 2 — Participants</h3>
      ${wizField("Un nom par ligne", `<textarea id="wz-players" rows="8" placeholder="Marie @Lomé&#10;Paul @Kara&#10;Léa…" style="${WIZ_INP};resize:vertical">${escHtml(names)}</textarea>`, "Doublons fusionnés. Club optionnel avec la syntaxe « Nom @Club ».")}
      <div style="display:flex;align-items:center;gap:10px;margin-top:12px"><span style="display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700;color:#22D3EE;background:rgba(34,211,238,.08);border:1px solid rgba(34,211,238,.3);border-radius:99px;padding:6px 13px">${ic(I.user, 13)}<span id="wiz-players-count">${d.players.length}</span> <span id="wiz-players-word">participant${d.players.length > 1 ? "s" : ""}</span></span></div>
      <div id="wiz-players-dupe-warning" style="${dupes.length ? "" : "display:none;"}margin-top:10px;font-size:12px;color:#FBBF24;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.3);border-radius:9px;padding:8px 12px">${dupeWarningHtml(dupes)}</div>`);
  // La cagnotte (participants × points en jeu) n'existe qu'en Survival — les autres formats n'ont
  // pas de budget à respecter, ne pas l'afficher évite de laisser croire le contraire.
  const cagnotteBlock = isSurvival
    ? `<div class="grid2b" style="display:grid;grid-template-columns:1.4fr 1fr;gap:16px;margin-bottom:16px">${participantsCard}${wizCard(`<h3 style="margin:0 0 14px;font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:.5px">Cagnotte prévisionnelle</h3>
      <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text-muted);margin-bottom:6px"><span>Participants</span><b id="wiz-cagnotte-count" style="color:var(--text)">${d.players.length}</b></div>
      <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text-muted)"><span>Points / participant</span><b style="color:var(--text)">${d.pointsPerPlayer}</b></div>
      <hr style="border:0;border-top:1px solid var(--border);margin:12px 0" />
      <div style="display:flex;justify-content:space-between;font-size:14px"><span style="color:var(--text-muted)">Cagnotte totale</span><b id="wiz-cagnotte-total" style="color:#34D399;font-size:18px">${d.players.length * d.pointsPerPlayer}</b></div>`)}</div>`
    : `<div style="margin-bottom:16px">${participantsCard}</div>`;
  return `${cagnotteBlock}
  ${rosterPanel}${wizFoot("Retour", 1, wizHasPools(d.format) || d.format === "BATTLE_ROYALE" ? 3 : 5)}`;
}

/** Grille des tailles de poule (Bebas Neue + lettre) — factorisée pour être régénérée en direct
 * au changement de "Nombre de poules" (voir l'effet dédié dans le composant). */
function poolSizeBoxesHtml(sizes: number[]): string {
  return sizes.map((n, i) => `<div style="border:1px solid var(--border);border-radius:12px;padding:14px;text-align:center"><div style="font-family:'Bebas Neue',sans-serif;font-size:22px;color:#22D3EE">${n}</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">Poule ${String.fromCharCode(65 + i)}</div></div>`).join("");
}
function wizPoolsStep(S: State) {
  const d = S.wizData;
  if (d.format === "BATTLE_ROYALE") {
    return `${wizCard(`<h3 style="margin:0 0 10px;font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:.5px;display:flex;align-items:center;gap:9px">${ic(I.tv, 17)}Étape 3 — Parties</h3>
      <div style="display:flex;align-items:center;gap:9px;margin-bottom:14px"><label style="font-size:12.5px;color:var(--text-muted);font-weight:600">Nombre de parties</label><select id="wz-pools" style="${WIZ_INP};width:auto;padding:9px 12px">${[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => `<option value="${n}" ${n === d.nbPools ? "selected" : ""}>${n}</option>`).join("")}</select></div>
      <p style="color:var(--text-muted);font-size:13px;line-height:1.7">Après chaque partie, l'organisateur saisit le classement complet (du 1er au dernier). Les points par palier de classement se cumulent sur l'ensemble des <b id="wiz-pools-count" style="color:var(--text)">${d.nbPools}</b> partie<span id="wiz-pools-count-s">${d.nbPools > 1 ? "s" : ""}</span> — le plus haut total à la fin remporte le tournoi.</p>`)}
    ${wizFoot("Retour", S.wizEditId ? 1 : 2, 4)}`;
  }
  const isSurvival = d.format === "SURVIVAL";
  const formatLabel = (WIZ_FORMATS.find(([k]) => k === d.format) || WIZ_FORMATS[0])[1];
  // Poules en double élimination hors Survival : un seul bracket continu (voir
  // Engine.launchGroupedDoubleElim) — les vainqueurs/perdants de chaque poule s'enchaînent
  // directement dans le même bracket vainqueurs/perdants, jusqu'à une grande finale unique. Pas de
  // "qualifiés" à départager (tout le monde y entre dès le 1er tour) ni de format de phase finale à
  // choisir (ce sera toujours ce même bracket, jusqu'au bout).
  const isDoubleMerged = !isSurvival && d.poolFormat === "double";
  // Round Robin et Double élim, choisis comme format principal à l'étape 1, SONT eux-mêmes des modes
  // de poule valides (voir wizFormat côté clic) : redemander "Mode des poules" ici serait une
  // question redondante — seul Bracket simple garde un vrai choix indépendant (poules Round Robin ou
  // Double élim menant à une finale Bracket simple, le besoin d'origine de cette indépendance).
  const poolModeImplied = !isSurvival && (d.format === "ROUND_ROBIN" || d.format === "DOUBLE_ELIM");
  // Aucun plafond produit, quel que soit le mode de poule : à toi de choisir, jusqu'à l'effectif de
  // la plus petite poule (chaque mode classe toute la poule, voir Engine.poolQualified).
  const maxQ = wizMaxQualify(d.players.length, d.nbPools);
  const qualif = Math.min(d.qualifyPerPool || 2, maxQ);
  const qualifNote = `${qualif * d.nbPools} qualifiés au total (${qualif} × ${d.nbPools} poules) rejoignent la phase finale — jusqu'à ${maxQ} par poule (effectif de la plus petite).`;
  const poolModeNote = isDoubleMerged
    ? "Un seul grand bracket double élimination pour tout le monde : les vainqueurs de chaque poule s'enchaînent entre eux, pareil pour les perdants, jusqu'à une grande finale unique — pas de poules indépendantes à requalifier."
    : (wizPoolModes(d.format).find(([k]) => k === d.poolFormat) || wizPoolModes(d.format)[0])[2];
  const sizes = balancedSizesPreview(d.players.length, d.nbPools);
  return `${wizCard(`<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:10px">
      <h3 style="margin:0;font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:.5px;display:flex;align-items:center;gap:9px">${ic(I.tv, 17)}Étape 3 — Poules</h3>
      <div style="display:flex;align-items:center;gap:9px"><label style="font-size:12.5px;color:var(--text-muted);font-weight:600">Nombre de poules</label><select id="wz-pools" style="${WIZ_INP};width:auto;padding:9px 12px">${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<option value="${n}" ${n === d.nbPools ? "selected" : ""}>${n}</option>`).join("")}</select></div>
    </div>
    <p style="color:var(--text-muted);font-size:13px;line-height:1.7">Répartition automatique équilibrée : <b id="wiz-pools-sizes" style="color:var(--text)">${sizes.join(" / ")}</b> joueur${d.players.length > 1 ? "s" : ""}. L'ordre de passage définit qui entre sur le terrain en premier — le 1er affronte le 2e, le vainqueur affronte le 3e, etc. Tu pourras prévisualiser et réordonner les poules juste avant de lancer le tournoi, une fois créé.</p>
    <div id="wiz-pools-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-top:14px">${poolSizeBoxesHtml(sizes)}</div>
    <p id="wiz-nopool-warning" style="${!isSurvival && d.nbPools === 1 ? "" : "display:none;"}color:#FBBF24;font-size:11.5px;margin-top:14px;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.3);border-radius:9px;padding:8px 12px">${ic(I.warn, 12)} Avec une seule poule il n'y a pas de phase de groupes : tous les participants vont directement en <span id="wiz-nopool-format">${escHtml(formatLabel)}</span>, opposés au hasard. Choisis plusieurs poules ci-dessus pour ajouter une phase de groupes avant.</p>
    <div id="wiz-poolmode-block" style="${(isSurvival || d.nbPools > 1) && !poolModeImplied ? "" : "display:none;"}margin-top:18px">
      <div style="font-size:12px;color:var(--text-muted);font-weight:650;margin-bottom:8px">Mode des poules</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${wizPoolModes(d.format).map(([key, label]) => {
          const on = d.poolFormat === key;
          return `<button data-wizpoolformat="${key}" style="font-size:12.5px;font-weight:700;border-radius:10px;padding:8px 14px;cursor:pointer;background:${on ? "rgba(34,211,238,.1)" : "var(--surface-3)"};border:1px solid ${on ? "#22D3EE" : "var(--border)"};color:${on ? "#22D3EE" : "var(--text-muted)"}">${label}</button>`;
        }).join("")}
      </div>
      <p style="color:var(--text-faint);font-size:11.5px;margin-top:8px">${poolModeNote}</p>
    </div>
    <div id="wiz-qualify-block" style="${(isSurvival || d.nbPools > 1) && !isDoubleMerged ? "" : "display:none;"}margin-top:18px">
      <div style="font-size:12px;color:var(--text-muted);font-weight:650;margin-bottom:8px">Qualifiés par poule</div>
      <input id="wz-qualify" type="number" min="1" max="${maxQ}" value="${qualif}" style="${WIZ_INP};width:130px" />
      <p id="wiz-qualify-note" style="color:var(--text-faint);font-size:11.5px;margin-top:8px">${qualifNote}</p>
    </div>
    ${!isSurvival ? `<div id="wiz-finalsformat-block" style="${d.nbPools > 1 && !isDoubleMerged ? "" : "display:none;"}margin-top:18px">
      <div style="font-size:12px;color:var(--text-muted);font-weight:650;margin-bottom:8px">Format de la phase finale</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${wizFinalsFormatOptions(d.poolFormat).map(([key, label]) => {
          const on = d.finalsFormat === key;
          return `<button data-wizfinalsformat="${key}" style="font-size:12.5px;font-weight:700;border-radius:10px;padding:8px 14px;cursor:pointer;background:${on ? "rgba(34,211,238,.1)" : "var(--surface-3)"};border:1px solid ${on ? "#22D3EE" : "var(--border)"};color:${on ? "#22D3EE" : "var(--text-muted)"}">${label}</button>`;
        }).join("")}
      </div>
      <p style="color:var(--text-faint);font-size:11.5px;margin-top:8px">${(FINALS_FORMATS.find(([k]) => k === d.finalsFormat) || FINALS_FORMATS[0])[2]} Indépendant du mode des poules ci-dessus : les qualifiés de chaque poule se retrouvent dans ce format-là, quel que soit celui utilisé pour les départager en poule.</p>
    </div>` : ""}`)}
  ${wizFoot("Retour", S.wizEditId ? 1 : 2, isSurvival ? 4 : 5, isSurvival ? "Continuer" : "Validation")}`;
}

const WIZ_SCORING_FIELDS: [string, string, string][] = [
  ["wz-sc-surv", "Victoire en poule Survival", "survWin"],
  ["wz-sc-loser", "Victoire en poule des perdants", "loserWin"],
  ["wz-sc-poolfinal", "Victoire en finale de poule", "poolFinalWin"],
  ["wz-sc-finals", "Victoire en phase finale", "finalsWin"],
  ["wz-sc-champion", "Bonus champion du tournoi", "championBonus"],
  ["wz-sc-streak", "Bonus striker", "streakBonus"],
];
// Plancher accepté par l'API (voir CreateTournamentDto) : les 4 "victoire" ne peuvent pas être à 0
// (un match qui ne rapporte rien n'a pas de sens), bonus champion/striker peuvent être désactivés (0).
const WIZ_SCORING_FLOOR: Record<string, number> = {
  survWin: 0.25, loserWin: 0.25, poolFinalWin: 0.25, finalsWin: 0.25, championBonus: 0, streakBonus: 0,
};
/** Champs de barème pertinents pour le format choisi (voir wizScoringStep) et tous à leur plancher —
 * utilisé pour bloquer la soumission avant l'API plutôt que de laisser remonter son message brut. */
function wizScoringValid(d: State["wizData"]): boolean {
  const isSurvival = d.format === "SURVIVAL";
  const fields = isSurvival ? WIZ_SCORING_FIELDS : WIZ_SCORING_FIELDS.filter(([, , key]) => key === "finalsWin" || key === "championBonus");
  return fields.every(([, , key]) => ((d as unknown as Record<string, number>)[key] ?? 0) >= WIZ_SCORING_FLOOR[key]);
}

/** Battle Royale n'a ni victoire de match ni bonus champion (Engine.reportBattleRoyale) : son barème
 * est un palier de points par classement de partie (1er, 2e, …) plus un bonus par élimination, tous
 * deux réglables avant lancement — jusqu'ici seul le nombre de parties (étape 3) l'était, le barème
 * restait figé sur Engine.DEFAULT_BR_POINTS. Nombre de paliers affichés = effectif (4 à 16, une ligne
 * par place possible en partie) ; au-delà, une place ne rapporte que le bonus d'élimination. */
function wizBrScoringStep(S: State) {
  const d = S.wizData;
  const nRanks = Math.max(4, Math.min(d.players.length || DEFAULT_BR_POINTS.length, 16));
  const pts = Array.from({ length: nRanks }, (_, i) => d.brPoints[i] ?? 0);
  const rankLabel = (i: number) => i === 0 ? "1er" : i === 1 ? "2e" : `${i + 1}e`;
  const rows = pts.map((v, i) => `<div style="display:flex;align-items:center;gap:16px;padding:11px 18px;${i === pts.length - 1 ? "" : "border-bottom:1px solid var(--surface-3);"}">
      <div style="flex:1;min-width:0;font-size:13.5px;font-weight:650">${rankLabel(i)} de partie</div>
      <input id="wz-br-pts-${i}" type="number" min="0" step="1" value="${v}" style="width:88px;text-align:center;border:1px solid var(--border-strong);border-radius:9px;background:var(--surface-3);color:var(--text);font-family:'JetBrains Mono',monospace;font-size:14px;padding:9px" />
      <span style="width:36px;text-align:right;font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--text-muted);flex:none">pts</span>
    </div>`).join("");
  return `<div class="grid2b" style="display:grid;grid-template-columns:1.4fr 1fr;gap:16px">
    <div>
      <h3 style="margin:0 0 6px;font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:.5px;display:flex;align-items:center;gap:9px">${ic(I.cart, 17)}${wizFullFlow(S) ? "Étape 4 — Barème des points" : "Barème des points"}</h3>
      <p style="color:var(--text-muted);font-size:13.5px;margin:6px 0 16px;max-width:520px">Après chaque partie, chaque participant marque les points de son classement (ci-dessous) plus un bonus par élimination — cumulés sur toutes les parties, le plus haut total à la fin remporte le tournoi.</p>
      <div style="border:1px solid var(--border);border-radius:12px;background:var(--surface);overflow:hidden">${rows}</div>
      <div style="display:flex;align-items:center;gap:16px;padding:14px 18px;margin-top:14px;border:1px solid var(--border);border-radius:12px;background:var(--surface)">
        <div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:650">Bonus par élimination</div><div style="font-size:11.5px;color:var(--text-faint);margin-top:2px">S'ajoute aux points de classement, par élimination réalisée dans la partie</div></div>
        <input id="wz-br-kill" type="number" min="0" step="0.5" value="${d.brKillPoints}" style="width:88px;text-align:center;border:1px solid var(--border-strong);border-radius:9px;background:var(--surface-3);color:var(--text);font-family:'JetBrains Mono',monospace;font-size:14px;padding:9px" />
        <span style="width:36px;text-align:right;font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--text-muted);flex:none">pts</span>
      </div>
      <p style="color:var(--text-faint);font-size:11.5px;margin-top:10px">Au-delà de ${rankLabel(nRanks - 1)}, une place ne rapporte plus que le bonus d'élimination. Comme le reste de ce barème, figé une fois le tournoi lancé.</p>
    </div>
  </div>${wizFoot("Retour", wizFullFlow(S) ? 3 : 1, 5, "Validation")}`;
}

function wizScoringStep(S: State) {
  const d = S.wizData;
  if (d.format === "BATTLE_ROYALE") return wizBrScoringStep(S);
  const isSurvival = d.format === "SURVIVAL";
  // Seules finalsWin (points par victoire) et championBonus (sacre) s'appliquent à tous les formats
  // à élimination/rondes — le reste (poules, repêchage, striker) est spécifique à Survival (voir
  // Engine.reportFinals/finishFinals) : pas la peine de le proposer pour un Bracket simple, par ex.
  const fields = isSurvival ? WIZ_SCORING_FIELDS : WIZ_SCORING_FIELDS.filter(([, , key]) => key === "finalsWin" || key === "championBonus");
  const c = cagnottePreview(d.players.length, d.nbPools, d.pointsPerPlayer, d, d.finalsFormat, d.poolFormat, d.qualifyPerPool);
  const rows = fields.map(([id, label, key], i) => {
    const b = c.breakdown[key as keyof typeof c.breakdown];
    const sub = key === "championBonus" ? "une seule fois"
      : key === "streakBonus" ? ""
      : `× ${b.matches} match${b.matches > 1 ? "s" : ""} prévu${b.matches > 1 ? "s" : ""}`;
    const last = i === fields.length - 1;
    return `<div style="display:flex;align-items:center;gap:16px;padding:14px 18px;${last ? "" : "border-bottom:1px solid var(--surface-3);"}">
      <div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:650">${label}</div><div id="wiz-sc-sub-${key}" style="font-size:11.5px;color:var(--text-faint);margin-top:2px">${sub}</div></div>
      <input id="${id}" type="number" min="${WIZ_SCORING_FLOOR[key]}" step="0.25" value="${(d as unknown as Record<string, number>)[key]}" style="width:88px;text-align:center;border:1px solid var(--border-strong);border-radius:9px;background:var(--surface-3);color:var(--text);font-family:'JetBrains Mono',monospace;font-size:14px;padding:9px" />
      <span id="wiz-sc-pts-${key}" style="width:70px;text-align:right;font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--text-muted);flex:none">${b.pts} pts</span>
    </div>`;
  }).join("");
  // Format de la phase finale (Survival) : choisi une fois pour toutes à la création (ou en
  // reconstruisant tout via "Changer le format" — wizFullFlow couvre les deux), jamais modifiable
  // ensuite — un changement en cours de route avait faussé le calcul de la cagnotte par le passé
  // (le nombre de matchs de finale dépend du format), voir Engine.finalsMatchCount.
  const chosenFinalsFmt = (FINALS_FORMATS.find(([k]) => k === d.finalsFormat) || FINALS_FORMATS[0]);
  const finalsFmtNote = !isSurvival ? "" : wizFullFlow(S)
    ? `<div style="margin-bottom:16px">
        <div style="font-size:12px;color:var(--text-muted);font-weight:650;margin-bottom:8px">Phase finale</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${wizFinalsFormatOptions(d.poolFormat).map(([key, label]) => {
            const on = d.finalsFormat === key;
            return `<button data-wizfinalsformat="${key}" style="font-size:12.5px;font-weight:700;border-radius:10px;padding:8px 14px;cursor:pointer;background:${on ? "rgba(34,211,238,.1)" : "var(--surface-3)"};border:1px solid ${on ? "#22D3EE" : "var(--border)"};color:${on ? "#22D3EE" : "var(--text-muted)"}">${label}</button>`;
          }).join("")}
        </div>
        <p style="color:var(--text-faint);font-size:11.5px;margin-top:8px">${chosenFinalsFmt[2]} Fixé à la création : le barème ci-dessous en dépend.</p>
      </div>`
    : `<p style="color:var(--text-faint);font-size:11.5px;margin:0 0 16px">Phase finale : <b style="color:#22D3EE">${chosenFinalsFmt[1].toLowerCase()}</b> — fixée à la création pour ce tournoi, le barème ci-dessous est calculé en conséquence.</p>`;
  const streakLenPicker = !isSurvival ? "" : `<div style="margin-bottom:16px">
    <div style="font-size:12px;color:var(--text-muted);font-weight:650;margin-bottom:8px">Bonus striker — série de</div>
    <div style="display:flex;gap:8px">
      <button data-wizstreaklen="3" style="font-size:12.5px;font-weight:700;border-radius:10px;padding:8px 14px;cursor:pointer;background:${d.streakLength === 3 ? "rgba(34,211,238,.1)" : "var(--surface-3)"};border:1px solid ${d.streakLength === 3 ? "#22D3EE" : "var(--border)"};color:${d.streakLength === 3 ? "#22D3EE" : "var(--text-muted)"}">3 victoires d'affilée</button>
      <button data-wizstreaklen="5" style="font-size:12.5px;font-weight:700;border-radius:10px;padding:8px 14px;cursor:pointer;background:${d.streakLength === 5 ? "rgba(34,211,238,.1)" : "var(--surface-3)"};border:1px solid ${d.streakLength === 5 ? "#22D3EE" : "var(--border)"};color:${d.streakLength === 5 ? "#22D3EE" : "var(--text-muted)"}">5 victoires d'affilée</button>
    </div>
    <p style="color:var(--text-faint);font-size:11.5px;margin-top:8px">Un seul palier actif par tournoi.</p>
  </div>`;
  const intro = isSurvival
    ? "Chaque valeur est librement réglable à partir de 0,25 point. Le total programmé doit tenir dans la cagnotte disponible."
    : "Points par victoire en phase finale et bonus au sacre du champion — pas de cagnotte à respecter pour ce format.";
  return `<div class="grid2b" style="display:grid;grid-template-columns:1.4fr 1fr;gap:16px">
    <div>
      <h3 style="margin:0 0 6px;font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:.5px;display:flex;align-items:center;gap:9px">${ic(I.cart, 17)}${wizFullFlow(S) ? "Étape 4 — Barème des points" : "Barème des points"}</h3>
      <p style="color:var(--text-muted);font-size:13.5px;margin:6px 0 16px;max-width:520px">${intro}</p>
      ${finalsFmtNote}
      ${streakLenPicker}
      <div style="border:1px solid var(--border);border-radius:12px;background:var(--surface);overflow:hidden">${rows}</div>
    </div>
    ${isSurvival ? wizGaugeCard(c) : ""}
  </div>${wizFoot("Retour", wizFullFlow(S) ? 3 : 1, 5, "Validation")}`;
}

function wizValidateStep(S: State) {
  const d = S.wizData;
  const editing = !!S.wizEditId;
  const isSurvival = d.format === "SURVIVAL";
  const isBR = d.format === "BATTLE_ROYALE";
  const c = cagnottePreview(d.players.length, d.nbPools, d.pointsPerPlayer, d, d.finalsFormat, d.poolFormat, d.qualifyPerPool);
  // Le barème détaillé (et sa jauge de validité) ne concerne que Survival — les autres formats n'ont rien à dépasser.
  // scoringOk : chaque valeur de "victoire" doit être ≥ 0,25 (voir WIZ_SCORING_FLOOR) — sinon l'API
  // refuse la création avec un message technique brut ; on bloque ici avec une raison compréhensible.
  const scoringOk = isBR || wizScoringValid(d);
  const canSubmit = scoringOk && (isSurvival ? c.valid : true) && d.name.trim().length > 0 && (editing || d.teamSize > 0 || d.players.length >= 2);
  const row = (label: string, value: string) => `<tr><td style="padding:9px 6px;color:var(--text-muted);font-size:13px">${label}</td><td style="padding:9px 6px;text-align:right;font-weight:650">${value}</td></tr>`;
  // Hors Survival, seuls finalsWin/championBonus s'appliquent (voir wizScoringStep) — le reste ne concerne pas ce format.
  const scoringFields = isSurvival ? WIZ_SCORING_FIELDS : WIZ_SCORING_FIELDS.filter(([, , key]) => key === "finalsWin" || key === "championBonus");
  const brk = scoringFields.map(([, label, key]) => row(label, String((d as unknown as Record<string, number>)[key]))).join("");
  const formatLabel = (WIZ_FORMATS.find(([key]) => key === d.format) || WIZ_FORMATS[0])[1];
  // Une phase de groupes existe pour Survival (toujours) et pour les formats a phase finale des
  // que plus d une poule est demandee (miroir de Engine.usesPools).
  const pooled = wizHasPools(d.format) && (isSurvival || d.nbPools > 1);
  const structureRow = pooled
    ? row("Poules", `${d.nbPools} (${balancedSizesPreview(d.players.length, d.nbPools).join(" / ")})`)
    : isBR ? row("Parties", String(d.nbPools)) : "";
  // Poules en double élimination fusionné (hors Survival) : ni qualifiés ni format de phase finale
  // distincts, un seul grand bracket continu (voir Engine.launchGroupedDoubleElim) — ces deux lignes
  // n'ont alors rien à annoncer.
  const isDoubleMerged = pooled && !isSurvival && d.poolFormat === "double";
  // Round Robin/Double élim : le mode de poule est déjà le format principal affiché plus haut (voir
  // wizPoolsStep, poolModeImplied) — redondant à répéter ici.
  const poolModeImplied = pooled && !isSurvival && (d.format === "ROUND_ROBIN" || d.format === "DOUBLE_ELIM");
  const poolRows = pooled && !isSurvival
    ? (poolModeImplied ? "" : row("Mode des poules", (wizPoolModes(d.format).find(([k]) => k === d.poolFormat) || wizPoolModes(d.format)[0])[1]))
      + (isDoubleMerged ? "" : row("Qualifiés par poule", String(Math.min(d.qualifyPerPool || 2, wizMaxQualify(d.players.length, d.nbPools))))
        + row("Phase finale", (FINALS_FORMATS.find(([k]) => k === d.finalsFormat) || FINALS_FORMATS[0])[1]))
    : "";
  // Nombre de qualifiés réellement choisi (étape Poules), borné comme à la saisie — et non plus
  // "Top 1 + Top 2" écrit en dur, faux dès qu'on en qualifie un autre nombre.
  const qualifN = Math.min(d.qualifyPerPool || 2, wizMaxQualify(d.players.length, d.nbPools));
  const qualifSurvivalLabel = `${qualifN === 1 ? "Le 1er" : `Les ${qualifN} premiers`} de chaque poule (${qualifN * d.nbPools} qualifié${qualifN * d.nbPools > 1 ? "s" : ""} au total) → phase finale`;
  const participantsRows = !wizFullFlow(S) ? "" : `${row("Format", formatLabel)}${row("Participants", String(d.players.length))}${structureRow}${poolRows}${isSurvival ? row("Mode des poules", (wizPoolModes(d.format).find(([k]) => k === d.poolFormat) || wizPoolModes(d.format)[0])[1]) : ""}${isSurvival ? row("Bonus striker", `Série de ${d.streakLength} victoires`) : ""}${isSurvival ? row("Qualification", qualifSurvivalLabel) : ""}${isSurvival ? row("Phase finale", (FINALS_FORMATS.find(([k]) => k === d.finalsFormat) || FINALS_FORMATS[0])[1]) : ""}`;
  const hasPoolsStep = isBR || wizHasPools(d.format);
  // Raccourci abrégé (format figé) : le retour vise Barème seulement en Survival — les autres
  // formats n'ont pas cette étape ici (voir wizSteps() et le nextStep de wizInfosStep()).
  const backTarget = !editing ? (isSurvival || isBR ? 4 : hasPoolsStep ? 3 : 2) : (!S.wizFullEdit ? (isSurvival || isBR ? 4 : 1) : (isSurvival || isBR ? 4 : hasPoolsStep ? 3 : 1));
  // Le barème (points par victoire, bonus champion) ne concerne que Survival — seul format à
  // respecter une cagnotte. Les autres formats gardent des valeurs fixes en interne, jamais montrées
  // ici : ça n'a rien à faire dans un récap Bracket simple/Round Robin/etc. Battle Royale a son propre
  // barème (palier de classement + bonus élimination), réglable depuis wizBrScoringStep.
  const bareme = isSurvival ? `<hr style="border:0;border-top:1px solid var(--border);margin:14px 0" />
      <h3 style="margin:0 0 10px;font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:.5px">Barème</h3>
      <table style="width:100%;border-collapse:collapse">${brk}</table>`
    : isBR ? `<hr style="border:0;border-top:1px solid var(--border);margin:14px 0" />
      <h3 style="margin:0 0 10px;font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:.5px">Barème</h3>
      <table style="width:100%;border-collapse:collapse">${d.brPoints.map((v, i) => row(i === 0 ? "1er de partie" : i === 1 ? "2e de partie" : `${i + 1}e de partie`, `${v} pts`)).join("")}${row("Bonus par élimination", `${d.brKillPoints} pt${d.brKillPoints > 1 ? "s" : ""}`)}</table>`
    : "";
  return `<div class="grid2b" style="display:grid;grid-template-columns:1.4fr 1fr;gap:16px">
    ${wizCard(`<h3 style="margin:0 0 14px;font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:.5px;display:flex;align-items:center;gap:9px">${ic(I.crown, 17)}${editing ? "Récapitulatif" : "Étape 5 — Récapitulatif"}</h3>
      <table style="width:100%;border-collapse:collapse">
        ${row("Tournoi", escHtml(d.name) || "—")}${row("Jeu", escHtml(d.game) || "—")}${row("Date / lieu", `${escHtml(d.date) || "—"}${d.place ? " · " + escHtml(d.place) : ""}`)}
        ${row("Format des matchs", d.matchMode === "ft" ? `Course à ${d.matchValue} pts` : `Bo${d.matchValue}`)}
        ${participantsRows}${row("Frais d'inscription", d.entryFeeXof ? money(d.entryFeeXof) : "Gratuit")}
      </table>
      ${bareme}
      <button data-act="${editing ? "wiz-update" : "wiz-submit"}" ${!canSubmit || S.busy ? "disabled" : ""} style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin-top:20px;background:${canSubmit ? "linear-gradient(135deg,#22D3EE,#12aec4)" : "var(--surface-4)"};color:${canSubmit ? "#04222a" : "var(--text-faint)"};border:0;border-radius:12px;padding:14px 22px;font-weight:750;font-size:15px;cursor:${canSubmit && !S.busy ? "pointer" : "default"}">${ic(I.bolt, 17)}${S.busy ? (editing ? "Enregistrement…" : "Création…") : (editing ? "Enregistrer les modifications" : "Créer le tournoi")}</button>
      ${canSubmit ? (editing ? "" : `<p style="color:var(--text-faint);font-size:11.5px;text-align:center;margin-top:9px">${isSurvival ? "Tu pourras répartir/réordonner les poules et lancer le tournoi depuis sa page." : "Tu pourras lancer le tournoi depuis sa page."}</p>`) : (() => {
        const reasons: string[] = [];
        if (!d.name.trim()) reasons.push("le nom du tournoi");
        if (!editing && !d.teamSize && d.players.length < 2) reasons.push("au moins 2 participants");
        if (!scoringOk) reasons.push("le barème (une victoire ne peut pas valoir 0 point — 0,25 minimum)");
        if (isSurvival && !c.valid) reasons.push("le barème (dépasse la cagnotte disponible)");
        return `<p style="color:#FB7185;font-size:11.5px;text-align:center;margin-top:9px">${ic(I.warn, 12)} Corrige ${reasons.join(", ")} avant de ${editing ? "enregistrer" : "créer"}.</p>`;
      })()}`)}
    ${isSurvival ? wizGaugeCard(c) : ""}
  </div>${wizFoot("Retour", backTarget, 0)}`;
}

/** Assistant de création/modification : modal plein écran (fond flouté), sidebar d'étapes + contenu.
 * Ne se ferme jamais au clic extérieur — un formulaire à 5 étapes est trop long à ressaisir pour un
 * clic accidentel ; seule la croix ferme explicitement. */
/** Libellé court de l'étape active, pour l'indicateur compact affiché à la place de la liste complète sous 1024px. */
const WIZ_STEP_LABELS: Record<number, string> = { 1: "Infos générales", 2: "Participants", 3: "Poules", 4: "Barème des points", 5: "Validation" };
/** « Événement : X » — rappelle dans quel événement le tournoi va être créé (vide pour un tournoi indépendant). */
function wizEventNote(S: State): string {
  if (!S.wizEventId || S.wizEditId) return "";
  const ev = [S.eventDetail, S.eventManage, ...(S.myEvents ?? [])].find((e: Detail) => e && e.id === S.wizEventId);
  return `<div style="margin-bottom:8px;color:#22D3EE;font-weight:700">Événement : ${escHtml(ev?.name || "sélectionné")}</div>`;
}
function tournamentWizard(S: State) {
  const editing = !!S.wizEditId;
  const body = [wizInfosStep, wizParticipantsStep, wizPoolsStep, wizScoringStep, wizValidateStep][S.wizStep - 1](S);
  const stepLabel = S.wizStep === 3 && S.wizData.format === "BATTLE_ROYALE" ? "Parties" : (WIZ_STEP_LABELS[S.wizStep] || "");
  const mobileProgress = `<div class="wiz-mobile-progress" style="border-bottom:1px solid var(--surface-3)">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px">
      <div><span style="font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:.5px">${editing ? "Modifier" : "Nouveau tournoi"}</span><div style="font-size:11.5px;color:var(--text-muted);margin-top:2px">Étape ${S.wizStep}/5 — ${stepLabel}</div></div>
      <button data-act="create-cancel" style="display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:var(--surface-3);border:1px solid var(--border);color:var(--text-muted);cursor:pointer;flex:none">${ic(I.x, 14)}</button>
    </div>
    <div style="height:3px;background:var(--surface-3)"><span style="display:block;height:100%;width:${(S.wizStep / 5) * 100}%;background:#22D3EE;transition:width .25s ease"></span></div>
  </div>`;
  return `<div class="wiz-overlay" style="position:fixed;inset:0;z-index:260;display:flex;align-items:flex-start;justify-content:center;padding:min(5vh,36px) 18px;background:rgba(6,6,10,.82);backdrop-filter:blur(8px);overflow-y:auto">
    <div data-stop="1" class="wiz-dialog" style="width:100%;max-width:1160px;border:1px solid var(--border);border-radius:20px;background:var(--bg);box-shadow:0 40px 100px rgba(0,0,0,.6);animation:fadeUp .18s ease both;margin-bottom:36px;display:flex;overflow:hidden;min-height:600px">
      ${mobileProgress}
      <div class="wiz-sidebar" style="width:230px;flex:none;border-right:1px solid var(--surface-3);background:var(--surface-2);display:flex;flex-direction:column">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 16px 16px 18px;border-bottom:1px solid var(--surface-3)">
          <span style="font-family:'Bebas Neue',sans-serif;font-size:19px;letter-spacing:1px">${editing ? "Modifier" : "Nouveau tournoi"}</span>
          <button data-act="create-cancel" style="display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:var(--surface-3);border:1px solid var(--border);color:var(--text-muted);cursor:pointer;flex:none">${ic(I.x, 13)}</button>
        </div>
        ${wizSteps(S)}
        <div style="flex:1"></div>
        <div style="padding:14px 18px 18px;border-top:1px solid var(--surface-3);font-size:11px;color:var(--text-faint);line-height:1.6">${wizEventNote(S)}Format : <b style="color:var(--text-muted)">${(WIZ_FORMATS.find(([key]) => key === S.wizData.format) || WIZ_FORMATS[0])[1]}</b>${S.wizData.format === "SURVIVAL" ? " — barème détaillé réglable à l'étape 4." : S.wizData.format === "BATTLE_ROYALE" ? " — points par palier de classement réglables depuis sa page une fois créé." : ""}</div>
      </div>
      <div class="wiz-body" style="flex:1;min-width:0;padding:26px 30px;overflow-y:auto">${body}</div>
    </div>
  </div>`;
}

/** Statuts affichables sur la liste — dérivés des mêmes champs réels que les cartes (t.live / t.status). */
const TOURN_STATUSES = ["Tous", "En direct", "Ouverts", "À lancer", "Terminés"] as const;
function matchesTournStatus(t: TournCard, status: string): boolean {
  if (status === "Tous") return true;
  if (status === "En direct") return t.live;
  if (status === "Terminés") return t.status === "Terminé";
  if (status === "À lancer") return !t.live && t.status === "À lancer";
  if (status === "Ouverts") return !t.live && t.status !== "Terminé" && t.status !== "À lancer";
  return true;
}

function pTournois(S: State) {
  const source = S.tourns ?? [];
  const manage = canManage(S);
  const q = S.q.trim().toLowerCase();
  let list = S.tournStatus === "Tous" ? source : source.filter((t) => matchesTournStatus(t, S.tournStatus));
  if (S.fmt !== "Tous") list = list.filter((t) => t.format === S.fmt);
  if (q) list = list.filter((t) => `${t.name} ${t.game || ""}`.toLowerCase().includes(q));
  const createBtn = manage
    ? `<button data-act="create-open" style="display:inline-flex;align-items:center;gap:8px;background:#22D3EE;color:#04222a;border:0;border-radius:10px;padding:12px 18px;font-weight:750;font-size:14px;cursor:pointer">${ic(I.plus, 16)}Créer un tournoi</button>`
    : "";
  const searchBox = `<div style="position:relative;width:240px"><span style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--text-faint)">${ic(I.search, 15)}</span><input id="hsearch" value="${escAttr(S.q)}" placeholder="Tournoi, jeu, lieu…" style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:9px;color:var(--text);font-family:inherit;font-size:13px;padding:10px 12px 10px 34px" /></div>`;
  const statusCounts = TOURN_STATUSES.map((st) => [st, st === "Tous" ? source.length : source.filter((t) => matchesTournStatus(t, st)).length] as const);
  const statusBar = `<div style="display:flex;border:1px solid var(--border);border-radius:9px;overflow-x:auto;max-width:100%">${statusCounts.map(([st, n], i) => {
    const on = S.tournStatus === st;
    return `<span data-tournstatus="${st}" style="padding:8px 15px;font-size:12.5px;font-weight:${on ? 750 : 600};cursor:pointer;background:${on ? "#22D3EE" : "transparent"};color:${on ? "#04222a" : "var(--text-muted)"};transition:background .2s ease,color .2s ease;white-space:nowrap;flex:none;${i > 0 ? "border-left:1px solid var(--border)" : ""}">${st} <span style="font-family:'JetBrains Mono',monospace;opacity:${on ? .7 : 1};color:${on ? "#04222a" : "var(--text-faint)"}">${n}</span></span>`;
  }).join("")}</div>`;
  const filt = `<div class="rise d1 page-hpad" style="display:flex;align-items:center;gap:22px;padding:14px 44px;border-bottom:1px solid var(--surface-3);flex-wrap:wrap">${statusBar}<span style="width:1px;height:22px;background:var(--surface-4);flex:none"></span><div style="display:flex;gap:7px;overflow-x:auto;max-width:100%">${chips(FORMATS, S.fmt, "fmt")}</div></div>`;

  const head = railPageHead("Tournois", `${source.length} tournoi${source.length > 1 ? "s" : ""} · ${source.filter((t) => t.live).length} en direct · ${source.filter((t) => matchesTournStatus(t, "Ouverts")).length} inscription${source.filter((t) => matchesTournStatus(t, "Ouverts")).length > 1 ? "s" : ""} ouverte${source.filter((t) => matchesTournStatus(t, "Ouverts")).length > 1 ? "s" : ""}`, `${searchBox}${createBtn}`);

  const form = S.creating && manage ? tournamentWizard(S) : "";

  // Tournoi en direct mis en avant, extrait de la grille.
  const liveT = source.find((t) => t.live);
  const featured = liveT ? `<div class="rise d2 page-hpad" style="padding:26px 44px 0"><div data-open="${liveT.id}" class="hcard glow" style="position:relative;border:1px solid rgba(34,211,238,.4);border-radius:14px;overflow:hidden;background:linear-gradient(100deg,#0f2932 10%,#13303a 45%,#1a1435);padding:26px 30px;cursor:pointer">
    <div style="display:flex;align-items:center;gap:10px"><span style="display:inline-flex;align-items:center;gap:6px;font-size:10.5px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:#04222a;background:#22D3EE;border-radius:99px;padding:4px 10px"><span style="width:6px;height:6px;border-radius:50%;background:#04222a;animation:blink 1.2s infinite"></span>En direct</span><span style="font-size:12px;color:#63C6DA;font-weight:600">${escHtml(liveT.format)}</span></div>
    <h3 style="font-family:'Bebas Neue',sans-serif;font-size:38px;letter-spacing:1.2px;margin:12px 0 0;line-height:.95;color:#fff">${escHtml(liveT.name)}</h3>
    <div style="color:#A6C9D3;font-size:13.5px;margin-top:8px">${[liveT.game, liveT.players + " joueurs", liveT.place, liveT.date].filter(Boolean).map(escHtml).join(" · ")}</div>
    <div style="display:flex;align-items:center;gap:14px;margin-top:18px;flex-wrap:wrap">
      <span style="display:inline-flex;align-items:center;gap:8px;background:#22D3EE;color:#04222a;border-radius:10px;padding:11px 17px;font-weight:750;font-size:13.5px">Ouvrir la régie ${ic(I.arrow, 15)}</span>
      <span data-show="${liveT.id}" style="display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.22);color:#fff;border-radius:10px;padding:11px 17px;font-weight:700;font-size:13.5px">${ic(I.tv, 15)}Mode Show</span>
    </div>
  </div></div>` : "";

  const emptyMsg = source.length === 0 ? "Aucun tournoi pour l'instant." : `Aucun tournoi ne correspond${q ? ` à « ${S.q} »` : ""}.`;
  const empty = `<div class="page-hpad-m" style="margin:26px 44px 0;border:1px solid var(--border);border-radius:16px;background:var(--surface);padding:48px 24px;text-align:center;color:var(--text-muted)">${emptyMsg}</div>`;
  const rest = list.filter((t) => !liveT || t.id !== liveT.id);
  const filetCard = (t: TournCard, i: number) => {
    const n = rest.length;
    const isRight = (i + 1) % 3 === 0 || i === n - 1;
    const isLastRow = i >= n - (n % 3 === 0 ? 3 : n % 3);
    const bannerBg = t.imageUrl
      ? `background-image:linear-gradient(180deg,rgba(11,11,17,.15),rgba(11,11,17,.6)),url('${mediaUrl(t.imageUrl)}');background-size:cover;background-position:center`
      : "background:linear-gradient(135deg,rgba(34,211,238,.16),rgba(124,130,255,.11))";
    const statusBadge = t.live
      ? `<span style="position:absolute;top:12px;right:12px;display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:800;white-space:nowrap;letter-spacing:1px;text-transform:uppercase;color:#04222a;background:#22D3EE;border-radius:99px;padding:4px 9px"><span style="width:5px;height:5px;border-radius:50%;background:#04222a;animation:blink 1.2s infinite"></span>Live</span>`
      : `<span style="position:absolute;top:12px;right:12px;font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:${t.status === "Terminé" ? "#FBBF24" : "#7C82FF"};background:rgba(11,11,17,.7);border:1px solid ${t.status === "Terminé" ? "rgba(251,191,36,.4)" : "rgba(124,130,255,.45)"};border-radius:99px;padding:4px 9px">${escHtml(t.status)}</span>`;
    const openAttr = t.id ? `data-open="${t.id}"` : `data-go="tournois"`;
    return `<div ${openAttr} class="fcell" style="padding:20px ${isRight ? "0" : "24px"} 24px ${i % 3 === 0 ? "0" : "24px"};${isRight ? "" : "border-right:1px solid var(--surface-3);"}${isLastRow ? "" : "border-bottom:1px solid var(--surface-3);"}cursor:pointer">
      <div class="zoom" style="position:relative;height:158px;border-radius:10px;overflow:hidden;${bannerBg};margin-bottom:14px">
        <span style="position:absolute;bottom:12px;left:12px;font-size:10.5px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#fff;background:rgba(11,11,17,.6);border:1px solid rgba(255,255,255,.16);border-radius:99px;padding:4px 10px">${escHtml(t.format)}</span>
        ${statusBadge}
      </div>
      <h4 style="margin:0 0 8px;font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:.8px">${escHtml(t.name)}</h4>
      <div style="color:var(--text-muted);font-size:13px;line-height:1.65">${escHtml(t.game)} · <span style="font-family:'JetBrains Mono',monospace">${t.players}</span> joueurs<br>${escHtml(t.date)} · ${escHtml(t.place)}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;padding-top:12px;border-top:1px solid var(--surface-3)"><span style="font-size:12.5px;color:${t.live ? "#22D3EE" : "var(--text-muted)"};font-weight:${t.live ? 700 : 600}">${t.live ? "En direct" : escHtml(t.status)}</span>${t.cagnotte !== null ? `<span style="font-size:12.5px;color:#FBBF24;font-weight:700;font-family:'JetBrains Mono',monospace">${t.cagnotte} pts</span>` : ""}</div>
    </div>`;
  };
  const gridHead = `<div style="display:flex;align-items:center;gap:10px;margin:0 0 4px"><h3 style="font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:1.2px;margin:0">${liveT ? "Tous les tournois" : "Tournois"}</h3><span style="font-size:12px;color:var(--text-faint);font-family:'JetBrains Mono',monospace">${rest.length}</span></div>`;
  const grid = rest.length
    ? `<div class="rise d3 page-hpad" style="padding:34px 44px 44px">${gridHead}<div class="tourn-grid" style="display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--surface-4);margin-top:12px">${rest.map(filetCard).join("")}</div></div>`
    : (liveT ? "" : empty);

  return `${head}${filt}${form}${featured}${grid}<div class="page-hpad" style="padding:0 44px 40px">${adCarousel(S, "tournois")}</div>`;
}

/** Rend le podium + tableau d'UN classement (déjà trié par points desc) pour un jeu donné. Jamais de stats mélangées entre jeux. */
function gameLeaderboardBlock(rows: Detail[], opts: { podium: boolean; limit?: number }) {
  const list = opts.limit ? rows.slice(0, opts.limit) : rows;
  const podiumColors = [["#FBBF24", "#f59e0b", "96px", "1"], ["#cbd5e1", "#94a3b8", "72px", "2"], ["#d6a37a", "#b4784f", "56px", "3"]];
  let podiumHtml = "";
  if (opts.podium && list.length) {
    const top3 = list.slice(0, 3);
    const order = top3.length > 1 ? [top3[1], top3[0], top3[2]].filter(Boolean) : top3;
    podiumHtml = `<div class="podium-row" style="display:flex;align-items:flex-end;justify-content:center;gap:14px;margin:4px 0 22px;flex-wrap:wrap">${order.map((r: Detail) => {
      const rank = list.indexOf(r);
      const [plColor, avA, h] = podiumColors[rank];
      return `<div data-playerprofile="${escAttr(r.name)}" data-playeruid="${escAttr(r.userId)}" style="display:flex;flex-direction:column;align-items:center;gap:9px;width:112px;cursor:pointer"><div style="display:grid;place-items:center;width:52px;height:52px;border-radius:14px;font-family:'Bebas Neue',sans-serif;font-size:24px;color:#04222a;background:linear-gradient(135deg,${plColor},${avA})">${r.name.charAt(0).toUpperCase()}</div><div style="text-align:center;max-width:110px"><div style="font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(r.name)}</div><div style="font-size:11px;color:var(--text-muted)">${r.points} pts</div></div><div style="width:100%;border-radius:12px 12px 0 0;border:1px solid var(--border);border-bottom:0;background:var(--surface-3);display:flex;align-items:center;justify-content:center;padding-top:8px;height:${h}"><span style="font-family:'Bebas Neue',sans-serif;font-size:28px;color:${plColor}">${rank + 1}</span></div></div>`;
    }).join("")}</div>`;
  }
  const th = (t: string, r?: boolean) => `<th style="text-align:${r ? "right" : "left"};color:var(--text-muted);font-size:10.5px;text-transform:uppercase;letter-spacing:1px;padding:12px 8px;font-weight:750">${t}</th>`;
  const trs = list.map((r: Detail, i: number) => `<tr data-playerprofile="${escAttr(r.name)}" data-playeruid="${escAttr(r.userId)}" style="border-top:1px solid var(--border);cursor:pointer"><td style="padding:11px 8px;font-family:'Bebas Neue',sans-serif;font-size:19px;color:${i < 3 ? "#FBBF24" : "var(--text-faint)"}">${i + 1}</td><td style="padding:11px 8px"><div style="display:flex;align-items:center;gap:10px"><span style="display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--surface-4);border:1px solid var(--border);font-size:11px;font-weight:800;color:var(--text-muted)">${r.name.charAt(0).toUpperCase()}</span><div><div style="font-weight:650">${escHtml(r.name)}${r.championships > 0 ? ` <span title="Titres remportés" style="color:#FBBF24">${ic(I.crown, 12)} ${r.championships}</span>` : ""}</div><div style="font-size:11px;color:var(--text-faint)">${r.team ? escHtml((r.team as string[]).join(", ")) : escHtml(r.city) || "—"}</div></div></div></td><td style="padding:11px 8px;text-align:right;color:var(--text-muted);font-variant-numeric:tabular-nums">${r.tournamentsPlayed}</td><td style="padding:11px 8px;text-align:right;font-variant-numeric:tabular-nums">${r.wins}-${r.losses}</td><td style="padding:11px 8px;text-align:right;color:#34D399;font-weight:700">${r.winrate}%</td><td style="padding:11px 8px;text-align:right;font-weight:800;color:#22D3EE;font-variant-numeric:tabular-nums">${r.points}</td></tr>`).join("");
  const table = `<div style="border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:8px 18px 14px;overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px;min-width:560px"><tr>${th("#")}${th("Joueur")}${th("Tournois", true)}${th("V-D", true)}${th("Winrate", true)}${th("Points", true)}</tr>${trs}</table></div>`;
  return podiumHtml + table;
}

/** Classement par clubs : agrège les lignes du classement joueurs par club (rattachement fait côté API via la base de joueurs). */
function clubLeaderboardBlock(rows: Detail[]) {
  type CAgg = { name: string; points: number; wins: number; losses: number; matches: number; championships: number; players: Set<string> };
  const byClub = new Map<string, CAgg>();
  for (const r of rows) {
    if (!r.club) continue;
    const c = byClub.get(r.club) ?? { name: r.club, points: 0, wins: 0, losses: 0, matches: 0, championships: 0, players: new Set<string>() };
    c.points += r.points; c.wins += r.wins; c.losses += r.losses; c.matches += r.matches; c.championships += r.championships;
    c.players.add(r.name);
    byClub.set(r.club, c);
  }
  const list = Array.from(byClub.values())
    .map((c) => ({
      name: c.name, points: Math.round(c.points * 10) / 10, wins: c.wins, losses: c.losses, matches: c.matches,
      winrate: c.matches ? Math.round((c.wins / c.matches) * 100) : 0, championships: c.championships, playerCount: c.players.size,
    }))
    .sort((a, b) => b.points - a.points || b.winrate - a.winrate);
  if (!list.length) {
    return `<div style="border:1px solid var(--border);border-radius:18px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:48px 24px;text-align:center;color:var(--text-muted)">Aucun joueur classé n'est encore rattaché à un club (à faire depuis Admin → Joueurs).</div>`;
  }
  const th = (t: string, r?: boolean) => `<th style="text-align:${r ? "right" : "left"};color:var(--text-muted);font-size:10.5px;text-transform:uppercase;letter-spacing:1px;padding:12px 8px;font-weight:750">${t}</th>`;
  const trs = list.map((c, i) => `<tr style="border-top:1px solid var(--border)"><td style="padding:11px 8px;font-family:'Bebas Neue',sans-serif;font-size:19px;color:${i < 3 ? "#FBBF24" : "var(--text-faint)"}">${i + 1}</td><td style="padding:11px 8px"><div style="display:flex;align-items:center;gap:10px"><span style="display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--surface-4);border:1px solid var(--border);font-size:11px;font-weight:800;color:var(--text-muted)">${c.name.charAt(0).toUpperCase()}</span><div><div style="font-weight:650">${escHtml(c.name)}${c.championships > 0 ? ` <span title="Titres remportés par des joueurs du club" style="color:#FBBF24">${ic(I.crown, 12)} ${c.championships}</span>` : ""}</div><div style="font-size:11px;color:var(--text-faint)">${c.playerCount} joueur${c.playerCount > 1 ? "s" : ""} classé${c.playerCount > 1 ? "s" : ""}</div></div></div></td><td style="padding:11px 8px;text-align:right;font-variant-numeric:tabular-nums">${c.wins}-${c.losses}</td><td style="padding:11px 8px;text-align:right;color:#34D399;font-weight:700">${c.winrate}%</td><td style="padding:11px 8px;text-align:right;font-weight:800;color:#22D3EE;font-variant-numeric:tabular-nums">${c.points}</td></tr>`).join("");
  return `<div style="border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:8px 18px 14px;overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px;min-width:480px"><tr>${th("#")}${th("Club")}${th("V-D", true)}${th("Winrate", true)}${th("Points", true)}</tr>${trs}</table></div>`;
}

/** Top N clubs (points cumulés des joueurs classés de ce jeu) — même agrégation que clubLeaderboardBlock, format compact pour le panneau latéral. */
function topClubsCompact(rows: Detail[], n = 3): { name: string; points: number; playerCount: number }[] {
  const byClub = new Map<string, { points: number; players: Set<string> }>();
  for (const r of rows) {
    if (!r.club) continue;
    const c = byClub.get(r.club) ?? { points: 0, players: new Set<string>() };
    c.points += r.points; c.players.add(r.name);
    byClub.set(r.club, c);
  }
  return Array.from(byClub.entries())
    .map(([name, c]) => ({ name, points: Math.round(c.points * 10) / 10, playerCount: c.players.size }))
    .sort((a, b) => b.points - a.points)
    .slice(0, n);
}

function pClassements(S: State) {
  // Tournois par équipes : les équipes ont leur propre onglet ; joueurs et clubs ne comptent que les individus.
  const allRows: Detail[] = S.leaderboard ?? [];
  const hasTeams = allRows.some((r) => r.team);
  const teamView = S.classementView === "equipes" && hasTeams;
  const all: Detail[] = allRows.filter((r) => (teamView ? !!r.team : !r.team));
  const viewToggle = (v: "joueurs" | "clubs" | "equipes" | "pronos", label: string) => `<span data-classview="${v}" style="padding:9px 16px;font-size:12.5px;font-weight:${S.classementView === v ? 750 : 600};cursor:pointer;transition:background .2s ease,color .2s ease;background:${S.classementView === v ? "#22D3EE" : "transparent"};color:${S.classementView === v ? "#04222a" : "var(--text-muted)"}">${label}</span>`;
  const head = railPageHead("Classements", `Points, victoires et titres calculés depuis les résultats réels. <b style="color:var(--text)">Un classement distinct par jeu</b> — les points ne sont jamais additionnés entre deux jeux.`,
    `<div style="display:flex;border:1px solid var(--border);border-radius:9px;overflow:hidden">${viewToggle("joueurs", "Joueurs")}${hasTeams ? viewToggle("equipes", "Équipes") : ""}${viewToggle("pronos", "Pronostics")}${viewToggle("clubs", "Clubs")}</div>`);
  if (S.classementView === "pronos") {
    const list: Detail[] = S.predictors ?? [];
    if (S.predictors === null) return `${head}<div class="page-hpad" style="padding:0 44px;color:var(--text-faint);text-align:center">Chargement…</div>`;
    if (!list.length) return `${head}<div class="page-hpad-m" style="margin:0 44px 40px;border:1px solid var(--border);border-radius:18px;background:var(--surface);padding:48px 24px;text-align:center;color:var(--text-muted)">Aucun pronostic résolu pour l'instant. Donne ton pronostic sur un match d'un tournoi en direct !</div>`;
    const th = (t: string, r?: boolean) => `<th style="text-align:${r ? "right" : "left"};color:var(--text-muted);font-size:10.5px;text-transform:uppercase;letter-spacing:1px;padding:12px 8px;font-weight:750">${t}</th>`;
    const trs = list.map((r, i) => `<tr style="border-top:1px solid var(--border)"><td style="padding:11px 8px;font-family:'Bebas Neue',sans-serif;font-size:19px;color:${i < 3 ? "#FBBF24" : "var(--text-faint)"}">${i + 1}</td><td style="padding:11px 8px;font-weight:650">${escHtml(r.name)}</td><td style="padding:11px 8px;text-align:right;font-weight:800;color:#22D3EE;font-variant-numeric:tabular-nums">${r.correct}</td><td style="padding:11px 8px;text-align:right;color:var(--text-muted);font-variant-numeric:tabular-nums">${r.total}</td><td style="padding:11px 8px;text-align:right;color:#34D399;font-weight:700">${r.rate}%</td></tr>`).join("");
    return `${head}<div class="rise d2 page-hpad" style="padding:10px 44px 44px"><div style="border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:8px 18px 14px;overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px;min-width:420px"><tr>${th("#")}${th("Pronostiqueur")}${th("Bons", true)}${th("Résolus", true)}${th("Réussite", true)}</tr>${trs}</table></div><p style="color:var(--text-faint);font-size:12.5px;margin:14px 2px 0">Un bon pronostic = le vainqueur d'un match trouvé avant son lancement. Classement tous tournois confondus.</p></div>`;
  }
  if (S.leaderboard === null) return `${head}<div class="page-hpad" style="padding:0 44px;color:var(--text-faint);text-align:center">Chargement…</div>`;
  if (!all.length) {
    return `${head}<div class="page-hpad-m" style="margin:0 44px 40px;border:1px solid var(--border);border-radius:18px;background:var(--surface);padding:56px 24px;text-align:center;color:var(--text-muted)">
      <div style="display:grid;place-items:center;width:60px;height:60px;border-radius:18px;background:var(--surface-3);border:1px solid var(--border-strong);color:#FBBF24;margin:0 auto 14px">${ic(I.medal, 26)}</div>
      Aucun résultat pour l'instant. Le classement se remplit au fil des matchs joués !</div>`;
  }
  // Chaque jeu garde son propre classement (points/winrate/tournois) — jamais additionné avec un autre jeu.
  const byGame = new Map<string, Detail[]>();
  for (const r of all) { const g = r.game || "Autre"; if (!byGame.has(g)) byGame.set(g, []); byGame.get(g)!.push(r); }
  const gamesPresent = GAMES.filter((g) => g !== "Tous" && byGame.has(g)).concat(Array.from(byGame.keys()).filter((g) => !GAMES.includes(g)));
  const activeGame = gamesPresent.includes(S.game) ? S.game : (gamesPresent[0] || "Tous");
  const block = (rows: Detail[], opts: { podium: boolean; limit?: number }) => S.classementView === "clubs" ? clubLeaderboardBlock(rows) : gameLeaderboardBlock(rows, opts);

  const tabs = `<div class="rise d1 page-hpad" style="display:flex;gap:0;padding:0 44px;border-bottom:1px solid var(--surface-3);overflow-x:auto">${gamesPresent.map((g) => {
    const on = g === activeGame;
    return `<span data-game="${g}" style="padding:14px 22px 13px;border-bottom:2px solid ${on ? "#22D3EE" : "transparent"};display:flex;align-items:baseline;gap:9px;cursor:pointer;flex:none;transition:border-color .2s ease"><span style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:1px;color:${on ? "var(--text)" : "var(--text-muted)"};transition:color .2s ease">${escHtml(g)}</span><span style="font-family:'JetBrains Mono',monospace;font-size:11.5px;color:${on ? "#22D3EE" : "var(--text-faint)"}">${(byGame.get(g) ?? []).length}</span></span>`;
  }).join("")}</div>`;

  const rows = byGame.get(activeGame) ?? [];
  if (!rows.length) {
    return `${head}${tabs}<div class="page-hpad-m" style="margin:26px 44px 40px;border:1px solid var(--border);border-radius:18px;background:var(--surface);padding:48px 24px;text-align:center;color:var(--text-muted)">Aucun résultat pour « ${escHtml(activeGame)} » pour l'instant.</div>`;
  }
  const topClubs = topClubsCompact(rows);
  const sidePanel = `<div style="display:flex;flex-direction:column;gap:16px">
    ${topClubs.length ? `<div style="border:1px solid var(--border);border-radius:12px;background:var(--surface);padding:18px">
      <div style="font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-muted);font-weight:800;margin-bottom:14px">Top clubs · ${escHtml(activeGame)}</div>
      ${topClubs.map((c, i) => `<div style="display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid var(--surface-3)"><span style="font-family:'Bebas Neue',sans-serif;font-size:17px;color:#FBBF24;width:16px">${i + 1}</span><div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:650">${escHtml(c.name)}</div><div style="font-size:11px;color:var(--text-faint)">${c.playerCount} joueur${c.playerCount > 1 ? "s" : ""} classé${c.playerCount > 1 ? "s" : ""}</div></div><span style="color:#22D3EE;font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:600">${c.points}</span></div>`).join("")}
    </div>` : ""}
    <div style="border:1px solid var(--border);border-radius:12px;background:var(--surface-2);padding:18px">
      <div style="font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-faint);font-weight:800;margin-bottom:10px">Comment les points sont calculés</div>
      <div style="font-size:12.5px;color:var(--text-muted);line-height:1.7">Chaque tournoi distribue une cagnotte fixée à l'avance (participants × points par joueur). Les points gagnés en match s'ajoutent au classement du jeu concerné. Un joueur peut figurer dans plusieurs classements sans jamais cumuler.</div>
    </div>
  </div>`;
  const body = `<div class="rise d2 page-hpad" style="padding:30px 44px 44px"><div class="grid2c" style="display:grid;grid-template-columns:1fr 320px;gap:22px;align-items:start">
    <div>${block(rows, { podium: true })}</div>
    ${S.classementView === "joueurs" ? sidePanel : ""}
  </div></div>`;
  return `${head}${tabs}${body}`;
}

/** Fiche joueur (comme le profil joueur de start.gg) : stats globales/par jeu, historique des matchs,
 * et confrontations directes contre un adversaire choisi. Identifiée par nom seul (voir leaderboard()
 * côté API) — accessible en cliquant un nom dans le classement, sans compte requis. */
function pPlayerProfile(S: State) {
  const p: Detail = S.playerProfile;
  if (!p) return `<div style="min-height:60vh;display:grid;place-items:center;color:var(--text-muted)">Chargement…</div>`;
  const stat = (v: string | number, k: string, color = "var(--text)") => `<div style="border:1px solid var(--border);border-radius:14px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:16px"><div style="font-family:'Bebas Neue',sans-serif;font-size:30px;line-height:1;color:${color}">${v}</div><div style="font-size:11px;letter-spacing:.8px;text-transform:uppercase;color:var(--text-muted);font-weight:700;margin-top:6px">${k}</div></div>`;
  const t = p.totals || {};
  const head = `<div class="rise page-hpad" style="display:flex;align-items:center;gap:18px;padding:32px 44px 20px;flex-wrap:wrap">
    <button data-back="1" style="display:grid;place-items:center;width:32px;height:32px;border-radius:9px;border:1px solid var(--border);background:var(--surface);color:var(--text-muted);flex:none;cursor:pointer">${icBack(14)}</button>
    <div style="display:grid;place-items:center;width:56px;height:56px;border-radius:16px;background:linear-gradient(135deg,#22D3EE,#7C82FF);font-family:'Bebas Neue',sans-serif;font-size:26px;color:#04222a;flex:none">${escHtml(p.name).charAt(0).toUpperCase()}</div>
    <div style="min-width:0">
      <h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(28px,4vw,40px);letter-spacing:1px;margin:0;line-height:1">${escHtml(p.name)}</h1>
      <div style="font-size:12.5px;color:var(--text-muted);margin-top:5px">${[p.club, p.city].filter(Boolean).map((v: string) => escHtml(v)).join(" · ") || "Aucune info de club ou de ville"}</div>
    </div>
  </div>`;
  const stats = `<div class="page-hpad" style="padding:0 44px;display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px">
    ${stat(t.points ?? 0, "Points cumulés", "#22D3EE")}${stat(`${t.wins ?? 0}-${t.losses ?? 0}`, "Victoires-Défaites")}${stat(`${t.winrate ?? 0}%`, "Winrate", "#34D399")}${stat(t.tournamentsPlayed ?? 0, "Tournois joués")}${stat(t.championships ?? 0, "Titres", "#FBBF24")}
  </div>`;
  const byGame: Detail[] = p.byGame || [];
  const gameRows = byGame.length ? `<div style="border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));overflow:hidden">
    <table style="width:100%;border-collapse:collapse;font-size:13.5px"><tr><th style="text-align:left;padding:10px 16px;font-size:10.5px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted)">Jeu</th><th style="text-align:right;padding:10px 16px;font-size:10.5px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted)">V-D</th><th style="text-align:right;padding:10px 16px;font-size:10.5px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted)">Titres</th><th style="text-align:right;padding:10px 16px;font-size:10.5px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted)">Points</th></tr>
    ${byGame.map((g) => `<tr style="border-top:1px solid var(--surface-3)"><td style="padding:10px 16px;font-weight:650">${escHtml(g.game)}</td><td style="padding:10px 16px;text-align:right;color:var(--text-muted)">${g.wins}-${g.losses}</td><td style="padding:10px 16px;text-align:right;color:#FBBF24">${g.championships || 0}</td><td style="padding:10px 16px;text-align:right;font-weight:750;color:#22D3EE">${g.points}</td></tr>`).join("")}</table>
  </div>` : "";
  const history: Detail[] = p.history || [];
  const historyList = history.length ? `<div style="display:flex;flex-direction:column;gap:2px">
    ${history.map((h) => `<div style="display:flex;align-items:center;gap:10px;padding:10px 4px;border-top:1px solid var(--surface-3)">
      <span style="font-size:10px;font-weight:800;letter-spacing:.5px;color:${h.won ? "#34D399" : "#FB7185"};background:${h.won ? "rgba(52,211,153,.1)" : "rgba(251,113,133,.1)"};border:1px solid ${h.won ? "rgba(52,211,153,.35)" : "rgba(251,113,133,.35)"};border-radius:6px;padding:3px 7px;flex:none">${h.won ? "V" : "D"}</span>
      <span style="font-size:13px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">contre ${escHtml(h.opponent)}</span>
      ${h.sa !== null && h.sb !== null ? `<span style="font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--text-muted);flex:none">${h.sa}–${h.sb}</span>` : ""}
      <span style="font-size:11.5px;color:var(--text-faint);flex:none;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(h.tournamentName)}</span>
    </div>`).join("")}
  </div>` : `<div style="color:var(--text-faint);font-size:13px;text-align:center;padding:16px 0">Aucun match joué pour l'instant.</div>`;

  const h2h = S.h2hData;
  const h2hBody = S.h2hBusy ? `<div style="color:var(--text-faint);font-size:13px;text-align:center;padding:12px 0">Recherche…</div>`
    : h2h ? (h2h.aWins + h2h.bWins === 0
      ? `<div style="color:var(--text-faint);font-size:13px;text-align:center;padding:12px 0">${escHtml(p.name)} et ${escHtml(h2h.b)} ne se sont jamais affrontés.</div>`
      : `<div style="text-align:center;margin:10px 0 14px"><span style="font-family:'Bebas Neue',sans-serif;font-size:34px;letter-spacing:1px">${h2h.aWins}<span style="color:var(--text-faint);font-size:22px"> – </span>${h2h.bWins}</span><div style="font-size:11.5px;color:var(--text-muted);margin-top:2px">${escHtml(p.name)} vs ${escHtml(h2h.b)}</div></div>
        <div style="display:flex;flex-direction:column;gap:2px">${h2h.matches.slice(0, 10).map((m: Detail) => `<div style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-top:1px solid var(--surface-3)">
          <span style="font-size:10px;font-weight:800;color:${m.winner === "a" ? "#34D399" : "#FB7185"}">${m.winner === "a" ? escHtml(p.name) : escHtml(h2h.b)}</span>
          ${m.sa !== null && m.sb !== null ? `<span style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text-muted)">${m.sa}–${m.sb}</span>` : ""}
          <span style="flex:1"></span><span style="font-size:11px;color:var(--text-faint)">${escHtml(m.tournamentName)}</span></div>`).join("")}</div>`)
    : "";
  const h2hCard = `<div style="border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:18px">
    <div style="font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-muted);font-weight:800;margin-bottom:12px">Confrontations directes</div>
    <div style="display:flex;gap:8px"><input id="h2h-opponent" value="${escAttr(S.h2hOpponent)}" placeholder="Nom de l'adversaire" style="flex:1;background:var(--surface-3);border:1px solid var(--border);border-radius:9px;color:var(--text);font-family:inherit;font-size:13px;padding:9px 12px" /><button data-h2h="${escAttr(p.name)}" style="background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:9px;padding:9px 16px;font-weight:750;font-size:13px;cursor:pointer">Comparer</button></div>
    ${h2hBody}
  </div>`;

  return `${head}<div class="rise d2 page-hpad" style="padding:20px 44px 44px;display:flex;flex-direction:column;gap:22px">
    ${stats}
    <div class="grid2c" style="display:grid;grid-template-columns:1fr 320px;gap:22px;align-items:start">
      <div style="display:flex;flex-direction:column;gap:22px">
        ${gameRows}
        <div>
          <div style="font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-muted);font-weight:800;margin-bottom:8px">Matchs récents</div>
          ${historyList}
        </div>
      </div>
      ${h2hCard}
    </div>
  </div>`;
}

function pGalerie(S: State) {
  const all: Detail[] = S.gallery ?? [];
  const tournFilters = Array.from(
    new Map(all.filter((it) => it.tournament).map((it: Detail) => [it.tournament.id, it.tournament.name])).entries()
  );
  const count = all.length;
  if (!count) {
    const head = railPageHead("Galerie", "Photos et vidéos des tournois, LAN et remises de prix Miabe");
    return `${head}<div class="rise d1" style="margin:0 44px 40px;border:1px solid var(--border);border-radius:18px;background:var(--surface);padding:64px 24px;text-align:center;color:var(--text-muted)">
      <div style="display:grid;place-items:center;width:64px;height:64px;border-radius:18px;background:var(--surface-3);border:1px solid var(--border-strong);color:#7C82FF;margin:0 auto 16px">${ic(I.image, 28)}</div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:1px;color:var(--text);margin-bottom:6px">Galerie vide pour l'instant</div>
      Reviens après le prochain événement pour revivre les meilleurs moments !</div>`;
  }
  const albums: Detail[] = S.albums ?? [];
  const openAlbum = S.albumOpen ? albums.find((a: Detail) => a.id === S.albumOpen) : null;
  // Catalogue ouvert : on ne montre que ses médias. Sinon, seuls les médias hors catalogue —
  // un média catalogué ne doit jamais apparaître avant d'être entré dans son catalogue.
  let items = openAlbum ? all.filter((it) => it.albumId === openAlbum.id) : all.filter((it) => !it.albumId);
  if (S.galleryFilter) items = items.filter((it) => it.tournament?.id === S.galleryFilter);
  if (S.galleryType === "video") items = items.filter((it) => it.mediaType === "video");
  else if (S.galleryType === "image") items = items.filter((it) => it.mediaType !== "video");

  const eventRow = (id: string, label: string, n: number) => {
    const on = S.galleryFilter === id;
    return `<div data-gfilter="${id}" style="display:flex;align-items:center;justify-content:space-between;padding:9px 11px;border-radius:8px;cursor:pointer;transition:background .2s ease,color .2s ease;background:${on ? "rgba(124,130,255,.14)" : "transparent"};color:${on ? "var(--text)" : "var(--text-muted)"};font-size:13px;font-weight:${on ? 700 : 600}">${escHtml(label)} <span style="font-family:'JetBrains Mono',monospace;font-size:11.5px;color:${on ? "#7C82FF" : "var(--text-faint)"}">${n}</span></div>`;
  };
  const typeChip = (v: "" | "image" | "video", label: string) => {
    const on = S.galleryType === v;
    return `<span data-gtype="${v}" class="chip" style="font-size:12px;font-weight:${on ? 700 : 600};color:${on ? "#7C82FF" : "var(--text-muted)"};background:${on ? "rgba(124,130,255,.1)" : "transparent"};border:1px solid ${on ? "#7C82FF" : "var(--border)"};border-radius:99px;padding:6px 12px;cursor:pointer;transition:background .2s ease,color .2s ease,border-color .2s ease">${label}</span>`;
  };
  const rail = `<div class="rise d1 page-filter-rail" style="width:220px;flex:none;border-right:1px solid var(--surface-3);padding:32px 20px">
    <div style="font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-faint);font-weight:800;margin-bottom:14px">Événements</div>
    <div style="display:flex;flex-direction:column;gap:2px">${eventRow("", "Tous", all.length)}${tournFilters.map(([id, name]) => eventRow(id as string, name as string, all.filter((it) => it.tournament?.id === id).length)).join("")}</div>
    <div style="margin-top:24px;padding-top:18px;border-top:1px solid var(--surface-3)">
      <div style="font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-faint);font-weight:800;margin-bottom:12px">Type</div>
      <div style="display:flex;gap:7px;flex-wrap:wrap">${typeChip("", "Tout")}${typeChip("image", "Photos")}${typeChip("video", "Vidéos")}</div>
    </div>
  </div>`;

  // Mosaïque à hauteurs variables : quelques tuiles plus grandes selon un rythme fixe, plutôt qu'une grille uniforme.
  const SPANS = ["grid-column:span 2;grid-row:span 2", "", "", "grid-column:span 2", "grid-row:span 2", ""];
  const card = (it: Detail, i: number) => {
    const media = it.mediaType === "video"
      ? `<video class="zoom" src="${mediaUrl(it.mediaUrl)}" muted loop playsinline onmouseover="this.play()" onmouseout="this.pause()" style="width:100%;height:100%;object-fit:cover"></video>`
      : `<div class="zoom" style="width:100%;height:100%;background-image:url('${mediaUrl(it.mediaUrl)}');background-size:cover;background-position:center"></div>`;
    return `<div data-gopen="${it.id}" class="hcard" style="${SPANS[i % SPANS.length]};cursor:pointer;border-radius:12px;overflow:hidden;background:var(--surface);position:relative">
      <div style="position:absolute;inset:0">${media}</div>
      <div style="position:absolute;inset:0;background:linear-gradient(180deg,transparent 50%,rgba(11,11,17,.9));pointer-events:none"></div>
      ${it.mediaType === "video" ? `<span style="position:absolute;top:10px;right:10px;display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:rgba(11,11,17,.7);border:1px solid rgba(255,255,255,.2);color:#fff">${ic(I.tv, 13)}</span>` : ""}
      <div style="position:absolute;left:12px;right:12px;bottom:11px"><div style="font-weight:700;font-size:13.5px;color:#fff;line-height:1.3">${escHtml(it.title)}</div>${it.tournament ? `<div style="font-size:11.5px;color:#22D3EE;font-weight:700;margin-top:3px">${escHtml(it.tournament.name)}</div>` : ""}</div></div>`;
  };
  // Message contextuel : "aucun média ne correspond à ce filtre" n'a de sens que si un filtre
  // (événement/type) est vraiment actif — sinon (ex. tout est rangé dans des catalogues) le message
  // générique induit en erreur puisqu'il n'y a pas de champ de recherche à l'origine du filtre.
  const emptyMsg = openAlbum
    ? "Ce catalogue est vide."
    : S.galleryFilter || S.galleryType
      ? "Aucun média ne correspond à ce filtre."
      : albums.length
        ? "Tous les médias sont rangés dans un catalogue — ouvre-en un ci-dessus pour les voir."
        : "Aucun média pour l'instant.";
  const grid = items.length
    ? `<div class="rise d2 gallery-grid" style="padding:0 40px 40px;display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:150px;gap:12px">${items.map(card).join("")}</div>`
    : `<div class="rise d2" style="margin:0 40px 40px;border:1px solid var(--border);border-radius:16px;background:var(--surface);padding:48px 24px;text-align:center;color:var(--text-muted)">${emptyMsg}</div>`;
  // Bandeau des catalogues (masqué quand on est déjà à l'intérieur de l'un d'eux).
  const albumStrip = !openAlbum && albums.length ? `<div class="rise d1" style="padding:0 40px 24px">
    <div style="font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-faint);font-weight:800;margin-bottom:12px">Catalogues</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px">${albums.map((a: Detail) => `
      <div data-albumopen="${a.id}" class="hcard" style="cursor:pointer;border:1px solid var(--border);border-radius:14px;overflow:hidden;background:var(--surface)">
        <div style="height:118px;position:relative;overflow:hidden">
          <div class="zoom" style="position:absolute;inset:0;background:${a.coverUrl ? `url('${mediaUrl(a.coverUrl)}') center/cover` : "var(--surface-3)"}"></div>
          <div style="position:absolute;inset:0;background:linear-gradient(180deg,transparent 55%,rgba(11,11,17,.85))"></div>
          ${!a.coverUrl ? `<span style="position:absolute;inset:0;display:grid;place-items:center;color:var(--border-strong)">${ic(I.image, 26)}</span>` : ""}
        </div>
        <div style="padding:11px 12px">
          <div style="font-size:13.5px;font-weight:700;line-height:1.3">${escHtml(a.title)}</div>
          <div style="font-size:11.5px;color:#7C82FF;font-weight:700;margin-top:3px">${a.count} média${a.count > 1 ? "s" : ""}</div>
        </div>
      </div>`).join("")}</div>
  </div>` : "";
  const header = openAlbum
    ? `<div class="rise d1" style="padding:32px 40px 22px">
        <button data-albumback="1" style="display:inline-flex;align-items:center;gap:7px;background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:10px;padding:9px 14px;font-weight:700;font-size:13px;cursor:pointer;margin-bottom:14px">${icBack(15)}Tous les catalogues</button>
        <h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(34px,4vw,50px);letter-spacing:1.5px;margin:0;line-height:.92">${escHtml(openAlbum.title)}</h1>
        <p style="color:var(--text-muted);font-size:14px;margin:8px 0 0">${openAlbum.description ? escHtml(openAlbum.description) + " · " : ""}${openAlbum.count} média${openAlbum.count > 1 ? "s" : ""}</p>
      </div>`
    : `<div class="rise d1" style="display:flex;align-items:flex-end;gap:20px;padding:32px 40px 22px"><div><h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(38px,4.5vw,56px);letter-spacing:1.5px;margin:0;line-height:.92">Galerie</h1><p style="color:var(--text-muted);font-size:14px;margin:8px 0 0">${count} photo${count > 1 ? "s" : ""} et vidéo${count > 1 ? "s" : ""} des tournois, LAN et remises de prix Miabe</p></div></div>`;
  const content = `<div style="flex:1;min-width:0">
    ${header}
    ${albumStrip}
    ${grid}
  </div>`;
  return `<div style="display:flex;flex-wrap:wrap">${rail}${content}</div>${galleryLightbox(S, items)}`;
}

/** Visionneuse plein écran (photo/vidéo, navigation précédent/suivant). */
function galleryLightbox(S: State, items: Detail[]) {
  if (!S.galleryOpen) return "";
  const idx = items.findIndex((it) => it.id === S.galleryOpen);
  const it = items[idx];
  if (!it) return "";
  const media = it.mediaType === "video"
    ? `<video src="${mediaUrl(it.mediaUrl)}" controls autoplay style="max-width:100%;max-height:78vh;border-radius:12px"></video>`
    : `<img src="${mediaUrl(it.mediaUrl)}" alt="${escAttr(it.title)}" style="max-width:100%;max-height:78vh;border-radius:12px;object-fit:contain" />`;
  const nav = (dir: "prev" | "next", disabled: boolean) => `<button data-g${dir}="1" ${disabled ? "disabled" : ""} style="display:grid;place-items:center;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);color:${disabled ? "var(--border-strong)" : "var(--text)"};cursor:${disabled ? "default" : "pointer"};flex:none;transform:${dir === "prev" ? "scaleX(-1)" : "none"}">${ic(I.arrow, 18)}</button>`;
  return `<div data-gclose="1" style="position:fixed;inset:0;z-index:250;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;background:rgba(6,6,10,.92);backdrop-filter:blur(8px)">
    <div data-stop="1" style="display:flex;align-items:center;gap:16px;max-width:1100px;width:100%">
      ${nav("prev", idx <= 0)}
      <div style="flex:1;min-width:0;text-align:center">
        ${media}
        <div style="margin-top:14px"><div style="font-weight:700;font-size:16px;color:#fff">${escHtml(it.title)}</div>${it.tournament ? `<div style="font-size:12.5px;color:#22D3EE;font-weight:700;margin-top:4px">${escHtml(it.tournament.name)}</div>` : ""}<div style="font-size:11.5px;color:var(--text-faint);margin-top:6px">${idx + 1} / ${items.length}</div></div>
      </div>
      ${nav("next", idx >= items.length - 1)}
    </div>
    <button data-gclose="1" style="position:absolute;top:20px;right:24px;display:grid;place-items:center;width:38px;height:38px;border-radius:10px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);color:var(--text);cursor:pointer">${ic(I.x, 18)}</button>
  </div>`;
}

function pBoutique(S: State) {
  const source = S.products ?? [];
  let list = S.cat === "Tous" ? source : source.filter((p) => p.cat === S.cat);
  if (S.boutiqueInStock) list = list.filter((p) => (p.stock ?? 0) > 0);
  const pImg = (p: { ph: string; img?: string | null }, ratio = "1/1") => p.img
    ? `<div class="zoom" style="aspect-ratio:${ratio};background-color:#fff;background-image:url('${mediaUrl(p.img)}');background-size:cover;background-position:center"></div>`
    : `<div class="zoom" style="aspect-ratio:${ratio};background:repeating-linear-gradient(45deg,var(--surface-6),var(--surface-6) 13px,var(--surface) 13px,var(--surface) 26px);display:grid;place-items:center;color:var(--text-faint);font-family:monospace;font-size:11px;letter-spacing:1px">// ${p.ph}</div>`;
  const addBtn = (p: typeof source[number], cls = "") => `<button ${cls ? `class="${cls}"` : ""} data-add-name="${escAttr(p.name)}" data-add-price="${p.price}" data-add-id="${p.id}" style="display:inline-flex;align-items:center;justify-content:center;gap:6px;background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:9px;padding:9px 12px;font-weight:700;font-size:12.5px;cursor:pointer">${ic(I.plus, 14)}Ajouter</button>`;
  const productCard = (p: typeof source[number]) => {
    const out = (p.stock ?? 0) <= 0;
    return `<div data-prodopen="${p.id}" class="${out ? "" : "hcard"}" style="cursor:pointer;border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--surface);display:flex;flex-direction:column;${out ? "opacity:.6" : ""}">
      <div style="position:relative">${pImg(p)}${out ? `<span style="position:absolute;top:8px;left:8px;font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#FB7185;background:rgba(11,11,17,.75);border:1px solid rgba(251,113,133,.4);border-radius:99px;padding:3px 8px">Rupture</span>` : ""}${p.loyaltyEligible ? `<span title="Réduction possible avec les points fidélité" style="position:absolute;top:8px;right:8px;font-size:9.5px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:#04222a;background:#22D3EE;border-radius:99px;padding:3px 8px">Points</span>` : ""}</div>
      <div class="shop-body" style="padding:14px 15px 16px;display:flex;flex-direction:column;flex:1">
        <span style="font-size:11px;color:#7C82FF;font-weight:700">${escHtml(p.cat)}</span>
        <div class="shop-name" style="font-weight:650;font-size:15px;margin:4px 0;line-height:1.3;flex:1">${escHtml(p.name)}</div>
        <div style="font-size:11.5px;margin-bottom:9px">${p.stock !== undefined ? (out ? `<span style="color:#FB7185;font-weight:700">épuisé</span>` : `<span style="color:#34D399;font-weight:700">${p.stock} en stock</span>`) : ""}</div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap">
          <span class="shop-price" style="font-weight:800;color:${out ? "var(--text-muted)" : "#22D3EE"};font-size:16px;font-family:'JetBrains Mono',monospace">${money(p.price)}</span>
          ${out ? "" : addBtn(p, "shop-buy")}
        </div>
      </div>
    </div>`;
  };
  const grid = list.length
    ? `<div class="rise d2 shop-grid">${list.map(productCard).join("")}</div>`
    : `<div class="rise d2" style="margin:0 40px 40px;border:1px solid var(--border);border-radius:16px;background:var(--surface);padding:48px 24px;text-align:center;color:var(--text-muted)">${source.length === 0 ? "Aucun produit pour l'instant." : "Aucun produit ne correspond à ces filtres."}</div>`;

  // Filtres en haut de page : sélecteur de catégorie + disponibilité (plus de rail latéral).
  const availChip = (v: boolean, label: string) => {
    const on = S.boutiqueInStock === v;
    return `<span data-instock="${v ? 1 : 0}" class="chip" style="font-size:12.5px;font-weight:${on ? 700 : 600};color:${on ? "#FBBF24" : "var(--text-muted)"};background:${on ? "rgba(251,191,36,.1)" : "transparent"};border:1px solid ${on ? "#FBBF24" : "var(--border)"};border-radius:99px;padding:8px 14px;cursor:pointer">${label}</span>`;
  };
  const catOpt = (v: string, label: string, n: number) => `<option value="${v}" ${S.cat === v ? "selected" : ""}>${label} (${n})</option>`;
  const filters = `<div class="rise d1 shop-filters" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:0 40px 20px">
    <select id="shop-cat" style="background:var(--surface);border:1px solid var(--border-strong);color:var(--text);border-radius:10px;padding:10px 14px;font-family:inherit;font-size:13.5px;font-weight:650;min-width:190px;cursor:pointer">${catOpt("Tous", "Toutes les catégories", source.length)}${CATS.filter((c) => c !== "Tous").map((c) => catOpt(c, c, source.filter((p) => p.cat === c).length)).join("")}</select>
    <div style="display:flex;gap:7px">${availChip(true, "En stock")}${availChip(false, "Tout")}</div>
  </div>`;

  const head = `<div class="rise shop-head" style="display:flex;align-items:flex-end;gap:20px;padding:32px 40px 22px;flex-wrap:wrap">
    <div><h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(38px,4.5vw,56px);letter-spacing:1.5px;margin:0;line-height:.92">Boutique</h1><p style="color:var(--text-muted);font-size:14px;margin:8px 0 0">Maillots, goodies, billets et cartes cadeaux — paiement mobile money &amp; carte</p></div>
    <span style="flex:1"></span>
    <button data-cart-open="1" style="display:inline-flex;align-items:center;gap:9px;background:#FBBF24;border:0;color:#0b0b11;border-radius:10px;padding:11px 17px;font-weight:750;font-size:13.5px;cursor:pointer">${ic(I.cart, 17)}Panier · <span style="font-family:'JetBrains Mono',monospace">${S.cartItems.length}</span></button>
  </div>`;

  // Fiche produit (au clic sur une carte).
  const open = S.productOpen ? source.find((p) => p.id === S.productOpen) : null;
  let modal = "";
  if (open) {
    const out = (open.stock ?? 0) <= 0;
    modal = `<div data-prodclose="1" style="position:fixed;inset:0;z-index:260;display:grid;place-items:center;padding:16px;background:rgba(6,6,10,.8);backdrop-filter:blur(6px);overflow-y:auto">
      <div data-stop="1" style="width:min(520px,100%);max-height:94vh;overflow-y:auto;background:var(--surface-2);border:1px solid var(--border);border-radius:18px">
        <div style="position:relative">${pImg(open, "4/3")}<button data-prodclose="1" style="position:absolute;top:10px;right:10px;display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:rgba(11,11,17,.75);border:1px solid rgba(255,255,255,.18);color:#fff;cursor:pointer">${ic(I.x, 16)}</button></div>
        <div style="padding:18px 20px 22px">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span style="font-size:11.5px;color:#7C82FF;font-weight:700">${escHtml(open.cat)}</span>${open.loyaltyEligible ? `<span style="font-size:9.5px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:#04222a;background:#22D3EE;border-radius:99px;padding:3px 8px">Points fidélité</span>` : ""}</div>
          <h2 style="font-family:'Bebas Neue',sans-serif;font-size:30px;letter-spacing:1px;margin:6px 0 8px;line-height:1.05">${escHtml(open.name)}</h2>
          <div style="font-size:13px;margin-bottom:14px">${open.stock !== undefined ? (out ? `<span style="color:#FB7185;font-weight:700">Épuisé</span>` : `<span style="color:#34D399;font-weight:700">${open.stock} en stock</span>`) : ""}</div>
          ${open.description ? `<p style="font-size:14px;color:var(--text);line-height:1.65;margin:0 0 16px;white-space:pre-line">${escHtml(open.description)}</p>` : ""}
          ${open.loyaltyEligible ? `<p style="font-size:12.5px;color:var(--text-muted);line-height:1.6;margin:0 0 16px">Une partie du prix peut être réglée avec tes points fidélité au moment du paiement.</p>` : ""}
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
            <span style="font-weight:800;color:${out ? "var(--text-muted)" : "#22D3EE"};font-size:24px;font-family:'JetBrains Mono',monospace">${money(open.price)}</span>
            ${out ? `<span style="border:1px solid var(--border);color:var(--text-faint);border-radius:10px;padding:11px 18px;font-weight:700;font-size:13.5px">Épuisé</span>` : `<button data-add-name="${escAttr(open.name)}" data-add-price="${open.price}" data-add-id="${open.id}" style="display:inline-flex;align-items:center;gap:8px;background:#FBBF24;border:0;color:#0b0b11;border-radius:10px;padding:12px 20px;font-weight:750;font-size:14px;cursor:pointer">${ic(I.cart, 16)}Ajouter au panier</button>`}
          </div>
        </div>
      </div></div>`;
  }

  return `<div>${head}${filters}${grid}</div>${modal}`;
}

const canManage = (S: State) => !!S.user && (S.user.role === "ORGANIZER" || S.user.role === "ADMIN");
const ROLE_LABEL: Record<string, string> = { PLAYER: "Joueur", ORGANIZER: "Organisateur", ADMIN: "Administrateur" };
const ROLE_COLOR: Record<string, string> = { PLAYER: "#22D3EE", ORGANIZER: "#7C82FF", ADMIN: "#FBBF24" };
const card = (inner: string, pad = "20px") => `<div style="border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:${pad}">${inner}</div>`;

function pDashboard(S: State) {
  const wrap = (inner: string) => `<main class="rise" style="width:100%;padding:28px clamp(22px,3vw,64px) 60px">${inner}</main>`;
  if (!S.user) {
    return wrap(`<div style="border:1px solid var(--border);border-radius:18px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:56px 24px;text-align:center">
      <div style="display:grid;place-items:center;width:64px;height:64px;border-radius:18px;background:var(--surface-3);border:1px solid var(--border-strong);color:#22D3EE;margin:0 auto 16px">${ic(I.user, 28)}</div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:30px;letter-spacing:1px;margin-bottom:8px">Espace membre</div>
      <p style="color:var(--text-muted);font-size:14px;max-width:420px;margin:0 auto 22px">Connecte-toi ou crée un compte pour accéder à ton tableau de bord.</p>
      <button data-auth-open="1" style="background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:13px 24px;font-weight:750;font-size:15px;cursor:pointer;box-shadow:0 0 30px rgba(34,211,238,.22)">Se connecter / S'inscrire</button></div>`);
  }
  const u = S.user;
  const me = S.me;
  const rc = ROLE_COLOR[u.role] || "#22D3EE";
  const sub: string[] = [];
  if (me?.city) sub.push(me.city);
  if (me?.clubName) sub.push(`@${me.clubName}`);
  if (me?.favoriteGame) sub.push(me.favoriteGame);
  const header = `<div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;margin-bottom:24px">
    <div style="display:grid;place-items:center;width:78px;height:78px;border-radius:20px;background:linear-gradient(135deg,#22D3EE,#7C82FF);font-family:'Bebas Neue',sans-serif;font-size:36px;color:#04222a;box-shadow:0 0 30px rgba(34,211,238,.3);flex:none">${(u.displayName || "?").charAt(0).toUpperCase()}</div>
    <div style="min-width:0"><h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(28px,4vw,44px);letter-spacing:1px;margin:0;line-height:1">${u.displayName}</h1>
      <div style="color:var(--text-muted);font-size:13.5px;margin-top:5px">${u.email}${sub.length ? " · " + sub.join(" · ") : ""}</div>
      ${me?.bio ? `<div style="color:var(--text-muted);font-size:13px;margin-top:6px;max-width:560px">${(me.bio as string).replace(/</g, "&lt;")}</div>` : ""}
      <span style="display:inline-block;margin-top:10px;font-size:12px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:${rc};background:${rc}18;border:1px solid ${rc}66;border-radius:999px;padding:6px 12px">${ROLE_LABEL[u.role] || u.role}</span></div>
    <div style="flex:1"></div>
    <button data-profileedit="1" style="display:inline-flex;align-items:center;gap:7px;background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:11px;padding:11px 16px;font-weight:700;font-size:13.5px;cursor:pointer">${ic(I.edit, 15)}Modifier le profil</button>
    <button data-logout="1" style="display:inline-flex;align-items:center;gap:7px;background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:11px;padding:11px 16px;font-weight:700;font-size:13.5px;cursor:pointer">${ic(I.logout, 15)}Déconnexion</button>
  </div>`;
  if (!me) return wrap(header + card(`<div style="color:var(--text-muted);text-align:center;padding:22px">Chargement du profil…</div>`));
  const statTiles = memberStats(S);
  const editor = S.profileEdit ? profileEditor(S) : "";
  // ADMIN/ORGANIZER passent par la console (sidebar) — voir renderPage(). Cette page ne sert plus qu'aux PLAYER.
  const body = grid2(regsCard(S), resultsCard(S)) + grid2(ordersCard(S), profileSecurity(S));
  return wrap(header + editor + nextMatchCard(S) + statTiles + statsByGameCard(me) + body + loyaltyCard(S));
}

/** Répartition des points/victoires par jeu — tout ce à quoi le joueur est rattaché sur le
 * site, jeu par jeu, pas seulement un total global. Partagée avec la fiche admin d'un joueur. */
function statsByGameCard(me: Detail) {
  const byGame: Detail[] = me?.stats?.byGame ?? [];
  if (!byGame.length) return "";
  const rows = byGame.map((g: Detail) => `<div style="display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid var(--surface-4)">
      <div style="min-width:0;flex:1;font-weight:650;font-size:14px">${escHtml(g.game)}</div>
      <span style="font-size:12px;color:var(--text-muted)">${g.tournamentsPlayed} tournoi${g.tournamentsPlayed > 1 ? "s" : ""}</span>
      <span style="font-size:12px;color:var(--text-muted)">${g.wins} V</span>
      ${g.championships ? `<span style="font-size:11px;font-weight:800;color:#FBBF24">${ic(I.crown, 11)} ${g.championships}</span>` : ""}
      <span style="font-weight:800;color:#22D3EE;font-size:14px;font-family:'JetBrains Mono',monospace">${g.points} pts</span>
    </div>`).join("");
  return `<div style="margin-bottom:16px">${card(secTitle(`Stats par jeu (${byGame.length})`) + rows)}</div>`;
}

/** Solde + historique des points fidélité (gagnés par participation, dépensés en boutique ou sur des frais d'inscription). */
function loyaltyCard(S: State) {
  const balance = S.me?.loyaltyPoints ?? 0;
  const history: Detail[] = S.loyaltyHistory ?? [];
  const reasonLabel: Record<string, string> = {
    PARTICIPATION: "Participation à un tournoi", ORDER_REDEMPTION: "Dépensé en boutique",
    REGISTRATION_REDEMPTION: "Dépensé sur une inscription", ADMIN_ADJUST: "Ajustement", REFUND: "Remboursement",
  };
  const rows = history.length ? history.map((h) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-top:1px solid var(--surface-4)">
      <div><div style="font-size:13.5px;font-weight:600">${reasonLabel[h.reason] || h.reason}${h.note ? ` · ${escHtml(h.note)}` : ""}</div><div style="font-size:11.5px;color:var(--text-faint)">${new Date(h.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}</div></div>
      <span style="font-family:'JetBrains Mono',monospace;font-weight:800;font-size:14px;color:${h.amount > 0 ? "#34D399" : "#FB7185"};flex:none">${h.amount > 0 ? "+" : ""}${h.amount}</span>
    </div>`).join("") : `<div style="color:var(--text-faint);font-size:13.5px;text-align:center;padding:20px 0">Aucun mouvement pour l'instant. Inscris-toi à un tournoi pour gagner ton premier point !</div>`;
  return card(`<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px">
    ${secTitle("Points fidélité")}
    <span style="font-family:'Bebas Neue',sans-serif;font-size:28px;color:#22D3EE">${balance} pt${balance > 1 ? "s" : ""}</span>
  </div>${scrollBox(rows, 320)}`);
}

/** Onglet Crédits de l'espace organisateur : quota gratuit, solde, achat, historique. */
function organizerCredits(S: State) {
  const c = S.creditsMe;
  if (!c) return card(`<div style="color:var(--text-muted);text-align:center;padding:30px 0">Chargement…</div>`);
  const freeLeft = Math.max(0, c.freeTournaments - c.freeTournamentsUsed);
  const canHostFree = freeLeft > 0;
  const summary = card(`
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
      ${secTitle("Crédits organisateur")}
      <span style="font-family:'Bebas Neue',sans-serif;font-size:28px;color:#22D3EE">${c.balance} crédit${c.balance > 1 ? "s" : ""}</span>
    </div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      ${canHostFree
        ? `<span style="display:inline-flex;align-items:center;gap:7px;color:#34D399;font-weight:700;font-size:13px;background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.35);border-radius:99px;padding:6px 13px">${ic(I.crown, 14)}${freeLeft} tournoi${freeLeft > 1 ? "s" : ""} gratuit${freeLeft > 1 ? "s" : ""} restant${freeLeft > 1 ? "s" : ""}</span>`
        : c.balance > 0
          ? `<span style="display:inline-flex;align-items:center;gap:7px;color:#22D3EE;font-weight:700;font-size:13px;background:rgba(34,211,238,.08);border:1px solid rgba(34,211,238,.35);border-radius:99px;padding:6px 13px">${ic(I.bolt, 14)}Tu peux créer ${c.balance} tournoi${c.balance > 1 ? "s" : ""} de plus</span>`
          : `<span style="display:inline-flex;align-items:center;gap:7px;color:#FBBF24;font-weight:700;font-size:13px;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.35);border-radius:99px;padding:6px 13px">${ic(I.warn, 14)}Quota gratuit épuisé — achète du crédit pour héberger un nouveau tournoi</span>`}
    </div>
    <p style="color:var(--text-faint);font-size:12.5px;line-height:1.6;margin:12px 0 0">1 crédit = 1 tournoi hébergé, au tarif de ${money(c.priceXof)}. Si tu supprimes un tournoi jamais lancé, le crédit dépensé t'est automatiquement rendu.</p>
  `);
  const qty = Math.max(1, S.creditBuyQty || 1);
  const total = qty * c.priceXof;
  const payChips = payMethods(S).map((m) => `<button data-creditbuypay="${m}" style="font-size:12px;font-weight:700;border-radius:9px;padding:8px 12px;cursor:pointer;background:${S.creditBuyPay === m ? "rgba(34,211,238,.1)" : "var(--surface-3)"};border:1px solid ${S.creditBuyPay === m ? "#22D3EE" : "var(--border)"};color:${S.creditBuyPay === m ? "#22D3EE" : "var(--text-muted)"}">${m}</button>`).join("");
  const canBuy = (onlinePayOn(S) || !!S.creditBuyPay) && !S.creditBuyBusy;
  const buyCard = card(`
    ${secTitle("Acheter des crédits")}
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <button data-creditbuyqty="${Math.max(1, qty - 1)}" style="width:36px;height:36px;border-radius:9px;background:var(--surface-3);border:1px solid var(--border);color:var(--text);cursor:pointer;font-size:16px">−</button>
      <span style="min-width:60px;text-align:center;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:18px">${qty}</span>
      <button data-creditbuyqty="${qty + 1}" style="width:36px;height:36px;border-radius:9px;background:var(--surface-3);border:1px solid var(--border);color:var(--text);cursor:pointer;font-size:16px">+</button>
      <span style="flex:1;text-align:right;color:var(--text-muted);font-size:13px">Total : <b style="color:#22D3EE;font-family:'JetBrains Mono',monospace">${money(total)}</b></span>
    </div>
    ${onlinePayOn(S) ? "" : `<div style="color:var(--text-muted);font-size:12px;font-weight:700;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Moyen de paiement</div>
    <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:16px">${payChips}</div>`}
    <button ${onlinePayOn(S) ? `data-payopen="credit"` : `data-creditbuy="1"`} ${canBuy ? "" : "disabled"} style="background:${canBuy ? "linear-gradient(135deg,#22D3EE,#12aec4)" : "var(--surface-4)"};color:${canBuy ? "#04222a" : "var(--text-faint)"};border:0;border-radius:12px;padding:12px 22px;font-weight:750;font-size:14px;cursor:${canBuy ? "pointer" : "default"}">${S.creditBuyBusy ? "Envoi…" : onlinePayOn(S) ? "Payer" : "Demander"}</button>
    <p style="color:var(--text-faint);font-size:12px;margin:12px 0 0">${onlinePayOn(S) ? "Tes crédits sont ajoutés dès que le paiement est confirmé." : "Pas de paiement en ligne : l'équipe Miabe te contacte pour confirmer, puis crédite ton compte."}</p>
  `);
  const pendingPurchases = (c.purchases ?? []).filter((p: Detail) => p.status === "pending");
  const pendingCard = pendingPurchases.length ? card(`${secTitle("Demandes en attente")}${pendingPurchases.map((p: Detail) => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-top:1px solid var(--surface-4)">
      <div><div style="font-size:13.5px;font-weight:600">${p.credits} crédit${p.credits > 1 ? "s" : ""} · ${escHtml(p.paymentMethod)}</div><div style="font-size:11.5px;color:var(--text-faint)">${money(p.amountXof)} · en attente de confirmation</div></div>
      <span style="display:flex;gap:8px;flex:none">${onlinePayOn(S) && ONLINE_PAY.includes(p.paymentMethod) ? `<button data-payretry="credit|${p.id}|${p.paymentMethod}" style="font-size:11.5px;font-weight:750;color:#04222a;background:#22D3EE;border:0;border-radius:8px;padding:6px 11px;cursor:pointer">Réessayer le paiement</button>` : ""}<button data-creditcancel="${p.id}" style="font-size:11.5px;font-weight:700;color:var(--text-muted);background:transparent;border:1px solid var(--border);border-radius:8px;padding:6px 11px;cursor:pointer">Annuler</button></span>
    </div>`).join("")}`) : "";
  const reasonLabel: Record<string, string> = {
    PURCHASE: "Achat de crédits", TOURNAMENT_HOST: "Tournoi hébergé", ADMIN_ADJUST: "Ajustement", REFUND: "Remboursement",
  };
  const history: Detail[] = c.history ?? [];
  const histRows = history.length ? history.map((h) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-top:1px solid var(--surface-4)">
      <div><div style="font-size:13.5px;font-weight:600">${reasonLabel[h.reason] || h.reason}${h.note ? ` · ${escHtml(h.note)}` : ""}</div><div style="font-size:11.5px;color:var(--text-faint)">${new Date(h.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}</div></div>
      <span style="font-family:'JetBrains Mono',monospace;font-weight:800;font-size:14px;color:${h.amount > 0 ? "#34D399" : "#FB7185"};flex:none">${h.amount > 0 ? "+" : ""}${h.amount}</span>
    </div>`).join("") : `<div style="color:var(--text-faint);font-size:13.5px;text-align:center;padding:20px 0">Aucun mouvement pour l'instant.</div>`;
  const historyCard = card(`${secTitle("Historique")}${scrollBox(histRows, 320)}`);
  return summary + `<div style="margin-top:16px">${grid2(buyCard, pendingCard || historyCard)}</div>${pendingCard ? historyCard : ""}`;
}

const grid2 = (a: string, b: string) => `<div class="grid2b" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">${a}${b}</div>`;

const secTitle = (t: string) => `<h3 style="margin:0 0 14px;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-muted);font-weight:750">${t}</h3>`;

function memberStats(S: State) {
  const me = S.me!;
  const since = me.createdAt ? new Date(me.createdAt).toLocaleDateString("fr-FR", { month: "short", year: "numeric" }) : "—";
  const stat = (v: string | number, k: string, color = "var(--text)") => `<div style="border:1px solid var(--border);border-radius:14px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:16px"><div style="font-family:'Bebas Neue',sans-serif;font-size:30px;line-height:1;color:${color}">${v}</div><div style="font-size:11px;letter-spacing:.8px;text-transform:uppercase;color:var(--text-muted);font-weight:700;margin-top:6px">${k}</div></div>`;
  const tiles = [
    stat(me.stats?.registrations ?? 0, "Inscriptions", "#22D3EE"),
    stat(me.stats?.totalPoints ?? 0, "Points cumulés (classement)", "#7C82FF"),
    stat(me.loyaltyPoints ?? 0, "Points fidélité (à dépenser)", "#22D3EE"),
    stat(me.stats?.totalWins ?? 0, "Victoires", "#34D399"),
    stat(me.stats?.championships ?? 0, "Titres remportés", "#FBBF24"),
    ...(me.role !== "PLAYER" ? [stat(me.stats?.tournaments ?? 0, "Tournois créés", "#FBBF24")] : []),
    stat(me.stats?.orders ?? 0, "Commandes"),
    stat(since, "Membre depuis"),
  ];
  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;margin-bottom:16px">${tiles.join("")}</div>`;
}

/** Historique des résultats réels (points/victoires/titre) calculés depuis les tournois joués. */
function resultsCard(S: State) {
  const results = S.myResults ?? [];
  const rows = results.length
    ? results.map((r: Detail) => `<div style="display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid var(--surface-4)">
        <span style="display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:var(--surface-3);border:1px solid var(--border);color:${r.champion ? "#FBBF24" : "#7C82FF"};flex:none">${ic(r.champion ? I.crown : I.medal, 15)}</span>
        <div style="min-width:0;flex:1"><div style="font-weight:650;font-size:14px">${escHtml(r.tournamentName)}</div><div style="font-size:12px;color:var(--text-faint)">${r.wins} victoire${r.wins > 1 ? "s" : ""}${r.champion ? " · Champion" : ""} · ${escHtml(r.status)}</div></div>
        <span style="font-weight:800;color:#22D3EE;font-size:14px">${r.points} pts</span></div>`).join("")
    : `<div style="color:var(--text-faint);font-size:13.5px;padding:16px 0;text-align:center">Pas encore de résultats. Participe à un tournoi pour voir tes stats ici !</div>`;
  return card(secTitle(`Mes résultats (${results.length})`) + rows);
}

function profileEditor(S: State) {
  const me = S.me!;
  const inp = "width:100%;background:var(--surface-3);border:1px solid var(--border);border-radius:11px;color:var(--text);font-family:inherit;font-size:14px;padding:11px 13px;margin-top:6px";
  const esc = (v: string | null | undefined) => (v || "").replace(/"/g, "&quot;");
  const nameLocked = !!me.nextNameChangeAt;
  const nameHelp = nameLocked
    ? `<span style="display:block;font-size:11px;color:#FBBF24;margin-top:5px">${ic(I.warn, 11)} Modifiable à nouveau le ${new Date(me.nextNameChangeAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}</span>`
    : `<span style="display:block;font-size:11px;color:var(--text-faint);margin-top:5px">Une fois par mois maximum</span>`;
  return `<div style="border:1px solid rgba(34,211,238,.3);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:20px;margin-bottom:16px">
    <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;margin-bottom:12px">Mon profil</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px">
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Nom affiché<input id="p-name" value="${esc(me.displayName)}" ${nameLocked ? "disabled" : ""} style="${inp};${nameLocked ? "opacity:.55;cursor:not-allowed" : ""}" />${nameHelp}</label>
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Club <span style="color:var(--text-faint)">(optionnel, modifiable librement)</span><input id="p-club" list="p-club-list" value="${esc(me.clubName)}" placeholder="Team 228" style="${inp}" /><datalist id="p-club-list">${(S.clubs ?? []).map((c: Detail) => `<option value="${escAttr(c.name)}">`).join("")}</datalist></label>
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Ville<input id="p-city" value="${esc(me.city)}" placeholder="Lomé" style="${inp}" /></label>
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Jeu favori<input id="p-game" value="${esc(me.favoriteGame)}" placeholder="EA FC 26" style="${inp}" /></label>
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Téléphone / WhatsApp<input id="p-phone" type="tel" value="${esc(me.phone)}" placeholder="+228 90 00 00 00" style="${inp}" /></label>
    </div>
    <label style="font-size:12px;color:var(--text-muted);font-weight:600;display:block;margin-top:14px">Bio<textarea id="p-bio" rows="2" placeholder="Quelques mots sur toi…" style="${inp};resize:vertical">${(me.bio || "").replace(/</g, "&lt;")}</textarea></label>
    ${S.profileMsg ? `<div style="color:#FB7185;font-size:12.5px;margin-top:10px">${S.profileMsg}</div>` : ""}
    <div style="display:flex;gap:10px;margin-top:14px"><button data-profilesave="1" style="background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:11px;padding:11px 18px;font-weight:750;font-size:14px;cursor:pointer">Enregistrer</button><button data-profilecancel="1" style="background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:11px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer">Annuler</button></div>
  </div>`;
}

/** « Mon prochain match » : visible seulement quand un match est prêt pour le joueur dans un tournoi en direct. */
function nextMatchCard(S: State): string {
  const list: Detail[] = S.myNext ?? [];
  if (!list.length) return "";
  return list.map((m) => `<div data-open="${m.tournamentId}" style="cursor:pointer;border:1px solid #22D3EE88;border-radius:16px;background:linear-gradient(135deg,rgba(34,211,238,.12),rgba(124,130,255,.08));padding:18px 20px;margin-bottom:18px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
    <div style="flex:1;min-width:200px">
      <div style="font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:#22D3EE;font-weight:800;display:flex;align-items:center;gap:7px"><span style="width:7px;height:7px;border-radius:50%;background:#22D3EE;animation:blink 1.2s infinite"></span>Ton prochain match · ${escHtml(m.tournamentName)}</div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:30px;letter-spacing:1px;margin-top:4px;line-height:1.1">${escHtml(m.playerName)} <span style="color:var(--text-faint);font-size:20px">vs</span> ${escHtml(m.opponent)}</div>
    </div>
    ${m.station
      ? `<div style="text-align:center"><div style="font-size:10.5px;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);font-weight:750">Rends-toi à</div><div style="font-family:'Bebas Neue',sans-serif;font-size:34px;color:#22D3EE;line-height:1.1">${escHtml(m.station)}</div></div>`
      : `<div style="text-align:center"><div style="font-size:10.5px;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);font-weight:750">Poste</div><div style="font-size:14px;font-weight:700;margin-top:3px">${m.waitingAhead > 0 ? `${m.waitingAhead} match${m.waitingAhead > 1 ? "s" : ""} avant toi` : "Tu es le prochain — poste bientôt annoncé"}</div></div>`}
  </div>`).join("");
}
function regsCard(S: State) {
  const regs = S.myRegs ?? [];
  const rows = regs.length
    ? regs.map((r: Detail) => `<div data-open="${r.tournament.id}" style="display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid var(--surface-4);cursor:pointer">
        <span style="display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:var(--surface-3);border:1px solid var(--border);color:#22D3EE;flex:none">${ic(I.crown, 15)}</span>
        <div style="min-width:0;flex:1"><div style="font-weight:650;font-size:14px">${r.tournament.name}</div><div style="font-size:12px;color:var(--text-faint)">${r.tournament.game}${r.tournament.date ? " · " + r.tournament.date : ""}${r.tournament.place ? " · " + r.tournament.place : ""}</div></div>
        <span style="font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:${r.tournament.live ? "#22D3EE" : r.tournament.status === "Terminé" ? "#FBBF24" : "var(--text-muted)"}">${r.tournament.status}</span></div>`).join("")
    : `<div style="color:var(--text-faint);font-size:13.5px;padding:16px 0;text-align:center">Aucune inscription pour l'instant.<br><button data-go="tournois" style="margin-top:10px;background:var(--surface-3);border:1px solid var(--border-strong);color:#22D3EE;border-radius:10px;padding:9px 14px;font-weight:700;font-size:13px;cursor:pointer">Parcourir les tournois</button></div>`;
  return card(secTitle(`Mes inscriptions (${regs.length})`) + rows);
}

function ordersCard(S: State) {
  const orders = S.myOrders ?? [];
  const rows = orders.length
    ? orders.map((o: Detail) => {
        const items = Array.isArray(o.items) ? o.items.map((i: Detail) => i.name).join(", ") : "";
        return `<div style="display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid var(--surface-4)">
        <span style="display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:var(--surface-3);border:1px solid var(--border);color:#7C82FF;flex:none">${ic(I.cart, 15)}</span>
        <div style="min-width:0;flex:1"><div style="font-weight:650;font-size:14px">${o.reference}</div><div style="font-size:12px;color:var(--text-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${items || o.paymentMethod}</div></div>
        <div style="text-align:right;flex:none"><div style="font-weight:800;color:#22D3EE;font-size:13.5px">${money(o.totalXof)}</div><div style="font-size:11px;color:${o.status === "pending" ? "#FBBF24" : "#34D399"};font-weight:700;text-transform:uppercase">${o.status === "pending" ? "En attente" : o.status}</div>${o.status === "pending" && onlinePayOn(S) && ONLINE_PAY.includes(o.paymentMethod) ? `<button data-payretry="order|${o.id}|${o.paymentMethod}" style="margin-top:6px;font-size:11px;font-weight:750;color:#04222a;background:#22D3EE;border:0;border-radius:8px;padding:5px 10px;cursor:pointer">Réessayer le paiement</button>` : ""}</div></div>`;
      }).join("")
    : `<div style="color:var(--text-faint);font-size:13.5px;padding:16px 0;text-align:center">Aucune commande.<br><button data-go="boutique" style="margin-top:10px;background:var(--surface-3);border:1px solid var(--border-strong);color:#7C82FF;border-radius:10px;padding:9px 14px;font-weight:700;font-size:13px;cursor:pointer">Visiter la boutique</button></div>`;
  return card(secTitle(`Mes commandes (${orders.length})`) + rows);
}

/** Panneau organisateur/admin : inscriptions du tournoi (payées + en attente de confirmation). */
function paymentsPanel(S: State, tournamentId: string) {
  const regs = S.regsPanel;
  if (regs === null) return "";
  const pending = regs.filter((r: Detail) => r.paymentStatus === "pending");
  const paid = regs.filter((r: Detail) => r.paymentStatus === "paid" && r.amountXof > 0);
  if (!pending.length && !paid.length) return "";
  const row = (r: Detail, isPending: boolean) => `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--surface-4);flex-wrap:wrap">
    <div style="min-width:0;flex:1"><div style="font-weight:650;font-size:13.5px">${escHtml(r.playerName)}</div><div style="font-size:11.5px;color:var(--text-faint)">${escHtml(r.userDisplayName)} · ${escHtml(r.userEmail)}</div></div>
    <span style="font-weight:700;color:var(--text);font-size:13px">${money(r.amountXof)}</span>
    <span style="font-size:11px;color:var(--text-muted)">${escHtml(r.paymentMethod || "")}</span>
    ${isPending
      ? `<button data-confirmpay="${tournamentId}|${r.id}" style="font-size:12px;font-weight:750;border-radius:9px;padding:7px 13px;cursor:pointer;background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.4);color:#34D399">Confirmer</button>`
      : `<span style="font-size:10.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#34D399;background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.35);border-radius:99px;padding:4px 10px">Payé</span>`}
    </div>`;
  return `<div style="border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:20px;margin-top:18px;text-align:left">
    <div style="display:flex;align-items:center;gap:10px">
      <h3 style="margin:0;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-muted);font-weight:750;flex:1">Paiements des inscriptions${pending.length ? ` · ${pending.length} en attente` : ""}</h3>
      <button data-exportregs="${tournamentId}" style="display:inline-flex;align-items:center;gap:6px;background:transparent;border:1px solid var(--border);color:var(--text-muted);border-radius:8px;padding:6px 10px;font-weight:700;font-size:11.5px;cursor:pointer">${ic(I.download, 12)}Excel</button>
    </div>
    ${pending.map((r: Detail) => row(r, true)).join("")}${paid.map((r: Detail) => row(r, false)).join("")}</div>`;
}

function profileSecurity(S: State) {
  const inp = "width:100%;background:var(--surface-3);border:1px solid var(--border);border-radius:11px;color:var(--text);font-family:inherit;font-size:14px;padding:11px 13px;margin-top:6px";
  const ok = S.passMsg === "Mot de passe modifié.";
  return card(secTitle("Sécurité · mot de passe") + `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;align-items:end">
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Mot de passe actuel<input id="pw-cur" type="password" placeholder="••••••" style="${inp}" /></label>
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Nouveau mot de passe<input id="pw-new" type="password" placeholder="6 caractères min." style="${inp}" /></label>
      <button data-passsave="1" style="background:var(--surface-4);border:1px solid var(--border-strong);color:#22D3EE;border-radius:11px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer">Changer</button>
    </div>
    ${S.passMsg ? `<div style="color:${ok ? "#34D399" : "#FB7185"};font-size:12.5px;margin-top:10px">${S.passMsg}</div>` : ""}`);
}

/** En-tête de l'onglet « Mon compte » de la console : identité + accès à l'édition du profil.
 * La page profil des joueurs a son propre en-tête ; la console n'en avait aucun, si bien qu'un
 * administrateur ou un organisateur ne pouvait pas modifier son profil depuis son espace. */
function consoleAccountHeader(S: State) {
  const u = S.user;
  if (!u) return "";
  const rc = ROLE_COLOR[u.role] || "var(--text-muted)";
  return card(`<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
    <div style="display:grid;place-items:center;width:54px;height:54px;border-radius:16px;background:linear-gradient(135deg,#22D3EE,#7C82FF);font-family:'Bebas Neue',sans-serif;font-size:26px;color:#04222a;flex:none">${(u.displayName || "?").charAt(0).toUpperCase()}</div>
    <div style="min-width:0;flex:1">
      <div style="font-weight:750;font-size:16px">${escHtml(u.displayName)}</div>
      <div style="color:var(--text-muted);font-size:12.5px;margin-top:3px">${escHtml(u.email)}</div>
      <span style="display:inline-block;margin-top:8px;font-size:10.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:${rc};background:${rc}18;border:1px solid ${rc}66;border-radius:999px;padding:4px 10px">${ROLE_LABEL[u.role] || u.role}</span>
    </div>
    <button data-profileedit="1" style="display:inline-flex;align-items:center;gap:7px;background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:11px;padding:11px 16px;font-weight:700;font-size:13.5px;cursor:pointer;flex:none;white-space:nowrap">${ic(I.edit, 15)}Modifier le profil</button>
  </div>`);
}

const ADMIN_TABS: [string, string][] = [
  ["apercu", "Aperçu"], ["events", "Événements"], ["site", "Site"], ["users", "Utilisateurs"], ["organisateurs", "Organisateurs"], ["joueurs", "Joueurs"], ["news", "Actualités"], ["galerie", "Galerie"], ["produits", "Produits"], ["fidelite", "Fidélité"], ["credits", "Crédits organisateur"], ["paiements", "Paiements"], ["commandes", "Commandes"],
  // Un administrateur reste un membre : il doit pouvoir modifier son profil et son mot de passe,
  // ce que seuls les joueurs et organisateurs pouvaient faire jusqu'ici.
  ["legal", "Pages légales"], ["compte", "Mon compte"],
];
const escAttr = (v: string | null | undefined) => (v || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const escHtml = (v: string | null | undefined) => (v || "").replace(/</g, "&lt;");
const btnSm = (attr: string, label: string, color = "var(--text-muted)", border = "var(--border)") =>
  `<button ${attr} style="font-size:11.5px;font-weight:700;border-radius:8px;padding:6px 10px;cursor:pointer;background:transparent;border:1px solid ${border};color:${color}">${label}</button>`;
const adminInp = "width:100%;background:var(--surface-3);border:1px solid var(--border);border-radius:11px;color:var(--text);font-family:inherit;font-size:14px;padding:11px 13px;margin-top:6px";

/** Barre de recherche (validation par Entrée) réutilisée dans les listes admin. */
function adminSearchBar(S: State, placeholder: string) {
  const q = S.adminSearch;
  return `<div style="margin-bottom:14px">
    <div style="position:relative;max-width:340px">
      <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text-faint);pointer-events:none">${ic(I.search, 15)}</span>
      <input id="adm-search" value="${escAttr(q)}" placeholder="${placeholder}" style="width:100%;background:var(--surface-3);border:1px solid var(--border);border-radius:10px;color:var(--text);font-family:inherit;font-size:13px;padding:9px 12px 9px 34px" />
    </div>
    ${q ? `<div style="margin-top:8px"><span style="display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--text-muted);background:var(--surface);border:1px solid var(--border);border-radius:999px;padding:6px 11px">Recherche : <b style="color:var(--text)">${escHtml(q)}</b><button data-admsearchclear="1" style="display:grid;place-items:center;width:18px;height:18px;background:transparent;border:0;color:var(--text-muted);cursor:pointer">${ic(I.x, 12)}</button></span></div>` : ""}
  </div>`;
}

/** Enveloppe défilante : évite qu'une longue liste ne pousse toute la page. */
const scrollBox = (inner: string, max = 480) => `<div style="max-height:${max}px;overflow-y:auto;padding-right:4px">${inner}</div>`;

/** Jeu d'onglets réduit pour ORGANIZER (pas d'accès aux réglages site/utilisateurs/joueurs/actus/galerie/produits — réservés à ADMIN). */
const ORG_TABS: [string, string][] = [["apercu", "Tableau de bord"], ["events", "Événements"], ["credits", "Crédits"], ["compte", "Mon compte"]];
/** Icônes de la sidebar console par clé d'onglet — réutilise l'objet I déjà défini (aucune nouvelle icône). */
const CONSOLE_TAB_ICON: Record<string, string> = {
  apercu: I.bolt, events: I.crown, site: I.edit, users: I.user, organisateurs: I.crown, joueurs: I.crown, news: I.flame, galerie: I.image,
  produits: I.cart, fidelite: I.medal, credits: I.cart, paiements: I.warn, commandes: I.cart, legal: I.edit, compte: I.user,
};

/** Tuiles KPI + table des tournois + « à traiter » (onglet "apercu") — données déjà chargées, aucune requête supplémentaire.
 * Pas de métrique inventée : uniquement ce que S.admin.overview / S.tourns / S.myTourns fournissent réellement. */
/** Bandeau de statut de validation organisateur — affiché tant que le compte n'est pas APPROVED. */
function organizerStatusBanner(S: State): string {
  if (S.user?.role !== "ORGANIZER") return "";
  const st = S.user.organizerStatus;
  if (st === "APPROVED" || !st) return "";
  const pending = st === "PENDING";
  return `<div style="display:flex;align-items:center;gap:12px;padding:14px 18px;border-radius:12px;margin-bottom:18px;background:${pending ? "rgba(251,191,36,.08)" : "rgba(251,113,133,.08)"};border:1px solid ${pending ? "rgba(251,191,36,.35)" : "rgba(251,113,133,.35)"}">
    <span style="color:${pending ? "#FBBF24" : "#FB7185"};flex:none">${ic(I.warn, 18)}</span>
    <div><div style="font-weight:700;font-size:13.5px;color:${pending ? "#FBBF24" : "#FB7185"}">${pending ? "Compte en attente de validation" : "Demande refusée"}</div>
    <div style="font-size:12.5px;color:var(--text-muted);margin-top:2px">${pending ? "L'équipe Miabe examine ta demande — tu pourras créer des tournois une fois approuvé." : "Contacte l'équipe Miabe si tu penses qu'il s'agit d'une erreur."}</div></div>
  </div>`;
}
function consoleOverview(S: State) {
  const isAdmin = S.user?.role === "ADMIN";
  const tourns: TournCard[] = ((isAdmin ? S.tourns : S.myTourns) ?? []) as TournCard[];
  const kpiStat = (v: number | string, k: string, color = "var(--text)") => `<div style="background:var(--surface);padding:16px 18px"><div style="font-family:'JetBrains Mono',monospace;font-size:28px;font-weight:600;color:${color}">${v}</div><div style="font-size:10.5px;letter-spacing:1.1px;text-transform:uppercase;color:var(--text-muted);font-weight:750;margin-top:6px">${k}</div></div>`;
  const ov = S.admin?.overview;
  const kpis = isAdmin
    ? (ov ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:1px;background:var(--surface-3);border:1px solid var(--surface-3);border-radius:12px;overflow:hidden;margin-bottom:20px">${kpiStat(ov.tournaments, "Tournois", "#22D3EE")}${kpiStat(ov.users, "Utilisateurs", "#7C82FF")}${kpiStat(ov.pendingPayments ?? 0, "Paiements en attente", (ov.pendingPayments ?? 0) > 0 ? "#FBBF24" : "var(--text)")}${kpiStat(ov.orders, "Commandes")}${kpiStat(ov.products, "Produits")}</div>` : "")
    : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:1px;background:var(--surface-3);border:1px solid var(--surface-3);border-radius:12px;overflow:hidden;margin-bottom:20px">${kpiStat(tourns.length, "Mes tournois", "#22D3EE")}${kpiStat((S.myRegs ?? []).length, "Mes inscriptions", "#7C82FF")}${kpiStat((S.myOrders ?? []).length, "Commandes")}${kpiStat(tourns.filter((t) => t.live).length, "En direct", "#FBBF24")}</div>`;

  const tableRows = tourns.length ? tourns.map((t) => `
    <tr data-open="${t.id}" style="border-top:1px solid var(--surface-3);cursor:pointer">
      <td style="padding:12px 18px"><div style="font-weight:650">${escHtml(t.name)}</div><div style="font-size:11px;color:var(--text-faint)">${escHtml(t.date)}${t.place ? " · " + escHtml(t.place) : ""}</div></td>
      <td style="padding:12px;color:var(--text-muted)">${escHtml(t.game)} · ${escHtml(t.format)}</td>
      <td style="padding:12px;text-align:right;font-family:'JetBrains Mono',monospace">${t.players}</td>
      <td style="padding:12px;text-align:right;font-family:'JetBrains Mono',monospace;color:${t.cagnotte !== null ? "#FBBF24" : "var(--text-faint)"}">${t.cagnotte !== null ? t.cagnotte : "—"}</td>
      <td style="padding:12px 18px;text-align:right">${t.live
        ? `<span style="display:inline-flex;align-items:center;gap:6px;font-size:10.5px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:#04222a;background:#22D3EE;border-radius:99px;padding:4px 10px"><span style="width:5px;height:5px;border-radius:50%;background:#04222a;animation:blink 1.2s infinite"></span>Live</span>`
        : `<span style="font-size:10.5px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:var(--text-muted);border:1px solid var(--border-strong);border-radius:99px;padding:4px 10px">${escHtml(t.status)}</span>`}</td>
    </tr>`).join("") : `<tr><td colspan="5" style="padding:26px;text-align:center;color:var(--text-faint)">${isAdmin ? "Aucun tournoi pour l'instant." : "Tu n'as pas encore créé de tournoi."}</td></tr>`;
  const table = `<div style="border:1px solid var(--border);border-radius:12px;background:var(--surface);overflow:hidden;margin-bottom:20px">
    <div style="padding:13px 18px;border-bottom:1px solid var(--surface-3);font-size:11px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-muted);font-weight:750">${isAdmin ? "Tournois" : "Mes tournois"} (${tourns.length})</div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13.5px;min-width:560px"><thead><tr style="color:var(--text-faint);font-size:10px;text-transform:uppercase;letter-spacing:1.1px">
      <th style="text-align:left;padding:10px 18px;font-weight:750">Tournoi</th><th style="text-align:left;padding:10px 12px;font-weight:750">Jeu / Format</th><th style="text-align:right;padding:10px 12px;font-weight:750">Joueurs</th><th style="text-align:right;padding:10px 12px;font-weight:750">Cagnotte</th><th style="text-align:right;padding:10px 18px;font-weight:750">Statut</th>
    </tr></thead><tbody>${tableRows}</tbody></table></div></div>`;

  const pending = ov?.pendingPayments ?? 0;
  const todo = isAdmin && pending > 0 ? `<div style="border:1px solid var(--border);border-radius:12px;background:var(--surface);overflow:hidden">
    <div style="padding:13px 18px;border-bottom:1px solid var(--surface-3);font-size:11px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-muted);font-weight:750">À traiter</div>
    <div data-admintab="paiements" style="display:flex;align-items:center;gap:12px;padding:13px 18px;cursor:pointer">
      <span style="display:grid;place-items:center;width:30px;height:30px;border-radius:8px;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.35);color:#FBBF24;flex:none">${ic(I.warn, 15)}</span>
      <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:650">${pending} paiement${pending > 1 ? "s" : ""} à confirmer</div></div>
      <span style="border:1px solid rgba(251,191,36,.4);border-radius:7px;padding:6px 11px;font-size:11.5px;font-weight:700;color:#FBBF24">Voir</span>
    </div></div>` : "";

  // Alerte d'exploitation : sans secret de session fixe, l'API en tire un au hasard à chaque
  // démarrage d'instance — les membres se retrouvent déconnectés sans raison apparente.
  const secretWarn = isAdmin && ov && ov.sessionSecretConfigured === false ? `<div style="display:flex;align-items:flex-start;gap:12px;padding:14px 18px;border-radius:12px;margin-bottom:18px;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.35)">
    <span style="color:#FBBF24;flex:none;margin-top:1px">${ic(I.warn, 18)}</span>
    <div><div style="font-weight:700;font-size:13.5px;color:#FBBF24">Sessions instables : secret de session non configuré</div>
    <div style="font-size:12.5px;color:var(--text-muted);margin-top:3px;line-height:1.6">L'API n'a pas de variable <b style="color:var(--text)">JWT_SECRET</b> et en génère une au hasard à chaque redémarrage : les membres sont déconnectés sans raison. À définir sur le projet d'hébergement de l'API (environnement Production), puis redéployer.</div></div>
  </div>` : "";
  return organizerStatusBanner(S) + secretWarn + kpis + table + todo;
}

/** Tournoi en direct épinglé en haut de la sidebar (organisateur : ses tournois seulement ; admin : tous). */
function consolePinnedLive(S: State): string {
  const isAdmin = S.user?.role === "ADMIN";
  const source: TournCard[] = ((isAdmin ? S.tourns : S.myTourns) ?? []) as TournCard[];
  const live = source.find((t) => t.live);
  if (!live) return "";
  return `<div data-open="${live.id}" style="margin:14px 12px;border:1px solid rgba(34,211,238,.4);border-radius:12px;background:rgba(34,211,238,.06);padding:13px;cursor:pointer">
    <div style="display:flex;align-items:center;gap:7px;margin-bottom:8px"><span style="width:6px;height:6px;border-radius:50%;background:#22D3EE;animation:blink 1.2s infinite"></span><span style="font-size:10px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:#22D3EE">En direct</span></div>
    <div style="font-weight:700;font-size:13.5px;line-height:1.3">${escHtml(live.name)}</div>
    <div style="font-size:11.5px;color:var(--text-muted);margin-top:5px">${escHtml(live.game)}${live.place ? " · " + escHtml(live.place) : ""}</div>
    <div style="margin-top:11px;border-radius:9px;background:#22D3EE;color:#04222a;padding:9px;text-align:center;font-size:12.5px;font-weight:750">Ouvrir la régie</div>
  </div>`;
}

/** Shell console (sidebar + zone de contenu) pour ADMIN/ORGANIZER sur « Mon espace » — remplace le header/nav public sur cette page. */
function consoleShell(S: State, tabs: [string, string][], title: string, body: string) {
  const u = S.user!;
  const rc = ROLE_COLOR[u.role] || "#22D3EE";
  const nav = tabs.map(([k, label]) => {
    const on = S.adminTab === k;
    return `<button data-admintab="${k}" style="display:flex;align-items:center;gap:11px;width:100%;text-align:left;padding:10px 16px;margin:0 8px;border-radius:9px;border:0;background:${on ? "rgba(34,211,238,.1)" : "transparent"};color:${on ? "var(--text)" : "var(--text-muted)"};font-weight:${on ? 700 : 600};font-size:13.5px;cursor:pointer">${ic(CONSOLE_TAB_ICON[k] || I.bolt, 17)}${label}</button>`;
  }).join("");
  return `<div style="min-height:100vh;display:flex" class="console-shell">
    <div class="console-backdrop${S.consoleMenuOpen ? " console-backdrop-open" : ""}" data-consolemenu=""></div>
    <div class="console-sidebar${S.consoleMenuOpen ? " console-sidebar-open" : ""}" style="width:250px;flex:none;border-right:1px solid var(--surface-3);background:var(--surface-2);display:flex;flex-direction:column;padding:16px 0">
      <div data-go="accueil" style="display:flex;align-items:center;gap:10px;padding:0 16px 18px;border-bottom:1px solid var(--surface-3);cursor:pointer">
        ${brandLogo(S, 34, 19)}
        <span style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:1.4px">${escHtml(S.site?.brand?.name1 ?? "Miabe")} <span style="color:#22D3EE">${escHtml(S.site?.brand?.name2 ?? "ESPORT")}</span></span>
      </div>
      ${consolePinnedLive(S)}
      <div style="padding:8px 12px 6px;font-size:10px;letter-spacing:1.4px;text-transform:uppercase;color:#3d3d55;font-weight:800">Console</div>
      ${nav}
      <div style="flex:1"></div>
      <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-top:1px solid var(--surface-3);margin-top:12px">
        <span style="display:grid;place-items:center;width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,#22D3EE,#7C82FF);color:#04222a;font-weight:800;font-size:14px;flex:none">${(u.displayName || "?").charAt(0).toUpperCase()}</span>
        <div style="min-width:0;flex:1"><div style="font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(u.displayName)}</div><div style="font-size:10.5px;color:${rc};font-weight:700;letter-spacing:.4px;text-transform:uppercase">${ROLE_LABEL[u.role] || u.role}</div></div>
        <button data-logout="1" title="Déconnexion" style="display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:transparent;border:0;color:var(--text-muted);cursor:pointer;flex:none">${ic(I.logout, 15)}</button>
      </div>
    </div>
    <div style="flex:1;min-width:0;display:flex;flex-direction:column">
      <div class="console-mobile-top" style="align-items:center;gap:12px;padding:13px 16px;border-bottom:1px solid var(--surface-3)">
        <button data-consolemenu="1" title="Menu" style="display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);cursor:pointer;flex:none">${ic(I.menu, 17)}</button>
        <span style="font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:1px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${title}</span>
        ${themeToggleBtn(S, 36, 15)}
        <button data-go="accueil" title="Voir le site public" style="display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text-muted);cursor:pointer;flex:none">${ic(I.extlink, 15)}</button>
      </div>
      <div style="display:flex;align-items:center;gap:16px;padding:16px 28px;border-bottom:1px solid var(--surface-3);flex-wrap:wrap">
        <h1 class="console-desktop-title" style="font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:1.2px;margin:0;line-height:1">${title}</h1>
        <span style="flex:1"></span>
        <div style="position:relative;min-width:220px">
          <span style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--text-faint);pointer-events:none">${ic(I.search, 15)}</span>
          <input id="hsearch" value="${escAttr(S.q)}" placeholder="Tournoi, jeu… (Entrée)" style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:9px;color:var(--text);font-family:inherit;font-size:13px;padding:9px 12px 9px 34px" />
        </div>
        ${themeToggleBtn(S, 40, 17)}
        <button data-go="accueil" style="display:inline-flex;align-items:center;gap:8px;background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:9px;padding:10px 16px;font-weight:700;font-size:13.5px;cursor:pointer">${ic(I.extlink, 15)}Voir le site</button>
        <button data-act="create-open" style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:9px;padding:10px 16px;font-weight:750;font-size:13.5px;cursor:pointer">${ic(I.plus, 16)}Nouveau tournoi</button>
      </div>
      <div style="padding:22px 28px;flex:1">${body}</div>
    </div>
  </div>`;
}

/** Page « Mon espace » pour ADMIN/ORGANIZER : shell sidebar + contenu de l'onglet actif, assistant en overlay si ouvert. */
function consolePage(S: State): string {
  const isAdmin = S.user?.role === "ADMIN";
  const tabs = isAdmin ? ADMIN_TABS : ORG_TABS;
  const activeLabel = tabs.find(([k]) => k === S.adminTab)?.[1] || tabs[0][1];
  let body: string;
  // « Mon compte » ne dépend que du compte connecté : à traiter AVANT l'attente des données
  // d'administration, sinon une panne du tableau de bord empêcherait de changer son mot de passe.
  const accountBody = () => consoleAccountHeader(S) + grid2(regsCard(S), resultsCard(S)) + grid2(ordersCard(S), profileSecurity(S)) + loyaltyCard(S);
  if (isAdmin) {
    const a = S.admin;
    body = S.adminTab === "compte" ? accountBody() :
      S.adminTab === "events" ? consoleEvents(S) :
      !a ? `<div style="color:var(--text-muted);text-align:center;padding:40px 0">Chargement…</div>` :
      S.adminTab === "site" ? adminSite(S) :
      S.adminTab === "users" ? adminUsers(S) :
      S.adminTab === "organisateurs" ? adminOrganizers(S) :
      S.adminTab === "joueurs" ? adminRoster(S) :
      S.adminTab === "news" ? adminNews(S) :
      S.adminTab === "galerie" ? adminGallery(S) :
      S.adminTab === "produits" ? adminProducts(S) :
      S.adminTab === "fidelite" ? adminLoyalty(S) :
      S.adminTab === "credits" ? adminCredits(S) :
      S.adminTab === "paiements" ? adminPayments(S) :
      S.adminTab === "commandes" ? adminOrders(a) :
      S.adminTab === "legal" ? adminLegal(S) :
      consoleOverview(S);
  } else {
    body = S.adminTab === "compte" ? accountBody()
      : S.adminTab === "credits" ? organizerCredits(S)
      : S.adminTab === "events" ? consoleEvents(S)
      : consoleOverview(S);
  }
  const editor = S.profileEdit ? profileEditor(S) : "";
  const shell = consoleShell(S, tabs, activeLabel, editor + body);
  return shell + (S.creating ? tournamentWizard(S) : "") + cartDrawer(S) + confirmModal(S) + matchCorrectModal(S) + playerDetailModal(S);
}

/** Onglet Site : identité (logo/nom), héro, slider « À la une », partenaires. */
function adminSite(S: State) {
  const site = S.site;
  if (!site) return card(`<div style="color:var(--text-muted);text-align:center;padding:20px">Chargement des réglages…</div>`);
  const b = site.brand || {};
  const hz = site.hero || {};
  const stats: Detail[] = hz.stats?.length ? hz.stats : [{ v: "", k: "" }, { v: "", k: "" }, { v: "", k: "" }];
  const slides = S.slidesEdit ?? [];
  const partners = S.partnersEdit ?? [];
  const ads = S.adsEdit ?? [];
  const lbl = "font-size:12px;color:var(--text-muted);font-weight:600";
  const sec = (title: string, inner: string) => `<div style="border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:20px;margin-bottom:16px">${secTitle(title)}${inner}</div>`;

  const identite = sec("Identité · logo & nom du site", `
    <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
      <div style="flex:1;min-width:220px"><div style="${lbl}">Logo (image carrée conseillée)</div>${filePicker("b-logo", "Choisir le logo", "image/*", b.logoUrl)}</div>
      <label style="${lbl}">Nom (partie 1)<input id="b-name1" value="${escAttr(b.name1 ?? "Miabe")}" style="${adminInp}" /></label>
      <label style="${lbl}">Nom (partie 2, en couleur)<input id="b-name2" value="${escAttr(b.name2 ?? "ESPORT")}" style="${adminInp}" /></label>
    </div>`);

  const heroSec = sec("Accueil · section principale (héro)", `
    <label style="${lbl};display:block">Sur-titre<input id="h-kicker" value="${escAttr(hz.kicker)}" style="${adminInp}" /></label>
    <label style="${lbl};display:block;margin-top:12px">Grand titre (une ligne par retour à la ligne)<textarea id="h-title" rows="2" style="${adminInp};resize:vertical">${escHtml(hz.title)}</textarea></label>
    <label style="${lbl};display:block;margin-top:12px">Texte de présentation<textarea id="h-sub" rows="3" style="${adminInp};resize:vertical">${escHtml(hz.subtitle)}</textarea></label>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-top:12px">
      ${[0, 1, 2].map((i) => `<div style="border:1px solid var(--surface-4);border-radius:12px;padding:12px"><div style="${lbl};margin-bottom:4px">Statistique ${i + 1}</div><input id="h-s${i}v" value="${escAttr(stats[i]?.v)}" placeholder="2 400+" style="${adminInp}" /><input id="h-s${i}k" value="${escAttr(stats[i]?.k)}" placeholder="Joueurs" style="${adminInp}" /></div>`).join("")}
    </div>
    <div style="display:flex;align-items:center;gap:14px;margin-top:14px;flex-wrap:wrap">
      <div style="flex:1;min-width:240px"><div style="${lbl}">Fond du héro : image (optimisée automatiquement) ou vidéo mp4/webm de ${MAX_UPLOAD_MB} Mo max — halos animés par défaut</div>${filePicker("h-bg", "Choisir le fond", "image/*,video/mp4,video/webm", hz.bgUrl)}</div>
      ${hz.bgUrl ? `<button data-herobgclear="1" style="font-size:12px;font-weight:700;border-radius:9px;padding:8px 12px;cursor:pointer;background:transparent;border:1px solid var(--border-strong);color:var(--text-muted)">Retirer le fond</button>` : ""}
    </div>`);

  const slidesSec = sec("Accueil · « À la une » (slider)", `
    ${slides.map((sl, i) => `
    <div style="border:1px solid var(--surface-4);border-radius:12px;padding:14px;margin-bottom:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="${lbl};color:#22D3EE">Diapo ${i + 1}</div>
        <button data-sldel="${sl.key}" style="display:grid;place-items:center;width:34px;height:34px;border-radius:9px;background:transparent;border:1px solid rgba(251,113,133,.35);color:#FB7185;cursor:pointer;flex:none">${ic(I.trash, 14)}</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 2fr;gap:12px" class="grid2b">
        <label style="${lbl}">Badge<input id="sl-${sl.key}-tag" value="${escAttr(sl.tag)}" placeholder="Grand tournoi" style="${adminInp}" /></label>
        <label style="${lbl}">Titre<input id="sl-${sl.key}-title" value="${escAttr(sl.title)}" placeholder="SURVIVAL CUP LOMÉ 2026" style="${adminInp}" /></label>
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-top:10px" class="grid2b">
        <label style="${lbl}">Texte<input id="sl-${sl.key}-sub" value="${escAttr(sl.sub)}" placeholder="Description courte…" style="${adminInp}" /></label>
        <label style="${lbl}">Bouton<input id="sl-${sl.key}-cta" value="${escAttr(sl.cta)}" placeholder="S'inscrire" style="${adminInp}" /></label>
      </div>
      <div style="margin-top:10px"><div style="${lbl}">Image de la diapo (fond du carrousel)</div>${filePicker(`sl-${sl.key}-img`, "Choisir une image", "image/*", sl.imageUrl)}</div>
    </div>`).join("")}
    ${slides.length ? "" : `<div style="color:var(--text-faint);font-size:13px;padding:8px 0 14px">Aucune diapo pour l'instant.</div>`}
    <button data-sladd="1" style="display:inline-flex;align-items:center;gap:7px;background:var(--surface-3);border:1px dashed var(--border-strong);color:#22D3EE;border-radius:10px;padding:9px 15px;font-weight:700;font-size:13px;cursor:pointer">${ic(I.plus, 15)}Ajouter une diapo</button>`);

  const partnersSec = sec("Partenaires & sponsors <span style=\"color:var(--text-faint);text-transform:none;letter-spacing:0;font-weight:500\">— bandeau permanent affiché sur toutes les pages, logo optionnel</span>", `
    ${partners.map((p) => `
    <div style="border:1px solid var(--surface-4);border-radius:12px;padding:12px;margin-bottom:10px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <label style="${lbl};flex:1;min-width:180px">Nom du partenaire<input id="pt-${p.key}-name" value="${escAttr(p.name)}" placeholder="Nom du sponsor" style="${adminInp}" /></label>
      <div style="flex:1;min-width:220px"><div style="${lbl}">Logo (optionnel)</div>${filePicker(`pt-${p.key}-logo`, "Choisir le logo", "image/*", p.logoUrl)}</div>
      <label style="${lbl};min-width:150px">Affichage<select id="pt-${p.key}-display" style="${adminInp}">
        <option value="both" ${(p.display || "both") === "both" ? "selected" : ""}>Logo + nom</option>
        <option value="logo" ${p.display === "logo" ? "selected" : ""}>Logo seul</option>
        <option value="name" ${p.display === "name" ? "selected" : ""}>Nom seul</option>
      </select></label>
      <button data-ptdel="${p.key}" style="align-self:flex-end;display:grid;place-items:center;width:38px;height:38px;border-radius:10px;background:transparent;border:1px solid rgba(251,113,133,.35);color:#FB7185;cursor:pointer;flex:none">${ic(I.trash, 15)}</button>
    </div>`).join("")}
    ${partners.length ? "" : `<div style="color:var(--text-faint);font-size:13px;padding:8px 0 14px">Aucun partenaire pour l'instant.</div>`}
    <button data-ptadd="1" style="display:inline-flex;align-items:center;gap:7px;background:var(--surface-3);border:1px dashed var(--border-strong);color:#22D3EE;border-radius:10px;padding:9px 15px;font-weight:700;font-size:13px;cursor:pointer">${ic(I.plus, 15)}Ajouter un partenaire</button>`);

  const AD_PAGES: [string, string][] = [["accueil", "Accueil"], ["tournois", "Page Tournois"], ["toutes", "Toutes les pages"]];
  const adsSec = sec("Emplacements publicitaires <span style=\"color:var(--text-faint);text-transform:none;letter-spacing:0;font-weight:500\">— plusieurs annonces sur une même page tournent en carrousel</span>", `
    ${ads.map((ad) => `
    <div style="border:1px solid var(--surface-4);border-radius:12px;padding:14px;margin-bottom:10px">
      <div style="display:grid;grid-template-columns:2fr 2fr 1fr;gap:12px" class="grid2b">
        <label style="${lbl}">Libellé (optionnel)<input id="ad-${ad.key}-label" value="${escAttr(ad.label)}" placeholder="Nom de l'annonceur" style="${adminInp}" /></label>
        <label style="${lbl}">Lien au clic (optionnel)<input id="ad-${ad.key}-link" value="${escAttr(ad.linkUrl)}" placeholder="https://…" style="${adminInp}" /></label>
        <label style="${lbl}">Page<select id="ad-${ad.key}-page" style="${adminInp}">${AD_PAGES.map(([v, l]) => `<option value="${v}" ${ad.page === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      </div>
      <div style="display:flex;align-items:flex-end;gap:12px;margin-top:10px;flex-wrap:wrap">
        <div style="flex:1;min-width:220px"><div style="${lbl}">Image de la bannière</div>${filePicker(`ad-${ad.key}-img`, "Choisir une image", "image/*", ad.imageUrl)}</div>
        <button data-addel="${ad.key}" style="display:grid;place-items:center;width:38px;height:38px;border-radius:10px;background:transparent;border:1px solid rgba(251,113,133,.35);color:#FB7185;cursor:pointer;flex:none">${ic(I.trash, 15)}</button>
      </div>
    </div>`).join("")}
    ${ads.length ? "" : `<div style="color:var(--text-faint);font-size:13px;padding:8px 0 14px">Aucune publicité pour l'instant.</div>`}
    <button data-adnew="1" style="display:inline-flex;align-items:center;gap:7px;background:var(--surface-3);border:1px dashed var(--border-strong);color:#7C82FF;border-radius:10px;padding:9px 15px;font-weight:700;font-size:13px;cursor:pointer">${ic(I.plus, 15)}Ajouter une publicité</button>`);

  const ok = S.siteMsg === "Réglages enregistrés.";
  const saveBar = `<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
    <button data-sitesave="1" style="background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:13px 24px;font-weight:750;font-size:15px;cursor:pointer;box-shadow:0 0 30px rgba(34,211,238,.22)">Enregistrer les réglages</button>
    ${S.siteMsg ? `<span style="color:${ok ? "#34D399" : "#FB7185"};font-size:13px;font-weight:700">${S.siteMsg}</span>` : ""}
  </div>`;

  return identite + heroSec + slidesSec + partnersSec + adsSec + saveBar;
}

function adminOverview(a: NonNullable<State["admin"]>) {
  const ov = a.overview;
  const stat = (v: number, k: string, color = "var(--text)") => `<div style="border:1px solid var(--border);border-radius:14px;background:var(--surface);padding:16px"><div style="font-family:'Bebas Neue',sans-serif;font-size:32px;line-height:1;color:${color}">${v}</div><div style="font-size:11px;letter-spacing:.8px;text-transform:uppercase;color:var(--text-muted);font-weight:700;margin-top:6px">${k}</div></div>`;
  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:14px;margin-bottom:20px">
    ${stat(ov.users, "Utilisateurs", "#22D3EE")}${stat(ov.organizers, "Organisateurs", "#7C82FF")}${stat(ov.admins, "Admins", "#FBBF24")}${stat(ov.tournaments, "Tournois")}${stat(ov.news ?? 0, "Articles", "#34D399")}${stat(ov.gallery ?? 0, "Photos/vidéos", "#7C82FF")}${stat(ov.products, "Produits")}${stat(ov.pendingPayments ?? 0, "Paiements en attente", (ov.pendingPayments ?? 0) > 0 ? "#FBBF24" : "var(--text)")}${stat(ov.orders, "Commandes")}</div>`;
}

function adminUsers(S: State) {
  const a = S.admin!;
  const q = S.adminSearch.trim().toLowerCase();
  const all: Detail[] = a.users;
  const users = q ? all.filter((u: Detail) => `${u.displayName} ${u.email}`.toLowerCase().includes(q)) : all;
  const roleBtn = (uid: string, role: string, cur: string) => { const on = cur === role; return `<button data-setrole="${uid}|${role}" style="font-size:11.5px;font-weight:700;border-radius:8px;padding:6px 10px;cursor:pointer;background:${on ? ROLE_COLOR[role] + "18" : "transparent"};border:1px solid ${on ? ROLE_COLOR[role] : "var(--border)"};color:${on ? ROLE_COLOR[role] : "var(--text-muted)"}">${ROLE_LABEL[role]}</button>`; };
  const th = (label: string, align = "left") => `<th style="text-align:${align};padding:9px 10px;font-size:10.5px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase;color:var(--text-faint);white-space:nowrap">${label}</th>`;
  const date = (d?: string) => (d ? new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : "—");
  const row = (usr: Detail) => `<tr style="border-top:1px solid var(--surface-4)">
    <td style="padding:10px"><div style="display:flex;align-items:center;gap:10px"><span style="display:grid;place-items:center;flex:none;width:30px;height:30px;border-radius:50%;background:var(--surface-4);border:1px solid var(--border);font-size:12px;font-weight:800;color:var(--text-muted)">${(usr.displayName || "?").charAt(0).toUpperCase()}</span><span style="font-weight:650">${escHtml(usr.displayName)}${usr.id === S.me?.id ? ` <span style="font-size:10.5px;color:#22D3EE;font-weight:700">(toi)</span>` : ""}</span></div></td>
    <td style="padding:10px;color:var(--text-muted);font-size:13px">${escHtml(usr.email)}</td>
    <td style="padding:10px;color:var(--text-faint);font-size:12.5px;white-space:nowrap">${date(usr.createdAt)}</td>
    <td style="padding:10px"><div style="display:inline-flex;gap:6px;flex-wrap:nowrap">${roleBtn(usr.id, "PLAYER", usr.role)}${roleBtn(usr.id, "ORGANIZER", usr.role)}${roleBtn(usr.id, "ADMIN", usr.role)}</div></td>
    <td style="padding:10px;text-align:right;white-space:nowrap"><div style="display:inline-flex;gap:6px;flex-wrap:nowrap;white-space:nowrap">${btnSm(`data-userpwd="${usr.id}"`, "Réinit. mot de passe", "#FBBF24", "rgba(251,191,36,.35)")}${usr.id === S.me?.id ? "" : btnSm(`data-userdel="${usr.id}"`, "Supprimer", "#FB7185", "rgba(251,113,133,.35)")}</div></td></tr>`;
  const section = (title: string, color: string, list: Detail[], emptyMsg: string) => card(`
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><span style="width:8px;height:8px;border-radius:50%;background:${color};flex:none"></span><h3 style="margin:0;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-muted);font-weight:750">${title}</h3><span style="font-family:'JetBrains Mono',monospace;font-size:11.5px;color:var(--text-faint)">${list.length}</span></div>
    ${scrollBox(`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px;min-width:980px;table-layout:fixed"><colgroup><col style="width:19%"><col style="width:19%"><col style="width:10%"><col style="width:26%"><col style="width:26%"></colgroup><thead><tr>${th("Utilisateur")}${th("E-mail")}${th("Inscrit le")}${th("Rôle")}${th("Actions", "right")}</tr></thead><tbody>${list.length ? list.map(row).join("") : `<tr><td colspan="5" style="color:var(--text-faint);font-size:13px;padding:16px 0;text-align:center;border-top:1px solid var(--surface-4)">${emptyMsg}</td></tr>`}</tbody></table></div>`, 420)}`);
  const admins = users.filter((u: Detail) => u.role === "ADMIN");
  const organizers = users.filter((u: Detail) => u.role === "ORGANIZER");
  const players = users.filter((u: Detail) => u.role !== "ADMIN" && u.role !== "ORGANIZER");
  const clubReqs: Detail[] = a.clubRequests ?? [];
  const clubBox = clubReqs.length ? `<div style="margin-bottom:16px">${card(`
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><span style="width:8px;height:8px;border-radius:50%;background:#FBBF24;flex:none"></span><h3 style="margin:0;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:#FBBF24;font-weight:750">Clubs à valider</h3><span style="font-family:'JetBrains Mono',monospace;font-size:11.5px;color:var(--text-faint)">${clubReqs.length}</span></div>
    <p style="margin:0 0 12px;font-size:12.5px;color:var(--text-muted);line-height:1.5">Le club n'est ajouté à la base de données qu'après ta validation. Tant qu'il n'est pas traité, le joueur inscrit avec un club ne peut rien faire sur le site.</p>
    ${clubReqs.map((r: Detail) => `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:11px 0;border-top:1px solid var(--surface-4)">
      <div style="flex:1;min-width:200px"><div style="font-weight:650">${escHtml(r.displayName)} <span style="font-size:12px;color:var(--text-faint);font-weight:500">${escHtml(r.email)}</span></div><div style="font-size:13px;color:var(--text);margin-top:3px">Club demandé : <b style="color:#FBBF24">${escHtml(r.clubRequested || "")}</b>${r.clubBlocking ? ` <span style="font-size:11px;color:#FB7185;font-weight:700">· compte bloqué</span>` : ""}</div></div>
      <div style="display:flex;gap:8px">${btnSm(`data-clubreview="${r.id}|reject"`, "Refuser", "#FB7185", "rgba(251,113,133,.35)")}${btnSm(`data-clubreview="${r.id}|approve"`, "Valider le club", "#34D399", "rgba(52,211,153,.4)")}</div>
    </div>`).join("")}`)}</div>` : "";
  return `${clubBox}${card(`${secTitle(`Comptes (${all.length})`)}${adminSearchBar(S, "Nom ou email…")}<div style="margin-top:-6px;font-size:12.5px;color:var(--text-faint)">Administrateurs, organisateurs et utilisateurs sont listés séparément ci-dessous. Le bouton du rôle actuel est allumé ; un clic sur un autre rôle déplace le compte de tableau.</div>`)}
    <div style="display:flex;flex-direction:column;gap:16px;margin-top:16px">
      ${section("Administrateurs", "#FBBF24", admins, q ? "Aucun administrateur trouvé." : "Aucun administrateur.")}
      ${section("Organisateurs", "#7C82FF", organizers, q ? "Aucun organisateur trouvé." : "Aucun organisateur.")}
      ${section("Utilisateurs", "#22D3EE", players, q ? "Aucun utilisateur trouvé." : "Aucun utilisateur.")}
    </div>`;
}

/** Onglet Joueurs : base de joueurs (roster) + clubs, gérée depuis l'admin — sert aussi à pré-remplir les participants à la création d'un tournoi. */
function adminRoster(S: State) {
  // inline-flex + nowrap + flex:none : sans ça, dès que la ligne manque de place, le bouton se
  // rétrécit et son contenu se replie — l'icône se retrouvait au-dessus du libellé au lieu d'être
  // à côté. C'est la rangée d'onglets qui passe à la ligne (flex-wrap), pas l'intérieur des boutons.
  const tabBtn = (k: "joueurs" | "clubs" | "jeux", label: string) => `<button data-rostertab="${k}" style="display:inline-flex;align-items:center;gap:7px;white-space:nowrap;flex:none;font-size:12.5px;font-weight:700;border-radius:999px;padding:8px 15px;cursor:pointer;background:${S.rosterTab === k ? "rgba(34,211,238,.1)" : "var(--surface)"};border:1px solid ${S.rosterTab === k ? "#22D3EE" : "var(--border)"};color:${S.rosterTab === k ? "#22D3EE" : "var(--text-muted)"}">${label}</button>`;
  const tabs = `<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">${tabBtn("joueurs", `${ic(I.user, 14)}Joueurs`)}${tabBtn("clubs", `${ic(I.image, 14)}Clubs`)}${tabBtn("jeux", `${ic(I.bolt, 14)}Jeux`)}</div>`;
  return tabs + (S.rosterTab === "clubs" ? adminClubsView(S) : S.rosterTab === "jeux" ? adminGamesView(S) : adminRosterPlayers(S));
}

function adminRosterPlayers(S: State) {
  const roster: Detail[] = S.roster ?? [];
  const clubs: Detail[] = S.clubs ?? [];
  const e = S.rosterEdit;
  const editor = e ? `<div style="border:1px solid rgba(34,211,238,.3);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:20px;margin-bottom:16px">
    <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;margin-bottom:12px">${e.id ? "Modifier le joueur" : "Ajouter un joueur"}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px">
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Nom<input id="ro-name" value="${escAttr(e.name)}" placeholder="Nom du joueur" style="${adminInp}" /></label>
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Ville<input id="ro-city" value="${escAttr(e.city)}" placeholder="Lomé, Kara…" style="${adminInp}" /></label>
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Club<select id="ro-club" style="${adminInp}"><option value="">— Sans club —</option>${clubs.map((c: Detail) => `<option value="${c.id}" ${e.clubId === c.id ? "selected" : ""}>${escAttr(c.name)}</option>`).join("")}</select></label>
    </div>
    <div style="display:flex;gap:10px;margin-top:14px"><button data-rostersave="${e.id || "new"}" style="background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:11px;padding:11px 18px;font-weight:750;font-size:14px;cursor:pointer">${e.id ? "Enregistrer" : "Ajouter"}</button><button data-rostercancel="1" style="background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:11px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer">Annuler</button></div>
  </div>` : "";
  const q = S.adminSearch.trim().toLowerCase();
  const filtered = q ? roster.filter((p: Detail) => `${p.name} ${p.clubName || ""} ${p.city || ""}`.toLowerCase().includes(q)) : roster;
  const rows = filtered.length ? filtered.map((p: Detail) => `<div style="display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid var(--surface-4);flex-wrap:wrap">
      <span style="display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:var(--surface-4);border:1px solid var(--border);font-size:13px;font-weight:800;color:var(--text-muted);flex:none">${(p.name || "?").charAt(0).toUpperCase()}</span>
      <div style="min-width:0;flex:1"><div style="font-weight:650;font-size:14px">${escHtml(p.name)}</div><div style="font-size:11.5px;color:var(--text-faint)">${[p.city, p.clubName].filter(Boolean).map(escHtml).join(" · ") || "—"}</div></div>
      <span style="font-size:11px;color:#22D3EE;font-weight:700">${ic(I.bolt, 11)} ${p.elo}</span>
      <div style="display:inline-flex;gap:6px">${btnSm(`data-playerview="${p.id}"`, "Voir le profil", "#7C82FF", "#7C82FF55")}${btnSm(`data-rosteredit="${p.id}"`, "Modifier", "#22D3EE", "#22D3EE55")}${btnSm(`data-rosterdel="${p.id}"`, "Retirer", "#FB7185", "rgba(251,113,133,.35)")}</div></div>`).join("")
    : `<div style="color:var(--text-faint);font-size:13.5px;padding:16px 0;text-align:center">${q ? "Aucun joueur trouvé." : "Base vide. Ajoute des joueurs ici, ou crée un tournoi — pense à les y ajouter aussi."}</div>`;
  const head = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px">${secTitle(`Base de joueurs (${roster.length})`)}<button data-rosteredit="new" style="display:inline-flex;align-items:center;gap:7px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:11px;padding:10px 16px;font-weight:750;font-size:13.5px;cursor:pointer">${ic(I.plus, 15)}Ajouter un joueur</button></div>`;
  return editor + `<div style="border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:20px">${head}${adminSearchBar(S, "Nom, ville ou club…")}${scrollBox(rows)}<p style="color:var(--text-faint);font-size:11.5px;margin-top:12px">Ces joueurs sont proposés à la création d'un tournoi (« Depuis la base de joueurs »).</p></div>`;
}

function adminClubsView(S: State) {
  const clubs: Detail[] = S.clubs ?? [];
  const e = S.clubEdit;
  const editor = e ? `<div style="border:1px solid rgba(124,130,255,.35);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:20px;margin-bottom:16px">
    <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;margin-bottom:12px">${e.id ? "Modifier le club" : "Nouveau club"}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px">
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Nom<input id="cl-name" value="${escAttr(e.name)}" placeholder="Team 228" style="${adminInp}" /></label>
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Ville<input id="cl-city" value="${escAttr(e.city)}" placeholder="Lomé" style="${adminInp}" /></label>
    </div>
    <div style="margin-top:14px"><div style="font-size:12px;color:var(--text-muted);font-weight:600;margin-bottom:2px">Logo du club (optionnel)</div>${filePicker("cl-logo", "Choisir le logo", "image/*", e.logoUrl)}</div>
    <div style="display:flex;gap:10px;margin-top:14px"><button data-clubsave="${e.id || "new"}" style="background:linear-gradient(135deg,#7C82FF,#5a60e0);color:#fff;border:0;border-radius:11px;padding:11px 18px;font-weight:750;font-size:14px;cursor:pointer">${e.id ? "Enregistrer" : "Créer le club"}</button><button data-clubcancel="1" style="background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:11px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer">Annuler</button></div>
  </div>` : "";
  const q = S.adminSearch.trim().toLowerCase();
  const filtered = q ? clubs.filter((c: Detail) => `${c.name} ${c.city || ""}`.toLowerCase().includes(q)) : clubs;
  const clubAvatar = (c: Detail) => c.logoUrl
    ? `<span style="display:grid;place-items:center;width:36px;height:36px;border-radius:10px;overflow:hidden;flex:none;background:url('${mediaUrl(c.logoUrl)}') center/cover;border:1px solid var(--border)"></span>`
    : `<span style="display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:var(--surface-4);border:1px solid var(--border);color:#7C82FF;flex:none">${ic(I.image, 16)}</span>`;
  const rows = filtered.length ? filtered.map((c: Detail) => `<div style="display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid var(--surface-4);flex-wrap:wrap">
      ${clubAvatar(c)}
      <div style="min-width:0;flex:1"><div style="font-weight:650;font-size:14px">${escHtml(c.name)}</div><div style="font-size:11.5px;color:var(--text-faint)">${escHtml(c.city) || "—"}</div></div>
      <span style="font-size:12px;color:var(--text-muted)">${c.playerCount} joueur${c.playerCount > 1 ? "s" : ""}</span>
      <div style="display:inline-flex;gap:6px">${btnSm(`data-clubedit="${c.id}"`, "Modifier", "#7C82FF", "#7C82FF55")}${btnSm(`data-clubdel="${c.id}"`, "Supprimer", "#FB7185", "rgba(251,113,133,.35)")}</div></div>`).join("")
    : `<div style="color:var(--text-faint);font-size:13.5px;padding:16px 0;text-align:center">${q ? "Aucun club trouvé." : "Aucun club. Crée le premier !"}</div>`;
  const head = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px">${secTitle(`Clubs (${clubs.length})`)}<button data-clubedit="new" style="display:inline-flex;align-items:center;gap:7px;background:linear-gradient(135deg,#7C82FF,#5a60e0);color:#fff;border:0;border-radius:11px;padding:10px 16px;font-weight:750;font-size:13.5px;cursor:pointer">${ic(I.plus, 15)}Nouveau club</button></div>`;
  return editor + `<div style="border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:20px">${head}${adminSearchBar(S, "Nom ou ville…")}${scrollBox(rows)}</div>`;
}

/** Catalogue des jeux — noms canoniques proposés à la création d'un tournoi (évite les doublons
 * de casse/orthographe qui fausseraient les classements et stats par jeu). */
function adminGamesView(S: State) {
  const games: Detail[] = S.games ?? [];
  const e = S.gameEdit;
  const editor = e ? `<div style="border:1px solid rgba(52,211,153,.35);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:20px;margin-bottom:16px">
    <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;margin-bottom:12px">${e.id ? "Renommer le jeu" : "Nouveau jeu"}</div>
    <label style="font-size:12px;color:var(--text-muted);font-weight:600">Nom<input id="gm-name" value="${escAttr(e.name)}" placeholder="Valorant" style="${adminInp}" /></label>
    <div style="display:flex;gap:10px;margin-top:14px"><button data-gamesave="${e.id || "new"}" style="background:linear-gradient(135deg,#34D399,#1fae7d);color:#04222a;border:0;border-radius:11px;padding:11px 18px;font-weight:750;font-size:14px;cursor:pointer">${e.id ? "Enregistrer" : "Ajouter au catalogue"}</button><button data-gamecancel="1" style="background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:11px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer">Annuler</button></div>
  </div>` : "";
  const q = S.adminSearch.trim().toLowerCase();
  const filtered = q ? games.filter((g: Detail) => g.name.toLowerCase().includes(q)) : games;
  const rows = filtered.length ? filtered.map((g: Detail) => `<div style="display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid var(--surface-4)">
      <span style="display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:var(--surface-4);border:1px solid var(--border);color:#34D399;flex:none">${ic(I.bolt, 16)}</span>
      <div style="min-width:0;flex:1;font-weight:650;font-size:14px">${escHtml(g.name)}</div>
      <div style="display:inline-flex;gap:6px">${btnSm(`data-gameedit="${g.id}"`, "Renommer", "#34D399", "#34D39955")}${btnSm(`data-gamedel="${g.id}"`, "Supprimer", "#FB7185", "rgba(251,113,133,.35)")}</div></div>`).join("")
    : `<div style="color:var(--text-faint);font-size:13.5px;padding:16px 0;text-align:center">${q ? "Aucun jeu trouvé." : "Catalogue vide. Ajoute les jeux au fur et à mesure — ils seront proposés à la création d'un tournoi."}</div>`;
  const head = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px">${secTitle(`Jeux (${games.length})`)}<button data-gameedit="new" style="display:inline-flex;align-items:center;gap:7px;background:linear-gradient(135deg,#34D399,#1fae7d);color:#04222a;border:0;border-radius:11px;padding:10px 16px;font-weight:750;font-size:13.5px;cursor:pointer">${ic(I.plus, 15)}Nouveau jeu</button></div>`;
  return editor + `<div style="border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:20px">${head}${adminSearchBar(S, "Nom du jeu…")}${scrollBox(rows)}<p style="color:var(--text-faint);font-size:11.5px;margin-top:12px">Ces noms sont proposés (chips cliquables) à l'étape 1 de la création d'un tournoi — cliquer dessus au lieu de ressaisir le nom évite les doublons dans les classements.</p></div>`;
}

function adminNews(S: State) {
  const a = S.admin!;
  const e = S.newsEdit;
  const editor = e ? `<div style="border:1px solid rgba(34,211,238,.3);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:20px;margin-bottom:16px">
    <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;margin-bottom:12px">${e.id ? "Modifier l'article" : "Nouvel article"}</div>
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:14px" class="grid2b">
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Titre<input id="n-title" value="${escAttr(e.title)}" placeholder="Titre de l'article" style="${adminInp}" /></label>
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Catégorie<input id="n-cat" value="${escAttr(e.category)}" placeholder="Esport Togo, EA FC…" style="${adminInp}" /></label>
    </div>
    <label style="font-size:12px;color:var(--text-muted);font-weight:600;display:block;margin-top:14px">Contenu<textarea id="n-body" rows="4" placeholder="Texte de l'article…" style="${adminInp};resize:vertical">${escHtml(e.body)}</textarea></label>
    <div style="margin-top:14px"><div style="font-size:12px;color:var(--text-muted);font-weight:600">Image de l'article (jpg, png, webp — redimensionnée automatiquement)</div>${filePicker("n-img", "Choisir une image", "image/*", e.imageUrl)}</div>
    <div style="display:flex;gap:10px;margin-top:14px"><button data-newssave="${e.id || "new"}" style="background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:11px;padding:11px 18px;font-weight:750;font-size:14px;cursor:pointer">${e.id ? "Enregistrer" : "Publier l'article"}</button><button data-newscancel="1" style="background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:11px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer">Annuler</button></div>
  </div>` : "";
  const q = S.adminSearch.trim().toLowerCase();
  const news = q ? a.news.filter((n: Detail) => `${n.title} ${n.category}`.toLowerCase().includes(q)) : a.news;
  const rows = news.length ? news.map((n: Detail) => `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--surface-4);flex-wrap:wrap">
      ${n.imageUrl ? `<img src="${mediaUrl(n.imageUrl)}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:10px;border:1px solid var(--border);flex:none" />` : `<span style="display:grid;place-items:center;width:44px;height:44px;border-radius:10px;background:var(--surface-3);border:1px solid var(--border);color:var(--text-faint);flex:none">${ic(I.image, 17)}</span>`}
      <div style="min-width:0;flex:1"><div style="font-weight:650;font-size:14px">${escHtml(n.title)}</div><div style="font-size:12px;color:var(--text-faint)">${escHtml(n.category)} · ${new Date(n.createdAt).toLocaleDateString("fr-FR")}</div></div>
      <span style="font-size:10.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:${n.published ? "#34D399" : "var(--text-muted)"};background:${n.published ? "rgba(52,211,153,.08)" : "var(--surface)"};border:1px solid ${n.published ? "rgba(52,211,153,.4)" : "var(--border)"};border-radius:99px;padding:4px 10px">${n.published ? "Publié" : "Brouillon"}</span>
      <div style="display:inline-flex;gap:6px">${btnSm(`data-newspub="${n.id}|${n.published ? 0 : 1}"`, n.published ? "Masquer" : "Publier", n.published ? "var(--text-muted)" : "#34D399", n.published ? "var(--border)" : "rgba(52,211,153,.4)")}${btnSm(`data-newsedit="${n.id}"`, "Modifier", "#22D3EE", "#22D3EE55")}${btnSm(`data-newsdel="${n.id}"`, "Supprimer", "#FB7185", "rgba(251,113,133,.35)")}</div></div>`).join("")
    : `<div style="color:var(--text-faint);font-size:13.5px;padding:16px 0;text-align:center">${q ? "Aucun article trouvé." : "Aucun article. Crée le premier !"}</div>`;
  const head = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px">${secTitle(`Actualités (${a.news.length})`)}<button data-newsnew="1" style="display:inline-flex;align-items:center;gap:7px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:11px;padding:10px 16px;font-weight:750;font-size:13.5px;cursor:pointer">${ic(I.plus, 15)}Nouvel article</button></div>`;
  return editor + `<div style="border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:20px">${head}${adminSearchBar(S, "Titre ou catégorie…")}${scrollBox(rows)}</div>`;
}

function adminGallery(S: State) {
  const items = S.gallery ?? [];
  const tourns = S.tourns ?? [];
  const albums: Detail[] = S.albums ?? [];
  const editing = S.galleryEdit;
  const ae = S.albumEdit;
  const albumForm = ae ? `<div style="border:1px solid rgba(34,211,238,.3);border-radius:14px;background:var(--surface-7);padding:16px;margin-bottom:14px">
    <div style="font-size:13.5px;font-weight:700;margin-bottom:10px">${ae.id ? "Renommer le catalogue" : "Nouveau catalogue"}</div>
    <div style="display:grid;grid-template-columns:1fr 2fr;gap:12px" class="grid2b">
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Titre<input id="al-title" value="${escAttr(ae.title)}" placeholder="Survival Cup 2026" style="${adminInp}" /></label>
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Description (optionnelle)<input id="al-desc" value="${escAttr(ae.description)}" placeholder="Photos de la finale et de la remise des prix" style="${adminInp}" /></label>
    </div>
    <div style="display:flex;gap:10px;margin-top:12px">
      <button data-albumsave="1" style="background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:10px;padding:10px 16px;font-weight:750;font-size:13.5px;cursor:pointer">${ae.id ? "Enregistrer" : "Créer le catalogue"}</button>
      <button data-albumcancel="1" style="background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:10px;padding:10px 16px;font-weight:700;font-size:13.5px;cursor:pointer">Annuler</button>
    </div>
  </div>` : "";
  const albumCards = albums.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px">${albums.map((a: Detail) => `
    <div style="border:1px solid var(--border);border-radius:13px;overflow:hidden;background:var(--surface-2)">
      <div style="height:96px;background:${a.coverUrl ? `url('${mediaUrl(a.coverUrl)}') center/cover` : "var(--surface)"};position:relative">
        ${!a.coverUrl ? `<span style="position:absolute;inset:0;display:grid;place-items:center;color:var(--border-strong)">${ic(I.image, 24)}</span>` : ""}
        <span style="position:absolute;bottom:6px;right:6px;font-size:10.5px;font-weight:800;color:var(--text);background:rgba(11,11,17,.8);border-radius:99px;padding:3px 9px">${a.count} média${a.count > 1 ? "s" : ""}</span>
      </div>
      <div style="padding:10px 11px">
        <div style="font-size:13px;font-weight:700;line-height:1.3">${escHtml(a.title)}</div>
        ${a.description ? `<div style="font-size:11px;color:var(--text-faint);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(a.description)}</div>` : ""}
        <div style="display:flex;gap:6px;margin-top:9px;flex-wrap:wrap">
          ${btnSm(`data-galleryadd="${a.id}"`, "+ Ajouter", "#7C82FF", "#7C82FF55")}
          ${btnSm(`data-albumedit="${a.id}"`, "Renommer", "#22D3EE", "#22D3EE55")}
          ${btnSm(`data-albumdel="${a.id}"`, "Supprimer", "#FB7185", "rgba(251,113,133,.35)")}
        </div>
      </div>
    </div>`).join("")}</div>` : `<div style="color:var(--text-faint);font-size:13px;padding:10px 0">Aucun catalogue. Crée-en un pour regrouper les photos d'un même événement.</div>`;
  const albumsSection = `<div style="border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:20px;margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
      ${secTitle(`Catalogues (${albums.length})`)}
      <button data-albumnew="1" style="display:inline-flex;align-items:center;gap:7px;background:var(--surface-3);border:1px dashed var(--border-strong);color:#22D3EE;border-radius:10px;padding:9px 15px;font-weight:700;font-size:13px;cursor:pointer">${ic(I.plus, 15)}Nouveau catalogue</button>
    </div>
    ${albumForm}${albumCards}
  </div>`;
  const editor = editing ? `<div style="border:1px solid rgba(124,130,255,.35);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:20px;margin-bottom:16px">
    <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;margin-bottom:4px">Ajouter à la galerie</div>
    <p style="color:var(--text-muted);font-size:12.5px;margin:0 0 14px">Tu peux sélectionner <b style="color:var(--text)">plusieurs fichiers d'un coup</b> (Ctrl/Cmd ou Maj pour une série). Sans titre, chaque média reprend le nom de son fichier.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px">
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Titre <span style="color:var(--text-faint)">(optionnel)</span><input id="ga-title" placeholder="Finale Survival Cup — remise des prix" style="${adminInp}" /></label>
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Catalogue (optionnel)<select id="ga-album" style="${adminInp}"><option value="">— Hors catalogue —</option>${albums.map((a: Detail) => `<option value="${a.id}" ${editing?.albumId === a.id ? "selected" : ""}>${escAttr(a.title)}</option>`).join("")}</select></label>
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Tournoi lié (optionnel)<select id="ga-tourn" style="${adminInp}"><option value="">—</option>${tourns.map((t) => `<option value="${t.id}">${escAttr(t.name)}</option>`).join("")}</select></label>
    </div>
    <div style="margin-top:14px"><div style="font-size:12px;color:var(--text-muted);font-weight:600">Photos ou vidéos — les photos sont optimisées automatiquement, les vidéos restent limitées à ${MAX_UPLOAD_MB} Mo</div>${filePicker("ga-file", "Choisir les fichiers", "image/*,video/mp4,video/webm", null, true)}</div>
    <div style="display:flex;align-items:center;gap:10px;margin-top:14px;flex-wrap:wrap">
      <button data-gallerysave="1" ${S.galleryBusy ? "disabled" : ""} style="background:${S.galleryBusy ? "var(--surface-4)" : "linear-gradient(135deg,#7C82FF,#5a60e0)"};color:${S.galleryBusy ? "var(--text-faint)" : "#fff"};border:0;border-radius:11px;padding:11px 18px;font-weight:750;font-size:14px;cursor:${S.galleryBusy ? "default" : "pointer"}">${S.galleryBusy ? `Envoi… ${S.galleryBusy}` : "Ajouter"}</button>
      <button data-gallerycancel="1" style="background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:11px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer">Annuler</button>
    </div>
  </div>` : "";
  const q = S.adminSearch.trim().toLowerCase();
  const filtered = q ? items.filter((it: Detail) => `${it.title} ${it.tournament?.name ?? ""} ${it.album?.title ?? ""}`.toLowerCase().includes(q)) : items;
  const grid = filtered.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px">${filtered.map((it: Detail) => `<div style="border:1px solid var(--border);border-radius:14px;overflow:hidden;background:var(--surface-2);position:relative">
      <div style="height:150px;position:relative;background:${it.mediaType === "video" ? "var(--surface)" : `url('${mediaUrl(it.mediaUrl)}')`};background-size:cover;background-position:center">
        ${it.mediaType === "video" ? `<span style="position:absolute;inset:0;display:grid;place-items:center;color:#7C82FF">${ic(I.tv, 30)}</span>` : ""}
        <button data-gallerydel="${it.id}" style="position:absolute;top:8px;right:8px;display:grid;place-items:center;width:28px;height:28px;border-radius:9px;background:rgba(11,11,17,.75);border:1px solid rgba(251,113,133,.4);color:#FB7185;cursor:pointer">${ic(I.trash, 13)}</button>
      </div>
      <div style="padding:11px 12px"><div style="font-size:13px;font-weight:650;line-height:1.35">${escHtml(it.title)}</div>${it.album ? `<div style="font-size:11px;color:#22D3EE;font-weight:700;margin-top:4px">${escHtml(it.album.title)}</div>` : ""}${it.tournament ? `<div style="font-size:11px;color:#7C82FF;font-weight:700;margin-top:4px">${escHtml(it.tournament.name)}</div>` : ""}</div>
    </div>`).join("")}</div>` : `<div style="color:var(--text-faint);font-size:13.5px;padding:24px 0;text-align:center">${q ? "Aucun média trouvé." : "Galerie vide. Ajoute la première photo ou vidéo !"}</div>`;
  const head = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:16px">${secTitle(`Tous les médias (${items.length})`)}<button data-gallerynew="1" style="display:inline-flex;align-items:center;gap:7px;background:linear-gradient(135deg,#7C82FF,#5a60e0);color:#fff;border:0;border-radius:11px;padding:10px 16px;font-weight:750;font-size:13.5px;cursor:pointer">${ic(I.plus, 15)}Ajouter des médias</button></div>`;
  return albumsSection + editor + `<div style="border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:20px">${head}${adminSearchBar(S, "Titre, catalogue ou tournoi…")}${scrollBox(grid)}</div>`;
}

function adminProducts(S: State) {
  const a = S.admin!;
  const e = S.prodEdit;
  const editor = e ? `<div style="border:1px solid rgba(124,130,255,.35);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:20px;margin-bottom:16px">
    <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;margin-bottom:12px">${e.id ? "Modifier le produit" : "Nouveau produit"}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px">
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Nom<input id="pr-name" value="${escAttr(e.name)}" placeholder="Maillot officiel" style="${adminInp}" /></label>
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Catégorie<input id="pr-cat" value="${escAttr(e.category)}" placeholder="Vêtements, Goodies…" style="${adminInp}" /></label>
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Prix (FCFA)<input id="pr-price" type="number" min="0" value="${e.priceXof ?? 0}" style="${adminInp}" /></label>
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Stock<input id="pr-stock" type="number" min="0" value="${e.stock ?? 0}" style="${adminInp}" /></label>
    </div>
    <label style="display:block;font-size:12px;color:var(--text-muted);font-weight:600;margin-top:14px">Description (affichée sur la fiche produit)<textarea id="pr-desc" rows="4" maxlength="1500" placeholder="Taille, matière, contenu, conditions d'utilisation…" style="${adminInp};resize:vertical;font-family:inherit">${escHtml(e.description || "")}</textarea></label>
    <label style="display:flex;align-items:center;gap:8px;margin-top:14px;cursor:pointer"><input id="pr-loyalty" type="checkbox" ${e.loyaltyEligible ? "checked" : ""} style="width:16px;height:16px;accent-color:#22D3EE" /><span style="font-size:13px;color:var(--text)">Éligible à la réduction en points fidélité</span></label>
    <label style="display:flex;align-items:center;gap:8px;margin-top:10px;cursor:pointer"><input id="pr-showhome" type="checkbox" ${e.showOnHome ? "checked" : ""} style="width:16px;height:16px;accent-color:#22D3EE" /><span style="font-size:13px;color:var(--text)">Afficher dans le carrousel boutique de l'accueil</span></label>
    <div style="margin-top:14px"><div style="font-size:12px;color:var(--text-muted);font-weight:600">Image du produit (jpg, png, webp — redimensionnée automatiquement)</div>${filePicker("pr-img", "Choisir une image", "image/*", e.imageUrl)}</div>
    <div style="display:flex;gap:10px;margin-top:14px"><button data-prodsave="${e.id || "new"}" style="background:linear-gradient(135deg,#7C82FF,#5a60e0);color:#fff;border:0;border-radius:11px;padding:11px 18px;font-weight:750;font-size:14px;cursor:pointer">${e.id ? "Enregistrer" : "Ajouter le produit"}</button><button data-prodcancel="1" style="background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:11px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer">Annuler</button></div>
  </div>` : "";
  const q = S.adminSearch.trim().toLowerCase();
  let products = q ? a.products.filter((p: Detail) => `${p.name} ${p.category}`.toLowerCase().includes(q)) : a.products.slice();
  const cats = Array.from(new Set(a.products.map((p: Detail) => p.category).filter(Boolean))) as string[];
  if (S.prodCat !== "Tous") products = products.filter((p: Detail) => p.category === S.prodCat);
  if (S.prodSort) {
    const dir = S.prodSortDir === "asc" ? 1 : -1;
    products = products.slice().sort((x: Detail, y: Detail) => {
      if (S.prodSort === "name") return x.name.localeCompare(y.name) * dir;
      if (S.prodSort === "price") return (x.priceXof - y.priceXof) * dir;
      if (S.prodSort === "stock") return (x.stock - y.stock) * dir;
      return 0;
    });
  }
  const catChips = cats.length > 1 ? `<div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:12px">${["Tous", ...cats].map((c) => `<button data-prodcat="${escAttr(c)}" style="font-size:12px;font-weight:${S.prodCat === c ? 700 : 600};color:${S.prodCat === c ? "#7C82FF" : "var(--text-muted)"};background:${S.prodCat === c ? "rgba(124,130,255,.1)" : "var(--surface)"};border:1px solid ${S.prodCat === c ? "#7C82FF" : "var(--border)"};border-radius:999px;padding:6px 13px;cursor:pointer">${escHtml(c)}</button>`).join("")}</div>` : "";
  const sortTh = (label: string, key: string, right = true) => {
    const active = S.prodSort === key;
    const arrow = active ? (S.prodSortDir === "asc" ? " ↑" : " ↓") : "";
    return `<th data-prodsort="${key}" style="text-align:${right ? "right" : "left"};color:${active ? "#7C82FF" : "var(--text-muted)"};font-size:10.5px;text-transform:uppercase;letter-spacing:1px;padding:12px 8px;font-weight:750;cursor:pointer;user-select:none">${label}${arrow}</th>`;
  };
  const thead = `<tr>${sortTh("Produit", "name", false)}${sortTh("Prix", "price")}${sortTh("Stock", "stock")}<th style="text-align:right;color:var(--text-muted);font-size:10.5px;text-transform:uppercase;letter-spacing:1px;padding:12px 8px;font-weight:750">Actions</th></tr>`;
  const rows = products.length ? products.map((p: Detail) => `<tr style="border-top:1px solid var(--surface-4)">
      <td style="padding:10px 8px"><div style="display:flex;align-items:center;gap:10px">${p.imageUrl ? `<img src="${mediaUrl(p.imageUrl)}" alt="" style="width:38px;height:38px;object-fit:cover;border-radius:9px;border:1px solid var(--border);flex:none" />` : `<span style="display:grid;place-items:center;width:38px;height:38px;border-radius:9px;background:var(--surface-3);border:1px solid var(--border);color:var(--text-faint);flex:none">${ic(I.cart, 15)}</span>`}<div><div style="font-weight:650;display:flex;align-items:center;gap:7px">${escHtml(p.name)}${p.loyaltyEligible ? `<span style="font-size:9.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#04222a;background:#22D3EE;border-radius:99px;padding:2px 7px">Points</span>` : ""}</div><div style="font-size:11.5px;color:var(--text-faint)">${escHtml(p.category)}</div></div></div></td>
      <td style="padding:10px 8px;text-align:right;font-weight:800;color:#22D3EE;white-space:nowrap">${money(p.priceXof)}</td>
      <td style="padding:10px 8px;text-align:right;color:${p.stock > 0 ? "var(--text-muted)" : "#FB7185"};font-weight:700;white-space:nowrap">${p.stock > 0 ? p.stock + " en stock" : "Rupture"}</td>
      <td style="padding:10px 8px;text-align:right"><div style="display:inline-flex;gap:6px">${btnSm(`data-prodedit="${p.id}"`, "Modifier", "#22D3EE", "#22D3EE55")}${btnSm(`data-proddel="${p.id}"`, "Supprimer", "#FB7185", "rgba(251,113,133,.35)")}</div></td></tr>`).join("")
    : `<tr><td colspan="4" style="color:var(--text-faint);font-size:13.5px;padding:16px 0;text-align:center">${q ? "Aucun produit trouvé." : "Aucun produit."}</td></tr>`;
  const head = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px">${secTitle(`Produits (${products.length}/${a.products.length})`)}<button data-prodnew="1" style="display:inline-flex;align-items:center;gap:7px;background:linear-gradient(135deg,#7C82FF,#5a60e0);color:#fff;border:0;border-radius:11px;padding:10px 16px;font-weight:750;font-size:13.5px;cursor:pointer">${ic(I.plus, 15)}Nouveau produit</button></div>`;
  return editor + `<div style="border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:20px">${head}${adminSearchBar(S, "Nom ou catégorie…")}${catChips}${scrollBox(`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px;min-width:480px"><thead>${thead}</thead><tbody>${rows}</tbody></table></div>`)}</div>`;
}

/** Onglet Fidélité : taux de conversion des points (valeur en FCFA, plafond de réduction). */
function adminLoyalty(S: State) {
  const ly = S.site?.loyalty || { pointValueXof: 100, maxRedeemPercent: 50 };
  const ok = S.siteMsg === "Réglages enregistrés.";
  return card(`
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
      ${secTitle("Points fidélité")}
      ${S.siteMsg ? `<span style="color:${ok ? "#34D399" : "#FB7185"};font-size:13px;font-weight:700">${S.siteMsg}</span>` : ""}
    </div>
    <p style="color:var(--text-muted);font-size:13.5px;line-height:1.7;margin:0 0 18px">Chaque participation validée à un tournoi Miabe rapporte 1 point (désactivable par tournoi). Les membres peuvent ensuite dépenser leurs points sur les produits marqués « éligibles » en boutique, ou sur les frais d'inscription d'un futur tournoi.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Valeur d'un point (FCFA)<input id="ly-value" type="number" min="1" value="${ly.pointValueXof}" style="${adminInp}" /></label>
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Plafond de réduction (% du montant)<input id="ly-percent" type="number" min="0" max="100" value="${ly.maxRedeemPercent}" style="${adminInp}" /></label>
    </div>
    <div style="margin-top:16px"><button data-loyaltysave="1" style="background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:12px 22px;font-weight:750;font-size:14px;cursor:pointer">Enregistrer</button></div>
    <p style="color:var(--text-faint);font-size:12px;margin:14px 0 0">L'éligibilité produit se règle depuis l'onglet Produits, et le gain de point par tournoi depuis l'assistant de création (étape 1).</p>
  `);
}

/** Onglet Crédits organisateur : tarif + quota gratuit, et confirmation des demandes d'achat en attente. */
function adminCredits(S: State) {
  const cr = S.site?.credits || { priceXof: 750, freeTournaments: 1 };
  const ok = S.siteMsg === "Réglages enregistrés.";
  const settingsCard = card(`
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
      ${secTitle("Crédits organisateur")}
      ${S.siteMsg ? `<span style="color:${ok ? "#34D399" : "#FB7185"};font-size:13px;font-weight:700">${S.siteMsg}</span>` : ""}
    </div>
    <p style="color:var(--text-muted);font-size:13.5px;line-height:1.7;margin:0 0 18px">Un organisateur peut héberger ses premiers tournois gratuitement (quota ci-dessous), puis doit avoir du crédit pour en créer d'autres — 1 crédit = 1 tournoi hébergé. Pas de passerelle de paiement : l'organisateur choisit un moyen de paiement, tu confirmes ici à réception.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Prix d'un crédit (FCFA)<input id="cr-price" type="number" min="1" value="${cr.priceXof}" style="${adminInp}" /></label>
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Tournois gratuits offerts<input id="cr-free" type="number" min="0" value="${cr.freeTournaments}" style="${adminInp}" /></label>
    </div>
    <div style="margin-top:16px"><button data-creditssave="1" style="background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:12px 22px;font-weight:750;font-size:14px;cursor:pointer">Enregistrer</button></div>
  `);
  const purchases: Detail[] = S.admin?.creditPurchases ?? [];
  const rows = purchases.length ? purchases.map((p: Detail) => {
    const isPending = p.status === "pending";
    return `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--surface-4);flex-wrap:wrap">
      <div style="min-width:0;flex:1"><div style="font-weight:650;font-size:14px">${escHtml(p.user?.displayName)} <span style="color:var(--text-faint);font-weight:400;font-size:12px">· ${p.credits} crédit${p.credits > 1 ? "s" : ""}</span></div><div style="font-size:12px;color:var(--text-faint)">${escHtml(p.user?.email)}${p.user?.phone ? " · " + escHtml(p.user.phone) : ""} · ${escHtml(p.paymentMethod)}</div></div>
      <span style="font-weight:800;color:#22D3EE;white-space:nowrap">${money(p.amountXof)}</span>
      ${isPending
        ? `<button data-confirmcredit="${p.id}" style="font-size:12px;font-weight:750;border-radius:9px;padding:8px 14px;cursor:pointer;background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.4);color:#34D399">Confirmer</button>`
        : `<span style="font-size:10.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#34D399;background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.35);border-radius:99px;padding:4px 10px">Payé</span>`}
      </div>`;
  }).join("") : `<div style="color:var(--text-faint);font-size:13.5px;padding:16px 0;text-align:center">Aucune demande d'achat de crédits pour l'instant.</div>`;
  const pendingCount = purchases.filter((p: Detail) => p.status === "pending").length;
  const purchasesCard = card(`${secTitle(`Demandes d'achat (${purchases.length})${pendingCount ? ` · ${pendingCount} en attente` : ""}`)}${scrollBox(rows)}`, "20px");
  return settingsCard + `<div style="margin-top:16px">${purchasesCard}</div>`;
}

const ORG_STATUS_LABEL: Record<string, [string, string]> = {
  PENDING: ["En attente", "#FBBF24"], APPROVED: ["Approuvé", "#34D399"], REJECTED: ["Refusé", "#FB7185"],
};
/** Onglet admin « Organisateurs » : validation des demandes + plafonds (nb de tournois, joueurs max) par compte. */
function adminOrganizers(S: State) {
  const orgs: Detail[] = S.admin?.organizers ?? [];
  const q = S.adminSearch.trim().toLowerCase();
  const filtered = q ? orgs.filter((o: Detail) => `${o.displayName} ${o.email}`.toLowerCase().includes(q)) : orgs;
  const capField = (id: string, label: string, key: string, value: number | null, min: number) =>
    `<label style="font-size:11px;color:var(--text-muted);font-weight:600">${label}<input id="org-${key}-${id}" type="number" min="${min}" placeholder="Illimité" value="${value ?? ""}" style="${adminInp};margin-top:4px" /></label>`;
  const rows = filtered.length ? filtered.map((o: Detail) => {
    const [label, color] = ORG_STATUS_LABEL[o.organizerStatus as string] || ["—", "var(--text-muted)"];
    return `<div style="border-top:1px solid var(--surface-4);padding:14px 0">
      <div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div style="min-width:0;flex:1">
          <div style="font-weight:650;font-size:14px">${escHtml(o.displayName)} <span style="font-size:10.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:${color};background:${color}18;border:1px solid ${color}55;border-radius:99px;padding:3px 9px;margin-left:6px">${label}</span></div>
          <div style="font-size:12px;color:var(--text-faint);margin-top:2px">${escHtml(o.email)}${o.phone ? " · " + escHtml(o.phone) : ""} · ${o.tournamentCount} tournoi${o.tournamentCount > 1 ? "s" : ""} créé${o.tournamentCount > 1 ? "s" : ""}</div>
          ${o.organizerNote ? `<div style="font-size:12.5px;color:var(--text-muted);margin-top:8px;padding:10px 12px;background:var(--surface-7);border-radius:9px;border:1px solid var(--surface-3)">${escHtml(o.organizerNote)}</div>` : ""}
        </div>
      </div>
      <div style="display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;margin-top:12px">
        ${capField(o.id, "Tournois max", "maxt", o.organizerMaxTournaments, 0)}
        ${capField(o.id, "Joueurs max / tournoi", "maxp", o.organizerMaxPlayers, 1)}
        <span style="flex:1"></span>
        ${o.organizerStatus !== "REJECTED" ? `<button data-orgreject="${o.id}" style="font-size:12px;font-weight:700;border-radius:9px;padding:9px 14px;cursor:pointer;background:transparent;border:1px solid rgba(251,113,133,.4);color:#FB7185">Refuser</button>` : ""}
        <button data-orgapprove="${o.id}" style="font-size:12px;font-weight:750;border-radius:9px;padding:9px 16px;cursor:pointer;background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.4);color:#34D399">${o.organizerStatus === "APPROVED" ? "Enregistrer les plafonds" : "Approuver"}</button>
      </div>
    </div>`;
  }).join("") : `<div style="color:var(--text-faint);font-size:13.5px;padding:16px 0;text-align:center">${q ? "Aucun organisateur trouvé." : "Aucun compte organisateur pour l'instant."}</div>`;
  const pendingCount = orgs.filter((o: Detail) => o.organizerStatus === "PENDING").length;
  return card(`${secTitle(`Organisateurs (${orgs.length})${pendingCount ? ` · ${pendingCount} en attente` : ""}`)}${adminSearchBar(S, "Nom ou email…")}${scrollBox(rows)}`);
}


/** Onglet « Pages légales » : édition des mentions légales et de la politique de confidentialité.
 * Texte libre volontairement simple (« ## » pour un titre, « - » pour une puce) : ces pages doivent
 * pouvoir être corrigées après une relecture juridique sans intervention technique. */
function adminLegal(S: State) {
  const l = (S.site?.legal ?? {}) as { title?: string; body?: string };
  const pv = (S.site?.privacy ?? {}) as { title?: string; body?: string };
  const ok = S.siteMsg === "Réglages enregistrés.";
  const todo = [l.body, pv.body].filter(Boolean).join("\n").split("À COMPLÉTER").length - 1;
  const warn = todo > 0
    ? `<div style="display:flex;align-items:flex-start;gap:10px;padding:13px 16px;border-radius:12px;margin-bottom:16px;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.35)">
        <span style="color:#FBBF24;flex:none;margin-top:1px">${ic(I.warn, 17)}</span>
        <div style="font-size:13px;color:var(--text-muted);line-height:1.6"><b style="color:#FBBF24">${todo} mention${todo > 1 ? "s" : ""} à compléter</b> — cherche « À COMPLÉTER » dans les textes ci-dessous. Ces pages sont publiques : les renseigner est une obligation légale.</div>
      </div>`
    : "";
  const editor = (key: "lg" | "pv", label: string, doc: { title?: string; body?: string }, hint: string) => card(`
    ${secTitle(label)}
    <p style="color:var(--text-muted);font-size:12.5px;margin:0 0 14px">${hint}</p>
    <label style="font-size:12px;color:var(--text-muted);font-weight:600;display:block">Titre de la page<input id="${key}-title" value="${escAttr(doc.title)}" style="${adminInp}" /></label>
    <label style="font-size:12px;color:var(--text-muted);font-weight:600;display:block;margin-top:14px">Contenu<textarea id="${key}-body" rows="18" style="${adminInp};resize:vertical;font-family:'JetBrains Mono',monospace;font-size:12.5px;line-height:1.7">${escHtml(doc.body)}</textarea></label>`, "20px");
  return `${warn}
    <p style="color:var(--text-muted);font-size:13px;line-height:1.7;margin:0 0 16px">Mise en forme : une ligne commençant par <b style="color:var(--text)">##</b> devient un titre, une ligne commençant par <b style="color:var(--text)">-</b> devient une puce, une ligne vide sépare les paragraphes.</p>
    ${editor("lg", "Mentions légales", l, "Identité de l'éditeur, hébergeur, responsabilité. Page publique, accessible depuis le pied de page.")}
    <div style="margin-top:16px">${editor("pv", "Politique de confidentialité", pv, "Données collectées, finalités, durées de conservation et droits des membres.")}</div>
    <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:16px">
      <button data-legalsave="1" style="background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:13px 24px;font-weight:750;font-size:15px;cursor:pointer">Enregistrer les pages</button>
      ${S.siteMsg ? `<span style="color:${ok ? "#34D399" : "#FB7185"};font-size:13px;font-weight:700">${S.siteMsg}</span>` : ""}
    </div>`;
}

function adminPayments(S: State) {
  const a = S.admin!;
  const q = S.adminSearch.trim().toLowerCase();
  const payments = q
    ? a.payments.filter((r: Detail) => `${r.playerName} ${r.tournament?.name ?? ""} ${r.user?.displayName ?? ""} ${r.user?.email ?? ""}`.toLowerCase().includes(q))
    : a.payments;
  const rows = payments.length ? payments.map((r: Detail) => {
    const isPending = r.paymentStatus === "pending";
    return `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--surface-4);flex-wrap:wrap">
      <div style="min-width:0;flex:1"><div style="font-weight:650;font-size:14px">${escHtml(r.playerName)} <span style="color:var(--text-faint);font-weight:400;font-size:12px">· ${escHtml(r.tournament?.name)}</span></div><div style="font-size:12px;color:var(--text-faint)">${escHtml(r.user?.displayName)} · ${escHtml(r.user?.email)} · ${escHtml(r.paymentMethod)}</div></div>
      <span style="font-weight:800;color:#22D3EE;white-space:nowrap">${money(r.amountXof)}</span>
      ${isPending
        ? `<button data-confirmpay="${r.tournament?.id}|${r.id}" style="font-size:12px;font-weight:750;border-radius:9px;padding:8px 14px;cursor:pointer;background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.4);color:#34D399">Confirmer</button>`
        : `<span style="font-size:10.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#34D399;background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.35);border-radius:99px;padding:4px 10px">Payé</span>`}
      </div>`;
  }).join("") : `<div style="color:var(--text-faint);font-size:13.5px;padding:16px 0;text-align:center">${q ? "Aucun paiement trouvé." : "Aucun paiement d'inscription pour l'instant."}</div>`;
  const pendingCount = a.payments.filter((r: Detail) => r.paymentStatus === "pending").length;
  return card(`${secTitle(`Paiements des inscriptions (${a.payments.length})${pendingCount ? ` · ${pendingCount} en attente` : ""}`)}${adminSearchBar(S, "Joueur, tournoi ou email…")}${scrollBox(rows)}`);
}

const ORDER_STATUS: Record<string, [string, string]> = {
  pending: ["En attente", "#FBBF24"], paid: ["Payée", "#34D399"], delivered: ["Livrée", "#22D3EE"], cancelled: ["Annulée", "#FB7185"],
};

function adminOrders(a: NonNullable<State["admin"]>) {
  const orders = a.orders as Detail[];
  const confirmed = orders.filter((o) => o.status === "paid" || o.status === "delivered");
  const revenue = confirmed.reduce((sum, o) => sum + o.totalXof, 0);
  const pending = orders.filter((o) => o.status === "pending").length;
  const stat = (v: string | number, k: string, color = "var(--text)") => `<div style="border:1px solid var(--border);border-radius:14px;background:var(--surface);padding:16px"><div style="font-family:'Bebas Neue',sans-serif;font-size:28px;line-height:1;color:${color}">${v}</div><div style="font-size:11px;letter-spacing:.8px;text-transform:uppercase;color:var(--text-muted);font-weight:700;margin-top:6px">${k}</div></div>`;
  const summary = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;margin-bottom:18px">
    ${stat(orders.length, "Commandes")}${stat(money(revenue), "Revenu confirmé", "#34D399")}${stat(pending, "En attente", pending > 0 ? "#FBBF24" : "var(--text)")}</div>`;
  const rows = orders.length ? orders.map((o: Detail) => {
    const [sl, sc] = ORDER_STATUS[o.status] || [o.status, "var(--text-muted)"];
    const items = Array.isArray(o.items) ? o.items.map((i: Detail) => i.name).join(", ") : "";
    const stBtns = ["paid", "delivered", "cancelled"].filter((s) => s !== o.status)
      .map((s) => btnSm(`data-ordstatus="${o.id}|${s}"`, ORDER_STATUS[s][0], ORDER_STATUS[s][1], ORDER_STATUS[s][1] + "55")).join("");
    return `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--surface-4);flex-wrap:wrap">
      <div style="min-width:0;flex:1"><div style="font-weight:650;font-size:14px">${o.reference} <span style="color:var(--text-faint);font-weight:400;font-size:12px">· ${o.user ? escHtml(o.user.displayName) + " (" + escHtml(o.user.email) + ")" : "invité"}</span></div>
      <div style="font-size:12px;color:var(--text-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:520px">${escHtml(items || o.paymentMethod || "Aucun article")} · ${new Date(o.createdAt).toLocaleDateString("fr-FR")}</div></div>
      <span style="font-weight:800;color:#22D3EE;white-space:nowrap">${money(o.totalXof)}</span>
      <span style="font-size:10.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:${sc};background:${sc}14;border:1px solid ${sc}55;border-radius:99px;padding:4px 10px">${sl}</span>
      <div style="display:inline-flex;gap:6px">${stBtns}</div></div>`;
  }).join("") : `<div style="color:var(--text-faint);font-size:13.5px;padding:16px 0;text-align:center">Aucune commande.</div>`;
  return summary + card(secTitle(`Commandes (${orders.length})`) + scrollBox(rows));
}

/** Premier match jouable de la phase finale (tous formats confondus) — utilisé par le panneau d'arbitrage et le Mode Show. */
/** Regroupe tous les matchs de la phase finale, quel que soit le format (hors battle_royale, qui n'a pas de duels 1v1). */
function finalsMatchGroups(finals: Detail): Detail[][] {
  const pools: Detail[][] = [];
  // battle_royale n'a pas de duels 1v1 ; survival n'a pas de matchId (voir Engine.reportResult, tout
  // passe par poolId) — les deux sont hors de ce regroupement, consultés via t.pools[0] à la place.
  if (!finals || finals.format === "battle_royale" || finals.format === "survival") return pools;
  if (finals.format === "roundrobin") pools.push(finals.matches);
  else if (finals.format === "double") {
    finals.wb.forEach((r: Detail) => pools.push(r.matches));
    finals.lb.forEach((r: Detail) => pools.push(r.matches));
    pools.push(finals.gf2 ? [finals.gf, finals.gf2] : [finals.gf]);
  } else {
    finals.rounds.forEach((r: Detail) => pools.push(r.matches));
    if (finals.thirdPlace) pools.push([finals.thirdPlace]);
  }
  return pools;
}
/** Comme finalsMatchGroups, mais en conservant le nom de l'étape de chaque affiche. Le Mode Show
 * s'en sert pour annoncer « Winners · Finale » ou « Grande finale » plutôt que deux noms sans
 * contexte — sans quoi le public ne sait pas où en est le tournoi. */
function finalsLabelledMatches(finals: Detail): { label: string; m: Detail }[] {
  const out: { label: string; m: Detail }[] = [];
  const push = (label: string, ms: Detail[]) => (ms || []).forEach((m) => m && out.push({ label, m }));
  if (!finals || finals.format === "battle_royale" || finals.format === "survival") return out;
  if (finals.format === "roundrobin") push("Round Robin", finals.matches);
  else if (finals.format === "double") {
    (finals.wb || []).forEach((r: Detail) => push(r.label, r.matches));
    (finals.lb || []).forEach((r: Detail) => push(r.label, r.matches));
    push("Grande finale", finals.gf2 ? [finals.gf, finals.gf2] : [finals.gf]);
  } else {
    (finals.rounds || []).forEach((r: Detail) => push(r.label, r.matches));
    if (finals.thirdPlace) push("Petite finale", [finals.thirdPlace]);
  }
  return out;
}
function findPlayableFinalsMatch(finals: Detail): Detail | null {
  for (const arr of finalsMatchGroups(finals)) for (const m of arr) if (m && m.playable) return m;
  return null;
}
function findFinalsMatchById(finals: Detail, matchId: string): Detail | null {
  for (const arr of finalsMatchGroups(finals)) for (const m of arr) if (m && m.matchId === matchId) return m;
  return null;
}
/** matchId -> id de l'entrée de journal correspondante (voir Engine.correctResult) — permet au
 * crayon (matchTreeBox, journeeCalendar) de retrouver quelle correction déclencher pour une case
 * donnée. Fonctionne aussi bien pour les matchs de phase finale que pour un round robin de poule
 * (Engine.currentMatch pose matchId dans les deux cas). */
function logByMatchId(log: Detail[]): Record<string, string> {
  const out: Record<string, string> = {};
  (log || []).forEach((l: Detail) => { if (l.matchId) out[l.matchId] = l.id; });
  return out;
}

/** Battle Royale — classement + saisie des résultats, partagé entre régie et page publique (comme
 * poolCard/journeeCalendar). Onglets de parties (S.brActiveGame) : celles déjà jouées restent
 * consultables (résultat + éliminations), seule la prochaine encore à jouer est éditable — pas de
 * clic dans l'ordre d'arrivée mais un vrai placement + un nombre d'éliminations par joueur, en
 * inputs non contrôlés lus à la validation (voir data-brsubmit) comme la saisie de score des poules. */
function battleRoyaleCenter(S: State, t: Detail, manage: boolean): string {
  const f = t.finals;
  const champ = f.champion
    ? `<div style="border:1px solid rgba(251,191,36,.4);border-radius:16px;background:linear-gradient(180deg,rgba(251,191,36,.08),var(--surface));padding:24px;text-align:center;margin-bottom:18px"><div style="font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:#FBBF24;font-weight:800">${ic(I.crown, 16)} Champion du tournoi</div><div style="font-family:'Bebas Neue',sans-serif;font-size:44px;letter-spacing:1px;margin-top:6px">${escHtml(f.champion)}</div></div>`
    : "";
  const games: Detail[] = f.games;
  const nextGame = games.find((g: Detail) => !g.played) || null;
  const active = games.find((g: Detail) => g.id === S.brActiveGame) || nextGame || games[games.length - 1];
  // Barème réglé avant lancement (voir wizBrScoringStep) — rappelé ici pour que "pourquoi ce total ?"
  // ait toujours une réponse sous les yeux, sans devoir rouvrir l'assistant.
  const legend = `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:13px 16px;border:1px solid var(--border);border-radius:12px;background:var(--surface-8);margin-bottom:18px">
    <span style="font-size:10px;letter-spacing:1.3px;text-transform:uppercase;color:#22D3EE;font-weight:800;flex:none">Barème</span>
    ${f.pointsTable.slice(0, 8).map((p: number, i: number) => `<span style="font-size:12px;color:#9aa5b1;background:rgba(255,255,255,.03);border-radius:8px;padding:5px 10px"><b style="color:#c7d0db">${i === 0 ? "1er" : i === 1 ? "2e" : `${i + 1}e`}</b> · <span style="color:#22D3EE;font-weight:700">${p} pts</span></span>`).join("")}
    ${f.killPoints ? `<span style="font-size:12px;color:#9aa5b1;background:rgba(255,255,255,.03);border-radius:8px;padding:5px 10px"><b style="color:#c7d0db">+${f.killPoints}</b> / élimination</span>` : ""}
  </div>`;
  const tabs = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${games.map((g: Detail, i: number) => {
    const on = g.id === active.id;
    return `<button data-brgametab="${g.id}" style="font-size:12px;font-weight:700;border-radius:9px;padding:8px 14px;cursor:pointer;background:${on ? "#22D3EE" : "rgba(255,255,255,.04)"};border:1px solid ${on ? "#22D3EE" : "var(--border)"};color:${on ? "#04141a" : g.played ? "var(--text-muted)" : "#22D3EE"}">Partie ${i + 1}${!g.played && g.id === nextGame?.id ? " · à jouer" : ""}</button>`;
  }).join("")}</div>`;
  const players: { id: string; name: string }[] = Array.isArray(t.players) ? t.players : [];
  let entry: string;
  if (active.played) {
    const rows = (active.ranking as Detail[]).map((r: Detail) => `<div style="display:grid;grid-template-columns:44px 1fr 90px 90px;align-items:center;padding:9px 14px;border-bottom:1px solid var(--surface-3)">
      <span style="font-family:'Bebas Neue',sans-serif;font-size:16px;color:${r.rank === 1 ? "#FBBF24" : "var(--text-faint)"}">${r.rank}</span>
      <span style="font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(r.name)}</span>
      <span style="text-align:right;font-size:12.5px;color:var(--text-muted)">${r.kills} élim.</span>
      <span style="text-align:right;font-family:'JetBrains Mono',monospace;font-weight:750;color:#22D3EE">${r.pts} pts</span>
    </div>`).join("");
    entry = `<div style="border:1px solid var(--border);border-radius:14px;overflow:hidden;background:var(--surface-8)">${rows}</div>`;
  } else if (manage) {
    const rows = players.map((p, i) => `<div style="display:grid;grid-template-columns:1fr 110px 110px;gap:10px;align-items:center;padding:8px 14px;border-bottom:1px solid var(--surface-3)">
      <span style="font-size:13.5px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p.name)}</span>
      <input id="br-pl-${p.id}" type="number" min="1" max="${players.length}" value="${i + 1}" style="width:100%;text-align:center;background:#141b26;border:1px solid rgba(255,255,255,.12);border-radius:8px;color:var(--text);font-family:'JetBrains Mono',monospace;font-weight:700;font-size:13px;padding:7px" />
      <input id="br-kl-${p.id}" type="number" min="0" value="0" style="width:100%;text-align:center;background:#141b26;border:1px solid rgba(255,255,255,.12);border-radius:8px;color:var(--text);font-family:'JetBrains Mono',monospace;font-weight:700;font-size:13px;padding:7px" />
    </div>`).join("");
    entry = `<div style="border:1px solid var(--border);border-radius:14px;overflow:hidden;background:var(--surface-8)">
      <div style="display:grid;grid-template-columns:1fr 110px 110px;gap:10px;padding:12px 14px 8px;font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:var(--text-faint);font-weight:800"><span>Joueur</span><span style="text-align:center">Placement</span><span style="text-align:center">Élims</span></div>
      ${rows}
      <div style="padding:14px"><button data-brsubmit="${active.id}" style="width:100%;background:linear-gradient(135deg,#22D3EE,#0891b2);color:#04141a;border:0;border-radius:10px;padding:12px;font-weight:800;font-size:13px;letter-spacing:.4px;cursor:pointer">Valider les résultats du match</button></div>
    </div>`;
  } else {
    entry = `<div style="border:1px dashed var(--border);border-radius:14px;padding:30px;text-align:center;color:var(--text-faint);font-size:13px">En attente des résultats de cette partie.</div>`;
  }
  // Classement : une colonne par partie (placement + points de cette partie), éliminations
  // cumulées, total, et WWCD (nombre de victoires) — pas seulement le total, qui ne dit pas d'où
  // viennent les points (régularité vs coup d'éclat sur une seule partie). Extrait dans
  // brLeaderboardTable pour être régénéré en direct à la frappe (voir brRecalcLeaderboard) sans
  // dupliquer le rendu.
  const standings = f.standings as Detail[];
  const leaderboard = `<div id="br-leaderboard" style="overflow-x:auto">${brLeaderboardTable(standings, games.length)}</div>`;
  return `${champ}${legend}
    <div class="grid2c" style="display:grid;grid-template-columns:400px 1fr;gap:20px;align-items:start">
      <div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:1px;margin-bottom:14px;display:flex;align-items:center;gap:10px"><span style="width:5px;height:20px;border-radius:3px;background:#22D3EE"></span>Saisie des résultats</div>
        ${tabs}${entry}
      </div>
      <div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:1px;margin-bottom:14px;display:flex;align-items:center;gap:10px"><span style="width:5px;height:20px;border-radius:3px;background:#22D3EE"></span>Classement général · ${games.filter((g: Detail) => g.played).length}/${games.length} parties</div>
        ${leaderboard}
      </div>
    </div>`;
}
/** Tableau de classement Battle Royale — factorisé pour être appelé à la fois par le rendu React
 * normal (battleRoyaleCenter) et par brRecalcLeaderboard (recalcul en direct à la frappe, sans
 * re-rendu React, voir le commentaire de cette dernière) : un seul endroit qui sait dessiner une ligne. */
function brLeaderboardTable(standings: Detail[], gamesCount: number): string {
  const gridCols = `34px 1fr 62px repeat(${gamesCount}, 60px) 74px 56px`;
  const headRow = `<div style="display:grid;grid-template-columns:${gridCols};gap:6px;padding:0 14px 10px;align-items:center">
    <div></div><div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--text-faint);font-weight:800">Joueur</div>
    <div style="text-align:center;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--text-faint);font-weight:800">Élims</div>
    ${Array.from({ length: gamesCount }, (_, i) => `<div style="text-align:center;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--text-faint);font-weight:800">M${i + 1}</div>`).join("")}
    <div style="text-align:center;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--text-faint);font-weight:800">Total</div>
    <div style="text-align:center;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--text-faint);font-weight:800">WWCD</div>
  </div>`;
  const bodyRows = standings.map((r: Detail, i: number) => {
    const top = i < 3;
    const gameCells = (r.games as Detail[]).map((g: Detail) => g.played
      ? `<div style="text-align:center;${g.preview ? "opacity:.6" : ""}"><div style="font-family:'Bebas Neue',sans-serif;font-size:13px;font-weight:700;color:${g.rank === 1 ? "#FBBF24" : g.rank <= 3 ? "#22D3EE" : "var(--text-muted)"}">#${g.rank}</div><div style="font-size:9px;color:var(--text-faint)">${g.pts}p</div></div>`
      : `<div style="text-align:center;color:#33384a;font-size:12px">—</div>`).join("");
    return `<div style="display:grid;grid-template-columns:${gridCols};gap:6px;align-items:center;padding:9px 14px;border-top:1px solid var(--surface-3);${top ? "background:rgba(34,211,238,.05);border-radius:10px;" : ""}">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;color:${i === 0 ? "#FBBF24" : top ? "#22D3EE" : "var(--text-faint)"}">${i + 1}</div>
      <div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px;font-weight:600">${escHtml(r.name)}</div>
      <div style="text-align:center;font-size:13px;font-weight:700;color:var(--text-muted)">${r.kills}</div>
      ${gameCells}
      <div style="text-align:center;font-family:'Bebas Neue',sans-serif;font-size:18px;font-weight:700;color:#22D3EE">${r.pts}</div>
      <div style="text-align:center;font-weight:700;color:${r.wins > 0 ? "#FBBF24" : "#4b5563"}">${r.wins}</div>
    </div>`;
  }).join("");
  return `<div style="min-width:${360 + gamesCount * 62}px">${headRow}${bodyRows}</div>`;
}

/** Affiche imprimable (résultats) : classement général, qualifiés par poule, phase finale. Données réelles uniquement (mêmes champs que le cockpit). */
/** Affiche imprimable : au lieu d'un mini résumé maison (les rondes suivantes n'ayant pas encore de
 * nom réduites à des "—", le rendu paraissait cassé), on réutilise EXACTEMENT les mêmes composants
 * que l'écran (bracketTree/doubleElimTree/journeeCalendar/poolCard) — même arbre avec ses connecteurs,
 * mêmes cartes de poule. `dummyS` : ces composants prennent S en paramètre mais, appelés ici avec
 * manage=false partout (l'affiche est un instantané, jamais interactive), aucun de ses champs n'est
 * réellement lu — un objet vide suffit. */
function buildPoster(t: Detail): string {
  const dummyS = {} as State;
  const meta = [t.game, t.date, t.place].filter(Boolean).map((v: string) => escHtml(v)).join("  ·  ");
  // Classement général : concaténation des classements de chaque poule pour Survival (pts déjà cumulés sur tout le tournoi par le moteur) ;
  // pour les formats sans poules (single/double/roundrobin/swiss/battle_royale), repli sur le classement global format-agnostique de l'API.
  const overall: Detail[] = (t.pools || []).length
    ? ([] as Detail[]).concat(...t.pools.map((p: Detail) => p.ranking || [])).sort((a: Detail, b: Detail) => b.pts - a.pts || b.wins - a.wins)
    : (t.standings || []);
  let champHtml = "";
  if (t.status === "finished" && t.champion) {
    const top3 = overall.slice(0, 3);
    champHtml = `<div class="pa-champ"><div class="pa-clabel">Champion du tournoi</div><div class="pa-cname">${escHtml(t.champion)}</div></div>
      <div class="pa-podium">${top3.map((r: Detail, i: number) => `<div class="pa-pod"><span class="pa-rk">${i + 1}</span> ${escHtml(r.name)} <span class="pa-pp">${r.pts} pts</span></div>`).join("")}</div>`;
  }
  const standings = `<table class="pa-table"><thead><tr><th>#</th><th>Joueur</th><th>V</th><th>Points</th></tr></thead>
    <tbody>${overall.slice(0, 16).map((r: Detail, i: number) => `<tr><td>${i + 1}</td><td>${escHtml(r.name)}</td><td>${r.wins}</td><td><b>${r.pts}</b></td></tr>`).join("")}</tbody></table>`;
  // Poules : les vraies cartes (calendrier ou match en cours + classement complet J/G/P/Pts), pas un
  // simple "top1, top2" résumé — c'est tout l'intérêt de reproduire l'écran plutôt que le réinventer.
  const poolsHtml = (t.pools || []).length
    ? `<div class="pa-h" style="margin-top:14px">Poules</div><div class="pa-poolsgrid">${t.pools.map((p: Detail) => `<div class="pa-nostrip">${poolCard(dummyS, p, false, t.poolFormat, t.countGoalDiff)}</div>`).join("")}</div>`
    : "";
  // overflow-x:auto / max-height:…px + overflow-y:auto n'ont aucun sens sur une page imprimée (rien à
  // faire défiler) : ça couperait l'arbre ou le calendrier en plein milieu. On les neutralise sur cette
  // copie de rendu uniquement — la vraie page à l'écran garde son scroll normalement.
  const unscroll = (html: string) => html.replace(/overflow(-x|-y)?:\s*auto/g, "overflow$1:visible").replace(/max-height:[^;"]+;?/g, "");
  let bracketHtml = "";
  if (t.finals) {
    const f = t.finals;
    if (f.format === "single") {
      bracketHtml = unscroll(bracketTree(f.rounds, [], false))
        + (f.thirdPlace ? `<div class="pa-h" style="font-size:13px;margin-top:14px">Petite finale · 3e place</div><div style="max-width:280px">${matchBox(f.thirdPlace, false)}</div>` : "");
    } else if (f.format === "double") {
      bracketHtml = unscroll(doubleElimTree(f, [], false));
    } else if (f.format === "roundrobin") {
      const names = f.standings.map((r: Detail) => ({ id: r.id, name: r.name }));
      const showDiff = t.countGoalDiff !== false;
      const rowsHtml = f.standings.map((r: Detail, i: number) => `<tr><td>${i + 1}</td><td>${escHtml(r.name)}</td><td>${r.played}</td><td>${r.wins}</td><td>${r.losses}</td>${showDiff ? `<td>${r.gd > 0 ? "+" : ""}${r.gd}</td>` : ""}<td><b>${r.pts}</b></td></tr>`).join("");
      const table = `<table class="pa-table"><thead><tr><th>#</th><th>Joueur</th><th>J</th><th>G</th><th>P</th>${showDiff ? "<th>Diff.</th>" : ""}<th>Pts</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
      bracketHtml = table + `<div style="margin-top:10px">${unscroll(journeeCalendar(names, f.matches, false, () => null, false))}</div>`;
    } else if (f.format === "swiss") {
      const rowsHtml = f.standings.map((r: Detail, i: number) => `<tr><td>${i + 1}</td><td>${escHtml(r.name)}</td><td>${r.wins}</td><td>${r.buchholz}</td></tr>`).join("");
      const table = `<table class="pa-table"><thead><tr><th>#</th><th>Joueur</th><th>V</th><th>Buchholz</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
      const lastRound = f.rounds[f.rounds.length - 1];
      bracketHtml = table + (lastRound ? `<div class="pa-h" style="font-size:13px;margin-top:10px">${escHtml(lastRound.label)}</div><div class="pa-poolsgrid">${lastRound.matches.map((m: Detail) => `<div style="max-width:220px">${matchBox(m, false)}</div>`).join("")}</div>` : "");
    } else if (f.format === "battle_royale") {
      bracketHtml = `<table class="pa-table"><thead><tr><th>#</th><th>Joueur</th><th>Points</th></tr></thead><tbody>${f.standings.map((r: Detail, i: number) => `<tr><td>${i + 1}</td><td>${escHtml(r.name)}</td><td><b>${r.pts}</b></td></tr>`).join("")}</tbody></table>`;
    }
  }
  const now = new Date().toLocaleString("fr-FR");
  return `<div class="pa">
    <div class="pa-head"><div class="pa-brand">MIABE ESPORT</div><div class="pa-title">${escHtml(t.name)}</div>${meta ? `<div class="pa-meta">${meta}</div>` : ""}</div>
    ${champHtml}
    <div class="pa-h">Classement général</div>${standings}
    ${poolsHtml}
    ${bracketHtml ? `<div class="pa-h" style="margin-top:14px">Phase finale</div><div class="pa-bracketwrap">${bracketHtml}</div>` : ""}
    <div class="pa-foot">Édité le ${now} · Miabe Esport</div>
  </div>`;
}

/** Panneau "Joueurs" (organisateur/admin) — renommer, club, ajustement manuel de points, disqualification en direct.
 * Partagé entre pTournoi (pied de page) et la régie (overlay). */
function playersRosterPanel(S: State, t: Detail, manage: boolean): string {
  const roster2: { id: string; name: string; club?: string; disqualified?: boolean }[] = Array.isArray(t.players) ? t.players : [];
  if (!manage || !roster2.length) return "";
  const editRow = (p: { id: string; name: string; club?: string }) => `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;background:var(--surface);border:1px solid #22D3EE55;border-radius:10px;padding:8px;width:100%">
    <input id="pl-edit-name" value="${escAttr(p.name)}" placeholder="Nom" style="flex:1;min-width:110px;background:var(--surface-3);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:inherit;font-size:12.5px;padding:6px 9px" />
    ${t.teamSize && t.status === "setup" ? `<input id="pl-edit-members" value="${escAttr(((t.teams?.[p.name] as string[]) || []).join(", "))}" placeholder="Joueurs de l'équipe (virgules)" style="flex:2 1 100%;min-width:200px;background:var(--surface-3);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:inherit;font-size:12.5px;padding:6px 9px" />` : ""}
    <input id="pl-edit-club" value="${escAttr(p.club || "")}" placeholder="Club" style="flex:1;min-width:90px;background:var(--surface-3);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:inherit;font-size:12.5px;padding:6px 9px" />
    <input id="pl-edit-delta" type="number" step="0.5" placeholder="+/- pts" style="width:72px;background:var(--surface-3);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:inherit;font-size:12.5px;padding:6px 7px" />
    <input id="pl-edit-reason" placeholder="Motif (si ajustement)" style="flex:1;min-width:110px;background:var(--surface-3);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:inherit;font-size:12.5px;padding:6px 9px" />
    <button data-pledit-save="${t.id}|${p.id}" style="background:var(--surface-4);border:1px solid var(--border-strong);color:#22D3EE;border-radius:8px;padding:6px 11px;font-weight:700;font-size:12px;cursor:pointer">OK</button>
    <button data-pledit-cancel="1" style="background:transparent;border:0;color:var(--text-muted);cursor:pointer;font-size:12px">Annuler</button>
  </div>`;
  const q = S.rosterQ.trim().toLowerCase();
  const filtered = q ? roster2.filter((p) => p.name.toLowerCase().includes(q) || (p.club || "").toLowerCase().includes(q)) : roster2;
  const searchBar = roster2.length > 8 ? `<div style="position:relative;max-width:320px;margin:14px 0 4px">
      <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text-faint);pointer-events:none">${ic(I.search, 14)}</span>
      <input id="regie-roster-search" value="${escAttr(S.rosterQ)}" placeholder="Chercher un joueur…" style="width:100%;background:var(--surface-3);border:1px solid var(--border);border-radius:10px;color:var(--text);font-family:inherit;font-size:13px;padding:9px 12px 9px 33px" />
    </div>${q ? `<div style="margin-top:8px"><span style="display:inline-flex;align-items:center;gap:7px;font-size:11.5px;color:var(--text-muted);background:var(--surface);border:1px solid var(--border);border-radius:999px;padding:5px 10px">Recherche : <b style="color:var(--text)">${escHtml(S.rosterQ)}</b><button data-rosterqclear="1" style="display:grid;place-items:center;width:16px;height:16px;background:transparent;border:0;color:var(--text-muted);cursor:pointer">${ic(I.x, 11)}</button></span></div>` : ""}` : "";
  return `<details open style="border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:16px 20px;margin-bottom:20px">
      <summary style="cursor:pointer;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-muted);font-weight:750">Joueurs (${roster2.length})</summary>
      ${searchBar}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">${filtered.length ? filtered.map((p) => S.editingPlayerId === p.id ? editRow(p) : `<span style="display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:${p.disqualified ? "var(--text-faint)" : "var(--text)"};background:var(--surface);border:1px solid var(--border);border-radius:999px;padding:7px 8px 7px 13px${p.disqualified ? ";text-decoration:line-through" : ""}"><span style="display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--surface-4);font-size:10px;font-weight:800;color:#22D3EE">${p.name.charAt(0).toUpperCase()}</span>${escHtml(p.name)}${p.club ? `<span style="color:var(--text-faint);font-weight:500">@${escHtml(p.club)}</span>` : ""}<button data-pledit-open="${p.id}" title="Renommer / club / points" style="display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:transparent;border:0;color:var(--text-muted);cursor:pointer">${ic(I.edit || I.plus, 11)}</button>${p.disqualified ? `<span style="font-size:9.5px;font-weight:800;letter-spacing:.5px;color:#FB7185">DQ</span>` : t.status === "live" ? `<button data-pldq="${t.id}|${p.id}" title="Disqualifier" style="display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:transparent;border:0;color:#FB7185;cursor:pointer">${ic(I.warn, 12)}</button>` : ""}</span>`).join("") : `<div style="color:var(--text-faint);font-size:13px;padding:6px 2px">Aucun joueur ne correspond à « ${escHtml(S.rosterQ)} ».</div>`}</div>
    </details>`;
}

/** Poule Survival (match courant cliquable + classement) — partagé entre pTournoi et la régie. */
/** Calendrier round robin (méthode du cercle) : répartit n places en journées où chacune ne joue
 * qu'une fois — pour afficher un vrai calendrier par journées (comme un championnat) plutôt qu'une
 * liste plate de tous les face-à-face. Un effectif impair libère une place "repos" par journée,
 * retirée du résultat (indices ≥ n). Renvoie des index (0-based) dans l'ordre de `pool.order`. */
function roundRobinSchedule(n: number): [number, number][][] {
  const size = n % 2 === 0 ? n : n + 1;
  const arr = Array.from({ length: size }, (_, i) => i);
  const rounds: [number, number][][] = [];
  for (let r = 0; r < size - 1; r++) {
    const round: [number, number][] = [];
    for (let i = 0; i < size / 2; i++) {
      const a = arr[i], b = arr[size - 1 - i];
      if (a < n && b < n) round.push([a, b]);
    }
    rounds.push(round);
    arr.splice(1, 0, arr.pop()!); // rotation : la place 0 reste fixe, les autres tournent
  }
  return rounds;
}
/** Calendrier round robin par journées — remplace la grille plate de toutes les rencontres (poules
 * ET Round Robin de phase finale) par un vrai calendrier de championnat, groupé journée par journée,
 * chaque rencontre cliquable si `reportAttr` en renvoie un (les poules ne savent rapporter que le
 * prochain match jouable — Engine.currentMatch ; la phase finale accepte n'importe lequel via son
 * matchId, donc tout y est cliquable dès qu'il est jouable). */
function journeeCalendar(names: { id: string; name: string }[], matches: Detail[], manage: boolean, reportAttr: (m: Detail, playerId: string) => string | null, highlightCurrent = true, logByMatch: Record<string, string> = {}): string {
  const byPair = new Map<string, Detail>();
  matches.forEach((m) => { if (m.aId && m.bId) byPair.set([m.aId, m.bId].sort().join("|"), m); });
  const schedule = roundRobinSchedule(names.length);
  // Noms aux deux bords, score au milieu (comme un vrai tableau de scores) plutôt que les noms
  // resserrés autour d'un simple "vs" et le score/statut relégué à droite.
  const row = (m: Detail) => {
    const nameCell = (name: string, id: string, isWin: boolean) => {
      const attr = manage ? reportAttr(m, id) : null;
      if (attr) return `<button ${attr} style="background:transparent;border:0;color:var(--text);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;padding:3px 6px;border-radius:6px;text-align:inherit">${escHtml(name)}</button>`;
      return `<span style="color:${isWin ? "#22D3EE" : m.winnerId ? "var(--text-faint)" : "var(--text)"};font-weight:${isWin ? 750 : 600}">${escHtml(name)}${isWin ? " ✓" : ""}</span>`;
    };
    const hasScore = m.sa !== null && m.sa !== undefined && m.sb !== null && m.sb !== undefined;
    // highlightCurrent : n'a de sens que quand "playable" désigne LE match du moment parmi d'autres
    // qui ne le sont pas encore (poules — un seul à la fois, voir Engine.currentMatch). En Round Robin
    // de phase finale, tout match non joué est également reportable à tout instant (data-reportf
    // accepte n'importe quel matchId) : y allumer chaque ligne en cyan ne distingue plus rien, et
    // noie l'info utile (jouée/à venir) sous un mur bleu identique partout — on reste neutre.
    const isCurrent = highlightCurrent && m.playable;
    const center = hasScore
      ? `<span style="font-family:'JetBrains Mono',monospace;font-weight:800;font-size:15px;color:#34D399">${m.sa}–${m.sb}</span>`
      : m.winnerId
        ? `<span style="font-size:10px;font-weight:800;letter-spacing:.3px;color:#34D399">JOUÉ</span>`
        : isCurrent
          ? `<span style="font-size:11px;font-weight:800;letter-spacing:.3px;color:#22D3EE">VS</span>`
          : `<span style="font-size:11px;color:var(--text-faint)">vs</span>`;
    const logId = logByMatch[m.matchId];
    const pencil = m.winnerId && manage && logId
      ? `<button data-editmatch="${logId}" title="Corriger ce match" style="flex:none;display:grid;place-items:center;width:22px;height:22px;border-radius:6px;background:transparent;border:0;color:var(--text-faint);cursor:pointer">${ic(I.edit, 12)}</button>`
      : "";
    return `<div style="display:grid;grid-template-columns:1fr auto 1fr auto;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid #15151f;${isCurrent ? "background:rgba(34,211,238,.05)" : ""}">
      <div style="text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${nameCell(m.aName, m.aId, m.winnerId === m.aId)}</div>
      <div style="text-align:center;min-width:40px">${center}</div>
      <div style="text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${nameCell(m.bName, m.bId, m.winnerId === m.bId)}</div>
      <div>${pencil}</div>
    </div>`;
  };
  const calendar = schedule.map((round, ri) => {
    const rows = round.map(([ia, ib]) => {
      const key = [names[ia]?.id, names[ib]?.id].sort().join("|");
      const m = byPair.get(key);
      return m ? row(m) : "";
    }).filter(Boolean).join("");
    return rows ? `<div style="margin-bottom:10px"><div style="font-size:10px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--text-faint);padding:6px 12px">Manche ${ri + 1}</div>${rows}</div>` : "";
  }).join("");
  return `<div style="border:1px solid var(--border);border-radius:12px;overflow:hidden;max-height:440px;overflow-y:auto">${calendar || `<div style="padding:16px;text-align:center;color:var(--text-faint);font-size:13px">En attente…</div>`}</div>`;
}
/** Historique des matchs déjà joués d'une poule (Survival classique ou double poolFormat) —
 * Engine.currentMatch ne garde que le match du moment (état ephémère, wSurvivor/wIndex…), sans autre
 * trace consultable des matchs précédents : cette liste (dérivée de t.log) est le seul endroit où les
 * corriger (crayon). Round Robin n'en a pas besoin : son calendrier (journeeCalendar) montre déjà
 * chaque match, joué ou non. */
function poolHistoryList(log: Detail[], poolId: string, manage: boolean): string {
  const entries = (log || []).filter((l: Detail) => l.poolId === poolId);
  if (!entries.length) return "";
  const rows = entries.map((l: Detail) => {
    const aWin = l.winnerId === l.aId;
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 2px;border-bottom:1px solid var(--surface-3);font-size:12.5px">
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${aWin ? "#34D399" : "var(--text-muted)"};font-weight:${aWin ? 700 : 500}">${escHtml(l.aName)}${aWin ? " ✓" : ""}</span>
      ${l.sa !== null ? `<span style="font-family:'JetBrains Mono',monospace;font-size:11.5px;color:var(--text-faint);flex:none">${l.sa}–${l.sb}</span>` : ""}
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;color:${!aWin ? "#34D399" : "var(--text-muted)"};font-weight:${!aWin ? 700 : 500}">${!aWin ? "✓ " : ""}${escHtml(l.bName)}</span>
      ${manage ? `<button data-editmatch="${l.id}" title="Corriger ce match" style="flex:none;display:grid;place-items:center;width:22px;height:22px;border-radius:6px;background:transparent;border:0;color:var(--text-faint);cursor:pointer">${ic(I.edit, 12)}</button>` : ""}
    </div>`;
  }).join("");
  return `<div style="margin-top:16px">
    <div style="font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:var(--text-muted);font-weight:750;margin-bottom:6px">Historique</div>
    <div style="max-height:220px;overflow-y:auto">${rows}</div>
  </div>`;
}
/** Postes et match « à l'antenne » du tournoi affiché (posés au rendu, voir renderPageBody) — lus par les
 * cartes de poule et les cases de bracket, qui n'ont pas accès au tournoi entier. */
let LIVE_META: { stations: Record<string, string>; stream: string | null } = { stations: {}, stream: null };
function liveBadges(key: string | undefined, small = false): string {
  if (!key) return "";
  const station = LIVE_META.stations[key];
  const stream = LIVE_META.stream === key;
  if (!station && !stream) return "";
  const fs = small ? "8.5px" : "10px";
  return `${stream ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:${fs};font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:#fff;background:#F43F7E;border-radius:99px;padding:2px 7px">${ic(I.tv, small ? 8 : 10)}Antenne</span>` : ""}${station ? `<span style="font-size:${fs};font-weight:800;color:#04222a;background:#22D3EE;border-radius:99px;padding:2px 7px">${escHtml(station)}</span>` : ""}`;
}
function poolCard(S: State, p: Detail, manage: boolean, poolFormat: "survival" | "double" | "roundrobin" = "survival", countGoalDiff = true, log: Detail[] = []): string {
  const html = poolCardBase(S, p, manage, poolFormat, countGoalDiff, log);
  const b = p.current || (p.rrmatches || []).some((m: Detail) => m.playable) ? liveBadges(p.id) : "";
  if (!b) return html;
  const i = html.indexOf(">");
  return i < 0 ? html : `${html.slice(0, i + 1)}<div style="display:flex;gap:6px;justify-content:flex-end;padding:0 0 8px">${b}</div>${html.slice(i + 1)}`;
}
function poolCardBase(S: State, p: Detail, manage: boolean, poolFormat: "survival" | "double" | "roundrobin" = "survival", countGoalDiff = true, log: Detail[] = []): string {
  let body: string;
  if (poolFormat === "roundrobin") {
    // Calendrier par journées plutôt qu'un seul "match en cours" mis en avant : les journées déjà
    // jouées et à venir restent visibles, comme un vrai calendrier de championnat. Seul le prochain
    // match jouable peut être rapporté ici — le moteur ne résout les poules round robin que dans
    // l'ordre (Engine.currentMatch), les autres journées à venir restent donc en lecture seule.
    const order: { id: string; name: string }[] = Array.isArray(p.order) ? p.order : [];
    const calendar = journeeCalendar(order, p.rrmatches || [], manage, (m) => m.playable ? `data-activematch="${p.id}"` : null, true, logByMatchId(log));
    body = `<div style="font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:var(--text-muted);font-weight:750;margin-bottom:10px">Calendrier</div>${calendar}`;
  } else if (p.current) {
    // Round Robin est traité plus haut (calendrier par journées) : ici poolFormat ne vaut plus que
    // "survival" ou "double", tous deux dotés d'un vrai survivant/challenger asymétrique.
    const stageLabel: Record<string, string> = poolFormat === "double"
      ? { survival: "Bracket vainqueurs", losers: "Bracket perdants", poolFinal: "Finale de poule" }
      : { survival: "Survival", losers: "Repêchage", poolFinal: "Finale de poule" };
    const stageTitle = `${stageLabel[p.current.stage] || p.current.stage}${p.current.streak > 1 ? " · série " + p.current.streak : ""}`;
    const subA = p.current.stage === "poolFinal" ? "Champ. vainqueurs" : poolFormat === "double" ? stageLabel[p.current.stage] : "Survivant";
    const subB = p.current.stage === "poolFinal" ? "Champ. perdants" : poolFormat === "double" ? stageLabel[p.current.stage] : "Challenger";
    // Cadre d'un des deux joueurs (survivant/challenger, ou les deux côtés d'un bracket) : partagé par la
    // version organisateur et la version lecture seule. Sans min-width:0, un cadre flex ne rétrécit
    // jamais sous son contenu : « BRACKET VAINQUEURS » se coupait sur deux lignes dès que la carte était
    // étroite, et le cadre pouvait même déborder de la carte. Ici : cadres de largeur égale (flex 1 1 0),
    // une seule ligne par texte, et une taille de police qui suit la largeur du cadre (unités de
    // conteneur, cqw — la 1re déclaration sert de repli aux navigateurs qui ne les connaissent pas) :
    // le texte reste lisible en entier au lieu d'être tronqué. L'ellipsis (+ title au survol) ne joue
    // plus qu'en dernier recours, pour un pseudo vraiment très long. line-height 1.2 : 1 rognerait
    // l'accent d'une majuscule (É).
    const vsSide = (name: string, cls: string, sub: string) => {
      const col = cls === "surv" ? "#22D3EE" : "#F43F7E";
      const clip = "max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      return `<div style="flex:1 1 0;min-width:0;min-height:120px;container-type:inline-size;border-radius:15px;border:1px solid ${cls === "surv" ? "rgba(34,211,238,.4)" : "rgba(244,63,126,.35)"};background:linear-gradient(180deg,${cls === "surv" ? "rgba(34,211,238,.08)" : "rgba(244,63,126,.05)"},var(--surface));display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:14px 8px"><span title="${escAttr(sub)}" style="${clip};font-size:10px;font-size:clamp(7px,7.4cqw,10.5px);font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:${col}">${escHtml(sub)}</span><span title="${escAttr(name)}" style="${clip};font-family:'Bebas Neue',sans-serif;font-size:30px;font-size:clamp(20px,20cqw,30px);line-height:1.2;color:${col}">${escHtml(name)}</span></div>`;
    };
    if (manage) {
      const inp = "width:64px;height:44px;text-align:center;background:var(--surface-3);border:1px solid var(--border);border-radius:10px;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:19px;font-weight:700;line-height:44px;padding:0";
      // 30px/8px (et non 44/12) : plus de place pour le texte des deux cadres sur une carte étroite ;
      // la ligne des champs de score garde les mêmes valeurs pour rester alignée sous les cadres.
      const divider = "display:flex;align-items:center;justify-content:center;width:30px;flex:none;color:var(--text-faint);font-family:'Bebas Neue',sans-serif;font-size:22px";
      body = `<div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);font-weight:700;margin-bottom:10px">${stageTitle} — saisis le score (FT)</div>
        <div style="display:flex;align-items:stretch;gap:8px">${vsSide(p.current.aName, "surv", subA)}<div style="${divider}">VS</div>${vsSide(p.current.bName, "chal", subB)}</div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:14px">
          <div style="flex:1;display:flex;justify-content:center"><input id="sc-a-${p.current.poolId}" type="number" min="0" value="0" class="scorenum" style="${inp}" /></div>
          <div style="${divider}">–</div>
          <div style="flex:1;display:flex;justify-content:center"><input id="sc-b-${p.current.poolId}" type="number" min="0" value="0" class="scorenum" style="${inp}" /></div>
        </div>
        <div style="display:flex;justify-content:center;margin-top:10px"><button data-reportscore="${p.current.poolId}" ${S.detailBusy ? "disabled" : ""} style="height:44px;background:var(--surface-4);border:1px solid var(--border-strong);color:#22D3EE;border-radius:10px;padding:0 20px;font-weight:750;font-size:13px;cursor:pointer">Valider le score</button></div>`;
    } else {
      body = `<div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);font-weight:700;margin-bottom:10px">${stageTitle} — en direct</div>
        <div style="display:flex;align-items:stretch;gap:8px">${vsSide(p.current.aName, "surv", subA)}<div style="display:flex;align-items:center;justify-content:center;width:30px;flex:none;color:var(--text-faint);font-family:'Bebas Neue',sans-serif;font-size:22px">VS</div>${vsSide(p.current.bName, "chal", subB)}</div>`;
    }
  } else if (p.done) {
    body = `<div style="text-align:center;padding:14px 0"><div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#34D399;font-weight:700;margin-bottom:12px">Poule terminée — qualifiés</div><div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">${(Array.isArray(p.qualified) && p.qualified.length ? p.qualified.map((q: Detail) => q.name) : [p.top1, p.top2].filter(Boolean)).map((name: string, i: number) => {
      // Tous les qualifiés dans l'ordre de classement (voir Engine.poolQualified) — jusqu'à
      // qualifyPerPool, plus seulement les deux finalistes. Or/cyan pour 1er/2e, neutre ensuite.
      const c = i === 0 ? ["#FBBF24", "251,191,36"] : i === 1 ? ["#22D3EE", "34,211,238"] : ["var(--text-muted)", "142,143,166"];
      return `<span style="font-size:13px;font-weight:700;color:${c[0]};background:rgba(${c[1]},.08);border:1px solid rgba(${c[1]},.35);border-radius:99px;padding:8px 14px">${i + 1}. ${escHtml(name)}</span>`;
    }).join("")}</div></div>`;
  } else {
    body = `<div style="color:var(--text-faint);text-align:center;padding:14px 0">En attente…</div>`;
  }
  // Mini-bracket de la poule (poolFormat 'double') : la grosse carte VS ci-dessus ne montre que le
  // match du moment — sans l'arbre complet, impossible de voir où en est le groupe (qui vient du
  // bracket perdants, combien de tours restent…). Réutilise doubleElimTree, déjà écrit pour la
  // phase finale, le DTO de p.dbracket ayant exactement la même forme (wb/lb/gf/gf2).
  if (poolFormat === "double" && p.dbracket) {
    // Toujours en lecture seule ici (manage=false) : le moteur ne rapporte les poules que via le
    // "match du moment" (Engine.currentMatch, carte VS ci-dessus, data-reportscore) — un clic sur une
    // case de cet arbre n'a pas d'équivalent dans le moteur pour les poules, contrairement à la phase
    // finale (t.finals, data-activematch). La correction d'un match déjà joué passe par l'historique
    // ci-dessous (poolHistoryList), pas par un crayon sur cet arbre.
    body += `<div style="margin-top:16px"><div style="font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:var(--text-muted);font-weight:750;margin-bottom:10px">Bracket de la poule</div>${doubleElimTree(p.dbracket, [], false, {}, ["Finale de poule", "Finale de poule · 2e match"])}</div>`;
  }
  // Historique (crayon) : seuls "survival" et "double" en ont besoin ici — Round Robin l'a déjà
  // ajouté à son calendrier plus haut, l'appeler une seconde fois ferait doublon.
  if (poolFormat !== "roundrobin") body += poolHistoryList(log, p.id, manage);
  // J (joués) / G (gagnés) / P (perdus) : vrai tableau de championnat, comme au football — seul le
  // mode Round Robin produit un classement complet (voir TournamentsService.poolRanking). Diff.
  // (différence de buts/manches) reste conditionnée au réglage "Départager par différence de buts".
  const isRR = poolFormat === "roundrobin";
  const hasGd = isRR && countGoalDiff !== false;
  const rank = `<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:14px">
    <thead><tr style="color:var(--text-faint);font-size:11px;text-transform:uppercase;letter-spacing:.5px"><td style="padding:6px 4px">#</td><td style="padding:6px 4px">Joueur</td>${isRR ? `<td style="padding:6px 4px;text-align:right">J</td><td style="padding:6px 4px;text-align:right">G</td><td style="padding:6px 4px;text-align:right">P</td>` : `<td style="padding:6px 4px;text-align:right">V</td>`}${hasGd ? `<td style="padding:6px 4px;text-align:right">Diff.</td>` : ""}<td style="padding:6px 4px;text-align:right">Pts</td></tr></thead>
    <tbody>${p.ranking.map((r: Detail, i: number) => `<tr style="border-top:1px solid var(--surface-4)"><td style="padding:7px 4px;color:var(--text-faint);font-family:'Bebas Neue',sans-serif;font-size:15px;width:22px">${i + 1}</td><td style="padding:7px 4px;font-weight:600">${escHtml(r.name)}</td>${isRR ? `<td style="padding:7px 4px;text-align:right;color:var(--text-muted)">${r.played}</td><td style="padding:7px 4px;text-align:right;color:var(--text-muted)">${r.wins}</td><td style="padding:7px 4px;text-align:right;color:var(--text-muted)">${r.losses}</td>` : `<td style="padding:7px 4px;text-align:right;color:var(--text-muted)">${r.wins}</td>`}${hasGd ? `<td style="padding:7px 4px;text-align:right;color:var(--text-muted)">${r.gd > 0 ? "+" : ""}${r.gd}</td>` : ""}<td style="padding:7px 4px;text-align:right;font-weight:750;color:#22D3EE">${r.pts}</td></tr>`).join("")}</tbody>
  </table>`;
  return `<div style="border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:18px"><div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;margin-bottom:12px">${p.name}</div>${body}${rank}</div>`;
}

/** Bracket(s) de la phase finale — rendu générique réutilisé pour les formats single/double/roundrobin/swiss, partagé entre pTournoi et la régie. */
/** États visuels d'un match — bordure, badge de statut, fond — partagés entre l'arbre de bracket
 * (matchTreeBox) et la liste plate (matchBox/roundCol). "active" ne s'applique qu'en régie (match
 * actuellement sélectionné dans le panneau de contrôle) ; "playable" reste mis en avant même côté
 * spectateur (on voit quel match est le prochain à se jouer), seul le clic pour le rapporter est
 * réservé à l'organisateur (géré séparément par l'appelant via `manage`). */
function matchVisual(m: Detail, active: boolean): { border: string; badgeText: string; badgeColor: string; bg: string } {
  if (active) return { border: "1px solid #22D3EE", badgeText: "En direct", badgeColor: "#22D3EE", bg: "rgba(34,211,238,.07)" };
  if (m.winnerId) return { border: "1px solid rgba(52,211,153,.3)", badgeText: "Joué", badgeColor: "#34D399", bg: "var(--surface-5)" };
  if (m.playable) return { border: "1px dashed rgba(34,211,238,.4)", badgeText: "À lancer", badgeColor: "#22D3EE", bg: "var(--surface-5)" };
  return { border: "1px dashed #2c2c3d", badgeText: "À venir", badgeColor: "var(--text-faint)", bg: "var(--surface-5)" };
}
function matchLine(name: string | null, win: boolean, playable: boolean, matchId: string, manage: boolean, score: number | null = null): string {
  if (!name) return `<div style="padding:9px 11px;color:var(--text-faint);font-style:italic">à venir</div>`;
  const scoreEl = score !== null ? `<span style="font-family:'JetBrains Mono',monospace;font-weight:800;font-size:13px;color:${win ? "#34D399" : "var(--text-faint)"};flex:none">${score}</span>` : "";
  if (playable && manage) return `<button data-activematch="${matchId}" style="display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;text-align:left;padding:9px 11px;background:transparent;border:0;color:var(--text);cursor:pointer;font-family:inherit;font-size:14px"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(name)}</span>${scoreEl}</button>`;
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 11px;color:${win ? "#34D399" : "var(--text)"};font-weight:${win ? 800 : 600}"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(name)}${win ? " ✓" : ""}</span>${scoreEl}</div>`;
}
function matchBox(m: Detail, manage: boolean, logByMatch: Record<string, string> = {}): string {
  if (m.bye) return `<div style="border:1px dashed var(--surface-3);border-radius:10px;overflow:hidden;background:var(--surface-5)">${matchLine(m.aName || m.bName, true, false, m.matchId, manage)}<div style="padding:9px 11px;color:var(--text-faint);font-style:italic;border-top:1px solid var(--surface-3)">exempt</div></div>`;
  const hasScore = m.sa !== null && m.sa !== undefined && m.sb !== null && m.sb !== undefined;
  const v = matchVisual(m, false);
  const logId = logByMatch[m.matchId];
  const pencil = m.winnerId && manage && logId
    ? `<button data-editmatch="${logId}" title="Corriger ce match" style="margin-left:auto;display:grid;place-items:center;width:18px;height:18px;border-radius:5px;background:transparent;border:0;color:${v.badgeColor};cursor:pointer;flex:none">${ic(I.edit, 10)}</button>`
    : "";
  return `<div style="border:${v.border};border-radius:10px;overflow:hidden;background:${v.bg}">
    <div style="display:flex;align-items:center;padding:6px 11px;background:var(--surface-7);border-bottom:1px solid var(--surface-3)"><span style="font-size:9px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:${v.badgeColor}">${v.badgeText}</span>${m.playable ? `<span style="display:inline-flex;gap:4px;margin-left:6px">${liveBadges(m.matchId, true)}</span>` : ""}${pencil}</div>
    ${matchLine(m.aName, m.winnerId === m.aId, m.playable, m.matchId, manage, hasScore ? m.sa : null)}<div style="border-top:1px solid var(--surface-3)">${matchLine(m.bName, m.winnerId === m.bId, m.playable, m.matchId, manage, hasScore ? m.sb : null)}</div>
  </div>`;
}
// hideByes (1er tour d'un bracket uniquement) : un exempt n'a pas de vraie rencontre à montrer — le
// nom qualifié apparaît déjà, résolu, dans la case du tour suivant. Une case "exempt" isolée sur la
// première colonne n'aurait fait que doubler cette info avec une fausse "rencontre".
function roundCol(label: string, matches: Detail[], manage: boolean, hideByes = false, logByMatch: Record<string, string> = {}): string {
  const shown = hideByes ? matches.filter((m) => !m.bye) : matches;
  return `<div style="display:flex;flex-direction:column;justify-content:space-around;gap:12px;min-width:180px">${label ? `<div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);font-weight:700">${escHtml(label)}</div>` : ""}${shown.map((m) => matchBox(m, manage, logByMatch)).join("")}</div>`;
}


/** Bouton "Lancer la phase finale" (toujours en double élimination pour Survival), une fois toutes les poules terminées. Partagé entre pTournoi et la régie. */
function finalsStartPanel(S: State, t: Detail, manage: boolean): string {
  if (!manage || !t.allPoolsDone || t.finals) return "";
  // t.finalsFormat est déjà le bon choix dans tous les cas : celui posé à la création pour Survival,
  // ou le format principal du tournoi pour les autres formats à poules (voir Engine.launchTournament).
  const finalsLabel = t.finalsFormat === "single" ? "bracket simple"
    : t.finalsFormat === "roundrobin" ? "round robin"
    : "double élimination";
  return `<div style="text-align:center;margin:24px 0">
      <div><button data-finals-start="${t.id}" ${S.detailBusy ? "disabled" : ""} style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:14px 24px;font-weight:750;font-size:15px;cursor:pointer;box-shadow:0 0 30px rgba(34,211,238,.22)">${ic(I.crown)}Lancer la phase finale (${finalsLabel})</button></div>
    </div>`;
}

/* ================= Régie (organisateur, tournoi en direct) — squelette rail · centre · contrôle (Tour 5/6) ================= */

type ActiveMatch = { kind: "pool" | "finals"; poolId?: string; matchId?: string; aId: string; aName: string; bId: string; bName: string };

/** Match mis en avant dans le panneau de contrôle : celui choisi via la file d'attente s'il est toujours jouable, sinon le premier jouable. */
/** Identifiant stable d'un match actif — matchId en phase finale, poolId en poule (une poule n'a
 * qu'un seul match "courant" à la fois, voir Engine.currentMatch). Sert de clé pour activeMatchIds/matchScores. */
function activeKey(a: ActiveMatch): string { return a.kind === "finals" ? a.matchId! : a.poolId!; }

/** Matchs mis en avant dans le panneau de contrôle de la régie — plusieurs à la fois : plusieurs
 * confrontations peuvent réellement se jouer en même temps (tables/écrans différents). S.activeMatchIds
 * choisit lesquelles ; vide (ou plus aucune jouable) retombe sur la première trouvée, pour qu'il y ait
 * toujours quelque chose à rapporter par défaut. */
function getActiveMatches(S: State, t: Detail): ActiveMatch[] {
  // Survival en finale : t.pools[0] EST la phase finale (voir Engine.startFinalsSurvivalPool), pas de
  // matchId à chercher — retombe sur la branche poolId ci-dessous, comme la phase de poules normale.
  if (t.finals && t.finals.format !== "battle_royale" && t.finals.format !== "survival") {
    let chosen = S.activeMatchIds
      .map((id) => findFinalsMatchById(t.finals, id))
      .filter((m): m is Detail => !!m && m.playable);
    if (t.finals.format === "double") {
      // Bracket vainqueurs et bracket perdants avancent réellement en parallèle (voir
      // Engine.buildDoubleElim) : un défaut PAR bracket, pas un seul défaut global qui masquerait
      // les perdants tant qu'il reste un match jouable côté vainqueurs (et vice-versa) — sinon
      // rapporter un match du bas retombe sur un match du haut au lieu du suivant en bas.
      // t.finals.wb/lb : [{label, matches}, ...] (voir TournamentsService.serializeFinals) — pas
      // directement un tableau de matchs, il faut descendre par .matches.
      const findIn = (rounds: Detail[]): Detail | null => {
        for (const round of rounds || []) for (const m of round.matches || []) if (m && m.playable) return m;
        return null;
      };
      const inWb = (id: string) => (t.finals.wb || []).some((round: Detail) => (round.matches || []).some((m: Detail) => m.matchId === id));
      const inLb = (id: string) => (t.finals.lb || []).some((round: Detail) => (round.matches || []).some((m: Detail) => m.matchId === id));
      if (!chosen.some((m) => inWb(m.matchId))) { const m = findIn(t.finals.wb); if (m) chosen.push(m); }
      if (!chosen.some((m) => inLb(m.matchId))) { const m = findIn(t.finals.lb); if (m) chosen.push(m); }
      // Aucun des deux (les deux brackets sont épuisés) : ne reste que la grande finale, couverte
      // par le repli générique ci-dessous.
      if (!chosen.length) { const m = findPlayableFinalsMatch(t.finals); if (m) chosen = [m]; }
    } else if (!chosen.length) {
      const m = findPlayableFinalsMatch(t.finals); if (m) chosen = [m];
    }
    const seen = new Set<string>();
    chosen = chosen.filter((m) => (seen.has(m.matchId) ? false : (seen.add(m.matchId), true)));
    return chosen.map((m) => ({ kind: "finals" as const, matchId: m.matchId, aId: m.aId, aName: m.aName, bId: m.bId, bName: m.bName }));
  }
  const pools: Detail[] = Array.isArray(t.pools) ? t.pools : [];
  // Phase de poules : toutes les poules ont réellement un match en cours en même temps (une table par
  // poule) — on les affiche donc toutes, sans avoir à les "lancer" une par une ; à la validation, le
  // match suivant de la même poule prend aussitôt la place (Engine.currentMatch).
  const chosenPools = pools.filter((p: Detail) => p.current);
  return chosenPools.map((p) => ({ kind: "pool" as const, poolId: p.id, aId: p.current.aId, aName: p.current.aName, bId: p.current.bId, bName: p.current.bName }));
}

/** Les autres matchs jouables qu'aucune des cartes affichées dans le contrôle — "Lancer" ajoute une carte de plus (S.activeMatchIds), sans remplacer celles déjà là. */
/** Matchs jouables pas encore en cours de saisie en régie, dans l'ordre de la file (le match à l'antenne d'abord). */
function queueItemsOf(t: Detail, actives: ActiveMatch[]): { id: string; label: string }[] {
  const activeIds = new Set(actives.map(activeKey));
  const items: { id: string; label: string }[] = [];
  if (t.finals && t.finals.format !== "battle_royale" && t.finals.format !== "survival") {
    for (const arr of finalsMatchGroups(t.finals)) for (const m of arr) {
      if (m && m.playable && !activeIds.has(m.matchId)) items.push({ id: m.matchId, label: `${escHtml(m.aName)} <span style="color:var(--text-faint)">vs</span> ${escHtml(m.bName)}` });
    }
  } else if (!t.finals || t.finals.format === "survival") {
    (t.pools || []).forEach((p: Detail) => { if (p.current && !activeIds.has(p.id)) items.push({ id: p.id, label: `${escHtml(p.name)} · ${escHtml(p.current.aName)} <span style="color:var(--text-faint)">vs</span> ${escHtml(p.current.bName)}` }); });
  }
  return [...items].sort((a, b) => Number(b.id === t.streamMatchKey) - Number(a.id === t.streamMatchKey));
}
function matchQueuePanel(t: Detail, actives: ActiveMatch[]): string {
  // Round Robin : tous les matchs sont jouables en parallèle (pas de progression par round), le calendrier par
  // journées du centre (journeeCalendar, avec report en un clic) couvre déjà ce besoin — une file d'attente y ferait doublon à l'identique.
  if (t.finals?.format === "roundrobin") return "";
  const items = queueItemsOf(t, actives);
  if (!items.length) return "";
  return `<div style="border:1px solid var(--border);border-radius:12px;background:var(--surface);overflow:hidden;margin-top:16px">
    <div style="display:flex;align-items:center;gap:9px;padding:12px 15px;border-bottom:1px solid var(--surface-4)"><span style="font-size:10.5px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-muted)">File d'attente</span><span style="flex:1"></span><button data-launchnext="${t.id}" title="Lance le prochain match, lui donne le premier poste libre et prévient les joueurs par e-mail" style="background:#22D3EE;color:#04222a;border:0;border-radius:8px;padding:5px 10px;font-size:11px;font-weight:800;cursor:pointer">Lancer le suivant</button><span style="font-family:'JetBrains Mono',monospace;font-size:11.5px;color:var(--text-faint)">${items.length}</span></div>
    <div style="padding:6px 12px 12px">${[...items].sort((a, b) => Number(b.id === t.streamMatchKey) - Number(a.id === t.streamMatchKey)).map((it) => {
      const station = t.stations?.[it.id];
      const onStream = it.id === t.streamMatchKey;
      return `<div style="display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid var(--surface-3)">${onStream ? `<span title="À l'antenne" style="color:#F43F7E;flex:none">${ic(I.tv, 13)}</span>` : ""}<span style="font-size:12.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${it.label}</span>${station ? `<span style="font-size:10px;font-weight:750;color:var(--text-muted);background:var(--surface-3);border:1px solid var(--border);border-radius:99px;padding:2px 8px;flex:none">${escHtml(station)}</span>` : ""}<span data-activematch="${it.id}" style="font-size:11px;font-weight:750;color:#22D3EE;cursor:pointer;flex:none">Lancer</span></div>`;
    }).join("")}</div>
  </div>`;
}

/** Aperçu compact du panneau Joueurs, colonne de contrôle de la régie — recherche + joueurs qui réclament une action (disqualifiés, paiement en attente), données réelles uniquement. */
function regieRosterMini(S: State, t: Detail): string {
  const roster: { id: string; name: string; club?: string; disqualified?: boolean }[] = Array.isArray(t.players) ? t.players : [];
  const dqCount = roster.filter((p) => p.disqualified).length;
  const pending = (S.regsPanel || []).filter((r: Detail) => r.paymentStatus === "pending");
  const flagged: { label: string; sub: string; tag: string; color: string }[] = [
    ...roster.filter((p) => p.disqualified).map((p) => ({ label: p.name, sub: p.club ? `@${p.club}` : "", tag: "Disqualifié", color: "#FB7185" })),
    ...pending.map((r: Detail) => ({ label: r.playerName, sub: "", tag: "Paiement en attente", color: "#FBBF24" })),
  ].slice(0, 3);
  const rows = flagged.length ? `<div style="display:flex;flex-direction:column;gap:2px;margin-top:10px">${flagged.map((f) => `<div style="display:flex;align-items:center;gap:8px;padding:6px 2px"><span style="width:6px;height:6px;border-radius:50%;background:${f.color};flex:none"></span><span style="font-size:12.5px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(f.label)}${f.sub ? ` <span style="color:var(--text-faint);font-weight:500">${escHtml(f.sub)}</span>` : ""}</span><span style="font-size:10.5px;font-weight:750;color:${f.color};flex:none">${f.tag}</span></div>`).join("")}</div>` : "";
  const alert = pending.length ? `<div style="display:flex;align-items:center;gap:9px;margin-top:12px;border:1px solid rgba(251,191,36,.35);background:rgba(251,191,36,.06);border-radius:10px;padding:9px 11px">
      <span style="color:#FBBF24;flex:none">${ic(I.warn, 14)}</span>
      <span style="font-size:11.5px;color:var(--text);flex:1">${pending.length} paiement${pending.length > 1 ? "s" : ""} en attente</span>
      <span data-regiepanel="paiements" style="font-size:11px;font-weight:750;color:#FBBF24;cursor:pointer;flex:none">Traiter</span>
    </div>` : "";
  return `<div style="border:1px solid var(--border);border-radius:12px;background:var(--surface);padding:13px 14px">
    <div style="display:flex;align-items:center;gap:9px"><span style="font-size:10.5px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-muted)">Joueurs</span><span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text-faint)">${roster.length}</span>${dqCount ? `<span style="font-size:10px;font-weight:750;color:#FB7185">${dqCount} disqualifié${dqCount > 1 ? "s" : ""}</span>` : ""}<span style="flex:1"></span><span data-regiepanel="joueurs" style="font-size:11px;font-weight:700;color:#22D3EE;cursor:pointer">Voir tout</span></div>
    ${rows || `<div style="font-size:11px;color:var(--text-faint);margin-top:6px">Renommer, disqualifier, ajuster les points — sans quitter la régie.</div>`}
    ${alert}
  </div>`;
}

/** Panneau de contrôle d'UN match actif : stepper de score, valider/annuler/forfait — remplace la
 * saisie par input number. Appelé une fois par match actif (voir regiePage) — plusieurs peuvent donc
 * s'afficher empilés quand plusieurs confrontations sont en cours en même temps. */
function matchScoreControl(S: State, t: Detail, active: ActiveMatch): string {
  const key = activeKey(active);
  const sc = S.matchScores[key] || { a: 0, b: 0 };
  const sa = sc.a, sb = sc.b;
  const canValidate = sa !== sb && !S.detailBusy;
  const side = (name: string, score: number, k: "a" | "b") => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;background:var(--surface-5);border:1px solid var(--border);flex:1 1 230px;min-width:0">
      <span style="display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--surface-4);font-size:11px;font-weight:800;color:#22D3EE;flex:none">${escHtml(name).charAt(0).toUpperCase()}</span>
      <b style="font-size:13.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(name)}</b>
      <button data-scorestep="${key}|${k}|-1" style="display:grid;place-items:center;width:26px;height:26px;border-radius:7px;border:1px solid var(--border-strong);background:transparent;color:var(--text-muted);font-size:15px;font-weight:700;cursor:pointer;flex:none">–</button>
      <span style="font-family:'JetBrains Mono',monospace;font-size:20px;font-weight:600;min-width:22px;text-align:center">${score}</span>
      <button data-scorestep="${key}|${k}|1" style="display:grid;place-items:center;width:26px;height:26px;border-radius:7px;background:#22D3EE;color:#04222a;font-size:15px;font-weight:800;border:0;cursor:pointer;flex:none">+</button>
    </div>`;
  const stationVal = (t.stations && t.stations[key]) || "";
  const stationField = `<span style="display:inline-flex;align-items:center;gap:6px;flex:none">
      <span style="font-size:10px;font-weight:750;letter-spacing:.4px;text-transform:uppercase;color:var(--text-faint)">Poste</span>
      <input id="station-${key}" value="${escAttr(stationVal)}" placeholder="Ex. Table 3" title="Table/poste physique où se joue ce match (indicatif, affiché sur l'écran de diffusion Mode Show)" style="width:78px;background:var(--surface-4);border:1px solid var(--border-strong);border-radius:7px;color:var(--text);font-family:inherit;font-size:11px;padding:5px 6px;text-align:center" />
      <button data-stationsave="${t.id}|${key}" title="Enregistrer le poste" style="flex:none;background:transparent;border:1px solid var(--border-strong);color:var(--text-muted);border-radius:7px;padding:5px 8px;font-size:10.5px;font-weight:700;cursor:pointer">OK</button>
    </span>`;
  const startedAt: number | undefined = t.matchStarts?.[key];
  const timerChip = startedAt
    ? `<span data-timer="${startedAt}" data-limit="${t.matchMinutes || 0}" title="Durée du match${t.matchMinutes ? ` (prévue : ${t.matchMinutes} min)` : ""}" style="flex:none;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;border:1px solid var(--border-strong);border-radius:7px;padding:4px 8px;color:var(--text-muted)">00:00</span>`
    : `<button data-matchstart="${t.id}|${key}" title="Démarrer le chronomètre de ce match" style="flex:none;background:transparent;border:1px solid var(--border-strong);color:var(--text-muted);border-radius:7px;padding:5px 8px;font-size:10.5px;font-weight:700;cursor:pointer">▶ Chrono</button>`;
  const onStream = t.streamMatchKey === key;
  const streamBtn = `<button data-streammatch="${t.id}|${key}|${onStream ? "0" : "1"}" title="${onStream ? "Retirer de l'antenne" : "Marquer à l'antenne (mis en avant sur l'écran de diffusion)"}" style="display:inline-flex;align-items:center;gap:5px;flex:none;background:${onStream ? "#F43F7E" : "transparent"};border:1px solid ${onStream ? "#F43F7E" : "var(--border-strong)"};color:${onStream ? "#fff" : "var(--text-muted)"};border-radius:7px;padding:5px 9px;font-size:10.5px;font-weight:700;cursor:pointer">${ic(I.tv, 12)}${onStream ? "À l'antenne" : "Stream"}</button>`;
  return `<div style="border:1px solid ${onStream ? "#F43F7E" : "rgba(34,211,238,.4)"};border-radius:12px;background:rgba(34,211,238,.05);overflow:hidden">
    <div style="display:flex;align-items:center;gap:9px;padding:12px 15px;border-bottom:1px solid rgba(34,211,238,.22);flex-wrap:wrap">
      <span style="width:6px;height:6px;border-radius:50%;background:#22D3EE;animation:blink 1.2s infinite"></span>
      <span style="font-size:10.5px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:#22D3EE;flex:1">Match en cours</span>
      ${t.matchFormatLabel ? `<span style="font-size:10px;font-weight:800;letter-spacing:.6px;color:var(--text-muted);background:var(--surface-3);border:1px solid var(--border);border-radius:99px;padding:3px 9px">${escHtml(t.matchFormatLabel)}</span>` : ""}
      ${streamBtn}
      ${stationField}
      ${timerChip}
      <button data-notifymatch="${t.id}|${key}" title="Prévenir les deux joueurs par e-mail (avec leur poste)" style="flex:none;background:transparent;border:1px solid var(--border-strong);color:var(--text-muted);border-radius:7px;padding:5px 8px;font-size:10.5px;font-weight:700;cursor:pointer">Prévenir</button>
      <button data-matchclose="${key}" title="Retirer de la régie (reste jouable, revient dans la file d'attente)" style="display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:transparent;border:0;color:var(--text-faint);cursor:pointer;flex:none">${ic(I.x, 12)}</button>
    </div>
    <div style="padding:14px">
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">${side(active.aName, sa, "a")}${side(active.bName, sb, "b")}</div>
      <div style="display:flex;justify-content:center;margin-top:12px"><button data-matchvalidate="${key}" ${canValidate ? "" : "disabled"} style="display:flex;align-items:center;justify-content:center;gap:8px;background:${canValidate ? "#22D3EE" : "var(--surface-4)"};color:${canValidate ? "#04222a" : "var(--text-faint)"};border:0;border-radius:9px;padding:11px 20px;font-weight:800;font-size:13px;cursor:${canValidate ? "pointer" : "default"}">Valider le vainqueur</button></div>
      <div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--text-faint);font-weight:750;margin-top:12px">Déclarer forfait</div>
      <div style="display:flex;gap:8px;margin-top:6px">
        <button data-matchforfeit="${key}|a" style="flex:1;text-align:center;border:1px solid rgba(244,63,126,.4);color:#F43F7E;background:transparent;border-radius:8px;padding:7px 4px;font-size:11px;font-weight:700;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(active.aName)}</button>
        <button data-matchforfeit="${key}|b" style="flex:1;text-align:center;border:1px solid rgba(244,63,126,.4);color:#F43F7E;background:transparent;border-radius:8px;padding:7px 4px;font-size:11px;font-weight:700;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(active.bName)}</button>
      </div>
    </div>
  </div>`;
}

/** Une case de l'arbre de bracket, positionnée en absolu. */
/** Hauteur d'une affiche de l'arbre. Imposée en dur à la boîte ET utilisée par bracketTree pour
 * placer les affiches : sans cette contrainte, ajouter une ligne dans la boîte (le badge « Joué »,
 * par exemple) la fait dépasser de la hauteur supposée et les affiches se collent entre elles. */
const TREE_BOX_H = 92;
const TREE_ROW_GAP = 22;
const TREE_BOX_W = 172;
const TREE_COL_GAP = 40;

function matchTreeBox(m: Detail, x: number, y: number, w: number, active: boolean, manage: boolean, logId?: string): string {
  const shell = (inner: string, border: string, bg: string, attrs = "", cursor = "") =>
    `<div ${attrs} style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${TREE_BOX_H}px;display:flex;flex-direction:column;border:${border};border-radius:10px;overflow:hidden;background:${bg};${cursor}">${inner}</div>`;
  if (m.bye) {
    return shell(
      `<div style="flex:1;display:flex;align-items:center;padding:0 10px;font-size:12.5px;font-weight:600">${escHtml(m.aName || m.bName || "—")}</div><div style="flex:1;display:flex;align-items:center;padding:0 10px;color:var(--text-faint);font-style:italic;font-size:11.5px;border-top:1px solid var(--surface-3)">exempt</div>`,
      "1px solid var(--surface-3)", "var(--surface-5)",
    );
  }
  const hasScore = m.sa !== null && m.sa !== undefined && m.sb !== null && m.sb !== undefined;
  const row = (name: string | null, win: boolean, score: number | null, sep: boolean) => {
    const base = `flex:1;display:flex;align-items:center;justify-content:space-between;gap:6px;padding:0 10px${sep ? ";border-top:1px solid var(--surface-3)" : ""}`;
    return name
      ? `<div style="${base};font-size:12.5px;font-weight:600;color:${win ? "#34D399" : "var(--text)"}"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(name)}${win ? " ✓" : ""}</span>${score !== null ? `<span style="font-family:'JetBrains Mono',monospace;font-weight:800;font-size:11.5px;color:${win ? "#34D399" : "var(--text-faint)"};flex:none">${score}</span>` : ""}</div>`
      : `<div style="${base};color:var(--text-faint);font-style:italic;font-size:11.5px">à venir</div>`;
  };
  // La mise en avant du prochain match jouable reste visible côté spectateur (on voit ce qui arrive) ;
  // seul le clic pour le rapporter est réservé à l'organisateur.
  const v = matchVisual(m, active);
  const clickable = !!m.playable && manage && !active;
  // Crayon : corriger un match déjà joué (voir matchCorrectControl) — remplace le tap direct sur un
  // nom pour valider un vainqueur, qui n'existe plus ici. logId absent (match trop ancien pour la
  // pile d'annulation, ou pas encore résolu côté API) : pas de crayon plutôt qu'une correction qui échouerait.
  const pencil = m.winnerId && manage && logId
    ? `<button data-editmatch="${logId}" title="Corriger ce match" style="margin-left:auto;display:grid;place-items:center;width:18px;height:18px;border-radius:5px;background:transparent;border:0;color:${v.badgeColor};cursor:pointer;flex:none">${ic(I.edit, 10)}</button>`
    : "";
  const badge = `<div style="flex:none;display:flex;align-items:center;padding:5px 10px;background:var(--surface-7);border-bottom:1px solid var(--surface-3)"><span style="font-size:9px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:${v.badgeColor}">${v.badgeText}</span>${m.playable ? `<span style="display:inline-flex;gap:4px;margin-left:6px">${liveBadges(m.matchId, true)}</span>` : ""}${pencil}</div>`;
  return shell(
    badge + row(m.aName, m.winnerId === m.aId, hasScore ? m.sa : null, false) + row(m.bName, m.winnerId === m.bId, hasScore ? m.sb : null, true),
    v.border, v.bg,
    clickable ? `data-activematch="${m.matchId}"` : "",
    clickable ? "cursor:pointer" : "",
  );
}

/** Tours du bracket des vainqueurs prolongés par la grande finale (et sa 2e manche en cas de
 * bracket reset). Ainsi l'affiche qui décide du titre se lit dans le prolongement naturel de
 * l'arbre, reliée à la finale des vainqueurs, au lieu d'être isolée ailleurs sur la page.
 * La filiation par défaut suffit : le tour ne contient qu'une affiche, dont le seul parent
 * existant est la finale précédente. */
function winnersRoundsWithFinal(finals: Detail, gfLabels: [string, string] = ["Grande finale", "Grande finale · manche 2"]): Detail[] {
  const rounds: Detail[] = [...(finals.wb || [])];
  if (finals.gf) rounds.push({ label: gfLabels[0], matches: [finals.gf], accent: "#FBBF24" });
  if (finals.gf2) rounds.push({ label: gfLabels[1], matches: [finals.gf2], accent: "#FBBF24" });
  return rounds;
}
/** Arbre de bracket avec connecteurs, disposition calculée génériquement (pas de pixels codés en dur) — élimination simple ou bracket vainqueurs d'un double élim. */
/** Filiation par défaut (élimination directe) : deux affiches d'un tour alimentent la suivante. */
const PARENTS_ELIM = (_r: number, i: number) => [2 * i, 2 * i + 1];
/** Filiation du bracket des perdants : les tours alternent. Un tour pair reçoit un repêché du
 * bracket des vainqueurs et conserve donc l'indice de son prédécesseur (1 vers 1) ; un tour impair
 * fusionne deux affiches comme une élimination directe. Sans cette distinction, l'arbre des
 * perdants serait relié de travers — c'est pourquoi il restait affiché en simple liste.
 * Voir propagateDouble() dans le moteur, qui applique exactement la même règle. */
const PARENTS_LOSERS = (r: number, i: number) => ((r - 1) % 2 === 0 ? [i] : [2 * i, 2 * i + 1]);

type TreeRound = { label: string; matches: Detail[]; accent?: string };
// centers[0][i] est undefined pour une affiche exempte du 1er tour : elle n'a pas de boîte propre
// (voir treeParts) et sert seulement de parent absent — filtré comme tel dans le calcul des tours suivants.
type TreeParts = { header: string; canvas: string; centers: (number | undefined)[][]; totalW: number; totalH: number };

/** Géométrie d’un arbre : rangées calculées une seule fois puis réutilisées pour les affiches,
 * les connecteurs et — en double élimination — la liaison qui remonte du bracket des perdants vers
 * la grande finale. Les morceaux sont renvoyés séparément pour pouvoir les reposer dans un canevas
 * commun aux deux brackets. */
function treeParts(rounds: TreeRound[], activeMatchIds: string[], manage: boolean, parentsOf: (r: number, i: number) => number[], logByMatch: Record<string, string> = {}): TreeParts {
  const BOX_W = TREE_BOX_W, COL_GAP = TREE_COL_GAP, BOX_H = TREE_BOX_H, ROW_GAP = TREE_ROW_GAP;
  const centers: (number | undefined)[][] = [];
  rounds.forEach((round, r) => {
    // Un exempt du 1er tour n'a pas de vraie rencontre à montrer (voir la boucle "boxes" plus bas,
    // qui saute les positions undefined) : le nom qualifié apparaît déjà, résolu, dans la case du
    // tour suivant — inutile de doubler l'info avec une case "exempt" isolée sur la première colonne.
    if (r === 0) centers.push(round.matches.map((m, i) => m.bye ? undefined : i * (BOX_H + ROW_GAP) + BOX_H / 2));
    else {
      const prev = centers[r - 1];
      // Repli si aucun parent réel (les deux étaient des exempts du 1er tour, qui se retrouvent
      // donc face à face ici sans jamais être passés par une case de tour 1) : répartit sur la
      // même hauteur totale que le 1er tour, à la densité de CE tour — pas la formule du 1er tour
      // elle-même, qui placerait plusieurs affiches à la même hauteur (chevauchement).
      const fallbackY = (i: number) => (i + 0.5) * (rounds[0].matches.length / round.matches.length) * (BOX_H + ROW_GAP);
      centers.push(round.matches.map((_, i) => {
        const ys = parentsOf(r, i).map((k) => prev[k]).filter((y) => y !== undefined);
        return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : fallbackY(i);
      }));
    }
  });
  let connectors = "";
  for (let r = 1; r < rounds.length; r++) {
    const prev = centers[r - 1];
    rounds[r].matches.forEach((_, i) => {
      const ys = parentsOf(r, i).map((k) => prev[k]).filter((y) => y !== undefined);
      const yA = ys[0], yB = ys[1];
      if (yA === undefined) return;
      const xLeft = r * (BOX_W + COL_GAP) - COL_GAP;
      const xMid = xLeft + COL_GAP / 2;
      const yMid = centers[r][i];
      connectors += `<span style="position:absolute;left:${xLeft}px;top:${yA}px;width:${COL_GAP / 2}px;height:2px;background:#2c2c3d"></span>`;
      if (yB !== undefined) {
        connectors += `<span style="position:absolute;left:${xLeft}px;top:${yB}px;width:${COL_GAP / 2}px;height:2px;background:#2c2c3d"></span>`;
        connectors += `<span style="position:absolute;left:${xMid}px;top:${Math.min(yA, yB)}px;width:2px;height:${Math.abs(yB - yA) || 2}px;background:#2c2c3d"></span>`;
      }
      connectors += `<span style="position:absolute;left:${xMid}px;top:${yMid}px;width:${COL_GAP / 2}px;height:2px;background:#2c2c3d"></span>`;
    });
  }
  const boxes = rounds.map((round, r) => round.matches.map((m, i) => {
    const y = centers[r][i];
    return y === undefined ? "" : matchTreeBox(m, r * (BOX_W + COL_GAP), y - BOX_H / 2, BOX_W, activeMatchIds.includes(m.matchId), manage, logByMatch[m.matchId]);
  }).join("")).join("");
  const header = `<div style="display:flex;gap:${COL_GAP}px">${rounds.map((r) => `<div style="width:${BOX_W}px"><div style="font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:${r.accent || "var(--text-faint)"};font-weight:800">${escHtml(r.label)}</div></div>`).join("")}</div>`;
  const definedYs = centers.flat().filter((y): y is number => y !== undefined);
  return {
    header, canvas: connectors + boxes, centers,
    totalW: rounds.length * (BOX_W + COL_GAP) - COL_GAP,
    totalH: Math.max(...definedYs.map((y) => y + BOX_H / 2 + 10), BOX_H),
  };
}

function bracketTree(rounds: TreeRound[], activeMatchIds: string[], manage: boolean, parentsOf: (r: number, i: number) => number[] = PARENTS_ELIM, logByMatch: Record<string, string> = {}): string {
  if (!rounds.length) return "";
  const g = treeParts(rounds, activeMatchIds, manage, parentsOf, logByMatch);
  return `<div style="overflow-x:auto;padding-bottom:14px"><div style="width:${g.totalW}px">${g.header}<div style="position:relative;width:${g.totalW}px;height:${g.totalH}px;margin-top:14px">${g.canvas}</div></div></div>`;
}

/** Double élimination : les deux brackets dans un seul canevas, pour tracer la liaison qui manquait
 * — la finale des perdants remonte vers la grande finale, qu’elle alimente au même titre que la
 * finale des vainqueurs. Sans ce trait, les deux arbres paraissent indépendants. */
function doubleElimTree(finals: Detail, activeMatchIds: string[], manage: boolean, logByMatch: Record<string, string> = {}, gfLabels?: [string, string]): string {
  const wbRounds = winnersRoundsWithFinal(finals, gfLabels);
  const lb: TreeRound[] = finals.lb || [];
  if (!wbRounds.length) return "";
  if (!lb.length) return bracketTree(wbRounds, activeMatchIds, manage, PARENTS_ELIM, logByMatch);
  const gw = treeParts(wbRounds, activeMatchIds, manage, PARENTS_ELIM, logByMatch);
  const gl = treeParts(lb, activeMatchIds, manage, PARENTS_LOSERS, logByMatch);
  const TITLE_H = 24, HEAD_H = 28, GAP = 36;
  const yWb = TITLE_H + HEAD_H;
  const yLbTitle = yWb + gw.totalH + GAP;
  const yLb = yLbTitle + TITLE_H + HEAD_H;
  const totalW = Math.max(gw.totalW, gl.totalW);
  const totalH = yLb + gl.totalH;
  const title = (txt: string, y: number) => `<div style="position:absolute;left:0;top:${y}px;font-size:11px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-muted);font-weight:750">${txt}</div>`;
  const layer = (inner: string, y: number, w: number, h: number) => `<div style="position:absolute;left:0;top:${y}px;width:${w}px;height:${h}px">${inner}</div>`;
  // Liaison finale des perdants → grande finale : en pointillés, car elle traverse toute la hauteur
  // de la page et un trait plein se confondrait avec les connecteurs internes d’un bracket.
  // Décalée vers la droite de l’affiche plutôt que centrée : au centre, la verticale barrerait
  // l’intitulé du tour qu’elle traverse.
  const colX = (col: number) => col * (TREE_BOX_W + TREE_COL_GAP) + TREE_BOX_W * 0.85;
  const vline = (x: number, y: number, h: number) => `<span style="position:absolute;left:${x - 1}px;top:${y}px;height:${Math.max(h, 2)}px;border-left:2px dashed #3F3F5C"></span>`;
  const hline = (x: number, y: number, w: number) => `<span style="position:absolute;left:${x}px;top:${y - 1}px;width:${Math.max(w, 2)}px;border-top:2px dashed #3F3F5C"></span>`;
  let link = "";
  const cG = finals.gf ? (finals.wb || []).length : -1;
  const cL = lb.length - 1;
  if (cG >= 0 && gw.centers[cG] && gl.centers[cL]) {
    const xG = colX(cG), xL = colX(cL);
    const yG = yWb + (gw.centers[cG][0] ?? 0) + TREE_BOX_H / 2;
    const yL = yLb + (gl.centers[cL][0] ?? 0) - TREE_BOX_H / 2;
    const yJog = yLbTitle - 14;
    link = Math.abs(xG - xL) < 1
      ? vline(xG, yG, yL - yG)
      : vline(xG, yG, yJog - yG) + hline(Math.min(xG, xL), yJog, Math.abs(xG - xL)) + vline(xL, yJog, yL - yJog);
    link += `<span style="position:absolute;left:${xG - 5}px;top:${yG}px;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:7px solid #3F3F5C"></span>`;
  }
  return `<div style="overflow-x:auto;padding-bottom:14px"><div style="position:relative;width:${totalW}px;height:${totalH}px">
    ${link}
    ${title("Bracket des vainqueurs", 0)}${layer(gw.header, TITLE_H, gw.totalW, HEAD_H)}${layer(gw.canvas, yWb, gw.totalW, gw.totalH)}
    ${title("Bracket des perdants", yLbTitle)}${layer(gl.header, yLbTitle + TITLE_H, gl.totalW, HEAD_H)}${layer(gl.canvas, yLb, gl.totalW, gl.totalH)}
  </div></div>`;
}

/** Une ligne de statut de round (phase finale) dans le rail de régie — terminée / en cours / à venir, à partir des données réelles des matchs. */
function regieRoundStatusRows(rounds: { label: string; matches: Detail[] }[]): string {
  return rounds.map((r) => {
    const doneCount = r.matches.filter((m: Detail) => m.winnerId || m.bye).length;
    const allDone = doneCount === r.matches.length;
    const anyPlayable = r.matches.some((m: Detail) => m.playable);
    const statusLabel = allDone ? "terminée" : anyPlayable ? `en cours · ${doneCount}/${r.matches.length}` : "à venir";
    const color = allDone ? "#34D399" : anyPlayable ? "#22D3EE" : "var(--text-faint)";
    return `<div style="display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:9px;${anyPlayable ? "background:rgba(34,211,238,.06)" : ""}">
      <span style="display:grid;place-items:center;width:19px;height:19px;border-radius:50%;${allDone ? "background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.4);color:#34D399" : "border:1px solid var(--border-strong);color:var(--text-faint)"};font-size:9px;flex:none">${allDone ? ic(I.plus, 9) : ""}</span>
      <span style="font-size:12.5px;color:${anyPlayable ? "var(--text)" : "var(--text-muted)"};font-weight:${anyPlayable ? 700 : 500};flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(r.label)}</span>
      <span style="font-size:11px;color:${color};flex:none;white-space:nowrap">${statusLabel}</span>
    </div>`;
  }).join("");
}
/** Une ligne de statut de poule Survival dans le rail — cliquable si elle a un match en cours (l'ajoute au panneau de contrôle, plusieurs poules peuvent y être en même temps). */
function regiePoolStatusRows(t: Detail, activePoolIds: Set<string>): string {
  const pools: Detail[] = Array.isArray(t.pools) ? t.pools : [];
  return pools.map((p: Detail) => {
    const isActive = activePoolIds.has(p.id);
    const statusLabel = p.done ? "terminée" : p.current ? "en cours" : "à venir";
    const color = p.done ? "#34D399" : p.current ? "#22D3EE" : "var(--text-faint)";
    // Toutes les poules sont cliquables (pas seulement celle en cours) : une poule terminée reste
    // consultable — sans ça, impossible de revoir ses résultats une fois passée à la suivante.
    return `<div data-viewpool="${p.id}" style="display:flex;align-items:center;gap:9px;padding:9px 10px;border-radius:9px;cursor:pointer;${isActive ? "background:rgba(34,211,238,.08)" : ""}">
      <span style="display:grid;place-items:center;width:19px;height:19px;border-radius:50%;${p.done ? "background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.4);color:#34D399" : p.current ? "background:#22D3EE;color:#04222a" : "border:1px solid var(--border-strong);color:var(--text-faint)"};font-size:10px;font-weight:700;flex:none">${p.done ? ic(I.plus, 9) : "•"}</span>
      <span style="font-size:12.5px;color:${p.current ? "var(--text)" : "var(--text-muted)"};font-weight:${p.current ? 700 : 500};flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p.name)}</span>
      <span style="font-size:11px;color:${color};flex:none;white-space:nowrap">${statusLabel}</span>
    </div>`;
  }).join("");
}
/** Une ligne de statut de partie Battle Royale dans le rail. */
function regieGamesStatusRows(t: Detail): string {
  const games: Detail[] = t.finals?.games || [];
  return games.map((g: Detail, i: number) => `<div style="display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:9px">
    <span style="display:grid;place-items:center;width:19px;height:19px;border-radius:50%;${g.played ? "background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.4);color:#34D399" : "border:1px solid var(--border-strong);color:var(--text-faint)"};font-size:9px;flex:none">${g.played ? ic(I.plus, 9) : i + 1}</span>
    <span style="font-size:12.5px;color:var(--text-muted);flex:1">${escHtml(g.label)}</span>
    <span style="font-size:11px;color:${g.played ? "#34D399" : "var(--text-faint)"}">${g.played ? "jouée" : "à jouer"}</span>
  </div>`).join("");
}

/** Rail de gauche de la régie : déroulé réel du tournoi (poules/rondes/parties selon le format) + accès Joueurs/Paiements/Réglages. */
function regieRail(S: State, t: Detail, manage: boolean, actives: ActiveMatch[]): string {
  const hasPools = Array.isArray(t.pools) && t.pools.length > 0;
  let body: string;
  if (t.finals && t.finals.format === "battle_royale") {
    body = `<div style="font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:var(--text-faint);font-weight:800;padding:0 8px 8px">Parties</div>${regieGamesStatusRows(t)}`;
  } else if (t.finals && !hasPools) {
    // Formats sans poules (single/double/roundrobin/swiss) : le bracket/les rondes sont toute la compétition.
    const rounds = t.finals.format === "double" ? t.finals.wb : t.finals.format === "roundrobin" ? null : t.finals.rounds;
    const heading = t.finals.format === "roundrobin" ? "Round Robin" : t.finals.format === "swiss" ? "Rondes suisses" : t.finals.format === "double" ? "Bracket · vainqueurs" : "Bracket";
    body = `<div style="font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:var(--text-faint);font-weight:800;padding:0 8px 8px">${heading}</div>${rounds ? regieRoundStatusRows(rounds) : `<div style="padding:8px 10px;font-size:12px;color:var(--text-muted)">${t.finals.matches.filter((m: Detail) => m.winnerId).length}/${t.finals.matches.length} matchs joués</div>`}`;
  } else {
    // Survival : poules, puis éventuellement phase finale une fois toutes terminées.
    const activePoolIds = new Set(actives.filter((a) => a.kind === "pool").map((a) => a.poolId!));
    body = `<div style="font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:var(--text-faint);font-weight:800;padding:0 8px 8px">Phase 1 · poules</div>${regiePoolStatusRows(t, activePoolIds)}`;
    if (t.finals) {
      const rounds = t.finals.format === "double" ? t.finals.wb : t.finals.format === "roundrobin" ? null : t.finals.rounds;
      body += `<div style="font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:#7C82FF;font-weight:800;padding:12px 8px 6px">Phase 2 · finale</div>${rounds ? regieRoundStatusRows(rounds) : `<div style="padding:8px 10px;font-size:12px;color:var(--text-muted)">Round Robin en cours</div>`}`;
    } else if (t.allPoolsDone) {
      body += `<div style="font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:#7C82FF;font-weight:800;padding:12px 8px 6px">Phase 2 · finale</div><div style="padding:8px 10px;font-size:12px;color:#63C6DA">Poules terminées — à lancer</div>`;
    }
  }
  // Barème (cagnotte à respecter) : ne concerne que Survival. Les autres formats n'ont rien à y
  // régler une fois lancés (finalsWin/championBonus restent aux valeurs figées à la création) — le
  // bouton n'a pas lieu d'exister, comme pour l'étape équivalente de l'assistant.
  const nav = `<div style="margin-top:16px;border-top:1px solid var(--surface-3);padding-top:12px;display:flex;flex-direction:column;gap:2px">
    <div style="display:flex;align-items:center;gap:6px;padding:8px 10px;font-size:12px;color:var(--text-muted)" title="Au-delà de cette durée, le chronomètre d'un match passe en rouge (0 = pas d'alerte)">
      <span style="flex:1">Durée prévue / match</span>
      <input id="match-minutes" type="number" min="0" max="240" value="${t.matchMinutes || ""}" placeholder="min" style="width:52px;background:var(--surface-4);border:1px solid var(--border-strong);border-radius:7px;color:var(--text);font-family:inherit;font-size:11.5px;padding:4px 6px;text-align:center" />
      <button data-matchminutes="${t.id}" style="background:transparent;border:1px solid var(--border-strong);color:var(--text-muted);border-radius:7px;padding:4px 7px;font-size:10.5px;font-weight:700;cursor:pointer">OK</button>
    </div>
    <div data-regiepanel="joueurs" style="display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:9px;cursor:pointer"><span style="color:var(--text-muted)">${ic(I.user, 15)}</span><span style="font-size:12.5px;color:var(--text-muted);flex:1">Joueurs</span><span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text-faint)">${(t.players || []).length}</span></div>
    <div data-regiepanel="paiements" style="display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:9px;cursor:pointer"><span style="color:var(--text-muted)">${ic(I.cart, 15)}</span><span style="font-size:12.5px;color:var(--text-muted);flex:1">Paiements</span></div>
    ${t.mainFormat === "survival" ? `<div data-regiepanel="reglages" style="display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:9px;cursor:pointer"><span style="color:var(--text-muted)">${ic(I.warn, 15)}</span><span style="font-size:12.5px;color:var(--text-muted);flex:1">Réglages &amp; barème</span></div>` : ""}
  </div>`;
  return `<div class="regie-rail" style="width:236px;flex:none;border-right:1px solid var(--surface-3);padding:20px 16px;display:flex;flex-direction:column;gap:6px;background:#0a0a10;overflow-y:auto">
    <div style="font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:var(--text-faint);font-weight:800;padding:0 8px 8px">Déroulé du tournoi</div>
    ${body}
    ${nav}
  </div>`;
}

/** Bandeau condensé du haut de la régie : nom, badges, cagnotte, actions (Mode Show/Affiche/Modifier/Annuler-tournoi/Réinitialiser/Supprimer). */
function regieTopBanner(S: State, t: Detail): string {
  const dist = t.distributed || 0, total = t.cagnotte?.total || 0;
  const pct = total ? Math.min(100, (dist / total) * 100) : 0;
  // La cagnotte (points distribués par victoire) ne concerne que le mode Survival — les autres formats se jouent sans elle.
  const cagnotteBlock = t.mainFormat === "survival" ? `<div style="text-align:right;flex:none">
      <div style="font-size:10px;letter-spacing:1.1px;text-transform:uppercase;color:var(--text-faint);font-weight:750">Cagnotte distribuée</div>
      <div style="display:flex;align-items:center;gap:9px;margin-top:5px"><span style="width:104px;height:5px;border-radius:99px;background:var(--surface-4);overflow:hidden;display:inline-block"><span style="display:block;width:${pct}%;height:100%;background:#FBBF24"></span></span><span style="font-family:'JetBrains Mono',monospace;font-size:12.5px;color:#FBBF24">${dist}/${total}</span></div>
    </div>
    <span style="width:1px;height:32px;background:var(--surface-4)"></span>` : "";
  return `<div class="regie-banner" style="display:flex;align-items:center;gap:16px;padding:0 26px;height:70px;border-bottom:1px solid var(--surface-3);background:linear-gradient(90deg,rgba(34,211,238,.07),transparent 46%)">
    <button data-back="1" style="display:grid;place-items:center;width:28px;height:28px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text-muted);flex:none;cursor:pointer">${icBack(14)}</button>
    <div style="min-width:0">
      <div style="display:flex;align-items:center;gap:10px">
        <h1 style="font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:1px;margin:0;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:360px">${escHtml(t.name)}</h1>
        <span style="display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:#04222a;background:#22D3EE;border-radius:99px;padding:4px 9px;flex:none"><span style="width:5px;height:5px;border-radius:50%;background:#04222a;animation:blink 1.2s infinite"></span>En direct</span>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:3px">${[t.game, t.format, t.matchFormatLabel].filter(Boolean).map((v: string) => escHtml(v)).join(" · ")}</div>
    </div>
    <span style="flex:1"></span>
    ${cagnotteBlock}
    <button data-show="${t.id}" style="display:inline-flex;align-items:center;gap:7px;border:1px solid var(--border-strong);background:var(--surface);color:var(--text);border-radius:10px;padding:11px 15px;font-weight:700;font-size:13px;flex:none;cursor:pointer">${ic(I.tv, 15)}Mode Show</button>
    <button data-embed="${t.id}" style="display:inline-flex;align-items:center;gap:7px;border:1px solid var(--border-strong);background:var(--surface);color:var(--text);border-radius:10px;padding:11px 15px;font-weight:700;font-size:13px;flex:none;cursor:pointer">${ic(I.extlink, 15)}Intégrer</button>
    <button data-print="${t.id}" style="display:inline-flex;align-items:center;gap:7px;border:1px solid var(--border-strong);background:var(--surface);color:var(--text);border-radius:10px;padding:11px 15px;font-weight:700;font-size:13px;flex:none;cursor:pointer">${ic(I.printer, 15)}Affiche</button>
    <button data-exportresults="${t.id}" style="display:inline-flex;align-items:center;gap:7px;border:1px solid var(--border-strong);background:var(--surface);color:var(--text);border-radius:10px;padding:11px 15px;font-weight:700;font-size:13px;flex:none;cursor:pointer">${ic(I.download, 15)}Résultats Excel</button>
    <button data-reset="${t.id}" style="display:inline-flex;align-items:center;gap:7px;border:1px solid rgba(251,191,36,.35);background:transparent;color:#FBBF24;border-radius:10px;padding:11px 15px;font-weight:700;font-size:13px;flex:none;cursor:pointer">${ic(I.warn, 15)}Réinitialiser</button>
  </div>`;
}

/** Centre de régie pour Battle Royale — même contenu que la page publique (battleRoyaleCenter), avec les contrôles d'organisateur. */
function battleRoyaleRegieCenter(S: State, t: Detail): string {
  return `<div style="display:flex;align-items:flex-end;gap:14px;padding:22px 28px 0">
      <div><div style="display:inline-flex;align-items:center;gap:7px;font-size:10.5px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:#22D3EE;background:rgba(34,211,238,.1);border:1px solid rgba(34,211,238,.35);border-radius:99px;padding:4px 10px">Battle Royale</div>
      <h2 style="font-family:'Bebas Neue',sans-serif;font-size:34px;letter-spacing:1.2px;margin:9px 0 0;line-height:1">Résultats &amp; classement</h2></div>
    </div>
    <div style="padding:18px 28px 30px">${battleRoyaleCenter(S, t, true)}</div>`;
}

/** Centre de la régie : arbre de bracket (single/double), table Round Robin/Swiss, ou poule Survival active. Battle Royale a son propre centre dédié. */
function regieCenter(S: State, t: Detail, manage: boolean, actives: ActiveMatch[]): string {
  if (t.finals && t.finals.format === "battle_royale") return battleRoyaleRegieCenter(S, t);
  const activeMatchIds = actives.filter((a) => a.kind === "finals").map((a) => a.matchId!);

  // Une fois en phase finale, les poules qui y ont mené ne doivent pas devenir inconsultables pour
  // autant — troisième onglet du même sélecteur "Arbre/Liste" plutôt qu'un écran séparé à chercher.
  const hasPools = Array.isArray(t.pools) && t.pools.length > 0;
  const poolsToggleBtn = hasPools ? `<span data-bracketview="pools" style="font-size:11.5px;font-weight:${S.bracketView === "pools" ? 750 : 700};color:${S.bracketView === "pools" ? "#04222a" : "var(--text-muted)"};background:${S.bracketView === "pools" ? "#22D3EE" : "transparent"};border:1px solid ${S.bracketView === "pools" ? "#22D3EE" : "var(--border)"};border-radius:8px;padding:7px 12px;cursor:pointer">Poules</span>` : "";
  const poolsGrid = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px">${(t.pools || []).map((p: Detail) => poolCard(S, p, manage, t.poolFormat, t.countGoalDiff, t.log)).join("")}</div>`;

  const champ = t.finals?.champion
    ? `<div style="border:1px solid rgba(251,191,36,.4);border-radius:16px;background:linear-gradient(180deg,rgba(251,191,36,.08),var(--surface));padding:24px;text-align:center;margin:18px 28px 0"><div style="font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:#FBBF24;font-weight:800">${ic(I.crown, 16)} Champion du tournoi</div><div style="font-family:'Bebas Neue',sans-serif;font-size:44px;letter-spacing:1px;margin-top:6px">${escHtml(t.finals.champion)}</div></div>`
    : "";

  if (t.finals && (t.finals.format === "single" || t.finals.format === "double")) {
    const rounds = t.finals.format === "single" ? t.finals.rounds : t.finals.wb;
    const viewToggle = `<div style="display:flex;gap:7px">
      <span data-bracketview="tree" style="font-size:11.5px;font-weight:${S.bracketView === "tree" ? 750 : 700};color:${S.bracketView === "tree" ? "#04222a" : "var(--text-muted)"};background:${S.bracketView === "tree" ? "#22D3EE" : "transparent"};border:1px solid ${S.bracketView === "tree" ? "#22D3EE" : "var(--border)"};border-radius:8px;padding:7px 12px;cursor:pointer">Arbre</span>
      <span data-bracketview="list" style="font-size:11.5px;font-weight:${S.bracketView === "list" ? 750 : 700};color:${S.bracketView === "list" ? "#04222a" : "var(--text-muted)"};background:${S.bracketView === "list" ? "#22D3EE" : "transparent"};border:1px solid ${S.bracketView === "list" ? "#22D3EE" : "var(--border)"};border-radius:8px;padding:7px 12px;cursor:pointer">Liste des matchs</span>
      ${poolsToggleBtn}
    </div>`;
    if (S.bracketView === "pools") {
      return `<div style="display:flex;align-items:flex-end;gap:14px;padding:22px 28px 0">
          <div><div style="display:inline-flex;align-items:center;gap:7px;font-size:10.5px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:#22D3EE;background:rgba(34,211,238,.1);border:1px solid rgba(34,211,238,.35);border-radius:99px;padding:4px 10px">Phase 1</div>
          <h2 style="font-family:'Bebas Neue',sans-serif;font-size:34px;letter-spacing:1.2px;margin:9px 0 0;line-height:1">Poules</h2></div>
          <span style="flex:1"></span>${viewToggle}
        </div>
        <div style="padding:22px 28px 30px">${poolsGrid}</div>`;
    }
    // En double élim, l'arbre des vainqueurs se prolonge jusqu'à la grande finale.
    const treeRounds = t.finals.format === "double" ? winnersRoundsWithFinal(t.finals) : rounds;
    const body = S.bracketView === "list"
      ? `<div style="display:flex;gap:24px;overflow-x:auto;padding-bottom:10px">${treeRounds.map((r: Detail, i: number) => roundCol(r.label, r.matches, manage, i === 0, logByMatchId(t.log))).join("")}</div>`
      : t.finals.format === "double"
        ? doubleElimTree(t.finals, activeMatchIds, manage, logByMatchId(t.log))
        : bracketTree(treeRounds, activeMatchIds, manage, PARENTS_ELIM, logByMatchId(t.log));
    // En mode arbre, le bracket des perdants est déjà dans le canevas commun (avec sa liaison).
    const extra = t.finals.format === "double" && S.bracketView === "list"
      ? `<div style="margin-top:20px">
          <div style="font-size:11px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-muted);font-weight:750;margin-bottom:10px">Bracket des perdants</div>
          <div style="display:flex;gap:24px;overflow-x:auto;padding-bottom:14px">${t.finals.lb.map((r: Detail, i: number) => roundCol(r.label, r.matches, manage, i === 0, logByMatchId(t.log))).join("")}</div>
        </div>`
      : t.finals.format === "single" && t.finals.thirdPlace
        ? `<div style="margin-top:20px">
            <div style="font-size:11px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-muted);font-weight:750;margin-bottom:10px">Petite finale · 3e place</div>
            <div style="max-width:280px">${matchBox(t.finals.thirdPlace, manage, logByMatchId(t.log))}</div>
          </div>`
        : "";
    return `<div style="display:flex;align-items:flex-end;gap:14px;padding:22px 28px 0">
        <div><div style="display:inline-flex;align-items:center;gap:7px;font-size:10.5px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:#22D3EE;background:rgba(34,211,238,.1);border:1px solid rgba(34,211,238,.35);border-radius:99px;padding:4px 10px">${t.finals.format === "double" ? "Double élimination" : "Élimination simple"}</div>
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:34px;letter-spacing:1.2px;margin:9px 0 0;line-height:1">Arbre de la phase finale</h2></div>
        <span style="flex:1"></span>${viewToggle}
      </div>
      ${champ}
      <div style="padding:22px 28px 30px">${body}${extra}</div>`;
  }

  if (t.finals && (t.finals.format === "roundrobin" || t.finals.format === "swiss")) {
    const isSwiss = t.finals.format === "swiss";
    // Swiss départage toujours par Buchholz (pas de score sa/sb) ; Round Robin suit le réglage
    // "Départager par différence de buts" du tournoi (voir wizInfosStep) — masqué si désactivé,
    // plutôt que d'afficher une colonne qui n'a pas influencé le classement.
    const showDiff = isSwiss || t.countGoalDiff !== false;
    // J/G/P (joués/gagnés/perdus) : même tableau de championnat que les poules Round Robin — le Swiss
    // n'a pas de notion de "perdus" comparable (byes, rondes variables), il garde sa colonne V seule.
    const standings = `<table style="width:100%;border-collapse:collapse;font-size:13.5px;margin-bottom:20px"><thead><tr style="color:var(--text-faint);font-size:11px;text-transform:uppercase;letter-spacing:.5px"><td style="padding:6px 8px">#</td><td style="padding:6px 8px">Joueur</td>${isSwiss ? `<td style="padding:6px 8px;text-align:right">V</td>` : `<td style="padding:6px 8px;text-align:right">J</td><td style="padding:6px 8px;text-align:right">G</td><td style="padding:6px 8px;text-align:right">P</td>`}${showDiff ? `<td style="padding:6px 8px;text-align:right">${isSwiss ? "Buchholz" : "Diff."}</td>` : ""}<td style="padding:6px 8px;text-align:right">Pts</td></tr></thead><tbody>${t.finals.standings.map((r: Detail, i: number) => `<tr style="border-top:1px solid var(--surface-4)"><td style="padding:7px 8px;color:var(--text-faint);font-family:'Bebas Neue',sans-serif;font-size:16px">${i + 1}</td><td style="padding:7px 8px;font-weight:600">${escHtml(r.name)}</td>${isSwiss ? `<td style="padding:7px 8px;text-align:right;color:var(--text-muted)">${r.wins}</td>` : `<td style="padding:7px 8px;text-align:right;color:var(--text-muted)">${r.played}</td><td style="padding:7px 8px;text-align:right;color:var(--text-muted)">${r.wins}</td><td style="padding:7px 8px;text-align:right;color:var(--text-muted)">${r.losses}</td>`}${showDiff ? `<td style="padding:7px 8px;text-align:right;color:var(--text-muted)">${isSwiss ? r.buchholz : (r.gd > 0 ? "+" : "") + r.gd}</td>` : ""}<td style="padding:7px 8px;text-align:right;font-weight:750;color:#22D3EE">${r.pts}</td></tr>`).join("")}</tbody></table>`;
    const label = isSwiss ? `Ronde ${t.finals.rounds.length}/${t.finals.roundCount}` : `${t.finals.matches.filter((m: Detail) => m.winnerId).length}/${t.finals.matches.length} matchs joués`;
    const rrBackBtn = `<span data-bracketview="tree" style="font-size:11.5px;font-weight:700;color:var(--text-muted);background:transparent;border:1px solid var(--border);border-radius:8px;padding:7px 12px;cursor:pointer">${isSwiss ? "Classement Swiss" : "Round Robin"}</span>`;
    if (S.bracketView === "pools" && hasPools) {
      return `<div style="display:flex;align-items:flex-end;gap:14px;padding:22px 28px 0">
          <div><div style="display:inline-flex;align-items:center;gap:7px;font-size:10.5px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:#22D3EE;background:rgba(34,211,238,.1);border:1px solid rgba(34,211,238,.35);border-radius:99px;padding:4px 10px">Phase 1</div>
          <h2 style="font-family:'Bebas Neue',sans-serif;font-size:34px;letter-spacing:1.2px;margin:9px 0 0;line-height:1">Poules</h2></div>
          <span style="flex:1"></span><div style="display:flex;gap:7px">${rrBackBtn}${poolsToggleBtn}</div>
        </div>
        <div style="padding:22px 28px 30px">${poolsGrid}</div>`;
    }
    const body = isSwiss
      ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">${t.finals.rounds[t.finals.rounds.length - 1].matches.map((m: Detail) => matchBox(m, manage, logByMatchId(t.log))).join("")}</div>`
      : journeeCalendar(t.finals.standings.map((r: Detail) => ({ id: r.id, name: r.name })), t.finals.matches, manage, (m) => m.playable ? `data-activematch="${m.matchId}"` : null, false, logByMatchId(t.log));
    return `<div style="display:flex;align-items:flex-end;gap:14px;padding:22px 28px 0">
        <div><div style="display:inline-flex;align-items:center;gap:7px;font-size:10.5px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:#22D3EE;background:rgba(34,211,238,.1);border:1px solid rgba(34,211,238,.35);border-radius:99px;padding:4px 10px">${label}</div>
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:34px;letter-spacing:1.2px;margin:9px 0 0;line-height:1">${isSwiss ? "Classement Swiss" : "Round Robin"}</h2></div>
        <span style="flex:1"></span>${hasPools ? `<div style="display:flex;gap:7px">${poolsToggleBtn}</div>` : ""}
      </div>
      ${champ}
      <div style="padding:18px 28px 30px">${standings}${body}</div>`;
  }

  if (t.finals && t.finals.format === "survival") {
    // Grande poule finale (voir Engine.startFinalsSurvivalPool) : t.pools[0] EST la phase finale,
    // réunit tous les qualifiés — même carte que n'importe quelle poule, pas de bracket à tracer.
    const p = t.pools[0];
    return `<div style="display:flex;align-items:flex-end;gap:14px;padding:22px 28px 0">
        <div><div style="display:inline-flex;align-items:center;gap:7px;font-size:10.5px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:#22D3EE;background:rgba(34,211,238,.1);border:1px solid rgba(34,211,238,.35);border-radius:99px;padding:4px 10px">Phase finale</div>
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:34px;letter-spacing:1.2px;margin:9px 0 0;line-height:1">Survival</h2></div>
        <span style="flex:1"></span>
      </div>
      ${champ}
      <div style="padding:22px 28px 30px">${p ? poolCard(S, p, manage, "survival", true, t.log) : ""}</div>`;
  }

  // Survival, poules en cours (pas encore de phase finale) : toutes les poules en même temps, côte à
  // côte (2-3 colonnes selon la largeur), chacune avec son calendrier/carte de match ET son classement
  // en dessous — plusieurs poules peuvent avoir un match en cours simultanément, inutile de forcer à
  // n'en regarder qu'une à la fois. Le rail (data-viewpool) fait défiler jusqu'à la carte choisie.
  const pools: Detail[] = Array.isArray(t.pools) ? t.pools : [];
  return `<div style="padding:22px 28px 30px">
    <div style="display:flex;align-items:flex-end;gap:14px;margin-bottom:18px">
      <div><div style="display:inline-flex;align-items:center;gap:7px;font-size:10.5px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:#22D3EE;background:rgba(34,211,238,.1);border:1px solid rgba(34,211,238,.35);border-radius:99px;padding:4px 10px">Phase 1 · poules</div>
      <h2 style="font-family:'Bebas Neue',sans-serif;font-size:34px;letter-spacing:1.2px;margin:9px 0 0;line-height:1">Poules</h2></div>
    </div>
    ${pools.length
      ? `<div class="grid2" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:18px;align-items:start">${pools.map((p) => `<div id="poolcard-${p.id}">${poolCard(S, p, manage, t.poolFormat, t.countGoalDiff, t.log)}</div>`).join("")}</div>`
      : `<div style="color:var(--text-muted);text-align:center;padding:30px 0">Aucune poule.</div>`}
    ${finalsStartPanel(S, t, manage)}
  </div>`;
}

const WIZ_SCORING_FIELDS_REF: [string, string][] = [["Victoire en poule Survival", "survWin"], ["Victoire en poule des perdants", "loserWin"], ["Victoire en finale de poule", "poolFinalWin"], ["Victoire en phase finale", "finalsWin"], ["Bonus champion du tournoi", "championBonus"], ["Bonus striker", "streakBonus"]];
/** Barème modifiable en direct (le tournoi est déjà lancé — l'assistant de création ne s'applique plus).
 * La longueur de série du bonus striker (3 ou 5, fixée à la création) n'est plus modifiable une fois
 * le tournoi lancé — seul le point alloué l'est encore, comme les autres lignes du barème. */
function regieScoringForm(t: Detail): string {
  const rows = WIZ_SCORING_FIELDS_REF.map(([label, key]) => `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--surface-3)">
    <span style="flex:1;font-size:13px">${label}${key === "streakBonus" ? ` (${t.streakLength || 5} victoires d'affilée)` : ""}</span>
    <input id="ls-${key}" type="number" min="0" step="0.25" value="${(t.scoring as Record<string, number>)[key]}" style="width:80px;text-align:center;background:var(--surface-3);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:13px;padding:7px" />
  </div>`).join("");
  return `<div>${rows}</div><button data-livescoresave="${t.id}" style="width:100%;margin-top:14px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:10px;padding:11px;font-weight:750;font-size:13.5px;cursor:pointer">Enregistrer le barème</button>`;
}

/** Overlay Joueurs / Paiements / Réglages ouvert depuis le bas du rail de régie. */
function regieOverlay(S: State, t: Detail, manage: boolean): string {
  // Le barème n'a pas de sens hors Survival (voir regieRail, qui n'affiche même plus le bouton) —
  // filet de sécurité si l'état retenait ce panneau d'un tournoi Survival visité juste avant.
  if (!S.regiePanel || (S.regiePanel === "reglages" && t.mainFormat !== "survival")) return "";
  const titles: Record<string, string> = { joueurs: "Joueurs", paiements: "Paiements en attente", reglages: "Réglages & barème" };
  const body = S.regiePanel === "joueurs" ? (playersRosterPanel(S, t, manage) || `<div style="color:var(--text-muted);text-align:center;padding:20px">Aucun joueur.</div>`)
    : S.regiePanel === "paiements" ? (paymentsPanel(S, t.id) || `<div style="color:var(--text-muted);text-align:center;padding:20px">Aucun paiement en attente.</div>`)
    : regieScoringForm(t);
  return `<div data-regiepanel="" style="position:fixed;inset:0;z-index:270;display:flex;align-items:flex-start;justify-content:center;padding:min(6vh,60px) 18px;background:rgba(6,6,10,.75);backdrop-filter:blur(6px);overflow-y:auto">
    <div data-stop="1" style="width:100%;max-width:520px;border:1px solid var(--border);border-radius:16px;background:var(--surface-2);box-shadow:0 30px 80px rgba(0,0,0,.6);animation:fadeUp .18s ease both">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--surface-3)"><span style="font-family:'Bebas Neue',sans-serif;font-size:19px;letter-spacing:1px">${titles[S.regiePanel]}</span><button data-regiepanel="" style="display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:var(--surface-3);border:1px solid var(--border);color:var(--text-muted);cursor:pointer">${ic(I.x, 13)}</button></div>
      <div style="padding:18px 20px;max-height:70vh;overflow-y:auto">${body}</div>
    </div>
  </div>`;
}

/** Régie plein cadre (organisateur/admin, tournoi en direct) — rail · centre · contrôle, hors du rail public. Tour 5/6. */
function regiePage(S: State): string {
  const t = S.detail;
  if (!t) return `<div style="min-height:100vh;display:grid;place-items:center;color:var(--text-muted)">Chargement…</div>`;
  const manage = canManage(S);
  // Plusieurs confrontations peuvent réellement se jouer en même temps (tables/écrans différents) :
  // une carte de contrôle par match actif, empilées, plutôt qu'une seule qui forcerait à choisir.
  const actives = getActiveMatches(S, t);
  const control = actives.length
    ? actives.map((a) => matchScoreControl(S, t, a)).join("<div style=\"height:2px\"></div>")
    : `<div style="border:1px solid var(--border);border-radius:12px;background:var(--surface);padding:24px;text-align:center;color:var(--text-muted);font-size:13px">Aucun match en attente pour l'instant.</div>`;
  return `<div class="regie-page-outer" style="height:100vh;overflow:hidden;background:#08080d;display:flex;flex-direction:column">
    ${regieTopBanner(S, t)}
    <div class="regie-grid" style="display:grid;grid-template-columns:236px 1fr 330px;flex:1;min-height:0">
      ${regieRail(S, t, manage, actives)}
      <div class="regie-center" style="min-width:0;overflow-y:auto">${regieCenter(S, t, manage, actives)}</div>
      <div class="regie-control" style="border-left:1px solid var(--surface-3);padding:22px 20px 30px;display:flex;flex-direction:column;gap:16px;background:#0a0a10;overflow-y:auto">${control}${matchQueuePanel(t, actives)}${regieRosterMini(S, t)}</div>
    </div>
  </div>${regieOverlay(S, t, manage)}${confirmModal(S)}${matchCorrectModal(S)}${cartDrawer(S)}`;
}

/** Pronostics d'un tournoi en direct (page publique) : choisir le vainqueur des matchs à venir, voir la
 * tendance du public, puis le verdict une fois le match joué. Fermé dès que le match est lancé en régie. */
function predictionsCard(S: State, t: Detail, manage: boolean): string {
  if (manage || t.status !== "live" || !S.predBoard) return "";
  const board: Detail = S.predBoard;
  const mine: Detail[] = S.myPreds ?? [];
  const pickOf = (key: string) => mine.find((m) => m.matchKey === key)?.pick as string | undefined;
  const matches: Detail[] = board.matches || [];
  const won = mine.filter((m) => m.result === "won").length, done = mine.filter((m) => m.result !== "pending").length;
  if (!matches.length && !done) return "";
  const side = (m: Detail, name: string, votes: number, total: number, idx: number) => {
    const picked = pickOf(m.key) === name;
    const pct = total ? Math.round((votes / total) * 100) : 0;
    const locked = !!m.locked;
    const attr = !S.user ? `data-auth-open="1"` : locked ? "disabled" : `data-predict="${t.id}|${m.key}|${idx}"`;
    return `<button ${attr} style="flex:1;min-width:0;text-align:left;border:1px solid ${picked ? "#22D3EE" : "var(--border-strong)"};background:${picked ? "rgba(34,211,238,.12)" : "var(--surface-3)"};color:var(--text);border-radius:11px;padding:10px 12px;cursor:${locked ? "default" : "pointer"};font-family:inherit;opacity:${locked && !picked ? ".6" : "1"}">
      <div style="font-weight:750;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${picked ? "✓ " : ""}${escHtml(name)}</div>
      <div style="height:4px;border-radius:99px;background:var(--surface-4);margin-top:7px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${idx === 0 ? "#22D3EE" : "#F43F7E"}"></div></div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${total ? `${pct}% du public (${votes})` : "Aucun vote"}</div></button>`;
  };
  const rows = matches.map((m) => {
    const total = m.votesA + m.votesB;
    return `<div style="padding:12px 0;border-top:1px solid var(--surface-4)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="font-size:10.5px;letter-spacing:1px;text-transform:uppercase;color:var(--text-faint);font-weight:800;flex:1">${escHtml(m.label || "Match")}</span>${m.locked ? `<span style="font-size:10px;font-weight:800;color:#FBBF24">FERMÉ · match lancé</span>` : ""}</div>
      <div style="display:flex;gap:10px">${side(m, m.a, m.votesA, total, 0)}${side(m, m.b, m.votesB, total, 1)}</div></div>`;
  }).join("");
  return `<div style="border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:18px 20px;margin-bottom:18px">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h3 style="margin:0;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-muted);font-weight:750;flex:1">Pronostics · qui va gagner ?</h3>${done ? `<span style="font-size:12px;font-weight:800;color:#34D399">Tes pronostics : ${won}/${done}</span>` : ""}</div>
    ${!S.user ? `<div style="font-size:12.5px;color:var(--text-muted);margin-top:6px">Connecte-toi pour donner ton pronostic — un choix modifiable jusqu'au lancement du match.</div>` : ""}
    ${rows || `<div style="color:var(--text-faint);font-size:13px;padding:12px 0">Aucun match à pronostiquer pour l'instant.</div>`}
  </div>`;
}

function pTournoi(S: State) {
  const t = S.detail;
  if (!t) return `<main style="max-width:1220px;margin:0 auto;padding:40px 22px;text-align:center;color:var(--text-muted)">Chargement du tournoi…</main>`;
  const manage = canManage(S); // seuls organisateur/admin voient les contrôles de pilotage
  const statusMap: Record<string, [string, string]> = { setup: ["À lancer", "var(--text-muted)"], live: ["En direct", "#22D3EE"], finished: ["Terminé", "#FBBF24"] };
  const [slabel, scolor] = statusMap[t.status] || ["", "var(--text-muted)"];
  const dist = t.distributed || 0, total = t.cagnotte?.total || 0;
  const pct = total ? Math.min(100, (dist / total) * 100) : 0;

  // Couverture : l'affiche du tournoi (si fournie) constitue le fond de la section détail, comme sur les cartes.
  const coverBg = t.imageUrl
    ? `background-image:linear-gradient(180deg,rgba(11,11,17,.2) 35%,rgba(11,11,17,.94)),url('${mediaUrl(t.imageUrl)}');background-size:cover;background-position:center`
    : `background:linear-gradient(150deg,rgba(34,211,238,.10),rgba(124,130,255,.06) 55%,var(--surface-2))`;
  const cover = `<div style="border-radius:20px;border:1px solid var(--border);overflow:hidden;position:relative;margin-bottom:14px;${coverBg}">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 18px 0;flex-wrap:wrap;gap:10px">
      <button data-back="1" style="display:inline-flex;align-items:center;gap:7px;background:rgba(20,20,29,.72);backdrop-filter:blur(6px);border:1px solid var(--border-strong);color:#F4F5FB;border-radius:11px;padding:10px 14px;font-weight:700;font-size:13.5px;cursor:pointer">← Tournois</button>
      <span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:${scolor};background:rgba(20,20,29,.72);backdrop-filter:blur(6px);border:1px solid ${scolor}55;border-radius:99px;padding:6px 12px">${slabel}</span>
    </div>
    <div style="padding:${t.imageUrl ? "64px" : "26px"} 22px 22px">
      <h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(28px,4vw,44px);letter-spacing:1px;margin:0;line-height:1;text-wrap:balance;overflow-wrap:break-word;color:${t.imageUrl ? "#fff" : "var(--text)"};${t.imageUrl ? "text-shadow:0 2px 14px rgba(0,0,0,.65)" : ""}">${t.name}</h1>
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px;color:${t.imageUrl ? "#D5D6E3" : "var(--text-muted)"};font-size:13px;font-weight:600">
        <span style="min-width:0">${[t.game, t.format, t.matchFormatLabel, t.teamSize ? `Équipes de ${t.teamSize}` : "", t.place, t.date].filter(Boolean).map((v: string) => `<span style="display:inline-block;max-width:100%">${escHtml(v)}</span>`).join(`<span style="opacity:.55;padding:0 .35em">·</span>`)}</span>
        ${t.entryFeeXof ? `<span style="display:inline-flex;align-items:center;gap:5px;color:#FBBF24;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.3);border-radius:99px;padding:3px 10px;font-size:12px">${ic(I.cart, 12)}${money(t.entryFeeXof)}</span>` : ""}
      </div>
    </div>
  </div>`;
  const infoCard = t.prize || t.rules
    ? `<div style="border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:18px 20px;margin-bottom:18px">
        ${t.prize ? `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;${t.rules ? "margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--surface-4)" : ""}"><span style="display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.35);color:#FBBF24">${ic(I.crown, 16)}</span><div><div style="font-size:10.5px;letter-spacing:1.2px;text-transform:uppercase;color:var(--text-muted);font-weight:800">À gagner</div><div style="font-size:16px;font-weight:700">${escHtml(t.prize)}</div></div></div>` : ""}
        ${t.rules ? `<details ${t.prize ? "" : "open"}><summary style="cursor:pointer;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-muted);font-weight:750">Règlement</summary><div style="margin-top:10px;color:var(--text);font-size:14px;line-height:1.7;white-space:pre-line">${escHtml(t.rules)}</div></details>` : ""}
      </div>`
    : "";
  const head = `${cover}${infoCard}<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:20px">
    <button data-show="${t.id}" style="display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,rgba(34,211,238,.14),rgba(124,130,255,.14));border:1px solid #22D3EE66;color:#22D3EE;border-radius:11px;padding:9px 13px;font-weight:700;font-size:13px;cursor:pointer">${ic(I.tv, 15)}Mode Show</button>
    <button data-share="tournoi|${t.id}" style="display:inline-flex;align-items:center;gap:6px;background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:11px;padding:9px 13px;font-weight:700;font-size:13px;cursor:pointer">${ic(I.share, 15)}Partager</button>
    <button data-embed="${t.id}" style="display:inline-flex;align-items:center;gap:6px;background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:11px;padding:9px 13px;font-weight:700;font-size:13px;cursor:pointer">${ic(I.extlink, 15)}Intégrer</button>
    <button data-print="${t.id}" style="display:inline-flex;align-items:center;gap:6px;background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:11px;padding:9px 13px;font-weight:700;font-size:13px;cursor:pointer">${ic(I.printer, 15)}Affiche</button>
    ${manage ? `<button data-duplicate="${t.id}" title="Crée un nouveau tournoi avec les mêmes réglages (sans joueurs ni résultats)" style="display:inline-flex;align-items:center;gap:6px;background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:11px;padding:9px 13px;font-weight:700;font-size:13px;cursor:pointer">${ic(I.plus, 15)}Dupliquer</button>
    <button data-exportresults="${t.id}" style="display:inline-flex;align-items:center;gap:6px;background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:11px;padding:9px 13px;font-weight:700;font-size:13px;cursor:pointer">${ic(I.download, 15)}Résultats Excel</button>
    <button data-edit="1" style="display:inline-flex;align-items:center;gap:6px;background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:11px;padding:9px 13px;font-weight:700;font-size:13px;cursor:pointer">${ic(I.edit || I.plus, 15)}Modifier</button>
    ${t.status !== "setup" ? `<button data-reset="${t.id}" style="display:inline-flex;align-items:center;gap:6px;background:transparent;border:1px solid rgba(251,191,36,.35);color:#FBBF24;border-radius:11px;padding:9px 13px;font-weight:700;font-size:13px;cursor:pointer">${ic(I.warn, 15)}Réinitialiser</button>` : ""}
    <button data-del="${t.id}" style="display:inline-flex;align-items:center;gap:6px;background:transparent;border:1px solid rgba(251,113,133,.35);color:#FB7185;border-radius:11px;padding:9px 13px;font-weight:700;font-size:13px;cursor:pointer">${ic(I.trash, 15)}Supprimer</button>` : ""}
    <div style="flex:1"></div>
    ${t.mainFormat === "survival" ? `<div style="min-width:200px"><div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);margin-bottom:6px"><span>Cagnotte distribuée</span><span style="font-weight:700;color:var(--text)">${dist} / ${total} pts</span></div><div style="height:9px;border-radius:99px;background:var(--surface-4);border:1px solid var(--border);overflow:hidden"><span style="display:block;height:100%;width:${pct}%;background:linear-gradient(90deg,#22D3EE,#7C82FF)"></span></div></div>` : ""}
  </div>`;

  const inpE = "width:100%;background:var(--surface-3);border:1px solid var(--border);border-radius:11px;color:var(--text);font-family:inherit;font-size:14px;padding:11px 13px;margin-top:6px";
  const editCard = S.editing && manage ? `<div style="border:1px solid rgba(34,211,238,.3);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:20px;margin-bottom:20px">
    <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;margin-bottom:12px">Modifier le tournoi</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px">
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Nom<input id="e-name" value="${(t.name || "").replace(/"/g, "&quot;")}" style="${inpE}" /></label>
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Jeu<input id="e-game" value="${(t.game || "").replace(/"/g, "&quot;")}" style="${inpE}" /></label>
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Lieu<input id="e-place" value="${(t.place || "").replace(/"/g, "&quot;")}" style="${inpE}" /></label>
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Date<input id="e-date" type="date" style="${inpE}" /></label>
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Frais d'inscription (FCFA)<input id="e-fee" type="number" min="0" step="100" value="${t.entryFeeXof || 0}" style="${inpE}" /></label>
      ${t.status === "setup" ? `<label style="font-size:12px;color:var(--text-muted);font-weight:600">Nombre de poules<input id="e-pools" type="number" min="1" value="${t.nbPools || 2}" style="${inpE}" /></label>
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Points / joueur (cagnotte)<input id="e-pts" type="number" min="1" value="${t.pointsPerPlayer || 5}" style="${inpE}" /></label>` : ""}
      <label style="font-size:12px;color:var(--text-muted);font-weight:600">Lot / récompense<input id="e-prize" value="${escAttr(t.prize)}" maxlength="400" placeholder="Ex. 50 000 F + trophée" style="${inpE}" /></label>
      <label style="font-size:12px;color:var(--text-muted);font-weight:600;grid-column:1/-1">Règlement<textarea id="e-rules" rows="5" maxlength="4000" placeholder="Format des matchs, retards, fair-play, matériel autorisé…" style="${inpE};resize:vertical;font-family:inherit">${escHtml(t.rules)}</textarea></label>
      <div><div style="font-size:12px;color:var(--text-muted);font-weight:600">Affiche (image)</div>${filePicker("e-img", "Remplacer l'affiche", "image/*", t.imageUrl)}</div>
    </div>
    ${t.status !== "setup" ? `<div style="font-size:12px;color:var(--text-faint);margin-top:10px">Poules et points par joueur ne sont modifiables qu'avant le lancement.</div>` : ""}
    <div style="display:flex;gap:10px;margin-top:14px"><button data-editsave="${t.id}" style="background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:11px;padding:11px 18px;font-weight:750;font-size:14px;cursor:pointer">Enregistrer</button><button data-editcancel="1" style="background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:11px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer">Annuler</button></div>
  </div>` : "";
  // Tournoi Survival non lancé : « Modifier » ouvre l'assistant de création (pré-rempli) plutôt que ce petit formulaire.
  const wizModal = S.creating && S.wizEditId === t.id && manage ? tournamentWizard(S) : "";

  // À lancer : inscriptions ouvertes
  if (t.status === "setup") {
    const myReg = S.openId ? S.regIds.find((r) => r.id === S.openId) : undefined;
    const isReg = !!myReg;
    const isPending = myReg?.status === "pending";
    const fee: number = t.entryFeeXof || 0;
    let action: string;
    if (manage) {
      action = `<button data-launch="${t.id}" ${S.detailBusy ? "disabled" : ""} style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:14px 26px;font-weight:750;font-size:16px;cursor:${S.detailBusy ? "default" : "pointer"};opacity:${S.detailBusy ? ".6" : "1"};box-shadow:0 0 34px rgba(34,211,238,.24)">${ic(I.bolt)}${S.detailBusy ? "Lancement…" : "Lancer le tournoi"}</button>`;
    } else if (!S.user) {
      action = `<button data-auth-open="1" style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:14px 26px;font-weight:750;font-size:16px;cursor:pointer;box-shadow:0 0 34px rgba(34,211,238,.24)">${ic(I.user, 18)}Se connecter pour s'inscrire</button>`;
    } else if (isPending) {
      action = `<div style="display:flex;flex-direction:column;align-items:center;gap:12px"><span style="display:inline-flex;align-items:center;gap:8px;color:#FBBF24;font-weight:750;font-size:15px;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.4);border-radius:12px;padding:12px 22px">${ic(I.warn, 17)}Paiement en attente de confirmation (${money(myReg!.amountXof)})</span>${myReg!.regId && onlinePayOn(S) && ONLINE_PAY.includes(myReg!.method || "") ? `<button data-payretry="registration|${myReg!.regId}|${myReg!.method}" style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:12px 22px;font-weight:750;font-size:14.5px;cursor:pointer">Réessayer le paiement en ligne</button>` : ""}<button data-unreg="${t.id}" style="background:transparent;border:1px solid var(--border-strong);color:var(--text-muted);border-radius:10px;padding:9px 16px;font-weight:700;font-size:12.5px;cursor:pointer">Annuler l'inscription</button></div>`;
    } else if (isReg) {
      action = `<div style="display:flex;flex-direction:column;align-items:center;gap:12px"><span style="display:inline-flex;align-items:center;gap:8px;color:#34D399;font-weight:750;font-size:15px;background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.4);border-radius:12px;padding:12px 22px">${ic(I.crown, 17)}Tu es inscrit à ce tournoi</span><button data-unreg="${t.id}" style="background:transparent;border:1px solid var(--border-strong);color:var(--text-muted);border-radius:10px;padding:9px 16px;font-weight:700;font-size:12.5px;cursor:pointer">Se désinscrire</button>${ticketCard(t, myReg!)}</div>`;
    } else if (fee > 0) {
      const chips = payMethods(S).map((m) => `<button data-paypick="${m}" style="font-size:12.5px;font-weight:700;border-radius:10px;padding:9px 14px;cursor:pointer;background:${S.payPick === m ? "rgba(34,211,238,.1)" : "var(--surface-3)"};border:1px solid ${S.payPick === m ? "#22D3EE" : "var(--border)"};color:${S.payPick === m ? "#22D3EE" : "var(--text-muted)"}">${m}</button>`).join("");
      const ly = S.loyaltySettings || { pointValueXof: 100, maxRedeemPercent: 50 };
      const maxXof = Math.floor((fee * ly.maxRedeemPercent) / 100);
      const maxPoints = Math.max(0, Math.min(S.loyaltyBalance, Math.floor(maxXof / ly.pointValueXof)));
      const chosenPoints = Math.min(S.regPointsToRedeem, maxPoints);
      const discount = chosenPoints * ly.pointValueXof;
      const netFee = Math.max(0, fee - discount);
      const loyaltyBox = maxPoints > 0 ? `<div style="border:1px solid var(--border);border-radius:12px;background:var(--surface);padding:12px 14px;width:100%;max-width:320px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
          <span style="font-size:12px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.5px">Points fidélité</span>
          <span style="font-size:12px;color:var(--text-faint)">Solde : <b style="color:var(--text)">${S.loyaltyBalance}</b></span>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <button data-regpts="${Math.max(0, chosenPoints - 1)}" style="width:30px;height:30px;border-radius:8px;background:var(--surface-3);border:1px solid var(--border);color:var(--text);cursor:pointer">−</button>
          <span style="flex:1;text-align:center;font-family:'JetBrains Mono',monospace;font-weight:700">${chosenPoints} pt${chosenPoints > 1 ? "s" : ""}</span>
          <button data-regpts="${Math.min(maxPoints, chosenPoints + 1)}" style="width:30px;height:30px;border-radius:8px;background:var(--surface-3);border:1px solid var(--border);color:var(--text);cursor:pointer">+</button>
          <button data-regpts="${maxPoints}" style="font-size:11.5px;font-weight:700;color:#22D3EE;background:transparent;border:1px solid rgba(34,211,238,.35);border-radius:8px;padding:0 10px;height:30px;cursor:pointer">Max</button>
        </div>
        ${discount > 0 ? `<div style="margin-top:8px;font-size:12.5px;color:#34D399;font-weight:700">− ${money(discount)} appliqués</div>` : ""}
      </div>` : "";
      action = `<div style="display:flex;flex-direction:column;align-items:center;gap:14px">
        ${onlinePayOn(S) ? "" : `<div><div style="color:var(--text-muted);font-size:12.5px;font-weight:700;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Moyen de paiement</div><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">${chips}</div></div>`}
        ${loyaltyBox}
        <button ${onlinePayOn(S) && netFee > 0 ? `data-payopen="reg"` : `data-reg="${t.id}" ${S.payPick || netFee === 0 ? "" : "disabled"}`} style="display:inline-flex;align-items:center;gap:8px;background:${onlinePayOn(S) || S.payPick || netFee === 0 ? "linear-gradient(135deg,#22D3EE,#12aec4)" : "var(--surface-4)"};color:${onlinePayOn(S) || S.payPick || netFee === 0 ? "#04222a" : "var(--text-faint)"};border:0;border-radius:12px;padding:14px 26px;font-weight:750;font-size:16px;cursor:${onlinePayOn(S) || S.payPick || netFee === 0 ? "pointer" : "default"};box-shadow:${onlinePayOn(S) || S.payPick || netFee === 0 ? "0 0 34px rgba(34,211,238,.24)" : "none"}">${ic(I.plus, 18)}${onlinePayOn(S) && netFee > 0 ? "Payer l'inscription" : "S'inscrire"} · ${discount > 0 ? `<span style="text-decoration:line-through;opacity:.6;font-weight:600;font-size:13px">${money(fee)}</span> ` : ""}${money(netFee)}</button>
      </div>`;
    } else {
      action = `<button data-reg="${t.id}" style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:14px 26px;font-weight:750;font-size:16px;cursor:pointer;box-shadow:0 0 34px rgba(34,211,238,.24)">${ic(I.plus, 18)}S'inscrire au tournoi</button>`;
    }
    if (t.teamSize && !manage && S.user && !isPending && !isReg) {
      const draft = S.teamDraft || { name: "", members: [] as string[] };
      const inp = "width:100%;background:var(--surface-3);border:1px solid var(--border);border-radius:10px;color:var(--text);font-family:inherit;font-size:14px;padding:11px 13px";
      const rows = Array.from({ length: t.teamSize }, (_, i) => `<input id="team-m-${i}" value="${escAttr(draft.members[i] ?? (i === 0 ? S.user?.displayName : ""))}" placeholder="${i === 0 ? "Toi (capitaine)" : `Joueur ${i + 1}`}" maxlength="40" style="${inp}" />`).join("");
      action = `<div style="border:1px solid var(--border);border-radius:14px;background:var(--surface);padding:18px;width:100%;max-width:380px;text-align:left;margin-bottom:6px">
        <div style="font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:var(--text-muted);font-weight:800;margin-bottom:10px">Ton équipe (${t.teamSize} joueurs)</div>
        <input id="team-name" value="${escAttr(draft.name)}" placeholder="Nom de l'équipe" maxlength="40" style="${inp};margin-bottom:10px" />
        <div style="display:flex;flex-direction:column;gap:8px">${rows}</div>
      </div>${action}`;
    }
    const sub = manage
      ? t.mainFormat === "survival"
        ? "Le lancement répartit les joueurs en poules et démarre le mode Survival. L'ordre de passage est verrouillé."
        : t.usesPools
          ? "Le lancement répartit les joueurs en poules. L'ordre de passage est verrouillé."
          : "Le lancement démarre directement la compétition. L'ordre de passage est verrouillé."
      : fee > 0 ? "Inscription payante : choisis un moyen de paiement, l'organisateur confirmera à réception."
      : "Les inscriptions sont ouvertes jusqu'au lancement par l'organisateur.";
    const feeBadge = fee > 0 ? `<div style="display:inline-flex;align-items:center;gap:7px;color:#FBBF24;font-weight:700;font-size:13px;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.35);border-radius:99px;padding:6px 14px;margin-bottom:18px;margin-right:10px">${ic(I.cart, 14)}Frais d'inscription : ${money(fee)}</div>` : "";
    const pointBadge = !manage && t.givesLoyaltyPoint !== false ? `<div style="display:inline-flex;align-items:center;gap:7px;color:#22D3EE;font-weight:700;font-size:13px;background:rgba(34,211,238,.08);border:1px solid rgba(34,211,238,.35);border-radius:99px;padding:6px 14px;margin-bottom:18px">${ic(I.medal, 14)}+1 point fidélité</div>` : "";
    const roster: { id: string; name: string; club?: string }[] = Array.isArray(t.players) ? t.players : [];
    // Pastille en édition (renommer/club) : même mécanisme (editingPlayerId, data-pledit-*) que le
    // panneau Joueurs en régie — fonctionne aussi avant lancement, l'API n'impose aucune restriction.
    const plEditRow = (p: { id: string; name: string; club?: string }) => `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;background:var(--surface);border:1px solid #22D3EE55;border-radius:10px;padding:8px">
      <input id="pl-edit-name" value="${escAttr(p.name)}" placeholder="Nom" style="flex:1;min-width:110px;background:var(--surface-3);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:inherit;font-size:12.5px;padding:6px 9px" />
      ${t.teamSize && t.status === "setup" ? `<input id="pl-edit-members" value="${escAttr(((t.teams?.[p.name] as string[]) || []).join(", "))}" placeholder="Joueurs de l'équipe (virgules)" style="flex:2 1 100%;min-width:200px;background:var(--surface-3);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:inherit;font-size:12.5px;padding:6px 9px" />` : ""}
      <input id="pl-edit-club" value="${escAttr(p.club || "")}" placeholder="Club" style="flex:1;min-width:90px;background:var(--surface-3);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:inherit;font-size:12.5px;padding:6px 9px" />
      <button data-pledit-save="${t.id}|${p.id}" style="background:var(--surface-4);border:1px solid var(--border-strong);color:#22D3EE;border-radius:8px;padding:6px 11px;font-weight:700;font-size:12px;cursor:pointer">OK</button>
      <button data-pledit-cancel="1" style="background:transparent;border:0;color:var(--text-muted);cursor:pointer;font-size:12px">Annuler</button>
    </div>`;
    const participants = roster.length || manage
      ? `<div style="border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:20px;margin-top:18px">
          <h3 style="margin:0 0 14px;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-muted);font-weight:750">Participants (${roster.length})</h3>
          <div style="display:flex;gap:8px;flex-wrap:wrap;${roster.length > 15 ? "max-height:620px;overflow-y:auto;padding-right:4px" : ""}">${roster.map((p) => S.editingPlayerId === p.id ? plEditRow(p) : `<span style="display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:999px;padding:7px 8px 7px 13px">${p.club ? `<span style="color:var(--text-faint);font-weight:500">@${escHtml(p.club)}</span>` : ""}<span style="display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--surface-4);font-size:10px;font-weight:800;color:#22D3EE">${p.name.charAt(0).toUpperCase()}</span>${escHtml(p.name)}${t.teams?.[p.name] ? `<span style="color:var(--text-faint);font-weight:500;font-size:12px">· ${escHtml((t.teams[p.name] as string[]).join(", "))}</span>` : ""}${manage ? `<button data-pledit-open="${p.id}" title="Renommer / club" style="display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:transparent;border:0;color:var(--text-muted);cursor:pointer">${ic(I.edit || I.plus, 11)}</button><button data-plrem="${t.id}|${p.id}" style="display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:transparent;border:0;color:var(--text-muted);cursor:pointer">${ic(I.x, 12)}</button>` : ""}</span>`).join("")}</div>
          ${roster.length ? "" : `<div style="color:var(--text-faint);font-size:13px;margin-bottom:${manage ? "12px" : "0"}">Aucun participant pour l'instant.</div>`}
          ${manage ? `<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><input id="pl-add-name" placeholder="${t.teamSize ? "Nom de l'équipe" : "Nom du joueur (@club optionnel)"}" style="flex:1;min-width:200px;background:var(--surface-3);border:1px solid var(--border);border-radius:10px;color:var(--text);font-family:inherit;font-size:13px;padding:9px 12px" />${t.teamSize ? `<input id="pl-add-members" placeholder="${t.teamSize} joueurs, séparés par des virgules" style="flex:2;min-width:240px;background:var(--surface-3);border:1px solid var(--border);border-radius:10px;color:var(--text);font-family:inherit;font-size:13px;padding:9px 12px" />` : ""}<button data-pladd="${t.id}" style="display:inline-flex;align-items:center;gap:6px;background:var(--surface-3);border:1px dashed var(--border-strong);color:#22D3EE;border-radius:10px;padding:9px 15px;font-weight:700;font-size:13px;cursor:pointer">${ic(I.plus, 14)}Ajouter</button></div>` : ""}
        </div>`
      : "";
    // Répartition des poules : prévisualiser, réordonner et rééquilibrer l'effectif avant le
    // lancement — sinon le lancement répartit et tire au sort tout seul. Concerne tout format qui
    // utilise des poules (Survival toujours, les formats à bracket dès qu'on en a demandé plusieurs
    // — voir Engine.usesPools), pas seulement Survival : un Bracket simple ou un Round Robin avec
    // poules a exactement le même besoin de rééquilibrage manuel.
    const poolsList: { id: string; name: string; order: { id: string; name: string }[] }[] = Array.isArray(t.pools) ? t.pools : [];
    // Quel que soit le mode de poule, la taille réelle de chaque poule (après un rééquilibrage manuel)
    // compte pour savoir combien de joueurs elle peut effectivement envoyer en phase finale.
    const qualifyPerPool = t.qualifyPerPool || 2;
    // Poules en double élimination hors Survival : un seul bracket continu (voir
    // Engine.launchGroupedDoubleElim) — pas de "qualifiés" à départager, tout le monde y entre dès le
    // 1er tour. Même garde que wizPoolsStep (isDoubleMerged) pour ne pas afficher un réglage sans effet.
    const isDoubleMerged = t.mainFormat !== "survival" && t.poolFormat === "double";
    const poolsPreview = manage && t.usesPools
      ? poolsList.length
        ? `<div style="border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:20px;margin-top:18px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;flex-wrap:wrap;gap:8px"><h3 style="margin:0;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-muted);font-weight:750">Répartition des poules</h3><button data-pools-distribute="${t.id}" style="font-size:12px;font-weight:700;color:#22D3EE;background:transparent;border:0;cursor:pointer">Re-répartir au hasard</button></div>
            <p style="color:var(--text-faint);font-size:12.5px;margin:0 0 14px">L'ordre définit qui entre sur le terrain en premier dans chaque poule. Les flèches ◀ ▶ déplacent un joueur vers la poule voisine, pour rééquilibrer manuellement l'effectif.</p>
            ${isDoubleMerged
              ? `<p style="color:var(--text-faint);font-size:12.5px;margin-bottom:14px">Un seul grand bracket double élimination pour tout le monde : les vainqueurs de chaque poule s'enchaînent entre eux, pareil pour les perdants, jusqu'à une grande finale unique — pas de poules indépendantes à requalifier.</p>`
              : `<div style="border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:14px;background:var(--surface-5)">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <span style="font-size:12px;color:var(--text-muted);font-weight:650">Qualifiés par poule</span>
                <input id="pq-input-${t.id}" type="number" min="1" value="${qualifyPerPool}" style="width:76px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:inherit;font-size:13px;padding:6px 9px" />
                <button data-poolqualify-apply="${t.id}" style="font-size:12px;font-weight:700;color:#04222a;background:#22D3EE;border:0;border-radius:8px;padding:7px 13px;cursor:pointer">Appliquer</button>
              </div>
              <p style="color:${poolsList.some((p) => p.order.length < qualifyPerPool) ? "#FBBF24" : "var(--text-faint)"};font-size:11.5px;margin:8px 0 0">${poolQualifyNote(poolsList.map((p) => ({ name: p.name, size: p.order.length })), qualifyPerPool)}</p>
            </div>`}
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px">${poolsList.map((p, pi) => {
              const short = p.order.length < qualifyPerPool;
              return `<div style="border:1px solid var(--border);border-radius:12px;padding:14px">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><b style="font-size:13.5px">${escHtml(p.name)} <span style="color:var(--text-faint);font-weight:600">· ${p.order.length}</span></b><button data-pool-shuffle="${t.id}|${p.id}" title="Rebrasser" style="background:transparent;border:0;color:var(--text-muted);cursor:pointer;display:grid;place-items:center">${ic(I.arrow, 14)}</button></div>
              ${short ? `<p style="color:#FBBF24;font-size:11px;margin:0 0 8px">${ic(I.warn, 11)} Seulement ${p.order.length} joueur${p.order.length > 1 ? "s" : ""} ici : ${p.order.length} qualifié${p.order.length > 1 ? "s" : ""} au maximum, pas ${qualifyPerPool}.</p>` : ""}
              <div style="display:flex;flex-direction:column;gap:5px">${p.order.map((pl, i) => {
                // Une poule à un seul joueur ne peut pas se vider davantage (voir Engine.movePlayerToPool) : désactivé plutôt que de laisser échouer la requête.
                const canLeave = p.order.length > 1;
                const canPrev = pi > 0 && canLeave, canNext = pi < poolsList.length - 1 && canLeave;
                return `<div style="display:flex;align-items:center;gap:6px;font-size:13px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:6px 8px"><span style="color:var(--text-faint);width:16px">${i + 1}</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(pl.name)}</span><button data-pool-moveto="${t.id}|${p.id}|${pl.id}|-1" title="Vers la poule précédente" ${canPrev ? "" : "disabled"} style="background:transparent;border:0;color:${canPrev ? "#7C82FF" : "var(--border-strong)"};cursor:${canPrev ? "pointer" : "default"};padding:2px;font-size:11px">◀</button><button data-pool-moveto="${t.id}|${p.id}|${pl.id}|1" title="Vers la poule suivante" ${canNext ? "" : "disabled"} style="background:transparent;border:0;color:${canNext ? "#7C82FF" : "var(--border-strong)"};cursor:${canNext ? "pointer" : "default"};padding:2px;font-size:11px">▶</button><button data-pool-move="${t.id}|${p.id}|${i}|-1" title="Monter dans l'ordre de passage" ${i === 0 ? "disabled" : ""} style="background:transparent;border:0;color:${i === 0 ? "var(--border-strong)" : "var(--text-muted)"};cursor:${i === 0 ? "default" : "pointer"};padding:2px">▲</button><button data-pool-move="${t.id}|${p.id}|${i}|1" title="Descendre dans l'ordre de passage" ${i === p.order.length - 1 ? "disabled" : ""} style="background:transparent;border:0;color:${i === p.order.length - 1 ? "var(--border-strong)" : "var(--text-muted)"};cursor:${i === p.order.length - 1 ? "default" : "pointer"};padding:2px">▼</button></div>`;
              }).join("")}</div>
            </div>`;
            }).join("")}</div>
          </div>`
        : roster.length >= 2
          ? `<div style="text-align:center;margin-top:18px"><button data-pools-distribute="${t.id}" style="display:inline-flex;align-items:center;gap:7px;background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:11px;padding:10px 18px;font-weight:700;font-size:13.5px;cursor:pointer">${ic(I.plus, 15)}Répartir en poules (aperçu avant lancement)</button></div>`
          : ""
      : "";
    // Aperçu des oppositions du 1er tour (formats à bracket : single/double élim uniquement — Round
    // Robin/Swiss n'ont pas un "1er tour" figé de la même façon ; masqué dès qu'il y a des poules —
    // le vrai 1er tour du bracket n'existe qu'une fois les qualifiés connus, voir startFinals).
    // Bracket simple : mime Engine.buildBracket(ids, true) — appariement séquentiel, aucun exempt au
    // 1er tour tant que l'effectif est pair (voir buildBracket, compact). Double élimination : même
    // traitement (Engine.buildDoubleElimCompact). Réordonner ici change réellement
    // les oppositions au lancement (voir Engine.movePlayerOrder — même ordre que t.players).
    const seedPreview = manage && (t.mainFormat === "single" || t.mainFormat === "double") && !t.usesPools && roster.length >= 2
      ? (() => {
          type Cell = { id: string; name: string } | null;
          let pairs: [Cell, Cell, number, number][];
          // Single ET double : appariement séquentiel (Engine.buildBracket(ids, true) /
          // Engine.buildDoubleElimCompact) — tout le monde joue dès le 1er tour, un seul exempt si impair.
          pairs = [];
          for (let i = 0; i < roster.length; i += 2) pairs.push([roster[i] ?? null, roster[i + 1] ?? null, i + 1, i + 2]);
          const nDuels = pairs.filter(([a, b]) => a && b).length;
          const nByes = pairs.length - nDuels;
          const seedNum = (n: number) => `<span style="flex:none;width:19px;text-align:right;font-family:'JetBrains Mono',monospace;font-size:10px;color:#3F4054">${n}</span>`;
          const nameCell = (nm: string) => `<span style="flex:1;min-width:0;font-size:12.5px;font-weight:650;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(nm)}</span>`;
          // Les noms sont empilés plutôt que côte à côte : la carte reste étroite, ce qui permet
          // d'aligner 5 à 7 colonnes au lieu de 3 et supprime les lignes pleine largeur.
          const matchups = pairs.map(([a, b, sa, sb], i) => {
            const num = `<span style="flex:none;width:26px;font-family:'JetBrains Mono',monospace;font-size:10px;color:#4A4B5F">M${i + 1}</span>`;
            if (!a || !b) {
              const solo = (a || b)!;
              return `<div style="display:flex;align-items:center;gap:8px;border:1px dashed #26263A;border-radius:11px;padding:10px 12px;background:#0F0F17">
                ${num}
                <span style="flex:1;min-width:0;display:flex;align-items:center;gap:7px">${seedNum(a ? sa : sb)}${nameCell(solo.name)}</span>
                <span style="flex:none;font-size:9px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:var(--text-faint);border:1px solid #26263A;border-radius:99px;padding:3px 8px">exempt</span>
              </div>`;
            }
            return `<div style="display:flex;align-items:center;gap:8px;border:1px solid #2A2A3C;border-radius:11px;padding:9px 12px;background:linear-gradient(180deg,#16161F,var(--surface-5))">
              ${num}
              <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px">
                <span style="display:flex;align-items:center;gap:7px">${seedNum(sa)}${nameCell(a.name)}</span>
                <span style="display:flex;align-items:center;gap:7px;border-top:1px solid #1E1E2C;padding-top:4px">${seedNum(sb)}${nameCell(b.name)}</span>
              </span>
            </div>`;
          }).join("");
          const rows = roster.map((pl, i) => `<div style="display:flex;align-items:center;gap:6px;background:#12121B;border:1px solid #232331;border-radius:9px;padding:5px 7px">
              <span style="flex:none;width:20px;text-align:right;font-family:'JetBrains Mono',monospace;font-size:10.5px;color:#4A4B5F">${i + 1}</span>
              <span style="flex:1;min-width:0;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(pl.name)}</span>
              <button data-roster-move="${t.id}|${pl.id}|-1" ${i === 0 ? "disabled" : ""} title="Monter" style="flex:none;display:grid;place-items:center;width:20px;height:20px;border-radius:6px;background:transparent;border:0;color:${i === 0 ? "#2C2C3E" : "var(--text-muted)"};cursor:${i === 0 ? "default" : "pointer"};font-size:9px">&#9650;</button>
              <button data-roster-move="${t.id}|${pl.id}|1" ${i === roster.length - 1 ? "disabled" : ""} title="Descendre" style="flex:none;display:grid;place-items:center;width:20px;height:20px;border-radius:6px;background:transparent;border:0;color:${i === roster.length - 1 ? "#2C2C3E" : "var(--text-muted)"};cursor:${i === roster.length - 1 ? "default" : "pointer"};font-size:9px">&#9660;</button>
            </div>`).join("");
          const stat = (v: string, k: string, color: string) => `<span style="display:inline-flex;align-items:baseline;gap:5px"><b style="font-family:'JetBrains Mono',monospace;font-size:13px;color:${color}">${v}</b><span style="font-size:11.5px;color:var(--text-faint)">${k}</span></span>`;
          return `<div style="border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:20px;margin-top:18px">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:14px">
              <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;min-width:0">
                <h3 style="margin:0;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-muted);font-weight:750;white-space:nowrap">Oppositions du 1er tour</h3>
                <span style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap">${stat(String(nDuels), nDuels > 1 ? "duels" : "duel", "#22D3EE")}${nByes ? stat(String(nByes), nByes > 1 ? "exempts" : "exempt", "#FBBF24") : ""}</span>
              </div>
              <button data-roster-shuffle="${t.id}" style="flex:none;display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:#22D3EE;background:rgba(34,211,238,.07);border:1px solid rgba(34,211,238,.28);border-radius:9px;padding:6px 12px;cursor:pointer">${ic(I.arrow, 13)}Rebrasser</button>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:9px">${matchups}</div>
            ${nByes ? `<p style="color:var(--text-faint);font-size:11.5px;margin:12px 0 0;max-width:62ch">${t.mainFormat === "single"
                ? `${roster.length} participants (effectif impair) : ${nByes} ${nByes > 1 ? "joueurs passent" : "joueur passe"} le 1er tour sans jouer, le temps que les autres s'affrontent — c'est imposé par l'effectif, inévitable avec un nombre impair. Une phase de groupes les supprime.`
                : `${roster.length} participants pour un arbre de ${pairs.length * 2} places : ${nByes} ${nByes > 1 ? "joueurs passent" : "joueur passe"} le 1er tour sans jouer, c'est imposé par l'effectif. Une phase de groupes les supprime.`
              }</p>` : ""}
            <details style="margin-top:16px">
              <summary style="cursor:pointer;font-size:11px;letter-spacing:.9px;text-transform:uppercase;color:var(--text-muted);font-weight:750">Réordonner les participants</summary>
              <p style="color:var(--text-faint);font-size:11.5px;margin:8px 0 10px;max-width:62ch">Cet ordre est celui du tirage : le 1er est tête de série 1. C'est lui qui sera utilisé au lancement.</p>
              <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(188px,1fr));gap:6px">${rows}</div>
            </details>
          </div>`;
        })()
      : "";
    const pendingPanel = manage ? paymentsPanel(S, t.id) + checkinPanel(S, t) : "";
    // Participants (petite colonne fixe) + tout ce qui montre la composition de la compétition à
    // venir (large colonne) : la grille des poules une fois réparties, ou à défaut le bouton "Répartir
    // en poules" et/ou l'aperçu des oppositions du 1er tour (formats à bracket direct) — plutôt que
    // tout empiler en pleine largeur. Rien à montrer à droite (format sans poules ni bracket, ou vue
    // spectateur) : Participants garde toute la largeur, comme avant.
    const compositionPreview = `${poolsPreview}${seedPreview}`;
    // Un seul enfant par colonne : compositionPreview peut concaténer 2 fragments (bouton "Répartir en
    // poules" + aperçu des oppositions) — sans ce conteneur, la grille CSS les auto-place chacun comme
    // item séparé (2 colonnes déclarées → le 2e fragment retombe sur une nouvelle ligne, colonne 1,
    // écrasé dans les 300px de Participants) au lieu de les garder empilés dans la colonne large.
    const participantsAndPools = compositionPreview
      ? `<div class="grid2c" style="display:grid;grid-template-columns:300px 1fr;gap:18px;align-items:start">${participants}<div style="display:flex;flex-direction:column;gap:18px">${compositionPreview}</div></div>`
      : participants;
    const statTile = (label: string, value: string, color = "var(--text)") => `<div style="background:var(--surface);padding:14px 16px"><div style="font-size:10px;letter-spacing:1.1px;text-transform:uppercase;color:var(--text-muted);font-weight:750">${label}</div><div style="font-family:'JetBrains Mono',monospace;font-size:22px;color:${color};margin-top:4px">${value}</div></div>`;
    // La cagnotte (participants × points en jeu) n'existe qu'en Survival — les autres formats
    // n'ont pas configuré pointsPerPlayer (valeur par défaut envoyée mais jamais consultée), la
    // montrer aurait fait croire à un budget de points qui ne s'applique pas à ce tournoi.
    const statTiles = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1px;background:var(--surface-3);border:1px solid var(--surface-3);border-radius:11px;overflow:hidden;margin-bottom:30px">
      ${t.mainFormat === "survival" ? statTile("Cagnotte", String(t.cagnotte?.total ?? 0), "#FBBF24") : ""}
      ${statTile("Inscrits", String(roster.length))}
      ${statTile("Frais", fee > 0 ? money(fee) : "Gratuit")}
      ${statTile("Format", escHtml(t.format) || "—")}
    </div>`;
    // Explication du format réellement choisi (même texte que l'assistant de création — pas de
    // description dupliquée par tournoi, mais chaque format a la sienne, pas seulement Survival).
    const formatInfo = `<div style="border:1px solid var(--border);border-radius:11px;background:var(--surface);padding:16px;margin-bottom:30px">
      <div style="display:flex;align-items:center;gap:9px;margin-bottom:8px"><span style="display:grid;place-items:center;width:26px;height:26px;border-radius:8px;background:rgba(34,211,238,.1);border:1px solid rgba(34,211,238,.3);color:#22D3EE">${ic(I.bolt, 14)}</span><b style="font-size:13.5px">Comment ça se joue</b></div>
      <div style="font-size:12.5px;color:var(--text-muted);line-height:1.7">${WIZ_FORMAT_EXPLAIN[ENGINE_TO_DB_FORMAT[t.mainFormat] || "SURVIVAL"] || ""}</div>
    </div>`;
    // "Changer le format" (brouillon uniquement) : rouvre l'assistant complet plutôt que d'obliger à
    // supprimer et recréer le tournoi pour changer de type — les participants déjà saisis sont conservés.
    const changeFormatBtn = manage ? `<button data-changeformat="${t.id}" style="display:inline-flex;align-items:center;gap:6px;background:transparent;border:1px dashed var(--border-strong);color:var(--text-muted);border-radius:10px;padding:8px 14px;font-weight:700;font-size:12.5px;cursor:pointer;margin-bottom:30px">${ic(I.arrow, 13)}Changer le format</button>` : "";
    const actionRail = `<div style="border:1px solid rgba(34,211,238,.35);border-radius:12px;background:rgba(34,211,238,.05);padding:20px;text-align:center">
      <div style="font-size:10.5px;letter-spacing:1.4px;text-transform:uppercase;color:#22D3EE;font-weight:800;margin-bottom:10px">${manage ? "Prêt à démarrer" : "Inscription"}</div>
      ${feeBadge}${pointBadge}
      <p style="color:var(--text-muted);font-size:13.5px;margin:0 0 18px">${sub}</p>
      ${action}
    </div>`;
    const left = `<div class="rise d1 detail-left tf-col" style="flex:1;min-width:0;padding:24px 40px 44px;border-right:1px solid var(--surface-3)">${statTiles}${changeFormatBtn}${formatInfo}${participantsAndPools}${pendingPanel}</div>`;
    const right = `<div class="rise d2 stack-sidebar tf-col" style="width:340px;flex:none;padding:24px 28px 44px">${actionRail}</div>`;
    return `<main class="rise tf" style="width:100%"><div class="tf-head" style="padding:28px 44px 0">${head}${predictionsCard(S, t, manage)}${editCard}</div><div style="display:flex;align-items:flex-start;flex-wrap:wrap">${left}${right}</div>${wizModal}</main>`;
  }

  const poolsHtml = `<div class="rise" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px">${t.pools.map((p: Detail) => poolCard(S, p, manage, t.poolFormat, t.countGoalDiff, t.log)).join("")}</div>`;

  const finalsBtn = finalsStartPanel(S, t, manage);


  let finalsHtml = "";
  if (t.finals && t.finals.format === "battle_royale") {
    finalsHtml = `<div class="rise" style="margin-top:26px">${battleRoyaleCenter(S, t, manage)}</div>`;
  } else if (t.finals) {
    const champ = t.finals.champion
      ? `<div style="border:1px solid rgba(251,191,36,.4);border-radius:16px;background:linear-gradient(180deg,rgba(251,191,36,.08),var(--surface));padding:24px;text-align:center;margin-bottom:18px"><div style="font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:#FBBF24;font-weight:800">${ic(I.crown, 16)} Champion du tournoi</div><div style="font-family:'Bebas Neue',sans-serif;font-size:44px;letter-spacing:1px;margin-top:6px">${escHtml(t.finals.champion)}</div></div>`
      : "";
    let body: string;
    let fmtLabel = "";
    if (t.finals.format === "swiss") {
      fmtLabel = ` · Swiss (ronde ${t.finals.rounds.length}/${t.finals.roundCount})`;
      const standings = `<table style="width:100%;border-collapse:collapse;font-size:13.5px;margin-bottom:20px"><thead><tr style="color:var(--text-faint);font-size:11px;text-transform:uppercase;letter-spacing:.5px"><td style="padding:6px 8px">#</td><td style="padding:6px 8px">Joueur</td><td style="padding:6px 8px;text-align:right">V</td><td style="padding:6px 8px;text-align:right">Buchholz</td><td style="padding:6px 8px;text-align:right">Pts</td></tr></thead><tbody>${t.finals.standings.map((r: Detail, i: number) => `<tr style="border-top:1px solid var(--surface-4)"><td style="padding:7px 8px;color:var(--text-faint);font-family:'Bebas Neue',sans-serif;font-size:16px">${i + 1}</td><td style="padding:7px 8px;font-weight:600">${escHtml(r.name)}</td><td style="padding:7px 8px;text-align:right;color:var(--text-muted)">${r.wins}</td><td style="padding:7px 8px;text-align:right;color:var(--text-muted)">${r.buchholz}</td><td style="padding:7px 8px;text-align:right;font-weight:750;color:#22D3EE">${r.pts}</td></tr>`).join("")}</tbody></table>`;
      body = standings + `<div style="display:flex;flex-direction:column;gap:18px">${t.finals.rounds.map((r: Detail) => roundCol(r.label, r.matches, manage, false, logByMatchId(t.log))).join("")}</div>`;
    } else if (t.finals.format === "roundrobin") {
      fmtLabel = " · Round Robin";
      // Colonne masquée si le tournoi a désactivé le départage par différence de buts (voir wizInfosStep).
      const showDiff = t.countGoalDiff !== false;
      const standings = `<table style="width:100%;border-collapse:collapse;font-size:13.5px;margin-bottom:20px"><thead><tr style="color:var(--text-faint);font-size:11px;text-transform:uppercase;letter-spacing:.5px"><td style="padding:6px 8px">#</td><td style="padding:6px 8px">Joueur</td><td style="padding:6px 8px;text-align:right">J</td><td style="padding:6px 8px;text-align:right">G</td><td style="padding:6px 8px;text-align:right">P</td>${showDiff ? `<td style="padding:6px 8px;text-align:right">Diff.</td>` : ""}<td style="padding:6px 8px;text-align:right">Pts</td></tr></thead><tbody>${t.finals.standings.map((r: Detail, i: number) => `<tr style="border-top:1px solid var(--surface-4)"><td style="padding:7px 8px;color:var(--text-faint);font-family:'Bebas Neue',sans-serif;font-size:16px">${i + 1}</td><td style="padding:7px 8px;font-weight:600">${escHtml(r.name)}</td><td style="padding:7px 8px;text-align:right;color:var(--text-muted)">${r.played}</td><td style="padding:7px 8px;text-align:right;color:var(--text-muted)">${r.wins}</td><td style="padding:7px 8px;text-align:right;color:var(--text-muted)">${r.losses}</td>${showDiff ? `<td style="padding:7px 8px;text-align:right;color:var(--text-muted)">${r.gd > 0 ? "+" : ""}${r.gd}</td>` : ""}<td style="padding:7px 8px;text-align:right;font-weight:750;color:#22D3EE">${r.pts}</td></tr>`).join("")}</tbody></table>`;
      // Calendrier par journées plutôt que la grille plate de mini-cartes — même traitement que les
      // poules Round Robin, cohérent avec "faut corriger tous les tableaux comme ça".
      const calendar = journeeCalendar(t.finals.standings.map((r: Detail) => ({ id: r.id, name: r.name })), t.finals.matches, manage, (m) => m.playable ? `data-activematch="${m.matchId}"` : null, false, logByMatchId(t.log));
      body = standings + `<div style="font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:var(--text-muted);font-weight:750;margin-bottom:10px">Calendrier</div>${calendar}`;
    } else if (t.finals.format === "double") {
      fmtLabel = " · Double élimination";
      body = doubleElimTree(t.finals, [], manage, logByMatchId(t.log));
    } else if (t.finals.format === "single") {
      const tp = t.finals.thirdPlace;
      body = bracketTree(t.finals.rounds, [], manage, PARENTS_ELIM, logByMatchId(t.log))
        + (tp ? `<div style="margin-top:22px"><div style="font-size:11px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-muted);font-weight:750;margin-bottom:10px">Petite finale · 3e place</div><div style="max-width:280px">${matchBox(tp, manage, logByMatchId(t.log))}</div></div>` : "");
    } else if (t.finals.format === "survival") {
      // "Grande poule" finale (voir Engine.startFinalsSurvivalPool) : t.pools[0] EST la phase
      // finale, réunit tous les qualifiés, rendue par le même composant que n'importe quelle poule.
      fmtLabel = " · Survival";
      body = t.pools[0] ? poolCard(S, t.pools[0], manage, "survival", true, t.log) : "";
    } else {
      body = bracketTree(t.finals.rounds, [], manage);
    }
    const bracketCol = `${champ}<div style="font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:1px;margin-bottom:14px;display:flex;align-items:center;gap:10px"><span style="width:5px;height:22px;border-radius:3px;background:#22D3EE"></span>Phase finale${fmtLabel}</div>${body}`;
    // La cagnotte (points distribués par victoire) ne concerne que le mode Survival.
    const cagnotteTracker = t.mainFormat === "survival" ? `<div style="border:1px solid var(--border);border-radius:11px;background:var(--surface);padding:14px">
      <div style="font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-faint);font-weight:800;margin-bottom:10px">Cagnotte</div>
      <div style="display:flex;justify-content:space-between;font-size:12.5px;color:var(--text-muted);margin-bottom:6px">Distribuée<b style="color:var(--text);font-family:'JetBrains Mono',monospace">${dist}</b></div>
      <div style="display:flex;justify-content:space-between;font-size:12.5px;color:var(--text-muted);margin-bottom:10px">Reste à distribuer<b style="color:#FBBF24;font-family:'JetBrains Mono',monospace">${Math.max(0, total - dist)}</b></div>
      <div style="height:7px;border-radius:99px;background:var(--surface-3);border:1px solid var(--border);overflow:hidden"><span style="display:block;height:100%;width:${pct}%;background:linear-gradient(90deg,#22D3EE,#7C82FF)"></span></div>
    </div>` : "";
    const sideCol = cagnotteTracker;
    finalsHtml = manage && sideCol
      ? `<div class="grid2c" style="margin-top:26px;display:grid;grid-template-columns:1fr 300px;gap:22px;align-items:start"><div class="rise d1">${bracketCol}</div><div class="rise d2" style="display:flex;flex-direction:column;gap:16px">${sideCol}</div></div>`
      : `<div class="rise" style="margin-top:26px">${bracketCol}</div>`;
  }

  const rosterPanel = playersRosterPanel(S, t, manage);

  // Une fois en phase finale, les poules qui y ont mené ne doivent pas devenir inconsultables pour
  // autant — organisateur ET public : un bouton bascule vers leur tableau sans quitter la page
  // (même bascule qu'en régie, voir regieCenter). Absent si le format n'a jamais eu de vraies poules
  // (bracket direct dès le départ, ou Battle Royale dont "nbPools" désigne des parties, pas des poules).
  const hasPoolsHistory = Array.isArray(t.pools) && t.pools.length > 0 && t.mainFormat !== "battle_royale";
  const poolsToggle = hasPoolsHistory && t.finals
    ? `<div style="display:flex;gap:7px;margin-top:26px">
        <span data-bracketview="tree" style="font-size:11.5px;font-weight:${S.bracketView !== "pools" ? 750 : 700};color:${S.bracketView !== "pools" ? "#04222a" : "var(--text-muted)"};background:${S.bracketView !== "pools" ? "#22D3EE" : "transparent"};border:1px solid ${S.bracketView !== "pools" ? "#22D3EE" : "var(--border)"};border-radius:8px;padding:7px 12px;cursor:pointer">Phase finale</span>
        <span data-bracketview="pools" style="font-size:11.5px;font-weight:${S.bracketView === "pools" ? 750 : 700};color:${S.bracketView === "pools" ? "#04222a" : "var(--text-muted)"};background:${S.bracketView === "pools" ? "#22D3EE" : "transparent"};border:1px solid ${S.bracketView === "pools" ? "#22D3EE" : "var(--border)"};border-radius:8px;padding:7px 12px;cursor:pointer">Poules</span>
      </div>`
    : "";
  const mainSection = hasPoolsHistory && t.finals && S.bracketView === "pools"
    ? `<div style="margin-top:18px">${poolsHtml}</div>`
    : (finalsHtml || poolsHtml + finalsBtn);

  return `<main class="rise tf tf-pad" style="width:100%;padding:28px 44px 60px">${head}${predictionsCard(S, t, manage)}${editCard}${rosterPanel}${poolsToggle}${mainSection}</main>${wizModal}`;
}


/** Rend le texte d'une page légale saisi depuis l'admin. Format volontairement minimal — une
 * ligne « ## » fait un titre, une ligne « - » un élément de liste, le reste des paragraphes —
 * pour que le contenu reste modifiable dans une simple zone de texte, sans éditeur riche. */
function renderLegalBody(body: string): string {
  const blocks: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (!list.length) return;
    blocks.push(`<ul style="margin:0 0 16px;padding-left:20px;color:#C9CBD8;font-size:14.5px;line-height:1.8">${list.map((li) => `<li style="margin-bottom:6px">${li}</li>`).join("")}</ul>`);
    list = [];
  };
  for (const raw of (body || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (line.startsWith("## ")) {
      flush();
      blocks.push(`<h2 style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:.8px;margin:28px 0 12px;color:var(--text)">${escHtml(line.slice(3))}</h2>`);
    } else if (line.startsWith("- ")) {
      list.push(escHtml(line.slice(2)));
    } else {
      flush();
      blocks.push(`<p style="margin:0 0 14px;color:#C9CBD8;font-size:14.5px;line-height:1.8">${escHtml(line)}</p>`);
    }
  }
  flush();
  return blocks.join("");
}

/** Page légale publique (mentions légales / politique de confidentialité). */
function pLegal(S: State, key: "legal" | "privacy"): string {
  const doc = (S.site?.[key] ?? {}) as { title?: string; body?: string };
  const title = doc.title || (key === "legal" ? "Mentions légales" : "Politique de confidentialité");
  const body = doc.body ? renderLegalBody(doc.body) : `<p style="color:var(--text-muted)">Cette page n'a pas encore été rédigée.</p>`;
  return `<main class="rise" style="width:100%;padding:28px clamp(22px,3vw,64px) 60px">
    <div style="max-width:760px;margin:0 auto">
      <h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(34px,4.5vw,52px);letter-spacing:1.5px;margin:0 0 8px;line-height:.95">${escHtml(title)}</h1>
      <p style="color:var(--text-faint);font-size:12.5px;margin:0 0 28px">Dernière mise à jour : ${new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}</p>
      <div style="border:1px solid var(--border);border-radius:18px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:28px 26px">${body}</div>
      <div style="margin-top:20px"><button data-go="accueil" style="background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:11px;padding:11px 18px;font-weight:700;font-size:13.5px;cursor:pointer">Retour à l'accueil</button></div>
    </div></main>`;
}

/** Page d'authentification dédiée : présentation à gauche, formulaire à droite. */
function pAuth(S: State) {
  const isLogin = S.authTab === "login";
  const isForgot = S.authTab === "forgot";
  const isReset = S.authTab === "reset";
  const inp = "width:100%;background:var(--surface-3);border:1px solid var(--border);border-radius:11px;color:var(--text);font-family:inherit;font-size:14px;padding:12px 13px;margin-top:6px";
  const lbl = "font-size:12px;color:var(--text-muted);font-weight:600;display:block";

  // Déjà connecté : pas de formulaire.
  if (S.user) {
    return `<main class="rise" style="width:100%;padding:28px clamp(22px,3vw,64px) 60px"><div style="max-width:520px;margin:40px auto;border:1px solid var(--border);border-radius:20px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:44px 28px;text-align:center">
      <div style="display:grid;place-items:center;width:60px;height:60px;border-radius:18px;background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.4);color:#34D399;margin:0 auto 14px">${ic(I.user, 26)}</div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:28px;letter-spacing:1px;margin-bottom:6px">Tu es déjà connecté</div>
      <p style="color:var(--text-muted);font-size:14px;margin:0 0 20px">${escHtml(S.user.displayName)} · ${escHtml(S.user.email)}</p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button data-go="profil" style="background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:12px 20px;font-weight:750;font-size:14px;cursor:pointer">Mon espace</button>
        <button data-logout="1" style="background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:12px;padding:12px 20px;font-weight:700;font-size:14px;cursor:pointer">Déconnexion</button>
      </div></div></main>`;
  }

  const tab = (k: string, label: string) => `<button data-auth-tab="${k}" style="flex:1;padding:12px;border:0;border-radius:10px;cursor:pointer;font-family:inherit;font-weight:700;font-size:14px;background:${S.authTab === k ? "var(--surface-4)" : "transparent"};color:${S.authTab === k ? "#22D3EE" : "var(--text-muted)"}">${label}</button>`;
  const roleBtns = ["PLAYER", "ORGANIZER"].map((r) => {
    const on = S.authRole === r;
    const t2 = r === "PLAYER" ? ["Joueur", "Je participe aux tournois"] : ["Organisateur", "Je crée et pilote des tournois"];
    return `<button data-authrole="${r}" style="flex:1;padding:12px;border-radius:12px;cursor:pointer;font-family:inherit;text-align:left;background:${on ? "rgba(34,211,238,.08)" : "var(--surface-3)"};border:1px solid ${on ? "#22D3EE" : "var(--border)"}">
      <div style="font-weight:750;font-size:13.5px;color:${on ? "#22D3EE" : "var(--text)"}">${t2[0]}</div>
      <div style="font-size:11.5px;color:var(--text-muted);margin-top:2px">${t2[1]}</div></button>`;
  }).join("");

  const loginForm = `
    <label style="${lbl};margin-top:14px">Email ou pseudo<input id="a-email" type="text" autocapitalize="none" autocomplete="username" placeholder="toi@exemple.com ou ton pseudo" style="${inp}" /></label>
    <label style="${lbl};margin-top:14px">Mot de passe<input id="a-pass" type="password" placeholder="••••••" style="${inp}" /></label>
    <div style="text-align:right;margin-top:8px"><button data-auth-tab="forgot" style="background:none;border:0;color:var(--text-muted);font-weight:600;cursor:pointer;font-size:12px;font-family:inherit;text-decoration:underline">Mot de passe oublié ?</button></div>`;

  const forgotForm = `
    <p style="color:var(--text-muted);font-size:13px;line-height:1.6;margin:14px 0 0">Indique l'adresse de ton compte : nous t'envoyons un lien pour choisir un nouveau mot de passe. Il est valable une heure.</p>
    <label style="${lbl};margin-top:14px">Email<input id="a-email" type="email" placeholder="toi@exemple.com" style="${inp}" /></label>`;

  const resetForm = `
    <p style="color:var(--text-muted);font-size:13px;line-height:1.6;margin:14px 0 0">Choisis ton nouveau mot de passe.</p>
    <label style="${lbl};margin-top:14px">Nouveau mot de passe (6 caractères min.)<input id="a-pass" type="password" placeholder="••••••" style="${inp}" /></label>
    <label style="${lbl};margin-top:14px">Confirme le mot de passe<input id="a-pass2" type="password" placeholder="••••••" style="${inp}" /></label>`;

  const registerForm = `
    <label style="${lbl};margin-top:14px">Nom affiché (pseudo)<input id="a-name" placeholder="Kossi K9" style="${inp}" /></label>
    <div style="margin-top:14px"><div style="${lbl};margin-bottom:6px">Je m'inscris en tant que</div><div style="display:flex;gap:10px">${roleBtns}</div></div>
    <label style="${lbl};margin-top:14px">Email<input id="a-email" type="email" placeholder="toi@exemple.com" style="${inp}" /></label>
    <div class="grid2b" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px">
      <label style="${lbl}">Mot de passe (6 caractères min.)<input id="a-pass" type="password" placeholder="••••••" style="${inp}" /></label>
      <label style="${lbl}">Confirme le mot de passe<input id="a-pass2" type="password" placeholder="••••••" style="${inp}" /></label>
    </div>
    <div class="grid2b" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px">
      <label style="${lbl}">Ville <span style="color:var(--text-faint)">(optionnel)</span><input id="a-city" placeholder="Lomé" style="${inp}" /></label>
      <label style="${lbl}">Jeu favori <span style="color:var(--text-faint)">(optionnel)</span><input id="a-game" placeholder="EA FC 26, Tekken 8…" style="${inp}" /></label>
    </div>
    <div class="grid2b" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px">
      <label style="${lbl}">Téléphone / WhatsApp <span style="color:var(--text-faint)">(optionnel)</span><input id="a-phone" type="tel" placeholder="+228 90 00 00 00" style="${inp}" /></label>
      <label style="${lbl}">Club <span style="color:var(--text-faint)">(optionnel · validé par l'administrateur avant activation du compte)</span><input id="a-club" list="a-club-list" placeholder="Team 228" style="${inp}" /><datalist id="a-club-list">${(S.clubs ?? []).map((c: Detail) => `<option value="${escAttr(c.name)}">`).join("")}</datalist></label>
    </div>
    ${S.authRole === "ORGANIZER" ? `<label style="${lbl};margin-top:14px">Présente ta demande <span style="color:var(--text-faint)">(quels jeux, quelle expérience… — examinée par l'équipe Miabe)</span><textarea id="a-orgnote" rows="3" placeholder="Ex : j'organise des LAN Tekken à Lomé depuis 2 ans…" style="${inp};resize:vertical"></textarea></label>
    <p style="color:var(--text-faint);font-size:11.5px;margin-top:8px">${ic(I.warn, 12)} Un compte organisateur doit être validé par l'équipe Miabe avant de pouvoir créer un tournoi.</p>` : ""}`;

  const perks = [
    [I.crown, "Inscris-toi aux tournois", "Survival, brackets, Battle Royale — suis tes matchs en direct."],
    [I.medal, "Classements & progression", "Points, ELO et historique de tes performances."],
    [I.cart, "Boutique officielle", "Maillots, billets et goodies — paiement mobile money."],
    [I.tv, "Mode Show", "Suis les matchs en plein écran, comme à la télé."],
  ].map(([icn, t2, s2]) => `<div style="display:flex;gap:14px;align-items:flex-start"><span style="display:grid;place-items:center;width:42px;height:42px;border-radius:12px;background:rgba(34,211,238,.07);border:1px solid rgba(34,211,238,.25);color:#22D3EE;flex:none">${ic(icn, 19)}</span><div><div style="font-weight:700;font-size:14.5px">${t2}</div><div style="color:var(--text-muted);font-size:13px;line-height:1.5;margin-top:3px">${s2}</div></div></div>`).join("");

  return `<main class="rise" style="width:100%;padding:28px clamp(22px,3vw,64px) 60px">
    <div class="grid2" style="display:grid;grid-template-columns:1fr 1.1fr;gap:28px;max-width:1180px;margin:0 auto;align-items:center;min-height:70vh">
      <div class="rise d1" style="padding:10px 6px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:22px">${brandLogo(S, 44, 24)}<span style="font-family:'Bebas Neue',sans-serif;font-size:30px;letter-spacing:1.6px">${escHtml(S.site?.brand?.name1 ?? "Miabe")} <span style="color:#22D3EE">${escHtml(S.site?.brand?.name2 ?? "ESPORT")}</span></span></div>
        <h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(32px,3.6vw,50px);letter-spacing:1.2px;line-height:.95;margin:0 0 12px">Rejoins la communauté<br>esport du Togo</h1>
        <p style="color:var(--text-muted);font-size:14.5px;line-height:1.6;max-width:460px;margin:0 0 26px">Un seul compte pour t'inscrire aux tournois, suivre tes résultats, commander à la boutique et vibrer avec la scène.</p>
        <div style="display:flex;flex-direction:column;gap:18px">${perks}</div>
      </div>
      <div class="rise d2" style="border:1px solid var(--border-strong);border-radius:22px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:26px 26px 28px;box-shadow:0 24px 70px rgba(0,0,0,.45)">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:1px;margin-bottom:14px">${isForgot ? "Mot de passe oublié" : isReset ? "Nouveau mot de passe" : isLogin ? "Connexion" : "Créer mon compte"}</div>
        ${isForgot || isReset ? "" : `<div style="display:flex;gap:4px;background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:4px;margin-bottom:4px">${tab("login", "Se connecter")}${tab("register", "Créer un compte")}</div>`}
        ${isForgot ? forgotForm : isReset ? resetForm : isLogin ? loginForm : registerForm}
        ${S.authNotice ? `<div style="display:flex;align-items:flex-start;gap:8px;color:#34D399;font-size:12.5px;margin-top:14px;background:rgba(52,211,153,.06);border:1px solid rgba(52,211,153,.3);border-radius:10px;padding:10px 12px">${ic(I.plus, 15)}<span>${escHtml(S.authNotice)}</span></div>` : ""}
        ${S.authError ? `<div style="display:flex;align-items:center;gap:8px;color:#FB7185;font-size:12.5px;margin-top:14px;background:rgba(251,113,133,.06);border:1px solid rgba(251,113,133,.3);border-radius:10px;padding:10px 12px">${ic(I.warn, 15)}${escHtml(S.authError)}</div>` : ""}
        <button data-auth-submit="1" ${S.authBusy ? "disabled" : ""} style="width:100%;margin-top:18px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:14px;font-weight:750;font-size:15px;cursor:${S.authBusy ? "default" : "pointer"};opacity:${S.authBusy ? ".6" : "1"};box-shadow:0 0 30px rgba(34,211,238,.2)">${S.authBusy ? "…" : isForgot ? "Envoyer le lien" : isReset ? "Enregistrer le mot de passe" : isLogin ? "Se connecter" : "Créer mon compte"}</button>
        <p style="color:var(--text-faint);font-size:12px;text-align:center;margin:14px 0 0">${isForgot || isReset
          ? `<button data-auth-tab="login" style="background:none;border:0;color:#22D3EE;font-weight:700;cursor:pointer;font-size:12px;font-family:inherit">Retour à la connexion</button>`
          : isLogin ? `Pas encore de compte ? <button data-auth-tab="register" style="background:none;border:0;color:#22D3EE;font-weight:700;cursor:pointer;font-size:12px;font-family:inherit">Inscris-toi</button>` : `Déjà membre ? <button data-auth-tab="login" style="background:none;border:0;color:#22D3EE;font-weight:700;cursor:pointer;font-size:12px;font-family:inherit">Connecte-toi</button>`}</p>
      </div>
    </div></main>`;
}

/** Fiche complète d'un joueur de la base, ouverte depuis Admin → Joueurs (« Voir le profil ») —
 * tout ce à quoi il est rattaché sur le site : stats globales + par jeu, commandes, inscriptions,
 * si un compte y est relié (sinon juste sa fiche roster : nom, club, ville, elo). */
function playerDetailModal(S: State) {
  const p = S.playerDetail;
  if (!p && !S.playerDetailBusy) return "";
  const body = !p ? `<div style="color:var(--text-muted);text-align:center;padding:30px 0">Chargement…</div>` : (() => {
    const acc = p.account;
    const infoRow = (label: string, value: string) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-top:1px solid var(--surface-4)"><span style="color:var(--text-muted);font-size:12.5px">${label}</span><span style="font-weight:650;font-size:13px">${value}</span></div>`;
    const roster = `<div style="border:1px solid var(--border);border-radius:14px;padding:14px;margin-bottom:16px">
      ${infoRow("Club", p.clubName ? escHtml(p.clubName) : "—")}
      ${infoRow("Ville", p.city ? escHtml(p.city) : "—")}
      ${infoRow("ELO", String(p.elo))}
      ${infoRow("Membre de la base depuis", new Date(p.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }))}
    </div>`;
    if (!p.linked || !acc) {
      return roster + `<div style="color:var(--text-faint);font-size:13px;text-align:center;padding:10px 0">${ic(I.warn, 13)} Pas de compte relié — ajouté manuellement, ou pas encore inscrit sur le site.</div>`;
    }
    const rc = ROLE_COLOR[acc.role] || "#22D3EE";
    const accountCard = `<div style="border:1px solid var(--border);border-radius:14px;padding:14px;margin-bottom:16px">
      ${infoRow("Email", escHtml(acc.email))}
      ${infoRow("Rôle", `<span style="color:${rc};font-weight:800">${ROLE_LABEL[acc.role] || acc.role}</span>`)}
      ${infoRow("Points fidélité", String(acc.loyaltyPoints ?? 0))}
      ${infoRow("Membre du site depuis", new Date(acc.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }))}
    </div>`;
    const regs: Detail[] = acc.registrations ?? [];
    const regsList = regs.length ? `<div style="border:1px solid var(--border);border-radius:14px;padding:14px;margin-bottom:16px">
      ${secTitle(`Inscriptions (${regs.length})`)}
      ${regs.map((r: Detail) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--surface-4)"><span style="font-size:13px">${escHtml(r.tournament.name)}</span><span style="font-size:11.5px;color:var(--text-muted)">${escHtml(r.tournament.status)}</span></div>`).join("")}
    </div>` : "";
    const orders: Detail[] = acc.orders ?? [];
    const ordersList = orders.length ? `<div style="border:1px solid var(--border);border-radius:14px;padding:14px;margin-bottom:16px">
      ${secTitle(`Commandes (${orders.length})`)}
      ${orders.map((o: Detail) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--surface-4)"><span style="font-size:13px">${escHtml(o.reference)}</span><span style="font-size:11.5px;color:var(--text-muted)">${money(o.totalXof)} · ${escHtml(o.status)}</span></div>`).join("")}
    </div>` : "";
    return roster + accountCard + statsByGameCard(acc) + regsList + ordersList;
  })();
  return `<div data-playerviewclose="1" style="position:fixed;inset:0;z-index:300;display:flex;align-items:flex-start;justify-content:center;padding:min(6vh,60px) 18px;background:rgba(6,6,10,.75);backdrop-filter:blur(6px);overflow-y:auto">
    <div data-stop="1" style="width:100%;max-width:520px;background:linear-gradient(180deg,var(--surface),var(--surface-2));border:1px solid var(--border-strong);border-radius:20px;padding:24px;box-shadow:0 30px 80px rgba(0,0,0,.6);animation:fadeUp .18s ease both">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">
        <span style="display:grid;place-items:center;width:46px;height:46px;border-radius:14px;background:linear-gradient(135deg,#22D3EE,#7C82FF);font-family:'Bebas Neue',sans-serif;font-size:22px;color:#04222a;flex:none">${(p?.name || "?").charAt(0).toUpperCase()}</span>
        <div style="min-width:0;flex:1"><div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:.5px;line-height:1">${escHtml(p?.name || "")}</div></div>
        <button data-playerviewclose="1" style="display:grid;place-items:center;width:32px;height:32px;border-radius:9px;background:transparent;border:1px solid var(--border-strong);color:var(--text-muted);cursor:pointer;flex:none">${ic(I.x, 15)}</button>
      </div>
      ${body}
    </div></div>`;
}

/** Modale de confirmation (suppression, déconnexion…). */
function confirmModal(S: State) {
  const c = S.confirmBox;
  if (!c) return "";
  const danger = c.action !== "logout" && !(c.action.startsWith("setrole|") && !c.action.endsWith("|ADMIN")) && !c.action.endsWith("|approve");
  const okColor = danger
    ? "background:linear-gradient(135deg,#FB7185,#e35065);color:#fff"
    : "background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a";
  return `<div data-confirm-cancel="1" style="position:fixed;inset:0;z-index:300;display:grid;place-items:center;padding:20px;background:rgba(6,6,10,.72);backdrop-filter:blur(6px)">
    <div data-stop="1" style="width:100%;max-width:400px;background:linear-gradient(180deg,var(--surface),var(--surface-2));border:1px solid var(--border-strong);border-radius:20px;padding:26px;box-shadow:0 30px 80px rgba(0,0,0,.6);text-align:center;animation:fadeUp .18s ease both">
      <div style="display:grid;place-items:center;width:54px;height:54px;border-radius:16px;background:${danger ? "rgba(251,113,133,.1)" : "rgba(34,211,238,.08)"};border:1px solid ${danger ? "rgba(251,113,133,.4)" : "rgba(34,211,238,.35)"};color:${danger ? "#FB7185" : "#22D3EE"};margin:0 auto 14px">${ic(danger ? I.warn : I.logout, 24)}</div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:1px;margin-bottom:8px">${c.title}</div>
      <p style="color:var(--text-muted);font-size:14px;line-height:1.55;margin:0 0 20px">${c.message}</p>
      <div style="display:flex;gap:10px;justify-content:center">
        <button data-confirm-cancel="1" style="flex:1;background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:12px;padding:12px 18px;font-weight:700;font-size:14px;cursor:pointer">Annuler</button>
        <button data-confirm-ok="1" style="flex:1;border:0;border-radius:12px;padding:12px 18px;font-weight:750;font-size:14px;cursor:pointer;${okColor}">${c.okLabel}</button>
      </div>
    </div></div>`;
}

/** Modale de correction d'un match déjà joué (crayon) — montée aux mêmes points que confirmModal,
 * pour fonctionner aussi bien depuis la régie (tournoi en direct) que depuis la page publique d'un
 * tournoi terminé (régie n'est plus accessible une fois status !== "live", voir renderPage). Même
 * stepper que matchScoreControl, pré-rempli avec le score existant, mais poussé via /correct (pas
 * /report) — le résultat original et tout ce qui en dépendait sont remis en jeu (voir
 * Engine.correctResult, cascade). */
function matchCorrectModal(S: State): string {
  if (!S.correctingId) return "";
  const t = S.detail;
  const entry = t && (t.log || []).find((l: Detail) => l.id === S.correctingId);
  if (!entry) return "";
  const key = "c:" + entry.id;
  const sc = S.matchScores[key] || { a: entry.sa ?? 0, b: entry.sb ?? 0 };
  const sa = sc.a, sb = sc.b;
  const canValidate = sa !== sb && !S.detailBusy;
  const side = (name: string, score: number, k: "a" | "b") => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;background:var(--surface-5);border:1px solid var(--border)">
      <span style="display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--surface-4);font-size:11px;font-weight:800;color:#FBBF24;flex:none">${escHtml(name).charAt(0).toUpperCase()}</span>
      <b style="font-size:13.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(name)}</b>
      <button data-correctstep="${key}|${k}|-1" style="display:grid;place-items:center;width:26px;height:26px;border-radius:7px;border:1px solid var(--border-strong);background:transparent;color:var(--text-muted);font-size:15px;font-weight:700;cursor:pointer;flex:none">–</button>
      <span style="font-family:'JetBrains Mono',monospace;font-size:20px;font-weight:600;min-width:22px;text-align:center">${score}</span>
      <button data-correctstep="${key}|${k}|1" style="display:grid;place-items:center;width:26px;height:26px;border-radius:7px;background:#FBBF24;color:#04222a;font-size:15px;font-weight:800;border:0;cursor:pointer;flex:none">+</button>
    </div>`;
  return `<div data-correctcancel="1" style="position:fixed;inset:0;z-index:290;display:grid;place-items:center;padding:20px;background:rgba(6,6,10,.72);backdrop-filter:blur(6px)">
    <div data-stop="1" style="width:100%;max-width:420px;border:1px solid rgba(251,191,36,.4);border-radius:16px;background:var(--surface-2);box-shadow:0 30px 80px rgba(0,0,0,.6);animation:fadeUp .18s ease both">
      <div style="display:flex;align-items:center;gap:9px;padding:16px 20px;border-bottom:1px solid rgba(251,191,36,.22)">
        ${ic(I.edit, 15)}<span style="font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:.5px;flex:1;color:#FBBF24">Corriger ce match</span>
        <button data-correctcancel="1" style="display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:var(--surface-3);border:1px solid var(--border);color:var(--text-muted);cursor:pointer">${ic(I.x, 13)}</button>
      </div>
      <div style="padding:20px">
        <p style="color:var(--text-muted);font-size:12.5px;margin:0 0 14px">Tout ce qui a été joué après ce match sera remis à rejouer.</p>
        <div style="display:flex;flex-direction:column;gap:8px">${side(entry.aName, sa, "a")}${side(entry.bName, sb, "b")}</div>
        <button data-correctvalidate="${entry.id}" ${canValidate ? "" : "disabled"} style="width:100%;margin-top:16px;display:flex;align-items:center;justify-content:center;gap:8px;background:${canValidate ? "#FBBF24" : "var(--surface-4)"};color:${canValidate ? "#04222a" : "var(--text-faint)"};border:0;border-radius:10px;padding:12px;font-weight:800;font-size:13.5px;cursor:${canValidate ? "pointer" : "default"}">Enregistrer la correction</button>
      </div>
    </div>
  </div>`;
}

function cartDrawer(S: State) {
  if (!S.cartOpen) return "";
  if (S.lastOrder) {
    const o = S.lastOrder;
    return `<div data-cart-close="1" style="position:fixed;inset:0;z-index:200;background:rgba(6,6,10,.6);backdrop-filter:blur(4px)">
      <div data-stop="1" style="position:absolute;top:0;right:0;height:100%;width:min(420px,92vw);background:var(--surface-2);border-left:1px solid var(--border);padding:22px;display:flex;flex-direction:column">
        <div style="display:flex;align-items:center;justify-content:flex-end;margin-bottom:8px"><span data-cart-close="1" style="color:var(--text-muted);cursor:pointer">${ic(I.x, 20)}</span></div>
        <div class="rise" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:6px">
          <div style="display:grid;place-items:center;width:64px;height:64px;border-radius:18px;background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.4);color:#34D399;margin-bottom:10px">${ic(I.crown, 26)}</div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:1px">Commande enregistrée</div>
          <div style="color:var(--text-muted);font-size:13.5px;max-width:280px;margin-top:4px">Réf. <b style="color:var(--text)">${escHtml(o.reference)}</b> · ${money(o.totalXof)} · paiement ${escHtml(o.paymentMethod)}. Elle sera confirmée par l'équipe Miabe à réception du paiement.</div>
        </div>
        <div style="border-top:1px solid var(--border);padding-top:16px;margin-top:8px;display:flex;flex-direction:column;gap:8px">
          <button data-cart-vieworders="1" style="width:100%;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:13px;font-weight:750;font-size:15px;cursor:pointer">Voir mes commandes</button>
          <button data-cart-close="1" style="width:100%;background:transparent;border:1px solid var(--border);color:var(--text-muted);border-radius:12px;padding:11px;font-weight:600;font-size:13px;cursor:pointer">Continuer mes achats</button>
        </div>
      </div></div>`;
  }
  const total = S.cartItems.reduce((a, i) => a + i.price, 0);
  const rows = S.cartItems.length
    ? S.cartItems.map((i, idx) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 0;border-bottom:1px solid var(--surface-4)"><div><div style="font-weight:600;font-size:14px">${escHtml(i.name)}</div><div style="font-size:12.5px;color:#22D3EE;font-weight:700;font-family:'JetBrains Mono',monospace">${money(i.price)}</div></div><button data-cart-remove="${idx}" style="display:grid;place-items:center;width:32px;height:32px;background:transparent;border:1px solid var(--border);border-radius:9px;color:var(--text-muted);cursor:pointer">${ic(I.trash, 15)}</button></div>`).join("")
    : `<div style="color:var(--text-faint);font-size:14px;text-align:center;padding:40px 0">Ton panier est vide.<br>Ajoute des articles depuis la boutique.</div>`;
  const payChips = S.cartItems.length && !onlinePayOn(S) ? `<div style="margin-bottom:14px">
    <div style="color:var(--text-muted);font-size:12px;font-weight:700;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Moyen de paiement</div>
    <div style="display:flex;gap:7px;flex-wrap:wrap">${payMethods(S).map((m) => `<button data-cartpaypick="${m}" style="font-size:12px;font-weight:700;border-radius:9px;padding:8px 12px;cursor:pointer;background:${S.cartPayPick === m ? "rgba(34,211,238,.1)" : "var(--surface-3)"};border:1px solid ${S.cartPayPick === m ? "#22D3EE" : "var(--border)"};color:${S.cartPayPick === m ? "#22D3EE" : "var(--text-muted)"}">${m}</button>`).join("")}</div>
  </div>` : "";
  // Réduction en points fidélité : uniquement sur la part du panier composée d'articles éligibles (choix admin).
  const eligibleSubtotal = S.cartItems.reduce((a, i) => {
    const prod = (S.products ?? []).find((p) => p.id === i.id);
    return a + (prod?.loyaltyEligible ? i.price : 0);
  }, 0);
  const ly = S.loyaltySettings || { pointValueXof: 100, maxRedeemPercent: 50 };
  const maxXof = Math.min(eligibleSubtotal, Math.floor((total * ly.maxRedeemPercent) / 100));
  const maxPoints = Math.max(0, Math.min(S.loyaltyBalance, Math.floor(maxXof / ly.pointValueXof)));
  const chosenPoints = Math.min(S.cartPointsToRedeem, maxPoints);
  const discount = chosenPoints * ly.pointValueXof;
  const netTotal = Math.max(0, total - discount);
  const loyaltyBox = S.user && maxPoints > 0 ? `<div style="margin-bottom:14px;border:1px solid var(--border);border-radius:12px;background:var(--surface);padding:12px 14px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
      <span style="font-size:12px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.5px">Points fidélité</span>
      <span style="font-size:12px;color:var(--text-faint)">Solde : <b style="color:var(--text)">${S.loyaltyBalance}</b></span>
    </div>
    <div style="display:flex;align-items:center;gap:10px">
      <button data-cartpts="${Math.max(0, chosenPoints - 1)}" style="width:30px;height:30px;border-radius:8px;background:var(--surface-3);border:1px solid var(--border);color:var(--text);cursor:pointer">−</button>
      <span style="flex:1;text-align:center;font-family:'JetBrains Mono',monospace;font-weight:700">${chosenPoints} pt${chosenPoints > 1 ? "s" : ""}</span>
      <button data-cartpts="${Math.min(maxPoints, chosenPoints + 1)}" style="width:30px;height:30px;border-radius:8px;background:var(--surface-3);border:1px solid var(--border);color:var(--text);cursor:pointer">+</button>
      <button data-cartpts="${maxPoints}" style="font-size:11.5px;font-weight:700;color:#22D3EE;background:transparent;border:1px solid rgba(34,211,238,.35);border-radius:8px;padding:0 10px;height:30px;cursor:pointer">Max</button>
    </div>
    ${discount > 0 ? `<div style="margin-top:8px;font-size:12.5px;color:#34D399;font-weight:700">− ${money(discount)} appliqués</div>` : ""}
  </div>` : "";
  const canOrder = S.cartItems.length > 0 && (onlinePayOn(S) || !!S.cartPayPick) && !S.cartBusy;
  return `<div data-cart-close="1" style="position:fixed;inset:0;z-index:200;background:rgba(6,6,10,.6);backdrop-filter:blur(4px)">
    <div data-stop="1" style="position:absolute;top:0;right:0;height:100%;width:min(420px,92vw);background:var(--surface-2);border-left:1px solid var(--border);padding:22px;display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><span style="font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:1px">Panier</span><span data-cart-close="1" style="color:var(--text-muted);cursor:pointer">${ic(I.x, 20)}</span></div>
      <div style="flex:1;overflow-y:auto">${rows}</div>
      <div style="border-top:1px solid var(--border);padding-top:16px;margin-top:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><span style="color:var(--text-muted);font-size:14px">Total</span><span style="text-align:right">${discount > 0 ? `<div style="font-size:13px;color:var(--text-faint);text-decoration:line-through">${money(total)}</div>` : ""}<span style="font-family:'Bebas Neue',sans-serif;font-size:26px;color:#22D3EE">${money(netTotal)}</span></span></div>
        ${loyaltyBox}
        ${payChips}
        <button ${canOrder ? "" : "disabled"} ${onlinePayOn(S) ? `data-payopen="cart"` : `data-checkout="1"`} style="width:100%;background:${canOrder ? "linear-gradient(135deg,#22D3EE,#12aec4)" : "var(--surface-4)"};color:${canOrder ? "#04222a" : "var(--text-faint)"};border:0;border-radius:12px;padding:13px;font-weight:750;font-size:15px;cursor:${canOrder ? "pointer" : "default"};opacity:${S.cartItems.length ? "1" : ".5"}">${S.cartBusy ? "Envoi…" : onlinePayOn(S) ? "Payer" : "Commander"}</button>
        ${S.cartItems.length ? `<button data-cart-clear="1" style="width:100%;margin-top:8px;background:transparent;border:1px solid var(--border);color:var(--text-muted);border-radius:12px;padding:11px;font-weight:600;font-size:13px;cursor:pointer">Vider le panier</button>` : ""}
      </div>
    </div></div>`;
}

/** Table de classement plein écran (Mode Show) — top 8, réutilisée pour poules Survival, Round Robin/Swiss et Battle Royale. */
function showStandingsTable(rows: { name: string; pts: number }[], ptsLabel: string): string {
  if (!rows.length) return `<div style="text-align:center;color:var(--text-faint);font-size:2.2vh;margin-top:3vh">Classement pas encore disponible.</div>`;
  return `<div style="max-width:min(880px,74vw);margin:2.4vh auto 0"><table style="width:100%;border-collapse:collapse">
    <thead><tr style="color:var(--text-faint);font-size:1.4vh;text-transform:uppercase;letter-spacing:2px"><td style="padding:.7vh 1vw">#</td><td style="padding:.7vh 1vw">Joueur</td><td style="padding:.7vh 1vw;text-align:right">${ptsLabel}</td></tr></thead>
    <tbody>${rows.map((r, i) => `<tr style="border-top:1px solid var(--surface-4)"><td style="padding:1vh 1vw;font-family:'Bebas Neue',sans-serif;font-size:3vh;color:${i === 0 ? "#FBBF24" : "var(--text-faint)"}">${i + 1}</td><td style="padding:1vh 1vw;font-weight:700;font-size:2.2vh">${escHtml(r.name)}</td><td style="padding:1vh 1vw;text-align:right;font-weight:800;color:#22D3EE;font-size:2.6vh">${r.pts}</td></tr>`).join("")}</tbody>
  </table></div>`;
}
/** Un à trois duels en gros plan (Mode Show) — phase finale single/double/round robin/swiss, ou file d'attente Survival. */
function showMatchesFocus(matches: { aName: string; bName: string; label?: string; station?: string; onStream?: boolean }[]): string {
  if (!matches.length) return `<div style="text-align:center;color:var(--text-faint);font-size:2.2vh;margin-top:3vh">En attente du prochain match…</div>`;
  // Le match "à l'antenne" (voir setStreamMatch) passe en tête de la liste, comme la file d'attente de la régie.
  const sorted = [...matches].sort((a, b) => Number(!!b.onStream) - Number(!!a.onStream));
  const box = (m: { aName: string; bName: string; label?: string; station?: string; onStream?: boolean }) => `<div>
    ${m.label || m.station || m.onStream ? `<div style="display:flex;align-items:center;justify-content:center;gap:1vh;margin-bottom:.8vh">
      ${m.label ? `<span style="color:#FBBF24;font-size:1.5vh;font-weight:800;letter-spacing:1.6px;text-transform:uppercase">${escHtml(m.label)}</span>` : ""}
      ${m.onStream ? `<span style="display:inline-flex;align-items:center;gap:.5vh;font-size:1.3vh;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:#fff;background:#F43F7E;border-radius:99px;padding:.4vh 1.2vh">${ic(I.tv, 11)}À l'antenne</span>` : ""}
      ${m.station ? `<span style="font-size:1.3vh;font-weight:800;color:#04222a;background:#22D3EE;border-radius:99px;padding:.4vh 1.2vh">${escHtml(m.station)}</span>` : ""}
    </div>` : ""}
    <div style="display:flex;align-items:center;justify-content:center;gap:2vw;flex-wrap:wrap">
    <div style="text-align:center;flex:1;min-width:0"><div style="font-family:'Bebas Neue',sans-serif;font-size:${matches.length > 1 ? 5.5 : 8}vh;color:#22D3EE;line-height:1">${escHtml(m.aName)}</div></div>
    <div style="font-family:'Bebas Neue',sans-serif;font-size:${matches.length > 1 ? 2 : 3.4}vh;color:var(--text-faint);flex:none">VS</div>
    <div style="text-align:center;flex:1;min-width:0"><div style="font-family:'Bebas Neue',sans-serif;font-size:${matches.length > 1 ? 5.5 : 8}vh;color:#F43F7E;line-height:1">${escHtml(m.bName)}</div></div>
    </div></div>`;
  return `<div style="display:flex;flex-direction:column;gap:${matches.length > 1 ? 2.6 : 0}vh;margin-top:3vh;max-width:82vw;margin-left:auto;margin-right:auto">${sorted.map(box).join("")}</div>`;
}
/** Derniers résultats (Mode Show) — vainqueur mis en avant, une ligne par match. */
function showRecentResults(matches: Detail[]): string {
  const hasScore = (m: Detail) => m.sa !== null && m.sa !== undefined && m.sb !== null && m.sb !== undefined;
  return `<div style="max-width:min(760px,66vw);margin:2.6vh auto 0;display:flex;flex-direction:column;gap:1.6vh">${matches.map((m: Detail) => {
    const aWon = m.winnerId === m.aId;
    const win = aWon ? m.aName : m.bName, lose = aWon ? m.bName : m.aName;
    const score = hasScore(m) ? `<span style="color:#22D3EE;font-family:'JetBrains Mono',monospace;font-weight:800;font-size:2vh">${aWon ? m.sa : m.sb}–${aWon ? m.sb : m.sa}</span>` : "";
    return `<div style="display:flex;align-items:center;justify-content:center;gap:1.2vw;font-size:2.4vh;border-bottom:1px solid var(--surface-3);padding-bottom:1.4vh">${ic(I.crown, 18)}<span style="color:#22D3EE;font-weight:800">${escHtml(win)}</span><span style="color:var(--text-faint);font-size:1.9vh">a battu</span><span style="color:var(--text-faint)">${escHtml(lose)}</span>${score}</div>`;
  }).join("")}</div>`;
}
/** Battle Royale (Mode Show) — partie à venir, ou podium de la dernière partie jouée. */
function showBRSlide(f: Detail): string {
  const nextGame = f.games.find((g: Detail) => !g.played);
  const lastGame = [...f.games].reverse().find((g: Detail) => g.played);
  const status = nextGame
    ? `<div style="color:#22D3EE;font-weight:800;letter-spacing:2px;font-size:1.7vh;text-transform:uppercase">${escHtml(nextGame.label)} à venir</div>`
    : `<div style="color:#34D399;font-weight:800;letter-spacing:2px;font-size:1.7vh;text-transform:uppercase">Toutes les parties ont été jouées</div>`;
  const podium = lastGame ? `<div style="margin-top:3vh;display:flex;justify-content:center;align-items:flex-end;gap:3vw"><div style="text-align:center;color:var(--text-faint);font-size:1.4vh">${escHtml(lastGame.label)}</div></div>
    <div style="margin-top:1vh;display:flex;justify-content:center;align-items:flex-end;gap:3vw">${lastGame.ranking.slice(0, 3).map((r: Detail, i: number) => `<div style="text-align:center"><div style="font-family:'Bebas Neue',sans-serif;font-size:${i === 0 ? 8 : 5.5}vh;color:${i === 0 ? "#FBBF24" : i === 1 ? "#D1D5DB" : "#B45309"};line-height:1">${escHtml(r.name)}</div><div style="color:var(--text-faint);font-size:1.4vh;margin-top:.6vh">${i + 1}${i === 0 ? "ʳᵉ" : "ᵉ"} place</div></div>`).join("")}</div>` : "";
  return `<div style="text-align:center">${status}${podium}</div>`;
}

/** Mode Show : si le tournoi fait partie d'un événement, sa couverture (bannière animée ou affiche) sert de fond, assombrie pour rester lisible. */
function showBackdrop(ev: Detail | null | undefined): string {
  if (!ev || !(ev.bannerUrl || ev.posterUrl)) return "";
  const bg = isVideoUrl(ev.bannerUrl)
    ? `<video src="${mediaUrl(ev.bannerUrl)}" muted autoplay loop playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>`
    : `<div style="position:absolute;inset:-4%;background:url('${mediaUrl(ev.bannerUrl || ev.posterUrl)}') center/cover;${ev.bannerUrl ? "" : "filter:blur(14px);"}"></div>`;
  return `<div style="position:fixed;inset:0;z-index:0;overflow:hidden;background:var(--bg);pointer-events:none">${bg}<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(11,11,17,.78),rgba(11,11,17,.9))"></div></div>`;
}
function pShow(S: State) {
  const inner = pShowInner(S);
  const back = showBackdrop(S.detail?.event as Detail | null | undefined);
  return back ? `${back}<div style="position:relative;z-index:1">${inner}</div>` : inner;
}

/** Matchs en cours d'un tournoi (pour l'écran d'événement) : matchs de poule du moment, ou affiches jouables de la phase finale. */
function evLiveMatches(st: Detail): { label: string; a: string; b: string; station?: string; onStream?: boolean }[] {
  const out: { label: string; a: string; b: string; station?: string; onStream?: boolean }[] = [];
  const stations: Record<string, string> = st?.stations || {};
  const streamKey = st?.streamMatchKey;
  const fin = st?.finals;
  if (!fin || fin.format === "survival") {
    (st?.pools || []).forEach((p: Detail) => { if (p.current) out.push({ label: p.name, a: p.current.aName, b: p.current.bName, station: stations[p.id], onStream: p.id === streamKey }); });
  } else {
    finalsLabelledMatches(fin).forEach(({ label, m }) => { if (m && m.playable && m.aName && m.bName) out.push({ label, a: m.aName, b: m.bName, station: stations[m.matchId], onStream: m.matchId === streamKey }); });
  }
  return out.sort((a, b) => Number(!!b.onStream) - Number(!!a.onStream));
}

/** Écran de diffusion d'un événement : tous ses tournois sur un seul écran, matchs en cours en direct, champions. */
function pEvShow(S: State) {
  const close = `<button data-evshowclose="1" style="position:absolute;top:16px;right:18px;z-index:2;background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text-muted);border-radius:10px;padding:8px 12px;font-weight:700;font-size:12px;cursor:pointer">Fermer</button>`;
  const d = S.evShow;
  if (!d) return `<div style="min-height:100vh;display:grid;place-items:center;color:var(--text-muted)">${close}Chargement de l'événement…</div>`;
  const ev = d.event;
  const accent = evAccent(ev);
  const tourns: Detail[] = ev.tournaments || [];
  const live = tourns.filter((t) => t.live);
  const upcoming = tourns.filter((t) => !t.live && t.status !== "Terminé");
  const done = tourns.filter((t) => t.status === "Terminé");
  const meta = [fmtEventDates(ev), ev.place].filter(Boolean).map(escHtml).join(" · ");
  const liveCard = (t: Detail) => {
    const st = d.states[t.id];
    const ms = st ? evLiveMatches(st).slice(0, 5) : [];
    const streamed = ms.find((m) => m.onStream);
    const phase = st ? (st.finals ? "Phase finale" : "Phase de poules") : "";
    const rows = ms.length
      ? ms.map((m) => `<div style="padding:1.2vh 0;border-top:1px solid var(--surface-4)"><div style="display:flex;align-items:center;justify-content:space-between;gap:1vh;margin-bottom:.5vh"><span style="color:var(--text-muted);font-size:1.3vh;letter-spacing:1.4px;text-transform:uppercase;font-weight:800">${escHtml(m.label)}</span><span style="display:flex;align-items:center;gap:.6vh">${m.onStream ? `<span style="display:inline-flex;align-items:center;gap:.4vh;font-size:1.2vh;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:#fff;background:#F43F7E;border-radius:99px;padding:.3vh 1vh;white-space:nowrap">${ic(I.tv, 10)}Sur le stream</span>` : ""}${m.station ? `<span style="font-size:1.3vh;font-weight:800;color:#04222a;background:${accent};border-radius:99px;padding:.3vh 1vh;white-space:nowrap">${escHtml(m.station)}</span>` : ""}</span></div>
          <div style="display:flex;align-items:baseline;justify-content:center;gap:1.4vw;flex-wrap:wrap"><span style="font-family:'Bebas Neue',sans-serif;font-size:3.6vh;color:${accent};letter-spacing:1px">${escHtml(m.a)}</span><span style="color:var(--text-faint);font-size:1.6vh;font-weight:800">VS</span><span style="font-family:'Bebas Neue',sans-serif;font-size:3.6vh;color:#F43F7E;letter-spacing:1px">${escHtml(m.b)}</span></div></div>`).join("")
      : `<div style="text-align:center;color:var(--text-faint);padding:2vh 0;font-size:1.8vh">${st ? "En attente du prochain match…" : "Chargement…"}</div>`;
    return `<div style="border:1px solid ${streamed ? "#F43F7E" : accent + "55"};border-radius:18px;background:linear-gradient(180deg,rgba(20,20,29,.92),rgba(14,14,22,.92));padding:2.4vh 1.8vw">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:1vw;flex-wrap:wrap"><div style="font-family:'Bebas Neue',sans-serif;font-size:3.4vh;letter-spacing:1.2px;line-height:1">${escHtml(t.name)}</div>${phase ? `<span style="font-size:1.3vh;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#04222a;background:${accent};border-radius:99px;padding:.6vh 1.2vh;white-space:nowrap">${phase}</span>` : ""}</div>
      <div style="color:var(--text-muted);font-size:1.5vh;margin:.6vh 0 1vh">${[t.game, t.format, `${t.players} joueurs`].filter(Boolean).map(escHtml).join(" · ")}</div>${rows}</div>`;
  };
  const pill = (t: Detail, extra = "") => `<span style="display:inline-flex;align-items:center;gap:.8vh;border:1px solid var(--border-strong);background:rgba(20,20,29,.8);border-radius:99px;padding:.9vh 1.6vh;font-size:1.7vh;font-weight:700">${escHtml(t.name)}${extra}</span>`;
  const doneRow = done.length
    ? `<div style="margin-top:3vh;text-align:center"><div style="color:#FBBF24;font-size:1.6vh;letter-spacing:2px;text-transform:uppercase;font-weight:800;margin-bottom:1.2vh">Champions</div>
        <div style="display:flex;gap:1.4vh;justify-content:center;flex-wrap:wrap">${done.map((t) => { const c = d.states[t.id]?.champion; return pill(t, c ? `<span style="color:#FBBF24">· ${escHtml(c)}</span>` : ""); }).join("")}</div></div>` : "";
  const upRow = upcoming.length
    ? `<div style="margin-top:3vh;text-align:center"><div style="color:var(--text-muted);font-size:1.6vh;letter-spacing:2px;text-transform:uppercase;font-weight:800;margin-bottom:1.2vh">À suivre</div>
        <div style="display:flex;gap:1.4vh;justify-content:center;flex-wrap:wrap">${upcoming.map((t) => pill(t, t.date ? `<span style="color:var(--text-muted);font-weight:500">· ${escHtml(t.date)}</span>` : "")).join("")}</div></div>` : "";
  const body = live.length
    ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(440px,92vw),1fr));gap:2vh;margin-top:3vh">${live.map(liveCard).join("")}</div>`
    : `<div style="text-align:center;color:var(--text-muted);font-size:2.2vh;margin-top:6vh">Aucun tournoi en cours pour le moment.</div>`;
  return `${showBackdrop(ev)}<div style="position:relative;z-index:1;min-height:100vh;padding:4vh 3vw;display:flex;flex-direction:column">${close}
    <div style="text-align:center">
      <div style="display:flex;align-items:center;justify-content:center;gap:1.4vh;margin-bottom:1.6vh">${brandLogo(S, 38, 20)}<span style="font-family:'Bebas Neue',sans-serif;font-size:2.6vh;letter-spacing:2.5px;color:var(--text-muted)">${escHtml(S.site?.brand?.name1 || "Miabe Esport")}</span></div>
      <h1 style="font-family:'Bebas Neue',sans-serif;font-size:9vh;letter-spacing:2px;line-height:.95;margin:0;text-shadow:0 6px 40px rgba(0,0,0,.6)">${escHtml(ev.name)}</h1>
      ${ev.tagline ? `<div style="color:#C9CBDC;font-size:2.4vh;margin-top:1.2vh">${escHtml(ev.tagline)}</div>` : ""}
      ${meta ? `<div style="color:${accent};font-size:2vh;font-weight:700;margin-top:1.2vh;letter-spacing:1px">${meta}</div>` : ""}
      ${live.length ? `<div style="display:inline-flex;align-items:center;gap:1vh;margin-top:2vh;color:${accent};font-size:1.8vh;font-weight:800;letter-spacing:2px;text-transform:uppercase"><span style="width:1.1vh;height:1.1vh;border-radius:50%;background:${accent};animation:blink 1.2s infinite"></span>${live.length} tournoi${live.length > 1 ? "s" : ""} en direct</div>` : ""}
    </div>${body}${upRow}${doneRow}</div>`;
}
/** Découpe les matchs actuellement jouables en plusieurs diapositives (Mode Show) au lieu d'en
 * tronquer l'affichage à quelques-uns — sur une LAN à plusieurs postes, chaque match compte (il
 * faut pouvoir repérer sa table). Les diapositives tournent avec les autres (voir showSlide) ; le
 * sous-titre indique la tranche affichée dès qu'il y en a plusieurs. */
function pushLiveMatchSlides(
  slides: { caption: string; body: string }[],
  playable: { aName: string; bName: string; label?: string; station?: string; onStream?: boolean }[],
  singleLabel: string,
  chunkSize = 4,
) {
  if (!playable.length) return;
  // Le match "à l'antenne" passe en tête (donc dans la première diapositive) plutôt que d'atterrir
  // au hasard dans une tranche tardive — showMatchesFocus le re-signale déjà en tête de sa tranche.
  const sorted = [...playable].sort((a, b) => Number(!!b.onStream) - Number(!!a.onStream));
  if (sorted.length <= chunkSize) {
    slides.push({ caption: sorted.length > 1 ? `${sorted.length} matchs en direct` : singleLabel, body: showMatchesFocus(sorted) });
    return;
  }
  for (let i = 0; i < sorted.length; i += chunkSize) {
    const part = sorted.slice(i, i + chunkSize);
    slides.push({ caption: `Matchs en direct (${i + 1}-${i + part.length}/${sorted.length})`, body: showMatchesFocus(part) });
  }
}
function pShowInner(S: State) {
  const t = S.detail;
  const close = `<button data-showclose="1" style="position:absolute;top:16px;right:18px;background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text-muted);border-radius:10px;padding:8px 12px;font-weight:700;font-size:12px;cursor:pointer;z-index:5">Fermer</button>`;
  const brand0 = `<div style="display:flex;align-items:center;justify-content:center;gap:1.4vh;margin-bottom:2vh">${brandLogo(S, 38, 20)}<span style="font-family:'Bebas Neue',sans-serif;font-size:3vh;letter-spacing:2.5px;color:var(--text-muted)">${escHtml(S.site?.brand?.name1 ?? "Miabe")} <span style="color:#22D3EE">${escHtml(S.site?.brand?.name2 ?? "ESPORT")}</span></span></div>`;
  // Tournoi rattaché à un événement : le Mode Show l'annonce (et reprend sa couverture en fond, voir pShow).
  const showEv = t?.event as Detail | null | undefined;
  const evAcc = showEv ? evAccent(showEv) : "#22D3EE";
  const eventLine = showEv
    ? `<div style="text-align:center;margin:-0.6vh 0 2.4vh"><span style="display:inline-flex;align-items:center;gap:1vh;font-size:1.9vh;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:${evAcc};border:1px solid ${evAcc}66;background:${evAcc}14;border-radius:99px;padding:.9vh 2vh">Événement · ${escHtml(showEv.name)}</span>${showEv.tagline ? `<div style="color:#A6A8BC;font-size:1.8vh;margin-top:1vh">${escHtml(showEv.tagline)}</div>` : ""}</div>`
    : "";
  const brand = brand0 + eventLine;
  if (!t) return `<div style="min-height:100vh;display:grid;place-items:center;color:var(--text-muted)">${close}Chargement de l'affichage…</div>`;
  if (t.status === "finished" && t.champion) {
    return `<div style="min-height:100vh;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:4vh 3vw;position:relative">${close}${brand}
      <div style="text-align:center"><div style="display:inline-flex;align-items:center;gap:1vh;color:#FBBF24;font-size:2vh;letter-spacing:2px;text-transform:uppercase;font-weight:800">${ic(I.crown, 22)} Champion du tournoi</div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:14vh;line-height:.9;color:#22D3EE;letter-spacing:1px;margin-top:1vh">${t.champion}</div>
      <div style="color:var(--text-muted);font-size:2.4vh;margin-top:1vh">${t.name}</div></div></div>`;
  }

  // Construit les diapositives disponibles pour l'état actuel (format + phase) — tournent automatiquement.
  type Slide = { caption: string; body: string };
  const slides: Slide[] = [];
  let phaseLabel = "";
  // Carte de poule (style Mode Show) — partagée par la phase de poules (Survival, avant finale) et
  // par la grande poule de la phase finale en mode Survival (voir Engine.startFinalsSurvivalPool).
  const poolCard = (p: Detail) => {
    let match: string;
    const station: string | undefined = t.stations?.[p.id];
    const onStream = p.id === t.streamMatchKey;
    const badges = p.current && (station || onStream) ? `<div style="display:flex;align-items:center;justify-content:center;gap:1vh;margin-bottom:1vh">
      ${onStream ? `<span style="display:inline-flex;align-items:center;gap:.5vh;font-size:1.3vh;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:#fff;background:#F43F7E;border-radius:99px;padding:.4vh 1.2vh">${ic(I.tv, 11)}À l'antenne</span>` : ""}
      ${station ? `<span style="font-size:1.3vh;font-weight:800;color:#04222a;background:#22D3EE;border-radius:99px;padding:.4vh 1.2vh">${escHtml(station)}</span>` : ""}
    </div>` : "";
    if (p.current) {
      match = `${badges}<div style="display:flex;align-items:center;justify-content:center;gap:2.2vw;flex-wrap:wrap"><div style="text-align:center"><div style="color:#22D3EE;font-size:1.4vh;font-weight:800;text-transform:uppercase;letter-spacing:1px">Survivant${p.current.streak > 1 ? " · série " + p.current.streak : ""}</div><div style="font-family:'Bebas Neue',sans-serif;font-size:5.5vh;color:#22D3EE;line-height:1;margin-top:.4vh">${p.current.aName}</div></div><div style="font-family:'Bebas Neue',sans-serif;font-size:3.4vh;color:var(--text-faint)">VS</div><div style="text-align:center"><div style="color:#F43F7E;font-size:1.4vh;font-weight:800;text-transform:uppercase;letter-spacing:1px">Challenger</div><div style="font-family:'Bebas Neue',sans-serif;font-size:5.5vh;color:#F43F7E;line-height:1;margin-top:.4vh">${p.current.bName}</div></div></div>`;
    } else if (p.done) {
      match = `<div style="text-align:center;color:#34D399;font-weight:700;font-size:2vh;padding:1vh 0">Qualifiés : ${(Array.isArray(p.qualified) && p.qualified.length ? p.qualified.map((q: Detail) => q.name) : [p.top1, p.top2].filter(Boolean)).join(", ")}</div>`;
    } else match = `<div style="text-align:center;color:var(--text-faint);padding:1vh 0">En attente du lancement…</div>`;
    const lead = p.ranking?.[0] ? `<div style="text-align:center;color:var(--text-muted);font-size:1.5vh;margin-top:1.4vh">Leader : <b style="color:var(--text)">${p.ranking[0].name}</b> · ${p.ranking[0].pts} pts</div>` : "";
    return `<div style="border:1px solid ${onStream ? "#F43F7E" : "var(--border)"};border-radius:18px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:2.6vh 2vw"><div style="font-family:'Bebas Neue',sans-serif;font-size:2.4vh;letter-spacing:1.5px;text-align:center;margin-bottom:1.6vh;color:var(--text-muted)">${p.name}</div>${match}${lead}</div>`;
  };
  if (!t.finals) {
    // Survival, poules en cours.
    phaseLabel = "Phase 1 · poules";
    const grid = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(440px,92vw),1fr));gap:2vh;margin-top:2.4vh">${(t.pools || []).map(poolCard).join("")}</div>`;
    slides.push({ caption: "Poules en direct", body: grid });
    const overall: Detail[] = ([] as Detail[]).concat(...(t.pools || []).map((p: Detail) => p.ranking || [])).sort((a: Detail, b: Detail) => b.pts - a.pts || b.wins - a.wins);
    if (overall.some((r) => r.pts > 0)) slides.push({ caption: "Classement général", body: showStandingsTable(overall.slice(0, 8), "Pts") });
  } else if (t.finals.format === "survival") {
    // Grande poule finale (voir Engine.startFinalsSurvivalPool) : t.pools[0] réunit tous les
    // qualifiés — même carte que la phase de poules, un seul slide puisqu'il n'y a qu'une poule.
    phaseLabel = "Phase finale · Survival";
    const p = t.pools[0];
    if (p) {
      slides.push({ caption: "Grande finale", body: poolCard(p) });
      if (p.ranking?.some((r: Detail) => r.pts > 0)) slides.push({ caption: "Classement", body: showStandingsTable(p.ranking.slice(0, 8), "Pts") });
    }
  } else if (t.finals.format === "battle_royale") {
    phaseLabel = "Battle Royale";
    slides.push({ caption: "Classement cumulé", body: showStandingsTable(t.finals.standings.slice(0, 8), "Pts") });
    slides.push({ caption: "Parties", body: showBRSlide(t.finals) });
  } else if (t.finals.format === "roundrobin" || t.finals.format === "swiss") {
    phaseLabel = t.finals.format === "swiss" ? `Swiss · ronde ${t.finals.rounds.length}/${t.finals.roundCount}` : "Round Robin";
    slides.push({ caption: "Classement", body: showStandingsTable(t.finals.standings.slice(0, 8), "Pts") });
    const playable = finalsMatchGroups(t.finals).flat().filter((m): m is Detail => !!m && m.playable)
      .map((m: Detail) => ({ aName: m.aName, bName: m.bName, station: t.stations?.[m.matchId], onStream: m.matchId === t.streamMatchKey }));
    pushLiveMatchSlides(slides, playable, "Match en direct");
    const played = finalsMatchGroups(t.finals).flat().filter((m): m is Detail => !!m && !!m.winnerId).slice(-4).reverse();
    if (played.length) slides.push({ caption: "Derniers résultats", body: showRecentResults(played) });
  } else if (t.finals.format === "double") {
    // Bracket vainqueurs et bracket perdants avancent réellement en parallèle (voir
    // Engine.buildDoubleElim, régie : getActiveMatches) : on montre TOUS les duels actuellement
    // jouables des deux côtés à la fois, pas seulement trois au hasard de l'ordre de construction —
    // sinon un round à plusieurs matchs simultanés côté vainqueurs pouvait masquer entièrement le
    // seul match en cours côté perdants (et inversement).
    phaseLabel = "Double élimination";
    // finalsLabelledMatches distingue déjà vainqueurs/perdants dans le libellé (ex. "Winners ·
    // Demi-finales" vs "Perdants · Round 2") : conservé tel quel, pas besoin de le recalculer.
    const playable = finalsLabelledMatches(t.finals).filter((x) => x.m.playable)
      .map((x) => ({ aName: x.m.aName, bName: x.m.bName, label: x.label, station: t.stations?.[x.m.matchId], onStream: x.m.matchId === t.streamMatchKey }));
    pushLiveMatchSlides(slides, playable, "Phase finale");
    const played = finalsMatchGroups(t.finals).flat().filter((m): m is Detail => !!m && !!m.winnerId && !m.bye).slice(-4).reverse();
    if (played.length) slides.push({ caption: "Derniers résultats", body: showRecentResults(played) });
  } else {
    // single élimination : un seul bracket — tous les matchs jouables défilent (voir
    // pushLiveMatchSlides), les plus tardifs dans l'arbre (donc les plus décisifs) en premier.
    phaseLabel = "Élimination simple";
    const playable = finalsLabelledMatches(t.finals).filter((x) => x.m.playable).reverse()
      .map((x) => ({ aName: x.m.aName, bName: x.m.bName, label: x.label, station: t.stations?.[x.m.matchId], onStream: x.m.matchId === t.streamMatchKey }));
    pushLiveMatchSlides(slides, playable, "Phase finale");
    const played = finalsMatchGroups(t.finals).flat().filter((m): m is Detail => !!m && !!m.winnerId && !m.bye).slice(-4).reverse();
    if (played.length) slides.push({ caption: "Derniers résultats", body: showRecentResults(played) });
  }
  if (!slides.length) slides.push({ caption: "", body: `<div style="text-align:center;color:var(--text-faint);font-size:2.2vh;margin-top:3vh">En attente…</div>` });
  const idx = ((S.showSlide % slides.length) + slides.length) % slides.length;
  const active = slides[idx];
  const dots = slides.length > 1 ? `<div style="display:flex;gap:.9vh;justify-content:center;margin-top:4vh">${slides.map((_, i) => `<span style="display:inline-block;width:${i === idx ? "2.6vh" : "1vh"};height:.6vh;border-radius:99px;background:${i === idx ? "#22D3EE" : "var(--border-strong)"};transition:width .3s"></span>`).join("")}</div>` : "";

  // Format des manches (Bo3, Ft10…) — n'a pas de sens en Battle Royale (pas de duels 1 contre 1).
  const formatBadge = t.matchFormatLabel && t.finals?.format !== "battle_royale" ? ` · ${t.matchFormatLabel}` : "";
  const title = `<div style="text-align:center;margin-bottom:1vh"><div style="font-family:'Bebas Neue',sans-serif;font-size:5.5vh;letter-spacing:2px;line-height:1">${escHtml(t.name)}</div>
    <div style="display:inline-flex;align-items:center;gap:.8vh;color:${t.status === "live" ? "#22D3EE" : "var(--text-muted)"};font-weight:800;letter-spacing:2px;font-size:1.7vh;text-transform:uppercase;margin-top:1vh">${t.status === "live" ? `<span style="width:1vh;height:1vh;border-radius:50%;background:#22D3EE;animation:blink 1.2s infinite"></span>` : ""}${phaseLabel}${escHtml(formatBadge)}</div></div>`;
  const caption = active.caption ? `<div style="text-align:center;color:var(--text-faint);font-size:1.6vh;letter-spacing:1.5px;text-transform:uppercase;font-weight:750;margin-top:2.4vh">${escHtml(active.caption)}</div>` : "";
  return `<div style="min-height:100vh;padding:4vh 3vw 6vh;position:relative;display:flex;flex-direction:column;justify-content:center">${close}${brand}${title}
    <div class="slidein">${caption}${active.body}</div>
    ${dots}</div>`;
}

/**
 * Emplacement publicitaire : carrousel compact et animé (pas une bannière étirée
 * sur toute la largeur). Affiche les pubs ciblant cette page (ou « toutes les
 * pages ») ; s'il y en a plusieurs, elles tournent automatiquement avec des
 * puces de navigation. L'image reste toujours visible en entier (object-fit:contain).
 */
/** Bannière sponsorisée : section pleine largeur au style cohérent avec le reste du site, placée en fin de page (jamais coincée entre deux blocs de contenu). */
function adCarousel(S: State, pageKey: string) {
  const all: Detail[] = S.site?.ads ?? [];
  const items = all.filter((a) => a.imageUrl && (a.page === pageKey || a.page === "toutes"));
  if (!items.length) return "";
  const idx = items.length > 1 ? ((S.adSlide % items.length) + items.length) % items.length : 0;
  const ad = items[idx];
  const label = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px"><span style="width:5px;height:22px;border-radius:3px;background:var(--text-faint);display:inline-block"></span><h3 style="margin:0;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-muted);font-weight:750">Contenu sponsorisé</h3></div>`;
  const inner = `<div class="slidein" style="display:flex;align-items:center;gap:26px;padding:20px 24px;flex-wrap:wrap">
    <div style="flex:none;width:180px;height:104px;border-radius:12px;overflow:hidden;background:var(--bg);display:flex;align-items:center;justify-content:center">
      <img src="${mediaUrl(ad.imageUrl)}" alt="${escAttr(ad.label || "Publicité")}" style="max-width:100%;max-height:100%;object-fit:contain" />
    </div>
    <div style="flex:1;min-width:200px">
      <div style="font-weight:750;font-size:16px">${ad.label ? escHtml(ad.label) : "Un partenaire Miabe Esport"}</div>
      <div style="font-size:12.5px;color:var(--text-faint);margin-top:4px">Cet emplacement soutient l'organisation des tournois Miabe.</div>
    </div>
    ${ad.linkUrl ? `<span style="flex:none;display:inline-flex;align-items:center;gap:7px;background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:11px;padding:11px 18px;font-weight:700;font-size:13.5px">Découvrir ${ic(I.arrow, 15)}</span>` : ""}
  </div>`;
  const card = `<div class="hcard" style="border:1px solid var(--border);border-radius:16px;overflow:hidden;background:linear-gradient(90deg,var(--surface),var(--surface-2))">${inner}</div>`;
  const clickable = ad.linkUrl ? `<a href="${escAttr(ad.linkUrl)}" target="_blank" rel="noopener sponsored" style="display:block;text-decoration:none;color:inherit">${card}</a>` : card;
  const dots = items.length > 1
    ? `<div style="display:flex;gap:6px;justify-content:center;margin-top:12px">${items.map((_, i) => `<span data-adslide="${i}" style="display:inline-block;width:${i === idx ? 18 : 7}px;height:6px;border-radius:99px;background:${i === idx ? "#7C82FF" : "var(--border-strong)"};cursor:pointer;transition:width .2s"></span>`).join("")}</div>`
    : "";
  return `<section style="margin:0 0 44px">${label}${clickable}${dots}</section>`;
}

/** Bandeau permanent des partenaires — présent sur toutes les pages, sous l'en-tête. */
function partnersMarquee(S: State) {
  const partners = normPartners(S);
  if (!partners.length) return "";
  const items = partners.map((p) => {
    const showLogo = !!p.logoUrl && p.display !== "name";
    const showName = p.display !== "logo" || !p.logoUrl;
    const icon = showLogo ? `<span style="display:inline-flex;align-items:center;justify-content:center;flex:none;height:50px;padding:7px 16px;border-radius:12px;background:#F4F5FB"><img src="${mediaUrl(p.logoUrl)}" alt="${showName ? "" : escAttr(p.name)}" style="height:36px;width:auto;max-width:140px;object-fit:contain" /></span>` : p.display === "name" ? "" : ic(I.crown, 16);
    return `<span style="display:inline-flex;align-items:center;gap:12px;margin:0 22px;font-size:14px;font-weight:700;color:#A6A8BC;letter-spacing:.4px" title="${escAttr(p.name)}">${icon}${showName ? escHtml(p.name) : ""}</span>`;
  }).join("");
  return `<div class="marquee" style="border-bottom:1px solid var(--surface-3);background:var(--bg);padding:12px 0"><div class="marquee-track">${items}${items}</div></div>`;
}

/** Pages du module contenu : shell rail (barre live + rail d'icônes) au lieu du header public. */
/* ================= Check-in (billet QR + pointage) ================= */
/** QR code en SVG (noir sur blanc, zone de silence comprise) — généré côté navigateur, rien n'est envoyé à un tiers. */
function qrSvg(text: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
}

/** Billet du joueur inscrit (paiement confirmé) : QR à présenter à l'arrivée + code court de secours. */
function ticketCard(t: Detail, reg: { regId?: string; code?: string; checkedIn?: boolean }): string {
  if (!reg.regId || t.status === "finished") return "";
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = `${origin}/tournois/${t.id}#ci=${t.id}.${reg.regId}`;
  return `<div style="width:100%;max-width:320px;border:1px solid ${reg.checkedIn ? "rgba(52,211,153,.45)" : "var(--border)"};border-radius:16px;background:var(--surface);padding:16px;text-align:center">
    <div style="font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:var(--text-muted);font-weight:800;margin-bottom:12px">Ton billet</div>
    <div style="display:inline-block;background:#fff;border-radius:14px;padding:12px;line-height:0"><div style="width:190px;height:190px">${qrSvg(url)}</div></div>
    <div style="font-family:'JetBrains Mono',monospace;font-size:22px;font-weight:700;letter-spacing:4px;margin-top:12px">${escHtml(reg.code || "")}</div>
    <div style="font-size:12.5px;margin-top:8px;color:${reg.checkedIn ? "#34D399" : "var(--text-muted)"};font-weight:${reg.checkedIn ? 750 : 500};line-height:1.5">${reg.checkedIn ? "✓ Présence confirmée" : "Présente ce QR code (ou le code) à l'organisateur à ton arrivée."}</div>
  </div>`;
}

/** Pointage des présences (organisateur/admin) : compteur, scanner, et liste des joueurs à pointer à la main. */
function checkinPanel(S: State, t: Detail): string {
  const regs: Detail[] = (S.regsPanel ?? []).filter((r: Detail) => r.paymentStatus === "paid");
  if (!regs.length || t.status === "finished") return "";
  const here = regs.filter((r: Detail) => r.checkedIn).length;
  const sorted = [...regs].sort((a: Detail, b: Detail) => Number(!!a.checkedIn) - Number(!!b.checkedIn) || String(a.playerName).localeCompare(String(b.playerName)));
  const rows = sorted.map((r: Detail) => `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--surface-4)">
    <div style="min-width:0;flex:1"><div style="font-weight:650;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(r.playerName)}</div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text-faint);letter-spacing:1.5px">${escHtml(r.code || "")}</div></div>
    ${r.checkedIn
      ? `<span style="font-size:10.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#34D399;background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.35);border-radius:99px;padding:4px 10px;white-space:nowrap">Présent</span>${btnSm(`data-checkin="${t.id}|${r.id}|0"`, "Annuler")}`
      : btnSm(`data-checkin="${t.id}|${r.id}|1"`, "Marquer présent", "#22D3EE", "rgba(34,211,238,.35)")}
  </div>`).join("");
  return `<div style="border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:20px;margin-top:18px;text-align:left">
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px">
      <h3 style="margin:0;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-muted);font-weight:750">Présences</h3>
      <span style="font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:${here === regs.length ? "#34D399" : "var(--text)"}">${here} / ${regs.length}</span>
      <span style="flex:1"></span>
      <button data-scanopen="1" style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:10px;padding:9px 14px;font-weight:750;font-size:13px;cursor:pointer">${ic(I.search, 14)}Scanner les billets</button>
    </div>
    <p style="margin:0 0 6px;font-size:12px;color:var(--text-faint);line-height:1.55">Chaque joueur inscrit et payé a un billet QR sur la page du tournoi. Scanne-le ici (ou avec l'appareil photo du téléphone), ou pointe-le à la main.</p>
    ${rows}</div>`;
}

/* ================= Événements ================= */
/** Rôle du compte connecté, lu du navigateur : fiable même dans un écouteur enregistré au démarrage (dont l'état React est périmé). */
function storedRole(): string | undefined {
  try { return JSON.parse(localStorage.getItem("vlome_user") || "null")?.role; } catch { return undefined; }
}
const isVideoUrl = (u?: string | null) => !!u && /\.(mp4|webm)(\?|$)/i.test(u);
const evAccent = (ev: Detail) => (/^#[0-9a-f]{6}$/i.test(ev?.accentColor || "") ? ev.accentColor : "#22D3EE");
const EVENT_STATE: Record<string, [string, string]> = { live: ["En direct", "#22D3EE"], upcoming: ["À venir", "#FBBF24"], ended: ["Terminé", "var(--text-muted)"] };

function fmtEventDates(ev: Detail): string {
  const f = (iso: string, withYear: boolean) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
  if (!ev.startDate) return "";
  if (!ev.endDate || ev.endDate.slice(0, 10) === ev.startDate.slice(0, 10)) return f(ev.startDate, true);
  return `${f(ev.startDate, false)} → ${f(ev.endDate, true)}`;
}

/** Visuel d'un événement : bannière animée (vidéo/GIF/image), sinon l'affiche, sinon un dégradé à la couleur de l'événement. */
function eventMedia(ev: Detail, alt: string, mode: "hero" | "card" = "hero"): string {
  const accent = evAccent(ev);
  const fallback = `background:radial-gradient(120% 140% at 15% 0%,${accent}55,transparent 60%),linear-gradient(135deg,${accent}22,#7C82FF1A)`;
  if (isVideoUrl(ev.bannerUrl)) {
    return `<video src="${mediaUrl(ev.bannerUrl)}" ${ev.posterUrl ? `poster="${mediaUrl(ev.posterUrl)}"` : ""} muted autoplay loop playsinline preload="metadata" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>`;
  }
  if (ev.bannerUrl) return `<img src="${mediaUrl(ev.bannerUrl)}" alt="${escAttr(alt)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" />`;
  // Sans bannière : dégradé à la couleur de l'événement ; sur une carte, l'affiche entière est posée dessus (sur la page, elle a son propre cadre).
  const poster = mode === "card" && ev.posterUrl ? `<img src="${mediaUrl(ev.posterUrl)}" alt="${escAttr(alt)}" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);height:88%;width:auto;max-width:80%;object-fit:contain;border-radius:8px;box-shadow:0 12px 34px rgba(0,0,0,.5)" />` : "";
  return `<div style="position:absolute;inset:0;${fallback}"></div>${poster}`;
}

function eventStateBadge(ev: Detail, big = false): string {
  const [label, color] = EVENT_STATE[ev.state] || EVENT_STATE.upcoming;
  const live = ev.state === "live";
  return `<span style="display:inline-flex;align-items:center;gap:6px;flex:none;white-space:nowrap;font-size:${big ? 12 : 10.5}px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase;color:${live ? "#04222a" : color};background:${live ? color : "rgba(11,11,17,.72)"};border:1px solid ${live ? color : color + "66"};border-radius:99px;padding:${big ? "6px 12px" : "4px 9px"};backdrop-filter:blur(6px)">${live ? `<span style="width:6px;height:6px;border-radius:50%;background:#04222a;animation:blink 1.2s infinite"></span>` : ""}${label}</span>`;
}

function eventCard(ev: Detail): string {
  const accent = evAccent(ev);
  const meta = [fmtEventDates(ev), ev.place].filter(Boolean).map(escHtml).join(" · ");
  const count = `${ev.tournamentCount} tournoi${ev.tournamentCount > 1 ? "s" : ""}${ev.liveCount ? ` · ${ev.liveCount} en direct` : ""}`;
  return `<div data-openevent="${ev.id}" class="hcard" style="border:1px solid var(--border);border-radius:16px;overflow:hidden;cursor:pointer;background:linear-gradient(180deg,var(--surface),var(--surface-2))">
    <div class="zoom" style="position:relative;height:170px;overflow:hidden;background:var(--surface-2)">${eventMedia(ev, ev.name, "card")}
      <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(11,11,17,.05) 30%,rgba(11,11,17,.8))"></div>
      <div style="position:absolute;left:14px;top:13px">${eventStateBadge(ev)}</div>
      ${ev.posterUrl && ev.bannerUrl ? `<img src="${mediaUrl(ev.posterUrl)}" alt="" style="position:absolute;right:14px;bottom:-22px;width:70px;height:96px;object-fit:cover;border-radius:8px;border:2px solid var(--surface);box-shadow:0 10px 30px rgba(0,0,0,.55)" />` : ""}
    </div>
    <div style="padding:16px 16px 18px">
      <h4 style="margin:0 0 4px;font-size:19px;line-height:1.2;color:var(--text)">${escHtml(ev.name)}</h4>
      ${ev.tagline ? `<div style="color:#A6A8BC;font-size:13px;margin-bottom:8px;line-height:1.45">${escHtml(ev.tagline)}</div>` : ""}
      <div style="color:var(--text-muted);font-size:12.5px;line-height:1.7">${meta || "Dates à venir"}</div>
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);font-size:12.5px;font-weight:700;color:${accent}">${count}</div>
    </div></div>`;
}

/** Page publique « Événements » : tous les événements publiés, en direct d'abord. */
function pEvenements(S: State) {
  const list = S.events;
  const manage = canManage(S);
  const head = railPageHead("Événements", "Compétitions, LAN et rendez-vous de la communauté : chaque événement regroupe un ou plusieurs tournois, parfois en même temps.",
    manage ? `<button data-evlist="1" style="display:inline-flex;align-items:center;gap:8px;background:#22D3EE;color:#04222a;border:0;border-radius:10px;padding:12px 18px;font-weight:750;font-size:14px;cursor:pointer">${ic(I.plus, 16)}Gérer mes événements</button>` : "");
  const body = list === null
    ? `<div style="color:var(--text-muted);text-align:center;padding:60px 0">Chargement des événements…</div>`
    : list.length
      ? `<div class="page-hpad" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:22px;padding:8px 44px 44px">${list.map(eventCard).join("")}</div>`
      : `<div style="color:var(--text-faint);text-align:center;padding:60px 20px;font-size:14px">Aucun événement pour le moment. Reviens bientôt !</div>`;
  return head + body;
}

/** Page d'un événement : bannière animée, affiche, infos et tournois (plusieurs peuvent être en direct en même temps). */
function pEvenement(S: State) {
  const ev = S.eventDetail;
  if (!ev) return `<div style="color:var(--text-muted);text-align:center;padding:80px 0">Chargement de l'événement…</div>`;
  const accent = evAccent(ev);
  const isOwner = !!S.user && canManage(S) && (S.user.role === "ADMIN" || ev.createdById === (S.me?.id ?? S.user?.id));
  const tournaments: TournCard[] = ev.tournaments ?? [];
  const live = tournaments.filter((t) => t.live);
  const meta = [fmtEventDates(ev), ev.place].filter(Boolean);
  const chips = meta.map((m, i) => `<span style="display:inline-flex;align-items:center;gap:7px;font-size:13.5px;font-weight:600;color:#E8E9F4;background:rgba(11,11,17,.6);border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:8px 13px;backdrop-filter:blur(6px)">${escHtml(m)}</span>`).join("");
  const showBtn = `<button data-evshow="${ev.id}" style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,rgba(34,211,238,.14),rgba(124,130,255,.14));border:1px solid #22D3EE66;color:#22D3EE;border-radius:10px;padding:10px 16px;font-weight:700;font-size:13.5px;cursor:pointer">${ic(I.tv, 15)}Écran de diffusion</button>`;
  const shareEvBtn = `<button data-share="evenement|${ev.id}" style="display:inline-flex;align-items:center;gap:8px;background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:10px;padding:10px 16px;font-weight:700;font-size:13.5px;cursor:pointer">${ic(I.share, 15)}Partager</button>`;
  const actions = isOwner
    ? `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">${shareEvBtn}${showBtn}
        <button data-evedit="${ev.id}" style="display:inline-flex;align-items:center;gap:8px;background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:10px;padding:10px 16px;font-weight:700;font-size:13.5px;cursor:pointer">${ic(I.edit, 15)}Gérer l'événement</button>
        <button data-act="create-open" data-evid="${ev.id}" style="display:inline-flex;align-items:center;gap:8px;background:${accent};color:#04222a;border:0;border-radius:10px;padding:10px 16px;font-weight:750;font-size:13.5px;cursor:pointer">${ic(I.plus, 15)}Créer un tournoi ici</button>
        ${ev.status !== "PUBLISHED" ? `<span style="align-self:center;font-size:12px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#FBBF24">Brouillon — non visible du public</span>` : ""}
      </div>`
    : `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">${shareEvBtn}${tournaments.length ? showBtn : ""}</div>`;
  // Bandeau sombre : seulement s'il y a une vraie bannière (photo/vidéo) à assombrir pour la légende —
  // sans bannière, le dégradé de couleur de l'événement suffit et le texte suit alors le thème du site.
  const heroHasCover = !!ev.bannerUrl;
  const heroTitleColor = heroHasCover ? "#fff" : "var(--text)";
  const heroTaglineColor = heroHasCover ? "#D2D4E4" : "var(--text-muted)";
  const hero = `<div style="position:relative;overflow:hidden;min-height:clamp(280px,38vw,440px);background:var(--surface-2);border-bottom:1px solid var(--border)">
    ${eventMedia(ev, ev.name)}
    ${heroHasCover ? `<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(11,11,17,.25) 0%,rgba(11,11,17,.55) 55%,#0B0B11 100%)"></div>` : ""}
    <div class="page-hpad" style="position:relative;display:flex;align-items:flex-end;gap:28px;padding:44px 44px 34px;min-height:clamp(280px,38vw,440px)">
      <div style="flex:1;min-width:0">
        <button data-go="evenements" style="background:rgba(11,11,17,.6);border:1px solid rgba(255,255,255,.16);color:#E8E9F4;border-radius:9px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;margin-bottom:18px;backdrop-filter:blur(6px)">← Événements</button>
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;margin-bottom:12px">${eventStateBadge(ev, true)}${ev.liveCount ? `<span style="font-size:12.5px;font-weight:700;color:${accent};white-space:nowrap">${ev.liveCount} tournoi${ev.liveCount > 1 ? "s" : ""} en direct</span>` : ""}</div>
        <h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(30px,8.2vw,84px);letter-spacing:1.2px;margin:0;line-height:.96;text-wrap:balance;overflow-wrap:break-word;color:${heroTitleColor};${heroHasCover ? "text-shadow:0 6px 40px rgba(0,0,0,.6)" : ""}">${escHtml(ev.name)}</h1>
        ${ev.tagline ? `<p style="color:${heroTaglineColor};font-size:clamp(15px,1.6vw,19px);margin:12px 0 0;max-width:720px;line-height:1.5">${escHtml(ev.tagline)}</p>` : ""}
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px">${chips}</div>
      </div>
      ${ev.posterUrl ? `<img class="ev-poster" src="${mediaUrl(ev.posterUrl)}" alt="Affiche ${escAttr(ev.name)}" style="flex:none;width:clamp(120px,15vw,200px);border-radius:12px;border:2px solid ${accent}55;box-shadow:0 20px 60px rgba(0,0,0,.6),0 0 40px ${accent}22" />` : ""}
    </div></div>`;
  const desc = ev.description
    ? `<div style="border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:22px 24px;margin-bottom:26px"><div style="font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:var(--text-muted);font-weight:800;margin-bottom:10px">À propos</div><div style="color:#C9CBDC;font-size:14.5px;line-height:1.75;white-space:pre-line">${escHtml(ev.description)}</div></div>` : "";
  const liveBox = live.length > 1
    ? `<div style="display:flex;align-items:center;gap:12px;border:1px solid ${accent}55;background:${accent}12;border-radius:12px;padding:12px 16px;margin-bottom:22px"><span style="width:8px;height:8px;border-radius:50%;background:${accent};animation:blink 1.2s infinite"></span><span style="font-size:13.5px;color:#E8E9F4"><b>${live.length} tournois se jouent en ce moment</b> — ${live.map((t) => escHtml(t.name)).join(" · ")}</span></div>` : "";
  const grid = tournaments.length
    ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:18px">${tournaments.map((t) => tournCard(t, false)).join("")}</div>`
    : `<div style="color:var(--text-faint);font-size:14px;padding:26px 0">Les tournois de cet événement seront annoncés bientôt.</div>`;
  // Classement cumulé (circuit) : toutes les étapes déjà jouées de l'événement confondues — n'apparaît
  // qu'une fois chargé (voir openEvent, chargé seulement à partir de 2 tournois rattachés).
  const standings: Detail[] = S.eventStandings || [];
  const standingsByGame = new Map<string, Detail[]>();
  for (const r of standings) { const g = r.game || "Autre"; if (!standingsByGame.has(g)) standingsByGame.set(g, []); standingsByGame.get(g)!.push(r); }
  const standingsBlock = standingsByGame.size ? `<div style="margin-bottom:26px">
    <h2 style="font-family:'Bebas Neue',sans-serif;font-size:28px;letter-spacing:1.2px;margin:0 0 6px">Classement du circuit</h2>
    <p style="color:var(--text-muted);font-size:13px;margin:0 0 16px">Résultats cumulés sur toutes les étapes de cet événement déjà jouées.</p>
    <div style="display:flex;flex-direction:column;gap:22px">${Array.from(standingsByGame.entries()).map(([game, rows]) => `<div>
      ${standingsByGame.size > 1 ? `<div style="font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:${accent};margin-bottom:8px">${escHtml(game)}</div>` : ""}
      ${gameLeaderboardBlock(rows, { podium: false, limit: 10 })}
    </div>`).join("")}</div>
  </div>` : "";
  const wizard = S.creating && canManage(S) ? tournamentWizard(S) : "";
  return wizard + hero + `<div class="page-hpad" style="padding:26px 44px 50px">${actions}${desc}${liveBox}${standingsBlock}
    <h2 style="font-family:'Bebas Neue',sans-serif;font-size:32px;letter-spacing:1.2px;margin:0 0 16px">Tournois de l'événement <span style="color:var(--text-faint);font-size:20px">${tournaments.length}</span></h2>${grid}</div>`;
}

/** Console (organisateur/admin) : liste des événements, éditeur et tournois rattachés. */
function consoleEvents(S: State) {
  const list = S.myEvents;
  const ed = S.eventEdit;
  const lbl = "font-size:12px;color:var(--text-muted);font-weight:600";
  const inp = "width:100%;margin-top:6px;background:var(--surface-3);border:1px solid var(--border);border-radius:10px;color:var(--text);font-family:inherit;font-size:14px;padding:11px 13px";
  const thumb = (ev: Detail) => {
    const src = ev.posterUrl || (!isVideoUrl(ev.bannerUrl) ? ev.bannerUrl : null);
    return `<span style="display:grid;place-items:center;width:64px;height:80px;border-radius:10px;overflow:hidden;flex:none;background:${src ? `url('${mediaUrl(src)}') center/cover` : `linear-gradient(135deg,${evAccent(ev)}44,#7C82FF33)`};border:1px solid var(--border);color:var(--text-faint)">${src ? "" : ic(I.crown, 18)}</span>`;
  };
  const rows = list === null
    ? `<div style="color:var(--text-muted);text-align:center;padding:24px 0">Chargement…</div>`
    : list.length
      ? list.map((ev: Detail) => {
          const [stLabel, stColor] = EVENT_STATE[ev.state] || EVENT_STATE.upcoming;
          return `<div style="display:flex;align-items:center;gap:14px;padding:12px 0;border-top:1px solid var(--surface-4);flex-wrap:wrap">
            ${thumb(ev)}
            <div style="flex:1;min-width:200px"><div style="font-weight:700;font-size:15px">${escHtml(ev.name)}</div>
              <div style="font-size:12.5px;color:var(--text-muted);margin-top:3px">${[fmtEventDates(ev), ev.place, `${ev.tournamentCount} tournoi${ev.tournamentCount > 1 ? "s" : ""}`].filter(Boolean).map(escHtml).join(" · ")}</div></div>
            <span style="white-space:nowrap;font-size:10.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:${stColor};border:1px solid ${stColor}55;border-radius:99px;padding:4px 9px">${stLabel}</span>
            <span style="white-space:nowrap;font-size:10.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:${ev.status === "PUBLISHED" ? "#34D399" : "#FBBF24"};border:1px solid ${ev.status === "PUBLISHED" ? "rgba(52,211,153,.4)" : "rgba(251,191,36,.4)"};border-radius:99px;padding:4px 9px">${ev.status === "PUBLISHED" ? "Publié" : "Brouillon"}</span>
            <div style="display:flex;gap:8px">${btnSm(`data-openevent="${ev.id}"`, "Voir")}${btnSm(`data-evedit="${ev.id}"`, "Modifier", "#22D3EE", "rgba(34,211,238,.35)")}${btnSm(`data-evdel="${ev.id}"`, "Supprimer", "#FB7185", "rgba(251,113,133,.35)")}</div></div>`;
        }).join("")
      : `<div style="color:var(--text-faint);font-size:13.5px;padding:18px 0;text-align:center">Aucun événement pour l'instant. Crée le premier : affiche, animation, dates et tournois.</div>`;
  const listCard = card(`<div style="display:flex;align-items:center;gap:12px;margin-bottom:6px;flex-wrap:wrap">${secTitle(`Mes événements${list ? ` (${list.length})` : ""}`).replace("margin:0 0 14px", "margin:0")}<span style="flex:1"></span>
      <button data-evnew="1" style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:10px;padding:10px 16px;font-weight:750;font-size:13.5px;cursor:pointer">${ic(I.plus, 15)}Nouvel événement</button></div>${rows}`);
  if (!ed) return listCard;

  const val = (v: unknown) => escAttr(String(v ?? ""));
  const date10 = (v?: string | null) => (v ? v.slice(0, 10) : "");
  const accent = /^#[0-9a-f]{6}$/i.test(ed.accentColor || "") ? ed.accentColor : "#22d3ee";
  const editor = `<div style="border:1px solid rgba(34,211,238,.35);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:22px;margin-bottom:18px">
    <div style="font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:1px;margin-bottom:14px">${ed.id ? "Modifier l'événement" : "Nouvel événement"}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px">
      <label style="${lbl};grid-column:1/-1">Nom de l'événement<input id="ev-name" value="${val(ed.name)}" placeholder="Lomé Gaming Week" style="${inp}" /></label>
      <label style="${lbl};grid-column:1/-1">Accroche (une phrase)<input id="ev-tagline" value="${val(ed.tagline)}" placeholder="Trois jours de compétition, un seul champion" style="${inp}" /></label>
      <label style="${lbl}">Début<input id="ev-start" type="date" value="${date10(ed.startDate)}" style="${inp}" /></label>
      <label style="${lbl}">Fin<input id="ev-end" type="date" value="${date10(ed.endDate)}" style="${inp}" /></label>
      <label style="${lbl}">Lieu<input id="ev-place" value="${val(ed.place)}" placeholder="Vicenter, Lomé" style="${inp}" /></label>
      <label style="${lbl}">Couleur de l'événement<input id="ev-color" type="color" value="${accent}" style="${inp};height:44px;padding:4px" /></label>
      <label style="${lbl};grid-column:1/-1">Description<textarea id="ev-desc" rows="5" placeholder="Programme, règlement général, infos pratiques…" style="${inp};resize:vertical">${escHtml(ed.description)}</textarea></label>
      <div style="${lbl}">Affiche<div style="font-weight:500;color:var(--text-faint);margin-top:2px">Image verticale conseillée</div>${filePicker("ev-poster", "Choisir l'affiche", "image/*", ed.posterUrl)}</div>
      <div style="${lbl}">Bannière animée<div style="font-weight:500;color:var(--text-faint);margin-top:2px">GIF, image ou courte vidéo (mp4/webm) · 4 Mo maximum</div>${filePicker("ev-banner", "Choisir la bannière", "image/*,video/mp4,video/webm", ed.bannerUrl)}</div>
      <label style="${lbl}">Visibilité<select id="ev-status" style="${inp}"><option value="DRAFT" ${ed.status !== "PUBLISHED" ? "selected" : ""}>Brouillon (invisible du public)</option><option value="PUBLISHED" ${ed.status === "PUBLISHED" ? "selected" : ""}>Publié</option></select></label>
    </div>
    <div style="display:flex;align-items:center;gap:12px;margin-top:18px;flex-wrap:wrap">
      <button data-evsave="1" ${S.busy ? "disabled" : ""} style="background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:11px;padding:12px 22px;font-weight:750;font-size:14px;cursor:pointer">${S.busy ? "Enregistrement…" : ed.id ? "Enregistrer" : "Créer l'événement"}</button>
      <button data-evcancel="1" style="background:transparent;border:1px solid var(--border-strong);color:var(--text-muted);border-radius:11px;padding:12px 18px;font-weight:700;font-size:14px;cursor:pointer">Fermer</button>
      ${S.eventMsg ? `<span style="font-size:13px;color:#34D399;font-weight:700">${escHtml(S.eventMsg)}</span>` : ""}
    </div></div>`;

  let manage = "";
  const m = S.eventManage;
  if (ed.id) {
    const ts: Detail[] = m?.tournaments ?? [];
    const attachable: Detail[] = m?.attachable ?? [];
    // Filtre par jeu (puces) + résumé chiffré : un événement de plus d'une dizaine de tournois devient vite illisible en liste plate.
    const games = Array.from(new Set(ts.map((t: Detail) => t.game || "Autre")));
    const gameFilter = games.includes(S.evGame) ? S.evGame : "Tous";
    const shown = gameFilter === "Tous" ? ts : ts.filter((t: Detail) => (t.game || "Autre") === gameFilter);
    const totalPlayers = ts.reduce((n: number, t: Detail) => n + (Number(t.players) || 0), 0);
    const liveCount = ts.filter((t: Detail) => t.live).length;
    const stat = (v: string | number, k: string, color = "var(--text)") => `<div style="border:1px solid var(--border);border-radius:12px;background:var(--surface);padding:10px 16px;min-width:110px"><div style="font-family:'Bebas Neue',sans-serif;font-size:26px;line-height:1;color:${color}">${v}</div><div style="font-size:10.5px;letter-spacing:.9px;text-transform:uppercase;color:var(--text-muted);font-weight:700;margin-top:4px">${k}</div></div>`;
    const summary = ts.length ? `<div style="display:flex;gap:10px;flex-wrap:wrap;margin:12px 0 14px">${stat(ts.length, "Tournois")}${stat(totalPlayers, "Joueurs inscrits", "#22D3EE")}${stat(liveCount, "En direct", liveCount ? "#22D3EE" : "var(--text-faint)")}${stat(games.length, games.length > 1 ? "Jeux" : "Jeu")}</div>` : "";
    const chip = (g: string, n: number) => `<span data-evgame="${escAttr(g)}" style="cursor:pointer;white-space:nowrap;font-size:12px;font-weight:${gameFilter === g ? 750 : 600};color:${gameFilter === g ? "#04222a" : "var(--text-muted)"};background:${gameFilter === g ? "#22D3EE" : "transparent"};border:1px solid ${gameFilter === g ? "#22D3EE" : "var(--border)"};border-radius:99px;padding:6px 12px">${escHtml(g)} <span style="opacity:.7;font-family:'JetBrains Mono',monospace">${n}</span></span>`;
    const chips = games.length > 1 ? `<div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px">${chip("Tous", ts.length)}${games.map((g) => chip(g, ts.filter((t: Detail) => (t.game || "Autre") === g).length)).join("")}</div>` : "";
    const stateBadge = (t: Detail) => {
      const [label, color] = t.live ? ["En direct", "#22D3EE"] : t.status === "Terminé" ? ["Terminé", "#FBBF24"] : ["À venir", "#34D399"];
      return `<span style="font-size:10px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:${color};border:1px solid ${color}55;background:${color}14;border-radius:99px;padding:3px 9px;white-space:nowrap">${label}</span>`;
    };
    const tCard = (t: Detail) => `<div style="position:relative;border:1px solid var(--border);border-radius:14px;background:var(--surface);display:flex;flex-direction:column;overflow:hidden">
        <div data-open="${t.id}" style="cursor:pointer;padding:14px 16px 12px;flex:1">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="font-size:10.5px;letter-spacing:1px;text-transform:uppercase;color:#7C82FF;font-weight:800;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(t.game || "Jeu libre")}</span>${stateBadge(t)}</div>
          <div style="font-weight:700;font-size:14.5px;line-height:1.35">${escHtml(t.name)}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:6px">${[t.format, `${t.players} joueur${t.players > 1 ? "s" : ""}`].filter(Boolean).map(escHtml).join(" · ")}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;padding:9px 12px;border-top:1px solid var(--surface-4);background:var(--surface-2)">
          ${btnSm(`data-open="${t.id}"`, t.live ? "Ouvrir la régie" : "Ouvrir", "#22D3EE", "rgba(34,211,238,.35)")}
          <span style="flex:1"></span>
          <details style="position:relative"><summary title="Plus d'actions" style="list-style:none;cursor:pointer;display:grid;place-items:center;width:30px;height:28px;border-radius:8px;border:1px solid var(--border);color:var(--text-muted);font-size:16px;font-weight:800;line-height:1">⋯</summary>
            <div style="position:absolute;right:0;bottom:34px;z-index:5;min-width:190px;background:var(--surface-3);border:1px solid var(--border-strong);border-radius:10px;padding:6px;box-shadow:0 12px 30px rgba(0,0,0,.45)">${btnSm(`data-evdetach="${ed.id}|${t.id}"`, "Retirer de l'événement", "#FB7185", "rgba(251,113,133,.35)")}</div></details>
        </div>
      </div>`;
    const tRows = ts.length
      ? `${summary}${chips}<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px">${shown.map(tCard).join("")}</div>`
      : `<div style="color:var(--text-faint);font-size:13.5px;padding:14px 0">Aucun tournoi rattaché pour l'instant.</div>`;
    const attach = attachable.length
      ? `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px;padding-top:14px;border-top:1px solid var(--surface-4)"><select id="ev-attach-sel" style="${inp};margin-top:0;max-width:340px;flex:1">${attachable.map((t: Detail) => `<option value="${t.id}">${escHtml(t.name)}${t.game ? " · " + escHtml(t.game) : ""}</option>`).join("")}</select>
          <button data-evattach="1" style="background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:10px;padding:11px 16px;font-weight:700;font-size:13.5px;cursor:pointer">Rattacher ce tournoi</button></div>`
      : "";
    manage = card(`<div style="display:flex;align-items:center;gap:12px;margin-bottom:6px;flex-wrap:wrap">${secTitle(`Tournois de l'événement (${ts.length})`).replace("margin:0 0 14px", "margin:0")}<span style="flex:1"></span>
        <button data-act="create-open" data-evid="${ed.id}" style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:10px;padding:10px 16px;font-weight:750;font-size:13.5px;cursor:pointer">${ic(I.plus, 15)}Créer un tournoi dans cet événement</button></div>
      <p style="margin:0 0 6px;font-size:12.5px;color:var(--text-muted);line-height:1.6">Plusieurs tournois peuvent se dérouler en même temps : chacun a sa propre régie. Chaque tournoi consomme un crédit organisateur, comme d'habitude.</p>${tRows}${attach}`);
  }
  return editor + manage + `<div style="margin-top:18px">${listCard}</div>`;
}

const RAIL_PAGES: Record<string, (s: State) => string> = { accueil: pAccueil, tournois: pTournois, tournoi: pTournoi, evenements: pEvenements, evenement: pEvenement, classements: pClassements, joueur: pPlayerProfile, galerie: pGalerie, boutique: pBoutique, profil: pDashboard, auth: pAuth };

/** Compte bloqué : le club saisi à l'inscription doit d'abord être validé par un administrateur. */
function clubPendingBanner(S: State): string {
  const u = S.user;
  if (!u || !u.clubBlocking) return "";
  return `<div style="position:sticky;top:0;z-index:240;display:flex;align-items:center;gap:12px;padding:12px 18px;background:#241c07;border-bottom:1px solid rgba(251,191,36,.4)">
    <span style="color:#FBBF24;flex:none">${ic(I.warn, 18)}</span>
    <div style="font-size:13px;line-height:1.5;color:var(--text)"><b style="color:#FBBF24">Compte en attente de validation.</b> L'administrateur doit d'abord valider ton club « ${escHtml(u.clubRequested || "")} ». D'ici là, tu peux consulter le site mais pas t'inscrire, commander ni payer. Tu seras prévenu(e) par e-mail.</div>
  </div>`;
}
function renderPage(S: State) { return clubPendingBanner(S) + renderPageBody(S) + payChoiceModal(S) + shareModal(S) + embedModal(S) + toastHtml(S); }
function renderPageBody(S: State) {
  LIVE_META = { stations: (S.detail?.stations as Record<string, string>) || {}, stream: (S.detail?.streamMatchKey as string | null) ?? null };
  // Mode Show / écran de diffusion : conçus pour être projetés (vidéoprojecteur, écran de LAN) — restent
  // sombres quel que soit le thème choisi pour le reste du site.
  if (S.page === "show") return `<div data-force-theme="dark">${pShow(S)}</div>`;
  if (S.page === "evshow") return `<div data-force-theme="dark">${pEvShow(S)}</div>`;
  // Organisateur/admin sur « Mon espace » : shell console (sidebar) autonome, pas le rail du module contenu.
  if (S.page === "profil" && canManage(S)) return consolePage(S);
  // Régie organisateur/admin pendant qu'un tournoi est en direct : écran plein cadre autonome (rail·centre·contrôle), hors du rail public — même principe que la console.
  // Sa coque (bandeau, rail, colonne de contrôle) est en dur sur fond sombre (régie "salle de contrôle") :
  // sans forcer le thème sombre sur tout le sous-arbre, les cartes du centre (bracket, poules) suivaient
  // le thème clair/sombre choisi pour le reste du site et devenaient des pavés blancs sur fond noir.
  if (S.page === "tournoi" && canManage(S) && S.detail && S.detail.status === "live") return `<div data-force-theme="dark">${regiePage(S)}</div>`;
  if (RAIL_PAGES[S.page]) {
    const activeKey = S.page === "tournoi" ? "tournois" : S.page === "evenement" ? "evenements" : S.page;
    return railShell(S, activeKey, RAIL_PAGES[S.page](S)) + cartDrawer(S) + confirmModal(S) + matchCorrectModal(S);
  }
  const body = S.page === "auth" ? pAuth(S)
    : S.page === "mentions-legales" ? pLegal(S, "legal")
    : S.page === "confidentialite" ? pLegal(S, "privacy")
    : pAccueil(S);
  const footer = siteFooter();
  return header(S) + partnersMarquee(S) + body + footer + cartDrawer(S) + confirmModal(S) + matchCorrectModal(S);
}

/* ================= Composant ================= */
/** Application (page unique) : chaque route publique (/, /tournois, /tournois/[id]…) la monte avec sa page de départ. */
export default function Spa({ initialPage = "accueil", initialOpenId, initialEventId }: { initialPage?: string; initialOpenId?: string; initialEventId?: string } = {}) {
  const [S, setS] = useState<State>({
    page: initialPage, slide: 0, fmt: "Tous", scope: "Togo", game: "Tous", cat: "Tous", tournStatus: "Tous",
    tourns: null, creating: false, busy: false, leaderboard: null,
    playerProfile: null, h2hOpponent: "", h2hData: null, h2hBusy: false, eventStandings: null, embedTarget: null, productOpen: null, evGame: "Tous", toast: null, myNext: null, teamDraft: null, predBoard: null, myPreds: null, predictors: null,
    cartItems: [], cartOpen: false, products: null, cartPayPick: "", cartBusy: false, lastOrder: null,
    cartPointsToRedeem: 0, regPointsToRedeem: 0, loyaltySettings: null, loyaltyHistory: null, loyaltyBalance: 0,
    creditsMe: null, creditBuyQty: 1, creditBuyPay: "", creditBuyBusy: false, payConfig: null, payModal: null,
    events: null, eventDetail: null, openEventId: null, myEvents: null, eventEdit: null, eventManage: null, eventMsg: "", wizEventId: null, scanOpen: false, evShow: null, shareTarget: null, theme: "dark",
    user: null, authTab: "login", authBusy: false, authError: "", authNotice: "", resetToken: "", authRole: "PLAYER",
    q: "",
    openId: null, detail: null, detailBusy: false, editing: false, admin: null,
    adminTab: "apercu", adminSearch: "", newsEdit: null, prodEdit: null, news: null, confirmBox: null,
    prodCat: "Tous", prodSort: "", prodSortDir: "asc",
    site: null, siteMsg: "",
    me: null, myRegs: null, myOrders: null, myTourns: null, myResults: null,
    regIds: [], profileMsg: "", passMsg: "", profileEdit: false,
    payPick: "", gallery: null, galleryEdit: null, galleryFilter: "", galleryOpen: null, galleryType: "", galleryBusy: null,
    albums: null, albumEdit: null, albumOpen: null, boutiqueInStock: false, regsPanel: null,
    partnersEdit: null, adsEdit: null, adSlide: 0, slidesEdit: null,
    editingPlayerId: null, brActiveGame: null,
    activeMatchIds: [], matchScores: {}, correctingId: null, regiePanel: null, bracketView: "tree", rosterQ: "", showSlide: 0, consoleMenuOpen: false,
    wizStep: 1,
    wizData: { teamSize: 0, name: "", game: "", date: "", place: "", format: "SURVIVAL", pointsPerPlayer: 5, nbPools: 2, players: [], entryFeeXof: 0, givesLoyaltyPoint: true, survWin: 1, loserWin: 0.5, poolFinalWin: 1.5, finalsWin: 2, championBonus: 3, streakBonus: 0, finalsFormat: "double", poolFormat: "survival", streakLength: 5, qualifyPerPool: 2, matchMode: "bo", matchValue: 1, countGoalDiff: true, brPoints: DEFAULT_BR_POINTS.slice(), brKillPoints: DEFAULT_BR_KILL_POINTS, imageUrl: null },
    wizRosterSearch: "", wizEditId: null, wizFullEdit: false,
    roster: null, clubs: null, rosterEdit: null, clubEdit: null, rosterTab: "joueurs", classementView: "joueurs",
    games: null, gameEdit: null, playerDetail: null, playerDetailBusy: false,
  });
  const html = useMemo(() => renderPage(S), [S]);

  // Les animations d'entrée (.rise) ne jouent qu'au changement de page :
  // tout autre re-rendu recrée le DOM et les rejouerait sinon.
  const prevPage = useRef<string | null>(null);
  const pageChanged = prevPage.current !== S.page;
  useEffect(() => { prevPage.current = S.page; });

  // Le HTML injecté est entièrement recréé à chaque rendu : les zones défilantes internes (bracket,
  // centre de la régie, listes) retomberaient en haut. On mémorise donc leur dernière position (écoute
  // des événements scroll, pas une lecture au rendu qui peut tomber entre deux remplacements du DOM)
  // puis on la rétablit après chaque remplacement, tant qu'on reste sur la même page.
  const rootRef = useRef<HTMLDivElement>(null);
  // Éléments repérés par id / classe / style (+ rang parmi les identiques), pas par position dans le
  // DOM : le nombre d'éléments qui les précèdent change d'un rendu à l'autre (rail, bannière…).
  const scrollKey = (el: HTMLElement) => el.id || el.getAttribute("class") || `${el.tagName}|${(el.getAttribute("style") || "").slice(0, 60)}`;
  const scrollMem = useRef<{ page: string; win: number; pos: Map<string, [number, number]> }>({ page: S.page, win: 0, pos: new Map() });
  if (scrollMem.current.page !== S.page) scrollMem.current = { page: S.page, win: 0, pos: new Map() };
  useEffect(() => {
    let raf = 0;
    const record = () => {
      raf = 0;
      const root = rootRef.current;
      if (!root) return;
      const pos = new Map<string, [number, number]>();
      const seen: Record<string, number> = {};
      root.querySelectorAll<HTMLElement>("*").forEach((el) => {
        const k = scrollKey(el);
        const n = (seen[k] = (seen[k] ?? -1) + 1);
        if (el.scrollTop > 0 || el.scrollLeft > 0) pos.set(`${k} ${n}`, [el.scrollTop, el.scrollLeft]);
      });
      scrollMem.current.pos = pos;
      scrollMem.current.win = window.scrollY;
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(record); };
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => { window.removeEventListener("scroll", onScroll, true); if (raf) cancelAnimationFrame(raf); };
  }, []);
  const restoreScroll = () => {
    const mem = scrollMem.current;
    if (!rootRef.current || mem.page !== S.page) return;
    const seen: Record<string, number> = {};
    rootRef.current.querySelectorAll<HTMLElement>("*").forEach((el) => {
      const k = scrollKey(el);
      const n = (seen[k] = (seen[k] ?? -1) + 1);
      const v = mem.pos.get(`${k} ${n}`);
      if (v && (el.scrollTop !== v[0] || el.scrollLeft !== v[1])) { el.scrollTop = v[0]; el.scrollLeft = v[1]; }
    });
    // Sur mobile c'est la page entière qui défile (panneaux « Match en cours » empilés) : idem.
    if (mem.win > 0 && Math.abs(window.scrollY - mem.win) > 1) window.scrollTo({ top: mem.win, behavior: "instant" as ScrollBehavior });
  };
  const restoreScrollRef = useRef(restoreScroll);
  restoreScrollRef.current = restoreScroll;
  useLayoutEffect(() => { restoreScrollRef.current(); }, [html]);
  // Filet : le contenu peut aussi être remplacé hors d'un rendu de ce composant (recréation du DOM par
  // React lui-même) ; on rétablit alors la position dès que les enfants de la racine changent.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const mo = new MutationObserver(() => restoreScrollRef.current());
    mo.observe(root, { childList: true });
    return () => mo.disconnect();
  }, []);

  // Passerelles de paiement en ligne disponibles + retour de FedaPay (?pay=fedapay&kind=…&ref=…&id=…) :
  // on nettoie l'URL puis on demande au serveur de vérifier la transaction.
  useEffect(() => {
    if (token()) {
      fetch(`${API}/api/users/me`, { headers: authHeaders() }).then((r) => (r.ok ? r.json() : null)).then((m) => {
        if (!m) return;
        setS((s) => {
          if (!s.user) return s;
          const u = { ...s.user, clubStatus: m.clubStatus, clubRequested: m.clubRequested ?? null, clubBlocking: !!m.clubBlocking };
          try { localStorage.setItem("vlome_user", JSON.stringify(u)); } catch { /* ignore */ }
          return { ...s, user: u };
        });
      }).catch(() => { /* API hors ligne */ });
    }
    loadEvents();
    fetch(`${API}/api/payments/config`).then((r) => (r.ok ? r.json() : null)).then((c) => { if (c) setS((s) => ({ ...s, payConfig: c })); }).catch(() => { /* API hors ligne */ });
    const q = new URLSearchParams(window.location.search);
    if (q.get("pay") !== "fedapay") return;
    const kind = q.get("kind") as PayKind | null, ref = q.get("ref"), tx = q.get("id"), status = (q.get("status") || "").toLowerCase();
    window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    if (!kind || !ref) return;
    // Paiement annulé / refusé : rien à vérifier, et surtout on ne touche ni à la session ni à la navigation.
    if (status && status !== "approved" && status !== "transferred") {
      alert("Paiement annulé. Rien n'a été débité. Tu peux le réessayer depuis « Réessayer le paiement » (page du tournoi, Mes commandes ou Crédits).");
      return;
    }
    if (!token()) { alert("Ton paiement a bien été pris en compte. Reconnecte-toi pour voir sa confirmation."); return; }
    void verifyOnlinePayment("fedapay", kind, ref, tx || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scanner de billets : une couche à part, gérée à la main. L'interface est régénérée à chaque changement d'état,
  // ce qui détruirait l'élément <video> (et donc le flux caméra) ; ici il vit hors de ce cycle jusqu'à la fermeture.
  useEffect(() => {
    if (!S.scanOpen || !S.openId) return;
    const tid = S.openId;
    const layer = document.createElement("div");
    layer.id = "scan-layer";
    layer.style.cssText = "position:fixed;inset:0;z-index:330;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:18px;background:rgba(6,6,10,.94);font-family:Inter,system-ui,sans-serif;color:var(--text)";
    layer.innerHTML = `<div style="width:min(440px,100%);display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;align-items:center;gap:10px"><span style="font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:1px;flex:1">Scanner les billets</span><span id="scan-count" style="font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--text-muted)"></span>
        <button id="scan-close" style="background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text);border-radius:10px;padding:8px 14px;font-weight:700;font-size:13px;cursor:pointer">Fermer</button></div>
      <div style="position:relative;border-radius:16px;overflow:hidden;background:#000;aspect-ratio:1/1;border:1px solid var(--border-strong)">
        <video id="scan-video" playsinline muted style="width:100%;height:100%;object-fit:cover"></video>
        <div style="position:absolute;inset:18%;border:3px solid rgba(34,211,238,.85);border-radius:16px;box-shadow:0 0 0 999px rgba(0,0,0,.35);pointer-events:none"></div>
      </div>
      <div id="scan-msg" style="min-height:44px;border-radius:12px;padding:11px 14px;font-weight:700;font-size:14px;background:var(--surface);border:1px solid var(--border);color:var(--text-muted);display:flex;align-items:center">Place le QR code du joueur dans le cadre…</div>
      <div style="display:flex;gap:8px"><input id="scan-code" placeholder="Ou saisis le code à 6 caractères" maxlength="40" style="flex:1;min-width:0;background:var(--surface-3);border:1px solid var(--border);border-radius:10px;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:14px;letter-spacing:2px;text-transform:uppercase;padding:11px 13px" />
        <button id="scan-go" style="background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:10px;padding:0 18px;font-weight:750;font-size:14px;cursor:pointer">Valider</button></div>
    </div>`;
    document.body.appendChild(layer);
    const $ = <T extends HTMLElement>(id: string) => layer.querySelector<T>("#" + id)!;
    const msg = $("scan-msg"), count = $("scan-count"), video = $<HTMLVideoElement>("scan-video"), input = $<HTMLInputElement>("scan-code");
    let stream: MediaStream | null = null, timer = 0, stopped = false, last = "", lastAt = 0;
    const show = (text: string, ok: boolean | null) => {
      msg.textContent = text;
      msg.style.color = ok === null ? "var(--text-muted)" : ok ? "#34D399" : "#FB7185";
      msg.style.borderColor = ok === null ? "var(--border)" : ok ? "rgba(52,211,153,.45)" : "rgba(251,113,133,.45)";
    };
    const submit = async (code: string) => {
      const res = await postCheckIn(tid, { code });
      show(res.message, res.ok);
      if (res.ok && res.data) { count.textContent = `${res.data.count} / ${res.data.total}`; loadRegsPanel(tid); try { navigator.vibrate?.(res.data.already ? [60, 60, 60] : 120); } catch { /* ignore */ } }
    };
    const close = () => { setS((s) => ({ ...s, scanOpen: false })); };
    $("scan-close").addEventListener("click", close);
    layer.addEventListener("click", (e) => { if (e.target === layer) close(); });
    $("scan-go").addEventListener("click", () => { const v = input.value.trim(); if (v) { submit(v); input.value = ""; } });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { const v = input.value.trim(); if (v) { submit(v); input.value = ""; } } });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.srcObject = stream;
        await video.play();
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const tick = () => {
          if (stopped) return;
          if (ctx && video.videoWidth) {
            const w = Math.min(640, video.videoWidth), h = Math.round((video.videoHeight * w) / video.videoWidth);
            canvas.width = w; canvas.height = h;
            ctx.drawImage(video, 0, 0, w, h);
            const found = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
            // Même billet re-détecté en boucle : on l'ignore quelques secondes.
            if (found?.data && (found.data !== last || Date.now() - lastAt > 4000)) { last = found.data; lastAt = Date.now(); submit(found.data); }
          }
          timer = window.setTimeout(tick, 250);
        };
        tick();
      } catch {
        show("Caméra indisponible (autorisation refusée ?). Saisis le code du billet ci-dessous.", false);
      }
    })();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      layer.remove();
    };
  }, [S.scanOpen, S.openId]);

  /* ---------- Pilotage d'un tournoi ---------- */
  /** Pronostics du tournoi ouvert : matchs ouverts + tendance du public, et mes propres choix si connecté. */
  async function loadPredictions(id: string) {
    try {
      const [b, m] = await Promise.all([
        fetch(`${API}/api/tournaments/${id}/predictions`),
        token() ? fetch(`${API}/api/tournaments/${id}/predictions/mine`, { headers: authHeaders() }) : Promise.resolve(null),
      ]);
      const board = b.ok ? await b.json() : null;
      const mine = m && m.ok ? await m.json() : [];
      setS((s) => (s.openId === id ? { ...s, predBoard: board, myPreds: mine } : s));
    } catch { /* ignore */ }
  }
  async function predict(tid: string, key: string, idx: number) {
    const m = (S.predBoard?.matches || []).find((x: Detail) => x.key === key);
    if (!m || !token()) return;
    const pick = idx === 0 ? m.a : m.b;
    try {
      const r = await fetch(`${API}/api/tournaments/${tid}/predictions`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ matchKey: key, pick }) });
      const d = await r.json().catch(() => null);
      if (!r.ok) { showToast(d?.message || "Pronostic impossible."); void loadPredictions(tid); return; }
      setS((s) => ({ ...s, myPreds: d }));
      void loadPredictions(tid);
      showToast(`Pronostic enregistré : ${pick}`);
    } catch { showToast("Pronostic impossible."); }
  }
  async function loadPredictors() {
    try {
      const r = await fetch(`${API}/api/tournaments/predictors/leaderboard`);
      if (r.ok) { const d = await r.json(); setS((s) => ({ ...s, predictors: Array.isArray(d) ? d : [] })); }
    } catch { /* ignore */ }
  }
  async function openDetail(id: string, page = "tournoi") {
    setS((s) => ({ ...s, page, openId: id, detail: null, teamDraft: null, regsPanel: null, payPick: "", regPointsToRedeem: 0, activeMatchIds: [], matchScores: {}, predBoard: null, myPreds: null, correctingId: null, regiePanel: null, brActiveGame: null, showSlide: 0 }));
    window.scrollTo({ top: 0 });
    try {
      const r = await fetch(`${API}/api/tournaments/${id}/state`);
      if (r.ok) { const d = await r.json(); setS((s) => ({ ...s, detail: d })); }
    } catch { /* API hors ligne */ }
    // Arrivée directe sur /tournois/<id> : S.user n'est pas encore rempli à ce stade (il est lu du navigateur dans le même
    // effet de démarrage) — on regarde donc aussi le compte enregistré, sinon la liste des inscrits ne se chargeait pas.
    const role = S.user?.role ?? storedRole();
    if (token() && (role === "ORGANIZER" || role === "ADMIN")) loadRegsPanel(id);
  }
  async function act(url: string, body?: unknown, method = "POST") {
    if (!token()) { setS((s) => ({ ...s, page: "auth" })); window.scrollTo({ top: 0 }); return; }
    setS((s) => ({ ...s, detailBusy: true }));
    try {
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json", ...authHeaders() }, body: body ? JSON.stringify(body) : undefined });
      if (r.status === 401) { setS((s) => ({ ...s, detailBusy: false, page: "auth", user: null })); return; }
      if (r.status === 403) { setS((s) => ({ ...s, detailBusy: false })); alert("Action réservée à l'organisateur du tournoi."); return; }
      if (r.ok) { const d = await r.json(); setS((s) => ({ ...s, detail: d, detailBusy: false })); loadTournaments(); }
      else { const d = await r.json().catch(() => null); setS((s) => ({ ...s, detailBusy: false })); if (d?.message) alert(d.message); }
    } catch { setS((s) => ({ ...s, detailBusy: false })); }
  }
  async function editSave(id: string, body: Record<string, string | number>) {
    if (!token()) { setS((s) => ({ ...s, page: "auth" })); window.scrollTo({ top: 0 }); return; }
    try { const img = await uploadOrNotify("e-img"); if (img) body.imageUrl = img; } catch { return; }
    try {
      const r = await fetch(`${API}/api/tournaments/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(body) });
      if (r.status === 403) { alert("Seul l'organisateur peut modifier ce tournoi."); return; }
      if (r.ok) { await loadTournaments(); await openDetail(id); setS((s) => ({ ...s, editing: false })); }
    } catch { /* ignore */ }
  }
  /** Enregistre le barème modifié en direct depuis la régie (une requête /scoring par valeur, comme submitUpdate). */
  async function saveLiveScoring(id: string) {
    if (!token()) { setS((s) => ({ ...s, page: "auth" })); window.scrollTo({ top: 0 }); return; }
    const val = (key: string) => parseFloat((document.getElementById("ls-" + key) as HTMLInputElement | null)?.value ?? "0");
    try {
      for (const [, key] of WIZ_SCORING_FIELDS_REF) {
        await fetch(`${API}/api/tournaments/${id}/scoring`, {
          method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ key, value: val(key) }),
        });
      }
      await openDetail(id);
      setS((s) => ({ ...s, regiePanel: null }));
    } catch { /* ignore */ }
  }
  /** Enregistre en une fois ce qui a changé dans le panneau d'édition d'un joueur : nom, club, ajustement manuel. */
  async function savePlayerEdit(tid: string, pid: string) {
    if (!token()) { setS((s) => ({ ...s, page: "auth" })); window.scrollTo({ top: 0 }); return; }
    const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";
    const name = val("pl-edit-name").trim();
    const club = val("pl-edit-club").trim();
    const delta = parseFloat(val("pl-edit-delta"));
    const reason = val("pl-edit-reason").trim();
    const current = S.detail?.players?.find((p: Detail) => p.id === pid);
    setS((s) => ({ ...s, detailBusy: true }));
    try {
      let lastOk: Detail | null = null;
      if (name && current && name !== current.name) {
        const r = await fetch(`${API}/api/tournaments/${tid}/players/${pid}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ name }) });
        if (r.ok) lastOk = await r.json();
        else { const d = await r.json().catch(() => null); alert(d?.message || "Renommage impossible."); }
      }
      const membersEl = document.getElementById("pl-edit-members") as HTMLInputElement | null;
      if (membersEl && current) {
        const list = membersEl.value.split(",").map((m) => m.trim()).filter(Boolean);
        const before = ((S.detail?.teams?.[current.name] as string[]) || []).join(",");
        if (list.join(",") !== before) {
          const r = await fetch(`${API}/api/tournaments/${tid}/players/${pid}/members`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ members: list }) });
          if (r.ok) lastOk = await r.json();
          else { const d = await r.json().catch(() => null); alert(d?.message || "Composition impossible à modifier."); }
        }
      }
      if (current && club !== (current.club || "")) {
        const r = await fetch(`${API}/api/tournaments/${tid}/players/${pid}/club`, { method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ club }) });
        if (r.ok) lastOk = await r.json();
      }
      if (delta) {
        const r = await fetch(`${API}/api/tournaments/${tid}/players/${pid}/adjust`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ delta, reason: reason || undefined }) });
        if (r.ok) lastOk = await r.json();
        else { const d = await r.json().catch(() => null); alert(d?.message || "Ajustement impossible."); }
      }
      setS((s) => ({ ...s, detail: lastOk || s.detail, detailBusy: false, editingPlayerId: null }));
      loadTournaments();
    } catch { setS((s) => ({ ...s, detailBusy: false })); }
  }
  async function deleteT(id: string) {
    if (!token()) { setS((s) => ({ ...s, page: "auth" })); window.scrollTo({ top: 0 }); return; }
    try {
      const r = await fetch(`${API}/api/tournaments/${id}`, { method: "DELETE", headers: authHeaders() });
      if (r.status === 403) { alert("Seul l'organisateur peut supprimer ce tournoi."); return; }
      if (r.ok) { await loadTournaments(); setS((s) => ({ ...s, page: "tournois", detail: null, openId: null })); }
    } catch { /* ignore */ }
  }

  /** Demande de lien de réinitialisation. Le message affiché est le même quelle que soit l'existence
   * du compte : la page ne doit pas révéler qui est inscrit. */
  async function submitForgot(email: string) {
    if (!email) { setS((s) => ({ ...s, authError: "Indique ton adresse e-mail." })); return; }
    setS((s) => ({ ...s, authBusy: true, authError: "", authNotice: "" }));
    try {
      await fetch(`${API}/api/auth/forgot-password`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }),
      });
      setS((s) => ({ ...s, authBusy: false, authNotice: `Si un compte existe pour ${email}, un lien de réinitialisation vient d'être envoyé. Pense à vérifier tes indésirables.` }));
    } catch { setS((s) => ({ ...s, authBusy: false, authError: "API injoignable." })); }
  }
  /** Enregistre le nouveau mot de passe à partir du jeton reçu par e-mail, et connecte directement. */
  async function submitReset(password: string, confirm: string) {
    if (password.length < 6) { setS((s) => ({ ...s, authError: "Mot de passe : au moins 6 caractères." })); return; }
    if (password !== confirm) { setS((s) => ({ ...s, authError: "Les deux mots de passe ne correspondent pas." })); return; }
    setS((s) => ({ ...s, authBusy: true, authError: "" }));
    try {
      const r = await fetch(`${API}/api/auth/reset-password`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: S.resetToken, password }),
      });
      const data = await r.json();
      if (!r.ok) { setS((s) => ({ ...s, authBusy: false, authError: data.message || "Lien invalide ou expiré." })); return; }
      localStorage.setItem("vlome_token", data.token);
      localStorage.setItem("vlome_user", JSON.stringify(data.user));
      history.replaceState(null, "", window.location.pathname);
      setS((s) => ({ ...s, authBusy: false, authError: "", authNotice: "", resetToken: "", authTab: "login", user: data.user, page: "profil", me: null }));
    } catch { setS((s) => ({ ...s, authBusy: false, authError: "API injoignable." })); }
  }

  async function submitAuth() {
    const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";
    const email = val("a-email").trim(), password = val("a-pass"), displayName = val("a-name").trim();
    const isLogin = S.authTab === "login";
    if (S.authTab === "forgot") { await submitForgot(email); return; }
    if (S.authTab === "reset") { await submitReset(password, val("a-pass2")); return; }
    if (!email || !password) { setS((s) => ({ ...s, authError: isLogin ? "Email (ou pseudo) et mot de passe requis." : "Email et mot de passe requis." })); return; }
    if (!isLogin) {
      if (!displayName) { setS((s) => ({ ...s, authError: "Choisis un nom affiché (pseudo)." })); return; }
      if (password.length < 6) { setS((s) => ({ ...s, authError: "Mot de passe : au moins 6 caractères." })); return; }
      if (password !== val("a-pass2")) { setS((s) => ({ ...s, authError: "Les deux mots de passe ne correspondent pas." })); return; }
    }
    setS((s) => ({ ...s, authBusy: true, authError: "" }));
    try {
      const r = await fetch(`${API}/api/auth/${isLogin ? "login" : "register"}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isLogin
          ? { email, password }
          : { email, password, displayName, role: S.authRole, city: val("a-city").trim(), favoriteGame: val("a-game").trim(), phone: val("a-phone").trim(), club: val("a-club").trim(), organizerNote: val("a-orgnote").trim() }),
      });
      const data = await r.json();
      if (!r.ok) { setS((s) => ({ ...s, authBusy: false, authError: data.message || "Échec de la connexion." })); return; }
      localStorage.setItem("vlome_token", data.token);
      localStorage.setItem("vlome_user", JSON.stringify(data.user));
      setS((s) => ({ ...s, authBusy: false, user: data.user, page: "profil", me: null, myRegs: null, myOrders: null, myTourns: null, myResults: null, admin: null }));
      window.scrollTo({ top: 0 });
      loadRegIds();
    } catch {
      setS((s) => ({ ...s, authBusy: false, authError: "API injoignable — démarre pnpm dev:api." }));
    }
  }
  function logout() {
    localStorage.removeItem("vlome_token"); localStorage.removeItem("vlome_user");
    setS((s) => ({ ...s, user: null, me: null, myRegs: null, myOrders: null, myTourns: null, myResults: null, admin: null, regIds: [], page: s.page === "profil" ? "accueil" : s.page }));
  }

  async function loadTournaments() {
    try {
      const r = await fetch(`${API}/api/tournaments`);
      if (!r.ok) return;
      const data: TournCard[] = await r.json();
      if (Array.isArray(data) && data.length) setS((s) => ({ ...s, tourns: data }));
    } catch { /* API hors ligne : repli statique */ }
  }

  async function loadSettings() {
    try {
      const r = await fetch(`${API}/api/settings`);
      if (r.ok) { const site = await r.json(); setS((s) => ({ ...s, site })); }
    } catch { /* repli statique */ }
  }

  async function loadNews() {
    try {
      const r = await fetch(`${API}/api/news`);
      if (!r.ok) return;
      const rows: Detail[] = await r.json();
      if (Array.isArray(rows) && rows.length) setS((s) => ({ ...s, news: rows }));
    } catch { /* repli statique */ }
  }

  async function loadGallery() {
    try {
      const [gR, aR] = await Promise.all([fetch(`${API}/api/gallery`), fetch(`${API}/api/gallery/albums`)]);
      const rows = gR.ok ? await gR.json() : null;
      const albums = aR.ok ? await aR.json() : null;
      setS((s) => ({ ...s, gallery: rows ?? s.gallery, albums: albums ?? s.albums }));
    } catch { /* ignore */ }
  }
  /** Crée ou renomme un catalogue de la galerie. */
  async function saveAlbum() {
    const e = S.albumEdit;
    if (!e) return;
    const val = (x: string) => (document.getElementById(x) as HTMLInputElement | null)?.value ?? "";
    const title = val("al-title").trim();
    if (!title) { alert("Le titre du catalogue est requis."); return; }
    const body = { title, description: val("al-desc").trim() || undefined };
    try {
      const r = await fetch(`${API}/api/gallery/albums${e.id ? "/" + e.id : ""}`, {
        method: e.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({} as Detail)); alert(d.message || "Enregistrement impossible."); return; }
      setS((s) => ({ ...s, albumEdit: null }));
      await loadGallery();
    } catch { /* ignore */ }
  }
  /** Supprime un catalogue — ses médias sont conservés et repassent « hors catalogue ». */
  async function deleteAlbum(id: string) {
    try {
      const r = await fetch(`${API}/api/gallery/albums/${id}`, { method: "DELETE", headers: authHeaders() });
      if (r.ok) await loadGallery();
    } catch { /* ignore */ }
  }
  /** Titre par défaut déduit du nom de fichier ("finale-survival_01.jpg" -> "Finale survival 01"),
   * pour que l'ajout en masse ne demande pas de saisir un titre par photo. */
  function titleFromFilename(name: string): string {
    const base = name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    if (!base) return "Photo";
    return base.charAt(0).toUpperCase() + base.slice(1);
  }
  /** Ajout à la galerie : accepte une sélection multiple et envoie les fichiers un par un
   * (l'API reçoit un média par requête, et chaque envoi doit rester sous la limite serverless). */
  async function saveGalleryItem() {
    const val = (x: string) => (document.getElementById(x) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";
    const input = document.getElementById("ga-file") as HTMLInputElement | null;
    const files = Array.from(input?.files ?? []);
    if (!files.length) { alert("Choisis au moins une photo ou une vidéo."); return; }
    const baseTitle = val("ga-title").trim();
    const tournamentId = val("ga-tourn") || undefined;
    const albumId = val("ga-album") || undefined;
    setS((s) => ({ ...s, galleryBusy: `0/${files.length}` }));
    const errors: string[] = [];
    let added = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setS((s) => ({ ...s, galleryBusy: `${i}/${files.length}` }));
      try {
        const url = await uploadOne(f);
        // Un titre saisi sert de base commune (numérotée s'il y a plusieurs fichiers) ; sinon on
        // reprend le nom du fichier, pour ne rien avoir à saisir lors d'un import en masse.
        const title = baseTitle
          ? (files.length > 1 ? `${baseTitle} ${i + 1}` : baseTitle)
          : titleFromFilename(f.name);
        const r = await fetch(`${API}/api/gallery`, {
          method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ title: title.slice(0, 140), mediaUrl: url, tournamentId, albumId }),
        });
        if (!r.ok) { const d = await r.json().catch(() => ({} as Detail)); throw new Error(d.message || `Ajout impossible pour « ${f.name} ».`); }
        added++;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : `Échec pour « ${f.name} ».`);
      }
    }
    setS((s) => ({ ...s, galleryBusy: null, galleryEdit: errors.length ? s.galleryEdit : null }));
    await loadGallery();
    if (S.admin) loadAdmin();
    if (errors.length) alert(`${added} média(s) ajouté(s), ${errors.length} en échec :\n\n${errors.slice(0, 5).join("\n")}${errors.length > 5 ? "\n…" : ""}`);
  }
  async function deleteGalleryItem(id: string) {
    try {
      const r = await fetch(`${API}/api/gallery/${id}`, { method: "DELETE", headers: authHeaders() });
      if (r.ok) { await loadGallery(); if (S.admin) loadAdmin(); }
    } catch { /* ignore */ }
  }

  /** Base de joueurs + clubs (organisateur/admin) — utilisée par l'admin et par l'assistant de création. */
  async function loadRoster() {
    if (!token()) return;
    try {
      const [rR, cR, gR] = await Promise.all([
        fetch(`${API}/api/roster`, { headers: authHeaders() }),
        fetch(`${API}/api/clubs`, { headers: authHeaders() }),
        fetch(`${API}/api/games`),
      ]);
      const roster = rR.ok ? await rR.json() : [];
      const clubs = cR.ok ? await cR.json() : [];
      const games = gR.ok ? await gR.json() : [];
      setS((s) => ({ ...s, roster, clubs, games }));
    } catch { /* ignore */ }
  }
  async function loadProducts() {
    try {
      const r = await fetch(`${API}/api/products`);
      if (!r.ok) return;
      const rows: { id: string; name: string; category: string; priceXof: number; imageUrl?: string | null; loyaltyEligible?: boolean; showOnHome?: boolean; description?: string | null }[] = await r.json();
      if (Array.isArray(rows) && rows.length) {
        setS((s) => ({ ...s, products: rows.map((p) => ({ id: p.id, cat: p.category, name: p.name, price: p.priceXof, ph: p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), img: p.imageUrl || null, loyaltyEligible: !!p.loyaltyEligible, showOnHome: !!p.showOnHome, description: p.description || null })) }));
      }
    } catch { /* repli statique */ }
  }
  async function loadLoyaltySettings() {
    try {
      const r = await fetch(`${API}/api/loyalty/settings`);
      if (r.ok) { const v = await r.json(); setS((s) => ({ ...s, loyaltySettings: v })); }
    } catch { /* ignore */ }
  }
  async function loadLoyaltyMe() {
    if (!token()) return;
    try {
      const r = await fetch(`${API}/api/loyalty/me`, { headers: authHeaders() });
      if (r.ok) { const v = await r.json(); setS((s) => ({ ...s, loyaltyHistory: v.history, loyaltyBalance: v.balance })); }
    } catch { /* ignore */ }
  }
  async function loadCreditsMe() {
    if (!token()) return;
    try {
      const r = await fetch(`${API}/api/credits/me`, { headers: authHeaders() });
      if (r.ok) { const v = await r.json(); setS((s) => ({ ...s, creditsMe: v })); }
    } catch { /* ignore */ }
  }
  /* ---------- Événements ---------- */
  async function loadEvents() {
    try {
      const r = await fetch(`${API}/api/events`);
      if (r.ok) { const list = await r.json(); setS((s) => ({ ...s, events: list })); }
    } catch { /* API hors ligne */ }
  }
  async function loadMyEvents() {
    if (!token()) return;
    try {
      const r = await fetch(`${API}/api/events/mine`, { headers: authHeaders() });
      if (r.ok) { const list = await r.json(); setS((s) => ({ ...s, myEvents: list })); }
    } catch { /* ignore */ }
  }
  /** Ouvre la page publique d'un événement. Un gestionnaire voit aussi ses brouillons (route /manage, sinon route publique). */
  async function openEvent(id: string) {
    setS((s) => ({ ...s, page: "evenement", openEventId: id, eventDetail: null, eventStandings: null }));
    window.scrollTo({ top: 0 });
    try {
      let d: Detail | null = null;
      if (token() && (S.user?.role === "ORGANIZER" || S.user?.role === "ADMIN")) {
        const m = await fetch(`${API}/api/events/${id}/manage`, { headers: authHeaders() });
        if (m.ok) d = await m.json();
      }
      if (!d) {
        const r = await fetch(`${API}/api/events/${id}`);
        if (r.ok) d = await r.json();
      }
      setS((s) => (s.openEventId === id ? { ...s, eventDetail: d ?? { notFound: true, tournaments: [] } } : s));
      // Classement cumulé (circuit) : n'a d'intérêt qu'avec au moins deux tournois rattachés.
      if (d && (d.tournaments || []).length > 1) {
        const sr = await fetch(`${API}/api/events/${id}/standings`);
        if (sr.ok) { const standings = await sr.json(); setS((s) => (s.openEventId === id ? { ...s, eventStandings: standings } : s)); }
      }
    } catch { /* ignore */ }
  }
  /** Ouvre l'éditeur (console) d'un événement existant avec ses tournois rattachés. */
  async function openEventEditor(id: string) {
    setS((s) => ({ ...s, page: "profil", adminTab: "events", eventEdit: null, eventManage: null, eventMsg: "" }));
    window.scrollTo({ top: 0 });
    loadMyEvents();
    try {
      const r = await fetch(`${API}/api/events/${id}/manage`, { headers: authHeaders() });
      if (!r.ok) return;
      const d = await r.json();
      setS((s) => ({ ...s, eventEdit: { id: d.id, name: d.name, tagline: d.tagline || "", description: d.description || "", startDate: d.startDate, endDate: d.endDate, place: d.place || "", accentColor: d.accentColor || "", status: d.status, posterUrl: d.posterUrl, bannerUrl: d.bannerUrl }, eventManage: d }));
    } catch { /* ignore */ }
  }
  /** Relit les champs du formulaire (champs non contrôlés) pour ne rien perdre lors d'un rechargement de l'éditeur. */
  function readEventForm(): Detail {
    const v = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null)?.value ?? "";
    const cur = S.eventEdit || {};
    return { ...cur, name: v("ev-name"), tagline: v("ev-tagline"), description: v("ev-desc"), startDate: v("ev-start") || null, endDate: v("ev-end") || null, place: v("ev-place"), accentColor: v("ev-color"), status: v("ev-status") || "DRAFT" };
  }
  async function saveEvent() {
    // Les fichiers choisis sont lus AVANT tout changement d'état : l'interface est régénérée à chaque rendu,
    // ce qui vide les champs de fichier — lire après « busy: true » ne trouvait plus rien à envoyer.
    const posterFile = (document.getElementById("ev-poster") as HTMLInputElement | null)?.files?.[0] ?? null;
    const bannerFile = (document.getElementById("ev-banner") as HTMLInputElement | null)?.files?.[0] ?? null;
    const f = readEventForm();
    if (!f.name.trim()) { alert("Donne un nom à l'événement."); return; }
    setS((s) => ({ ...s, busy: true, eventMsg: posterFile || bannerFile ? "Envoi des fichiers…" : "" }));
    try {
      let posterUrl: string | null = f.posterUrl ?? null, bannerUrl: string | null = f.bannerUrl ?? null;
      try {
        if (posterFile) posterUrl = await uploadOne(posterFile);
        if (bannerFile) bannerUrl = await uploadOne(bannerFile);
      } catch (e) {
        alert(e instanceof Error ? e.message : "Échec de l'envoi du fichier.");
        setS((s) => ({ ...s, busy: false, eventMsg: "" }));
        return;
      }
      const body = { name: f.name.trim(), tagline: f.tagline, description: f.description, startDate: f.startDate || "", endDate: f.endDate || "", place: f.place, accentColor: f.accentColor, status: f.status, posterUrl: posterUrl || "", bannerUrl: bannerUrl || "" };
      const r = await fetch(`${API}/api/events${f.id ? "/" + f.id : ""}`, { method: f.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({} as Detail));
      if (!r.ok) { alert(Array.isArray(d.message) ? d.message.join("\n") : d.message || "Enregistrement impossible."); setS((s) => ({ ...s, busy: false })); return; }
      setS((s) => ({ ...s, busy: false, eventMsg: "Événement enregistré." }));
      loadMyEvents(); loadEvents();
      await openEventEditor(d.id);
      setS((s) => ({ ...s, eventMsg: "Événement enregistré." }));
    } catch { setS((s) => ({ ...s, busy: false })); }
  }
  async function deleteEvent(id: string) {
    try {
      const r = await fetch(`${API}/api/events/${id}`, { method: "DELETE", headers: authHeaders() });
      if (!r.ok) { const d = await r.json().catch(() => ({} as Detail)); alert(d.message || "Suppression impossible."); return; }
      setS((s) => ({ ...s, eventEdit: s.eventEdit?.id === id ? null : s.eventEdit, eventManage: null }));
      loadMyEvents(); loadEvents(); loadTournaments();
    } catch { /* ignore */ }
  }
  async function eventTournamentLink(eventId: string, tournamentId: string, attach: boolean) {
    // On garde ce qui a été saisi dans le formulaire avant de recharger l'éditeur.
    const f = readEventForm();
    try {
      const r = await fetch(`${API}/api/events/${eventId}/tournaments/${tournamentId}`, { method: attach ? "POST" : "DELETE", headers: authHeaders() });
      if (!r.ok) { const d = await r.json().catch(() => ({} as Detail)); alert(d.message || "Action impossible."); return; }
      const m = await fetch(`${API}/api/events/${eventId}/manage`, { headers: authHeaders() });
      if (m.ok) { const d = await m.json(); setS((s) => ({ ...s, eventManage: d, eventEdit: { ...f, id: eventId } })); }
      loadMyEvents(); loadEvents(); loadTournaments();
    } catch { /* ignore */ }
  }

  /* ---------- Écran de diffusion d'un événement ---------- */
  async function loadEvShow(id: string) {
    try {
      const r = await fetch(`${API}/api/events/${id}`);
      if (!r.ok) return;
      const event = await r.json();
      const list: Detail[] = (event.tournaments || []).slice(0, 12);
      const states: Record<string, Detail> = {};
      await Promise.all(list.map(async (t: Detail) => {
        try { const sr = await fetch(`${API}/api/tournaments/${t.id}/state`); if (sr.ok) states[t.id] = await sr.json(); } catch { /* ignore */ }
      }));
      setS((s) => (s.openEventId === id ? { ...s, evShow: { event, states } } : s));
    } catch { /* API hors ligne */ }
  }

  /** Fiche joueur (nom seul, comme leaderboard() — aucun compte requis) : stats + historique des matchs. */
  async function openPlayerProfile(name: string, uid?: string) {
    setS((s) => ({ ...s, page: "joueur", playerProfile: null, h2hOpponent: "", h2hData: null }));
    window.scrollTo({ top: 0 });
    try {
      const r = await fetch(`${API}/api/tournaments/players/profile?name=${encodeURIComponent(name)}${uid ? `&uid=${encodeURIComponent(uid)}` : ""}`);
      if (r.ok) { const d = await r.json(); setS((s) => (s.page === "joueur" ? { ...s, playerProfile: d } : s)); }
    } catch { /* API hors ligne */ }
  }

  /** Confrontations directes entre le joueur de la fiche ouverte et un adversaire choisi. */
  async function loadHeadToHead(a: string, b: string, auid?: string) {
    if (!b.trim() || b.trim().toLowerCase() === a.toLowerCase()) return;
    setS((s) => ({ ...s, h2hBusy: true }));
    try {
      const r = await fetch(`${API}/api/tournaments/players/head-to-head?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b.trim())}${auid ? `&auid=${encodeURIComponent(auid)}` : ""}`);
      const d = r.ok ? await r.json() : null;
      setS((s) => ({ ...s, h2hData: d, h2hBusy: false }));
    } catch { setS((s) => ({ ...s, h2hBusy: false })); }
  }

  /* ---------- Partage ---------- */
  /** Lien public d'un tournoi/événement : essaie le partage natif du téléphone, sinon ouvre la fenêtre de partage. */
  async function openShare(kind: "tournoi" | "evenement", id: string, title: string) {
    const url = `${window.location.origin}/${kind === "tournoi" ? "tournois" : "evenements"}/${id}`;
    const nav = navigator as Navigator & { share?: (data: { title?: string; url?: string }) => Promise<void>; canShare?: (data?: { url?: string }) => boolean };
    if (nav.share && (!nav.canShare || nav.canShare({ url }))) {
      try { await nav.share({ title, url }); return; } catch { /* annulé ou indisponible : repli sur la fenêtre */ }
    }
    setS((s) => ({ ...s, shareTarget: { url, title } }));
  }
  async function copyShareLink() {
    const s = S.shareTarget;
    if (!s) return;
    try {
      await navigator.clipboard.writeText(s.url);
    } catch {
      // Contexte non sécurisé ou permission refusée : repli sur la sélection + copie classique.
      const ta = document.createElement("textarea");
      ta.value = s.url; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch { /* ignore */ }
      ta.remove();
    }
    setS((st) => (st.shareTarget ? { ...st, shareTarget: { ...st.shareTarget, copied: true } } : st));
    setTimeout(() => setS((st) => (st.shareTarget?.copied ? { ...st, shareTarget: { ...st.shareTarget, copied: false } } : st)), 2000);
  }

  function showToast(msg: string) {
    setS((s) => ({ ...s, toast: msg }));
    setTimeout(() => setS((s) => (s.toast === msg ? { ...s, toast: null } : s)), 4000);
  }
  /** Prévient par e-mail les joueurs d'un match (voir TournamentsService.notifyMatch). */
  async function notifyMatch(tid: string, key: string) {
    if (!token()) return;
    try {
      const r = await fetch(`${API}/api/tournaments/${tid}/notify-match`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ key }) });
      const d = await r.json().catch(() => null);
      if (!r.ok) { showToast(d?.message || "Impossible de prévenir les joueurs."); return; }
      const parts: string[] = [];
      if (d.sent.length) parts.push(`Prévenu : ${d.sent.join(", ")}`);
      if (d.unreachable.length) parts.push(`Sans compte (à appeler) : ${d.unreachable.join(", ")}`);
      if (d.mailFailed) parts.push(`${d.mailFailed} e-mail non envoyé`);
      showToast(parts.join(" · ") || "Aucun joueur à prévenir.");
    } catch { showToast("Impossible de prévenir les joueurs."); }
  }
  /** Lance le prochain match de la file : l'ajoute à la régie, lui donne le premier poste libre
   * (« Table 1 », « Table 2 »… — même préfixe que les postes déjà utilisés) puis prévient les joueurs. */
  async function launchNext(tid: string) {
    const t = S.detail;
    if (!t) return;
    const actives = getActiveMatches(S, t);
    const next = queueItemsOf(t, actives)[0];
    if (!next) { showToast("Aucun match en attente."); return; }
    const currentKeys = actives.map(activeKey);
    setS((s) => ({ ...s, activeMatchIds: [...currentKeys, next.id] }));
    if (!(t.stations && t.stations[next.id])) {
      const used = new Set<string>(currentKeys.map((k) => (t.stations?.[k] || "").trim()).filter(Boolean));
      const known: string[] = Object.values(t.stations || {}) as string[];
      const prefix = (known.map((v) => /^(.*?)(\d+)$/.exec(v)).find(Boolean)?.[1]) ?? "Table ";
      let n = 1;
      while (used.has(`${prefix}${n}`)) n++;
      await act(`${API}/api/tournaments/${tid}/station`, { key: next.id, label: `${prefix}${n}` });
    }
    await act(`${API}/api/tournaments/${tid}/match-start`, { key: next.id, on: true });
    await notifyMatch(tid, next.id);
  }

  /** Crée un nouveau tournoi avec les réglages de celui-ci (modèle) puis l'ouvre. */
  async function duplicateTournament(id: string) {
    if (!token()) return;
    try {
      const r = await fetch(`${API}/api/tournaments/${id}/duplicate`, { method: "POST", headers: authHeaders() });
      const d = await r.json().catch(() => null);
      if (!r.ok) { alert(d?.message || "Impossible de dupliquer ce tournoi."); return; }
      await loadTournaments();
      await openDetail(d.id);
      showToast("Copie créée : ajoute les joueurs et lance-la quand tu veux.");
    } catch { alert("Impossible de dupliquer ce tournoi."); }
  }
  /** Ouvre le code d'intégration (iframe) d'un tournoi — même URL chromeless que le bouton "Mode Show". */
  function openEmbed(id: string) {
    const url = `${window.location.origin}/tournois/${id}#show=${id}`;
    const code = `<iframe src="${url}" style="width:100%;height:600px;border:0" allowfullscreen></iframe>`;
    setS((s) => ({ ...s, embedTarget: { code } }));
  }
  async function copyEmbedCode() {
    const e = S.embedTarget;
    if (!e) return;
    try {
      await navigator.clipboard.writeText(e.code);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = e.code; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch { /* ignore */ }
      ta.remove();
    }
    setS((st) => (st.embedTarget ? { ...st, embedTarget: { ...st.embedTarget, copied: true } } : st));
    setTimeout(() => setS((st) => (st.embedTarget?.copied ? { ...st, embedTarget: { ...st.embedTarget, copied: false } } : st)), 2000);
  }

  /* ---------- Check-in ---------- */
  /** Pointe (ou dépointe) un joueur ; renvoie le résultat de l'API pour que l'appelant affiche le message qui convient. */
  async function postCheckIn(tid: string, body: { code?: string; registrationId?: string; present?: boolean }): Promise<{ ok: boolean; message: string; data?: Detail }> {
    try {
      const r = await fetch(`${API}/api/tournaments/${tid}/checkin`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({} as Detail));
      if (!r.ok) return { ok: false, message: Array.isArray(d.message) ? d.message.join(" ") : d.message || "Pointage impossible." };
      return { ok: true, message: d.already ? `${d.playerName} était déjà pointé(e)` : `✓ ${d.playerName} est présent(e)`, data: d };
    } catch { return { ok: false, message: "API injoignable." }; }
  }
  async function toggleCheckIn(tid: string, regId: string, present: boolean) {
    const res = await postCheckIn(tid, { registrationId: regId, present });
    if (!res.ok) { alert(res.message); return; }
    loadRegsPanel(tid);
  }
  /** Lien ouvert depuis l'appareil photo du téléphone (QR du billet) : pointe le joueur si le compte est organisateur/admin. */
  async function checkInFromLink(value: string) {
    const [tid] = value.split(".");
    history.replaceState(null, "", window.location.pathname + "#t=" + tid);
    await openDetail(tid);
    const role = storedRole();
    if (!token() || !(role === "ORGANIZER" || role === "ADMIN")) {
      alert("Ce QR code est un billet de joueur. Connecte-toi avec le compte organisateur du tournoi, puis rescanne-le pour pointer sa présence.");
      return;
    }
    const res = await postCheckIn(tid, { code: value });
    alert(res.message);
    if (res.ok) loadRegsPanel(tid);
  }

  /* ---------- Paiement en ligne (FedaPay / KkiaPay) ---------- */
  type PayKind = "registration" | "order" | "credit";
  /** Recharge ce qu'un paiement confirmé vient de modifier (profil, inscriptions, crédits, liste des tournois). */
  async function refreshAfterPayment() {
    setS((s) => ({ ...s, me: null, myRegs: null, myOrders: null, myResults: null }));
    await Promise.all([loadRegIds(), loadCreditsMe(), loadTournaments()]);
  }
  /** Demande au serveur de vérifier la transaction auprès du prestataire : c'est lui qui valide, jamais le navigateur. */
  async function verifyOnlinePayment(provider: "fedapay" | "kkiapay", kind: PayKind, refId: string, transactionId?: string): Promise<boolean> {
    try {
      const r = await fetch(`${API}/api/payments/verify`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ provider, kind, refId, transactionId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { alert(d.message || "Vérification du paiement impossible."); return false; }
      if (d.paid) { await refreshAfterPayment(); alert("Paiement confirmé. Merci !"); return true; }
      alert("Le paiement n'est pas encore confirmé. S'il a abouti, il sera validé automatiquement dans quelques instants.");
      return false;
    } catch { alert("Vérification du paiement impossible pour le moment."); return false; }
  }
  /** Lance le paiement en ligne d'un élément déjà créé « en attente » : FedaPay redirige vers sa page, KkiaPay ouvre son widget. */
  async function startOnlinePay(kind: PayKind, refId: string, method: string) {
    const provider = method === "KkiaPay" ? "kkiapay" : "fedapay";
    try {
      const r = await fetch(`${API}/api/payments/checkout`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ provider, kind, refId, returnOrigin: window.location.origin }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { alert(d.message || "Paiement en ligne impossible. Ta demande reste enregistrée, l'équipe peut la confirmer manuellement."); return; }
      if (d.provider === "fedapay") { window.location.href = d.url; return; }
      await new Promise<void>((resolve, reject) => {
        if ((window as unknown as Detail).openKkiapayWidget) { resolve(); return; }
        const sc = document.createElement("script");
        sc.src = "https://cdn.kkiapay.me/k.js"; sc.onload = () => resolve(); sc.onerror = () => reject(new Error("kkiapay"));
        document.head.appendChild(sc);
      });
      const w = window as unknown as Detail;
      w.removeKkiapayListener?.("success");
      w.addKkiapayListener("success", (resp: { transactionId?: string }) => { void verifyOnlinePayment("kkiapay", kind, refId, resp?.transactionId); });
      w.openKkiapayWidget({ amount: d.amountXof, api_key: d.publicKey, sandbox: !!d.sandbox, name: S.user?.displayName || "", email: S.user?.email || "", data: d.paymentId });
    } catch { alert("Impossible d'ouvrir le paiement en ligne. Ta demande reste enregistrée, l'équipe peut la confirmer manuellement."); }
  }
  async function buyCredits(method?: string) {
    const pay = method ?? S.creditBuyPay;
    if (S.creditBuyQty < 1 || !pay) return;
    setS((s) => ({ ...s, creditBuyBusy: true }));
    try {
      const r = await fetch(`${API}/api/credits/purchase`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ credits: S.creditBuyQty, paymentMethod: pay }),
      });
      if (r.status === 401) { setS((s) => ({ ...s, page: "auth", user: null, creditBuyBusy: false })); return; }
      const data = await r.json();
      if (!r.ok) { alert(data.message || "Demande impossible."); setS((s) => ({ ...s, creditBuyBusy: false })); return; }
      await loadCreditsMe();
      setS((s) => ({ ...s, creditBuyBusy: false, creditBuyQty: 1, creditBuyPay: "" }));
      if (ONLINE_PAY.includes(data.paymentMethod)) { await startOnlinePay("credit", data.id, data.paymentMethod); return; }
      alert(`Demande enregistrée · ${money(data.amountXof)} via ${data.paymentMethod}.\nTes crédits seront ajoutés dès confirmation par l'équipe Miabe.`);
    } catch { setS((s) => ({ ...s, creditBuyBusy: false })); }
  }
  async function cancelCreditPurchase(id: string) {
    try {
      const r = await fetch(`${API}/api/credits/purchase/${id}`, { method: "DELETE", headers: authHeaders() });
      if (r.ok) await loadCreditsMe();
    } catch { /* ignore */ }
  }
  async function checkout(method?: string) {
    const pay = method ?? S.cartPayPick;
    if (!S.cartItems.length || !pay) return;
    if (!token()) { setS((s) => ({ ...s, cartOpen: false, page: "auth" })); window.scrollTo({ top: 0 }); return; }
    setS((s) => ({ ...s, cartBusy: true }));
    try {
      const r = await fetch(`${API}/api/orders`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          items: S.cartItems.map((i) => ({ name: i.name, priceXof: i.price, productId: i.id })),
          paymentMethod: pay, pointsToRedeem: S.cartPointsToRedeem || 0,
        }),
      });
      if (r.status === 401) { setS((s) => ({ ...s, page: "auth", user: null, cartBusy: false })); return; }
      if (r.ok) {
        const o = await r.json();
        const payOnline = ONLINE_PAY.includes(o.paymentMethod) && o.totalXof > 0;
        setS((s) => ({ ...s, cartItems: [], cartPayPick: "", cartBusy: false, cartPointsToRedeem: 0, me: null, myOrders: null, loyaltyHistory: null, lastOrder: { reference: o.reference, totalXof: o.totalXof, paymentMethod: o.paymentMethod } }));
        if (payOnline) await startOnlinePay("order", o.id, o.paymentMethod);
      } else setS((s) => ({ ...s, cartBusy: false }));
    } catch { setS((s) => ({ ...s, cartBusy: false })); }
  }

  async function loadAdmin() {
    try {
      const get = (p: string) => fetch(`${API}/api/admin/${p}`, { headers: authHeaders() });
      const [ovR, usR, nwR, prR, orR, payR, crR, orgR, clubR] = await Promise.all([get("overview"), get("users"), get("news"), get("products"), get("orders"), get("payments"), get("credit-purchases"), get("organizers"), get("club-requests")]);
      if (ovR.ok && usR.ok) {
        const [overview, users, news, products, orders, payments, creditPurchases, organizers, clubRequests] = await Promise.all([
          ovR.json(), usR.json(),
          nwR.ok ? nwR.json() : [], prR.ok ? prR.json() : [], orR.ok ? orR.json() : [], payR.ok ? payR.json() : [], crR.ok ? crR.json() : [], orgR.ok ? orgR.json() : [], clubR.ok ? clubR.json() : [],
        ]);
        setS((s) => ({ ...s, admin: { overview, users, news, products, orders, payments, creditPurchases, organizers, clubRequests } }));
      }
    } catch { /* ignore */ }
  }
  /** Envoie le fichier choisi dans <input type=file> et renvoie son URL (/uploads/…). */
  /** Envoie UN fichier déjà obtenu (utile pour les sélections multiples, où l'on ne peut pas se
   * contenter du premier fichier du champ). Lève une erreur explicite, sans alerte. */
  async function uploadOne(file: File): Promise<string> {
    // Les photos sont redimensionnées/ré-encodées ici : plus rien à compresser à la main, et le
    // site reste léger. Les vidéos et GIF passent tels quels (non réencodables côté navigateur).
    const f = await optimizeImage(file);
    // Contrôle de taille AVANT l'envoi : l'API tourne en fonction serverless, dont le corps de
    // requête est plafonné (~4,5 Mo) bien avant la limite applicative. Sans ce garde-fou, un
    // fichier trop lourd part quand même et revient en 413 avec un corps texte (pas du JSON),
    // ce qui donnait un message d'erreur générique et incompréhensible.
    if (f.size > MAX_UPLOAD_BYTES) {
      const isVideo = f.type.startsWith("video/");
      throw new Error(`« ${file.name} » fait ${(f.size / 1024 / 1024).toFixed(1)} Mo : la taille maximale est de ${MAX_UPLOAD_MB} Mo.${isVideo ? " Les vidéos ne peuvent pas être compressées automatiquement — réduis sa durée ou sa définition." : " Même optimisée, l'image reste trop lourde."}`);
    }
    const fd = new FormData();
    fd.append("file", f);
    const r = await fetch(`${API}/api/uploads`, { method: "POST", headers: authHeaders(), body: fd });
    if (!r.ok) {
      const raw = await r.text().catch(() => "");
      let msg = "";
      try { msg = (JSON.parse(raw) as Detail).message || ""; } catch { /* corps non-JSON (413 de la plateforme) */ }
      if (!msg) msg = r.status === 413 ? `« ${f.name} » est trop lourd (${MAX_UPLOAD_MB} Mo maximum).` : `Échec de l'envoi de « ${f.name} ».`;
      throw new Error(msg);
    }
    return (await r.json()).url as string;
  }
  async function uploadFile(inputId: string): Promise<string | null> {
    const el = document.getElementById(inputId) as HTMLInputElement | null;
    const f = el?.files?.[0];
    if (!f) return null;
    return uploadOne(f);
  }
  /** uploadFile + message à l'utilisateur, pour les enregistrements qui s'interrompent en cas d'échec
   * (uploadFile lui-même reste silencieux : saveSite, lui, préfère collecter les erreurs et continuer). */
  async function uploadOrNotify(inputId: string): Promise<string | null> {
    try { return await uploadFile(inputId); }
    catch (e) { alert(e instanceof Error ? e.message : "Échec de l'envoi du fichier."); throw e; }
  }

  /** Enregistre les réglages du site (identité, héro, slider, partenaires). */
  /** Relit les champs texte des lignes partenaires/pubs depuis le DOM, sans perdre les logos déjà choisis. */
  function syncPartnersFromDom(list: NonNullable<State["partnersEdit"]>) {
    return list.map((p) => ({
      ...p,
      name: (document.getElementById(`pt-${p.key}-name`) as HTMLInputElement | null)?.value ?? p.name,
      display: ((document.getElementById(`pt-${p.key}-display`) as HTMLSelectElement | null)?.value as "both" | "logo" | "name" | undefined) ?? p.display,
    }));
  }
  function syncAdsFromDom(list: NonNullable<State["adsEdit"]>) {
    return list.map((a) => ({
      ...a,
      label: (document.getElementById(`ad-${a.key}-label`) as HTMLInputElement | null)?.value ?? a.label,
      linkUrl: (document.getElementById(`ad-${a.key}-link`) as HTMLInputElement | null)?.value ?? a.linkUrl,
      page: (document.getElementById(`ad-${a.key}-page`) as HTMLSelectElement | null)?.value ?? a.page,
    }));
  }
  function syncSlidesFromDom(list: NonNullable<State["slidesEdit"]>) {
    const val = (id: string, fallback: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? fallback;
    return list.map((sl) => ({
      ...sl,
      tag: val(`sl-${sl.key}-tag`, sl.tag),
      title: val(`sl-${sl.key}-title`, sl.title),
      sub: val(`sl-${sl.key}-sub`, sl.sub),
      cta: val(`sl-${sl.key}-cta`, sl.cta),
    }));
  }
  const newKey = () => Math.random().toString(36).slice(2, 9);

  async function saveSite() {
    const val = (x: string) => (document.getElementById(x) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? "";
    let logoUrl = S.site?.brand?.logoUrl ?? null;
    let heroBg = S.site?.hero?.bgUrl ?? null;
    const slideRows = syncSlidesFromDom(S.slidesEdit ?? []);
    const partnerRows = syncPartnersFromDom(S.partnersEdit ?? []);
    const adRows = syncAdsFromDom(S.adsEdit ?? []);
    // Un envoi d'image raté (fichier trop lourd, réseau…) ne doit PAS faire perdre tout le reste :
    // auparavant un seul échec interrompait la fonction, et aucun réglage — pas même les textes
    // déjà saisis — n'était enregistré. On collecte les erreurs et on enregistre quand même.
    const imgErrors: string[] = [];
    const tryUpload = async (inputId: string): Promise<string | null> => {
      try { return await uploadFile(inputId); }
      catch (e) { imgErrors.push(e instanceof Error ? e.message : "Envoi d'image impossible."); return null; }
    };
    const up = await tryUpload("b-logo"); if (up) logoUrl = up;
    const bg = await tryUpload("h-bg"); if (bg) heroBg = bg;
    for (const sl of slideRows) { const im = await tryUpload(`sl-${sl.key}-img`); if (im) sl.imageUrl = im; }
    for (const p of partnerRows) { const im = await tryUpload(`pt-${p.key}-logo`); if (im) p.logoUrl = im; }
    for (const a of adRows) { const im = await tryUpload(`ad-${a.key}-img`); if (im) a.imageUrl = im; }
    const brand = { name1: val("b-name1").trim() || "Miabe", name2: val("b-name2").trim(), logoUrl };
    const hero = {
      kicker: val("h-kicker").trim(), title: val("h-title"), subtitle: val("h-sub").trim(),
      bgUrl: heroBg,
      stats: [0, 1, 2].map((i) => ({ v: val(`h-s${i}v`).trim(), k: val(`h-s${i}k`).trim() })).filter((st) => st.v || st.k),
    };
    const slides = slideRows
      .filter((sl) => sl.title.trim())
      .map((sl) => ({ tag: sl.tag.trim(), title: sl.title.trim(), sub: sl.sub.trim(), cta: sl.cta.trim(), imageUrl: sl.imageUrl }));
    const partners = partnerRows.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), logoUrl: p.logoUrl, display: p.display || "both" }));
    const ads = adRows.filter((a) => a.imageUrl).map((a) => ({ label: a.label.trim(), linkUrl: a.linkUrl.trim(), imageUrl: a.imageUrl, page: a.page || "accueil" }));
    try {
      const save = (key: string, value: unknown) => fetch(`${API}/api/admin/settings/${key}`, {
        method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ value }),
      });
      const rs = await Promise.all([save("brand", brand), save("hero", hero), save("slides", slides), save("partners", partners), save("ads", ads)]);
      if (rs.every((r) => r.ok)) {
        await loadSettings();
        setS((s) => ({
          ...s,
          siteMsg: imgErrors.length ? `Textes enregistrés, mais image non envoyée — ${imgErrors[0]}` : "Réglages enregistrés.",
          slide: 0, slidesEdit: null, partnersEdit: null, adsEdit: null,
        }));
      } else setS((s) => ({ ...s, siteMsg: "Certains réglages n'ont pas pu être enregistrés." }));
    } catch { setS((s) => ({ ...s, siteMsg: "API injoignable." })); }
  }

  /** Enregistre les deux pages légales (Setting générique, clés "legal" et "privacy"). */
  async function saveLegalPages() {
    const val = (x: string) => (document.getElementById(x) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? "";
    const save = (key: string, value: unknown) => fetch(`${API}/api/admin/settings/${key}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ value }),
    });
    try {
      const rs = await Promise.all([
        save("legal", { title: val("lg-title").trim() || "Mentions légales", body: val("lg-body") }),
        save("privacy", { title: val("pv-title").trim() || "Politique de confidentialité", body: val("pv-body") }),
      ]);
      if (rs.every((r) => r.ok)) { await loadSettings(); setS((s) => ({ ...s, siteMsg: "Réglages enregistrés." })); }
      else setS((s) => ({ ...s, siteMsg: "Enregistrement impossible." }));
    } catch { setS((s) => ({ ...s, siteMsg: "API injoignable." })); }
  }
  /** Enregistre le taux de conversion des points fidélité (Setting générique, clé "loyalty"). */
  async function saveLoyalty() {
    const val = (x: string) => (document.getElementById(x) as HTMLInputElement | null)?.value ?? "";
    const value = { pointValueXof: Math.max(1, parseInt(val("ly-value")) || 100), maxRedeemPercent: Math.min(100, Math.max(0, parseInt(val("ly-percent")) || 0)) };
    try {
      const r = await fetch(`${API}/api/admin/settings/loyalty`, {
        method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ value }),
      });
      if (r.ok) { await loadSettings(); setS((s) => ({ ...s, siteMsg: "Réglages enregistrés." })); }
      else setS((s) => ({ ...s, siteMsg: "Enregistrement impossible." }));
    } catch { setS((s) => ({ ...s, siteMsg: "API injoignable." })); }
  }

  /** Retire le fond (image/vidéo) du héro : retour aux halos animés. */
  async function clearHeroBg() {
    const hero = { ...(S.site?.hero || {}), bgUrl: null };
    try {
      const r = await fetch(`${API}/api/admin/settings/hero`, {
        method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ value: hero }),
      });
      if (r.ok) { await loadSettings(); setS((s) => ({ ...s, siteMsg: "Fond du héro retiré." })); }
    } catch { /* ignore */ }
  }

  /** Enregistre un article (avec envoi de l'image si un fichier est choisi). */
  async function saveNews(id: string) {
    const val = (x: string) => (document.getElementById(x) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? "";
    const body: Detail = { title: val("n-title").trim(), category: val("n-cat").trim() || "Actualité", body: val("n-body").trim() };
    if (!body.title) { alert("Le titre est requis."); return; }
    try { const img = await uploadOrNotify("n-img"); if (img) body.imageUrl = img; } catch { return; }
    if (id === "new") adminAct("news", "POST", { ...body, published: true });
    else adminAct(`news/${id}`, "PATCH", body);
  }

  /** Enregistre un produit (avec envoi de l'image si un fichier est choisi). */
  async function saveProd(id: string) {
    const val = (x: string) => (document.getElementById(x) as HTMLInputElement | null)?.value ?? "";
    const body: Detail = {
      name: val("pr-name").trim(), category: val("pr-cat").trim() || "Goodies", priceXof: parseInt(val("pr-price")) || 0, stock: parseInt(val("pr-stock")) || 0,
      loyaltyEligible: (document.getElementById("pr-loyalty") as HTMLInputElement | null)?.checked ?? false,
      showOnHome: (document.getElementById("pr-showhome") as HTMLInputElement | null)?.checked ?? false,
      description: val("pr-desc").trim(),
    };
    if (!body.name) { alert("Le nom du produit est requis."); return; }
    try { const img = await uploadOrNotify("pr-img"); if (img) body.imageUrl = img; } catch { return; }
    if (id === "new") adminAct("products", "POST", body);
    else adminAct(`products/${id}`, "PATCH", body);
  }

  /** Écriture admin générique puis rafraîchissement (panneau + site public). */
  /** Écriture roster/clubs (hors /api/admin) puis rafraîchissement de la base. */
  async function rosterAct(url: string, method: string, body?: unknown) {
    try {
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json", ...authHeaders() }, body: body ? JSON.stringify(body) : undefined });
      if (!r.ok) { const d = await r.json().catch(() => ({} as Detail)); alert(d.message || "Action impossible."); return; }
      setS((s) => ({ ...s, rosterEdit: null, clubEdit: null, gameEdit: null }));
      await loadRoster();
    } catch { /* ignore */ }
  }
  function saveRosterPlayer(id: string) {
    const val = (x: string) => (document.getElementById(x) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";
    const name = val("ro-name").trim();
    if (!name) { alert("Le nom est requis."); return; }
    const body = { name, city: val("ro-city").trim(), clubId: val("ro-club") || undefined };
    if (id === "new") rosterAct(`${API}/api/roster`, "POST", body);
    else rosterAct(`${API}/api/roster/${id}`, "PATCH", body);
  }
  async function saveClub(id: string) {
    const val = (x: string) => (document.getElementById(x) as HTMLInputElement | null)?.value ?? "";
    const name = val("cl-name").trim();
    if (!name) { alert("Le nom du club est requis."); return; }
    const body: Detail = { name, city: val("cl-city").trim() };
    try { const logo = await uploadOrNotify("cl-logo"); if (logo) body.logoUrl = logo; } catch { return; }
    if (id === "new") rosterAct(`${API}/api/clubs`, "POST", body);
    else rosterAct(`${API}/api/clubs/${id}`, "PATCH", body);
  }
  function saveGame(id: string) {
    const name = (document.getElementById("gm-name") as HTMLInputElement | null)?.value.trim() ?? "";
    if (!name) { alert("Le nom du jeu est requis."); return; }
    if (id === "new") rosterAct(`${API}/api/games`, "POST", { name });
    else rosterAct(`${API}/api/games/${id}`, "PATCH", { name });
  }
  /** Fiche complète d'un joueur de la base (Admin → Joueurs → Voir le profil). */
  async function loadPlayerDetail(id: string) {
    setS((s) => ({ ...s, playerDetailBusy: true }));
    try {
      const r = await fetch(`${API}/api/roster/${id}`, { headers: authHeaders() });
      const data = r.ok ? await r.json() : null;
      setS((s) => ({ ...s, playerDetail: data, playerDetailBusy: false }));
    } catch { setS((s) => ({ ...s, playerDetailBusy: false })); }
  }
  /** Génère un mot de passe temporaire pour un membre bloqué et l'affiche une seule fois. */
  async function resetUserPassword(id: string) {
    try {
      const r = await fetch(`${API}/api/admin/users/${id}/reset-password`, { method: "POST", headers: authHeaders() });
      const d = await r.json();
      if (!r.ok) { alert(d.message || "Réinitialisation impossible."); return; }
      alert(
        `Mot de passe temporaire pour ${d.email} :\n\n${d.password}\n\n` +
        (d.emailed
          ? "Il vient aussi de lui être envoyé par e-mail."
          : "La messagerie n'étant pas configurée, transmets-le-lui toi-même.") +
        "\n\nIl doit le changer depuis « Mon compte » après connexion.",
      );
    } catch { alert("API injoignable."); }
  }
  async function adminAct(path: string, method: string, body?: unknown) {
    try {
      const r = await fetch(`${API}/api/admin/${path}`, {
        method, headers: { "Content-Type": "application/json", ...authHeaders() },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!r.ok) { const d = await r.json().catch(() => ({} as Detail)); alert(d.message || "Action impossible."); return; }
      setS((s) => ({ ...s, newsEdit: null, prodEdit: null }));
      await loadAdmin();
      loadNews();
      loadProducts();
    } catch { /* ignore */ }
  }
  async function setRole(uid: string, role: string) {
    try {
      const r = await fetch(`${API}/api/admin/users/${uid}/role`, { method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ role }) });
      if (r.ok) loadAdmin();
    } catch { /* ignore */ }
  }

  /* ---------- Espace membre : profil, inscriptions, commandes ---------- */
  async function loadMe() {
    try {
      const [meR, regR, ordR, resR] = await Promise.all([
        fetch(`${API}/api/users/me`, { headers: authHeaders() }),
        fetch(`${API}/api/users/me/registrations`, { headers: authHeaders() }),
        fetch(`${API}/api/users/me/orders`, { headers: authHeaders() }),
        fetch(`${API}/api/users/me/results`, { headers: authHeaders() }),
      ]);
      if (!meR.ok) return;
      const me = await meR.json();
      const myRegs = regR.ok ? await regR.json() : [];
      const myOrders = ordR.ok ? await ordR.json() : [];
      const myResults = resR.ok ? await resR.json() : [];
      let myTourns: Detail[] | null = null;
      if (me.role === "ORGANIZER" || me.role === "ADMIN") {
        const tR = await fetch(`${API}/api/tournaments/mine`, { headers: authHeaders() });
        if (tR.ok) myTourns = await tR.json();
      }
      setS((s) => ({ ...s, me, myRegs, myOrders, myTourns, myResults }));
      void loadMyNext();
    } catch { /* ignore */ }
  }
  /** « Mon prochain match » (membre inscrit à un tournoi en direct). */
  async function loadMyNext() {
    if (!token()) return;
    try {
      const r = await fetch(`${API}/api/tournaments/my-next-matches`, { headers: authHeaders() });
      if (r.ok) { const d = await r.json(); setS((s) => ({ ...s, myNext: Array.isArray(d) ? d : [] })); }
    } catch { /* ignore */ }
  }
  async function loadRegIds() {
    if (!token()) return;
    try {
      const r = await fetch(`${API}/api/tournaments/registrations/mine`, { headers: authHeaders() });
      if (r.ok) { const ids = await r.json(); setS((s) => ({ ...s, regIds: ids })); }
    } catch { /* ignore */ }
  }
  async function saveProfile() {
    const val = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? "";
    const me = S.me!;
    const displayName = val("p-name").trim();
    const club = val("p-club").trim();
    // Le pseudo n'est envoyé que s'il a vraiment changé — l'API le plafonne à 1x/mois, pas
    // question de déclencher ce contrôle à chaque sauvegarde d'un autre champ du profil.
    const body: Record<string, unknown> = { city: val("p-city"), favoriteGame: val("p-game"), phone: val("p-phone"), bio: val("p-bio") };
    if (displayName && displayName !== me.displayName) body.displayName = displayName;
    if (club !== (me.clubName || "")) body.club = club;
    try {
      const r = await fetch(`${API}/api/users/me`, {
        method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) { setS((s) => ({ ...s, profileMsg: data.message || "Erreur d'enregistrement." })); return; }
      // synchronise le nom affiché dans la session locale
      const u = { ...S.user!, displayName: data.displayName };
      localStorage.setItem("vlome_user", JSON.stringify(u));
      setS((s) => ({ ...s, me: data, user: u, profileEdit: false, profileMsg: "" }));
    } catch { setS((s) => ({ ...s, profileMsg: "API injoignable." })); }
  }
  async function savePassword() {
    const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";
    const currentPassword = val("pw-cur"), newPassword = val("pw-new");
    if (!currentPassword || newPassword.length < 6) { setS((s) => ({ ...s, passMsg: "Nouveau mot de passe : 6 caractères minimum." })); return; }
    try {
      const r = await fetch(`${API}/api/users/me/password`, {
        method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await r.json();
      setS((s) => ({ ...s, passMsg: r.ok ? "Mot de passe modifié." : data.message || "Échec." }));
    } catch { setS((s) => ({ ...s, passMsg: "API injoignable." })); }
  }
  /** Lit le formulaire d'équipe du capitaine (nom + joueurs) ; retombe sur le brouillon gardé en état si les champs ne sont pas à l'écran. */
  function readTeamForm(): { teamName: string; members: string[] } | null {
    const size: number = S.detail?.teamSize || 0;
    const el = (id: string) => document.getElementById(id) as HTMLInputElement | null;
    const teamName = (el("team-name")?.value ?? S.teamDraft?.name ?? "").trim();
    const members = Array.from({ length: size }, (_, i) => (el(`team-m-${i}`)?.value ?? S.teamDraft?.members[i] ?? "").trim());
    if (teamName.length < 2) { alert("Donne un nom à ton équipe."); return null; }
    if (members.some((m) => !m)) { alert(`Renseigne les ${size} joueurs de l'équipe.`); return null; }
    return { teamName, members };
  }
  function captureTeamDraft() {
    const size: number = S.detail?.teamSize || 0;
    if (!size) return;
    const el = (id: string) => document.getElementById(id) as HTMLInputElement | null;
    const draft = { name: el("team-name")?.value ?? "", members: Array.from({ length: size }, (_, i) => el(`team-m-${i}`)?.value ?? "") };
    setS((s) => ({ ...s, teamDraft: draft }));
  }
  async function toggleReg(id: string, register: boolean, method?: string) {
    if (!token()) { setS((s) => ({ ...s, page: "auth" })); window.scrollTo({ top: 0 }); return; }
    const fee = S.detail?.entryFeeXof || 0;
    const ly = S.loyaltySettings || { pointValueXof: 100, maxRedeemPercent: 50 };
    const maxXof = Math.floor((fee * ly.maxRedeemPercent) / 100);
    const maxPoints = Math.max(0, Math.min(S.loyaltyBalance, Math.floor(maxXof / ly.pointValueXof)));
    const pointsToRedeem = Math.min(S.regPointsToRedeem, maxPoints);
    const netFee = Math.max(0, fee - pointsToRedeem * ly.pointValueXof);
    const payMethod = method ?? S.payPick;
    const team = register && S.detail?.teamSize ? readTeamForm() : null;
    if (register && S.detail?.teamSize && !team) return;
    if (register && netFee > 0 && !payMethod) { alert("Choisis un moyen de paiement avant de t'inscrire."); return; }
    try {
      const r = await fetch(`${API}/api/tournaments/${id}/register`, {
        method: register ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: register && (fee > 0 || team) ? JSON.stringify({ ...(fee > 0 ? { paymentMethod: payMethod, pointsToRedeem } : {}), ...(team || {}) }) : undefined,
      });
      if (r.status === 401) { setS((s) => ({ ...s, page: "auth", user: null })); return; }
      const data = await r.json();
      if (!r.ok) { alert(data.message || "Action impossible."); return; }
      await loadRegIds();
      await loadTournaments();
      setS((s) => ({ ...s, me: null, myRegs: null, myResults: null, payPick: "", regPointsToRedeem: 0, teamDraft: null })); // le profil se rechargera
      loadLoyaltyMe();
      if (S.openId === id) {
        const st = await fetch(`${API}/api/tournaments/${id}/state`);
        if (st.ok) { const d = await st.json(); setS((s) => ({ ...s, detail: d })); }
      }
      if (register && data.pending && data.registrationId && ONLINE_PAY.includes(payMethod)) { await startOnlinePay("registration", data.registrationId, payMethod); return; }
      if (register && data.pending) alert(`Inscription enregistrée · ${money(data.amountXof)} via ${payMethod}.\nElle sera confirmée par l'organisateur dès réception du paiement.`);
    } catch { /* ignore */ }
  }

  /** Inscriptions du tournoi ouvert (cockpit organisateur) — payées et en attente. */
  async function loadRegsPanel(id: string) {
    try {
      const r = await fetch(`${API}/api/tournaments/${id}/registrations`, { headers: authHeaders() });
      if (r.ok) { const rows = await r.json(); setS((s) => ({ ...s, regsPanel: rows })); }
    } catch { /* ignore */ }
  }
  async function confirmCreditPurchaseAdmin(id: string) {
    try {
      const r = await fetch(`${API}/api/admin/credit-purchases/${id}/confirm`, { method: "POST", headers: authHeaders() });
      const data = await r.json();
      if (!r.ok) { alert(data.message || "Confirmation impossible."); return; }
      await loadAdmin();
    } catch { /* ignore */ }
  }
  /** Approuve/refuse une demande organisateur et fixe ses plafonds (nb de tournois, joueurs max). */
  async function reviewOrganizer(id: string, status: "APPROVED" | "REJECTED") {
    const val = (x: string) => (document.getElementById(x) as HTMLInputElement | null)?.value.trim() ?? "";
    const maxTRaw = val(`org-maxt-${id}`), maxPRaw = val(`org-maxp-${id}`);
    const body: Detail = {
      status,
      maxTournaments: maxTRaw === "" ? null : Math.max(0, parseInt(maxTRaw) || 0),
      maxPlayers: maxPRaw === "" ? null : Math.max(1, parseInt(maxPRaw) || 1),
    };
    try {
      const r = await fetch(`${API}/api/admin/organizers/${id}/review`, {
        method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(body),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({} as Detail)); alert(d.message || "Action impossible."); return; }
      await loadAdmin();
    } catch { /* ignore */ }
  }
  /** Enregistre le tarif des crédits organisateur (Setting générique, clé "credits"). */
  async function saveCreditsSettings() {
    const val = (x: string) => (document.getElementById(x) as HTMLInputElement | null)?.value ?? "";
    const value = { priceXof: Math.max(1, parseInt(val("cr-price")) || 750), freeTournaments: Math.max(0, parseInt(val("cr-free")) || 0) };
    try {
      const r = await fetch(`${API}/api/admin/settings/credits`, {
        method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ value }),
      });
      if (r.ok) { await loadSettings(); setS((s) => ({ ...s, siteMsg: "Réglages enregistrés." })); }
      else setS((s) => ({ ...s, siteMsg: "Enregistrement impossible." }));
    } catch { setS((s) => ({ ...s, siteMsg: "API injoignable." })); }
  }
  async function confirmRegPayment(tid: string, regId: string) {
    try {
      const r = await fetch(`${API}/api/tournaments/${tid}/registrations/${regId}/confirm`, { method: "POST", headers: authHeaders() });
      const data = await r.json();
      if (!r.ok) { alert(data.message || "Confirmation impossible."); return; }
      await loadRegsPanel(tid);
      await loadTournaments();
      if (S.admin) loadAdmin();
      const st = await fetch(`${API}/api/tournaments/${tid}/state`);
      if (st.ok) { const d = await st.json(); setS((s) => ({ ...s, detail: d })); }
    } catch { /* ignore */ }
  }

  // Charge le tableau de bord quand on ouvre l'espace membre.
  useEffect(() => {
    if (S.page === "profil" && S.user && !S.me) loadMe();
    if (S.page === "profil" && S.user && !S.loyaltyHistory) loadLoyaltyMe();
    if (S.page === "profil" && S.user?.role === "ORGANIZER" && !S.creditsMe) loadCreditsMe();
    if (S.page === "profil" && S.user?.role === "ADMIN" && !S.admin) loadAdmin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [S.page, S.user]);

  // Onglet Site : prépare les listes modifiables (partenaires, pubs) depuis les réglages chargés.
  useEffect(() => {
    if (S.adminTab !== "site" || !S.site) return;
    setS((s) => ({
      ...s,
      partnersEdit: s.partnersEdit ?? normPartners(s).map((p) => ({ key: newKey(), name: p.name, logoUrl: p.logoUrl, display: p.display })),
      adsEdit: s.adsEdit ?? (s.site?.ads ?? []).map((a: Detail) => ({ key: newKey(), label: a.label || "", linkUrl: a.linkUrl || "", imageUrl: a.imageUrl ?? null, page: a.page || "accueil" })),
      slidesEdit: s.slidesEdit ?? (s.site?.slides?.length ? s.site.slides : SLIDES).map((sl: Detail) => ({ key: newKey(), tag: sl.tag || "", title: sl.title || "", sub: sl.sub || "", cta: sl.cta || "", imageUrl: sl.imageUrl ?? null })),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [S.adminTab, S.site]);

  // Carrousel « À la une » : défilement automatique sur l'accueil.
  useEffect(() => {
    if (S.page !== "accueil") return;
    const n = S.site?.slides?.length || SLIDES.length;
    if (n < 2) return;
    const id = setInterval(() => setS((s) => ({ ...s, slide: (s.slide + 1) % n })), 6000);
    return () => clearInterval(id);
  }, [S.page, S.site]);

  // Carrousel des pubs : ne tourne que s'il y a plusieurs annonces pour la page affichée.
  useEffect(() => {
    const pageKey = S.page === "accueil" ? "accueil" : S.page === "tournois" ? "tournois" : null;
    if (!pageKey) return;
    const n = (S.site?.ads ?? []).filter((a: Detail) => a.imageUrl && (a.page === pageKey || a.page === "toutes")).length;
    if (n < 2) return;
    const id = setInterval(() => setS((s) => ({ ...s, adSlide: s.adSlide + 1 })), 6000);
    return () => clearInterval(id);
  }, [S.page, S.site]);

  // Mode Show et page publique d'un tournoi en direct : rafraîchit l'état tout seul, comme un spectateur
  // Challonge/start.gg qui voit le bracket avancer sans recharger. Sur la page publique, seulement pour un
  // tournoi vraiment en direct (rien à rafraîchir sur un tournoi à venir ou terminé), et jamais pendant
  // qu'un formulaire d'édition est ouvert (organisateur qui modifie le tournoi, correction d'un match).
  // Jamais non plus en régie (canManage) : S.page reste "tournoi" là aussi, et un remplacement périodique
  // de S.detail y effacerait la saisie en cours (ex. le champ "poste" perdait ce qu'on venait de taper).
  useEffect(() => {
    const isShow = S.page === "show" && !!S.openId;
    const isLiveDetail = S.page === "tournoi" && !!S.openId && S.detail?.status === "live" && !S.editing && !S.correctingId && !canManage(S);
    if (!isShow && !isLiveDetail) return;
    const id = setInterval(async () => {
      try { const r = await fetch(`${API}/api/tournaments/${S.openId}/state`); if (r.ok) { const d = await r.json(); setS((s) => ({ ...s, detail: d })); } } catch { /* ignore */ }
    }, 2500);
    return () => clearInterval(id);
  }, [S.page, S.openId, S.detail?.status, S.editing, S.correctingId, S.user?.role]);

  // Chronomètres de la régie : mis à jour à la seconde directement dans le DOM (sans re-rendu, pour ne pas
  // perdre une saisie en cours) ; rouge une fois la durée prévue dépassée.
  useEffect(() => {
    const tick = () => {
      document.querySelectorAll<HTMLElement>("[data-timer]").forEach((el) => {
        const start = Number(el.dataset.timer), limit = Number(el.dataset.limit || 0) * 60000;
        const ms = Math.max(0, Date.now() - start);
        const m = Math.floor(ms / 60000), sec = Math.floor((ms % 60000) / 1000);
        el.textContent = `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
        const over = limit > 0 && ms > limit;
        el.style.color = over ? "#fff" : "var(--text-muted)";
        el.style.background = over ? "#F43F7E" : "transparent";
        el.style.borderColor = over ? "#F43F7E" : "var(--border-strong)";
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [S.detail, S.activeMatchIds]);

  // Pronostics : chargés à l'ouverture d'un tournoi en direct (visiteurs, pas la régie) puis rafraîchis toutes les 10 s.
  useEffect(() => {
    if (S.page !== "tournoi" || !S.openId || S.detail?.status !== "live" || canManage(S)) return;
    const id = S.openId;
    void loadPredictions(id);
    const t = setInterval(() => { void loadPredictions(id); }, 10000);
    return () => clearInterval(t);
  }, [S.page, S.openId, S.detail?.status, S.user?.role]);

  // « Mon prochain match » : se remet à jour tout seul tant qu'un match attend le joueur (poste attribué, file qui avance).
  const hasNext = (S.myNext?.length ?? 0) > 0;
  useEffect(() => {
    if (S.page !== "profil" || !hasNext) return;
    const id = setInterval(() => { void loadMyNext(); }, 8000);
    return () => clearInterval(id);
  }, [S.page, hasNext]);

  // Écran de diffusion d'événement : actualisé toutes les 7 secondes (matchs en cours de chaque tournoi).
  useEffect(() => {
    if (S.page !== "evshow" || !S.openEventId) return;
    const id = S.openEventId;
    const timer = setInterval(() => loadEvShow(id), 7000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [S.page, S.openEventId]);

  // Mode Show : fait tourner automatiquement les diapositives (classement / matchs en direct / derniers résultats…).
  useEffect(() => {
    if (S.page !== "show") return;
    const id = setInterval(() => setS((s) => ({ ...s, showSlide: s.showSlide + 1 })), 8000);
    return () => clearInterval(id);
  }, [S.page]);

  // Montage : charge les tournois, restaure la session, gère #creer.
  useEffect(() => {
    // Chargement initial groupé : une seule mise à jour d'état (pas de rejeu d'animations).
    (async () => {
      const get = async (p: string) => { try { const r = await fetch(`${API}/api/${p}`); return r.ok ? await r.json() : null; } catch { return null; } };
      const [tourns, products, news, site, gallery, albums, leaderboard, loyaltySettings, games, clubs] = await Promise.all([get("tournaments"), get("products"), get("news"), get("settings"), get("gallery"), get("gallery/albums"), get("tournaments/leaderboard"), get("loyalty/settings"), get("games"), get("clubs")]);
      setS((s) => ({
        ...s,
        tourns: Array.isArray(tourns) && tourns.length ? tourns : s.tourns,
        products: Array.isArray(products) && products.length
          ? products.map((p: Detail) => ({ id: p.id, cat: p.category, name: p.name, price: p.priceXof, ph: p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), img: p.imageUrl || null, stock: p.stock, loyaltyEligible: !!p.loyaltyEligible, showOnHome: !!p.showOnHome, description: p.description || null }))
          : s.products,
        news: Array.isArray(news) && news.length ? news : s.news,
        site: site || s.site,
        gallery: Array.isArray(gallery) ? gallery : s.gallery,
        albums: Array.isArray(albums) ? albums : s.albums,
        leaderboard: Array.isArray(leaderboard) ? leaderboard : s.leaderboard,
        loyaltySettings: loyaltySettings || s.loyaltySettings,
        // Catalogues jeux/clubs : publics, utiles dès l'inscription (suggestions), pas seulement après connexion.
        games: Array.isArray(games) ? games : s.games,
        clubs: Array.isArray(clubs) ? clubs : s.clubs,
      }));
    })();
    try {
      const u = localStorage.getItem("vlome_user");
      if (u) {
        const parsed = JSON.parse(u);
        setS((s) => ({ ...s, user: parsed }));
        loadRegIds(); loadLoyaltyMe();
        if (parsed?.role === "ORGANIZER") loadCreditsMe();
      }
    } catch { /* ignore */ }
    // Thème : déjà posé sur <html> avant l'hydratation par le script du layout (évite un flash) —
    // on aligne juste l'état React dessus pour que le bouton affiche la bonne icône dès le premier rendu.
    try {
      if (document.documentElement.dataset.theme === "light") setS((s) => ({ ...s, theme: "light" }));
    } catch { /* ignore */ }
    const h = typeof window !== "undefined" ? window.location.hash : "";
    // Deep-link de développement : #dev=email:motdepasse — connexion auto (jamais en prod).
    if (process.env.NODE_ENV !== "production" && h.startsWith("#dev=")) {
      const [email, pass, tab] = decodeURIComponent(h.slice(5)).split(":");
      (async () => {
        try {
          const r = await fetch(`${API}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pass }) });
          if (r.ok) {
            const data = await r.json();
            localStorage.setItem("vlome_token", data.token);
            localStorage.setItem("vlome_user", JSON.stringify(data.user));
            setS((s) => ({ ...s, user: data.user, page: "profil", adminTab: tab || s.adminTab }));
            loadRegIds();
          }
        } catch { /* ignore */ }
      })();
    }
    // Route /tournois/[id] : ouvre directement ce tournoi (un éventuel #hash explicite garde la priorité).
    if (initialOpenId && !h) openDetail(initialOpenId);
    if (initialEventId && !h) openEvent(initialEventId);
    applyHash(h);
  }, []);

  // Le bouton précédent/suivant du navigateur (ou l'édition manuelle du hash) rouvre la bonne page.
  useEffect(() => {
    const onHashChange = () => applyHash(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  /* ===== Bouton « retour » du téléphone =====
   * Un panneau ouvert (panier, assistant, visionneuse, confirmation, menu console) n'existe que
   * dans l'état React : sans entrée d'historique dédiée, le retour Android quittait carrément le
   * site au lieu de simplement refermer le panneau. On empile donc une entrée à l'ouverture, et
   * le retour la dépile pour fermer. La navigation entre pages, elle, passe par le hash (plus bas). */
  const overlayOpen = !!(S.cartOpen || S.creating || S.galleryOpen || S.confirmBox || S.consoleMenuOpen);
  const overlayRef = useRef(false);
  const overlayPushed = useRef(false);
  useEffect(() => {
    overlayRef.current = overlayOpen;
    if (overlayOpen && !overlayPushed.current) {
      overlayPushed.current = true;
      history.pushState({ appOverlay: true }, "");
    } else if (!overlayOpen) {
      overlayPushed.current = false;
    }
  }, [overlayOpen]);
  useEffect(() => {
    const onPop = () => {
      if (!overlayRef.current) return; // navigation normale : hashchange s'en charge
      overlayRef.current = false;
      overlayPushed.current = false;
      setS((s) => ({ ...s, cartOpen: false, creating: false, wizEditId: null, wizFullEdit: false, galleryOpen: null, confirmBox: null, consoleMenuOpen: false }));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Garde l'URL synchronisée avec la page affichée (quelle que soit l'action qui l'a changée :
  // clic, redirection après connexion, retour au cockpit…) — un rafraîchissement rouvre donc
  // toujours la bonne section au lieu de retomber sur l'accueil. Le tout premier rendu est ignoré :
  // le hash vient déjà de l'URL chargée, pas besoin de le réécrire.
  const hashSynced = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!hashSynced.current) { hashSynced.current = true; return; }
    let hash = "";
    if (S.page === "tournoi" && S.openId) hash = "#t=" + S.openId;
    else if (S.page === "show" && S.openId) hash = "#show=" + S.openId;
    else if (S.page === "evenement" && S.openEventId) hash = "#ev=" + S.openEventId;
    else if (S.page === "evshow" && S.openEventId) hash = "#evshow=" + S.openEventId;
    else if (S.page === "joueur" && S.playerProfile?.name) hash = "#joueur=" + encodeURIComponent(S.playerProfile.name) + (S.playerProfile.userId ? "~" + S.playerProfile.userId : "");
    else if (S.page === "auth") hash = "#connexion";
    else if (S.page === "profil" && S.adminTab && S.adminTab !== "apercu") hash = "#profil/" + S.adminTab;
    else if (SIMPLE_PAGES.includes(S.page)) hash = "#" + S.page;
    else return;
    // pushState (et non replaceState) : chaque page visitée laisse une entrée, sans quoi le bouton
    // « retour » du téléphone quitte le site dès la première pression au lieu de revenir en arrière.
    if (window.location.hash !== hash) history.pushState(null, "", hash);
  }, [S.page, S.openId, S.openEventId, S.adminTab, S.playerProfile?.name]);

  // L'icône d'onglet suit le logo choisi dans l'admin (Site → Identité). Le serveur (layout.tsx) pose déjà
  // une icône générée depuis ce logo ; on la réécrit ici dès que les réglages sont chargés, pour qu'un
  // changement de logo se voie tout de suite dans l'onglet sans attendre le cache.
  useEffect(() => {
    const logo = S.site?.brand?.logoUrl;
    if (typeof document === "undefined" || !logo) return;
    const href = mediaUrl(logo);
    // On ne SUPPRIME jamais les <link> existants : Next/React les gère (métadonnées) et tenterait ensuite
    // de les retirer d'un parent devenu null → "Cannot read properties of null (reading 'removeChild')"
    // qui plantait la page. On réécrit leur href, ou on crée les nôtres s'il n'y en a pas.
    for (const rel of ["icon", "apple-touch-icon"]) {
      const existing = document.head.querySelectorAll<HTMLLinkElement>(`link[rel~="${rel}"]`);
      if (existing.length) existing.forEach((l) => { l.href = href; l.removeAttribute("type"); l.removeAttribute("sizes"); });
      else {
        const link = document.createElement("link");
        link.rel = rel;
        link.href = href;
        document.head.appendChild(link);
      }
    }
  }, [S.site?.brand?.logoUrl]);

  // Jeton refusé par l'API (session expirée, secret de session changé) : plutôt que de laisser
  // une cascade de 401 silencieux afficher un espace vide, on referme proprement la session et
  // on renvoie vers la connexion avec un message. Les appels sans jeton (connexion, inscription)
  // ne sont pas concernés : un 401 y signifie simplement « identifiants incorrects ».
  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await original(input, init);
      if (res.status === 401 && token()) {
        const headers = new Headers(init?.headers as HeadersInit | undefined);
        if (headers.has("Authorization")) {
          localStorage.removeItem("vlome_token");
          localStorage.removeItem("vlome_user");
          setS((s) => (s.user ? {
            ...s, user: null, me: null, admin: null, myRegs: null, myOrders: null, myTourns: null,
            myResults: null, creditsMe: null, page: "auth", authTab: "login",
            authError: "Ta session a expiré. Reconnecte-toi.",
          } : s));
        }
      }
      return res;
    };
    return () => { window.fetch = original; };
  }, []);
  // Champs fichier (affiche de tournoi, logos, images produits/actus…) : écouteur natif au niveau du
  // document, en capture. Le onChange délégué de React ne se déclenche JAMAIS ici : tout le HTML est
  // injecté via dangerouslySetInnerHTML, donc React résout l'élément « source » du change sur le div
  // racine (une div, ni <select> ni <input type=file>) et n'émet pas l'événement. C'est ce qui figeait
  // l'aperçu sur « Aucun fichier » et empêchait l'envoi de l'affiche.
  // La ref est réassignée à chaque rendu : l'écouteur, lui, n'est posé qu'une fois mais appelle
  // toujours la version courante du handler (qui lit S.wizStep/S.wizData via wizCapture).
  const fileChangeRef = useRef<(t: HTMLInputElement) => void>(() => {});
  useEffect(() => { fileChangeRef.current = handleFileChange; });
  useEffect(() => {
    const onNativeChange = (e: Event) => {
      const t = e.target as HTMLInputElement | null;
      if (t && t.tagName === "INPUT" && t.type === "file") fileChangeRef.current(t);
      // Boutique : le sélecteur de catégorie (même raison : HTML injecté, pas de onChange React).
      if (t && t.tagName === "SELECT" && t.id === "shop-cat") setS((s) => ({ ...s, cat: t.value }));
    };
    document.addEventListener("change", onNativeChange, true);
    return () => document.removeEventListener("change", onNativeChange, true);
  }, []);

  // Jauge de cagnotte en direct (étape Barème) : écouteurs natifs posés directement sur les champs,
  // plutôt que de compter sur la délégation d'événements React — le contenu de l'assistant est injecté
  // via dangerouslySetInnerHTML (jamais géré par la réconciliation React), et le onChange délégué s'est
  // montré peu fiable dessus (perdait des frappes). Un addEventListener natif, lui, ne rate jamais.
  useEffect(() => {
    if (!(S.creating && S.wizStep === 4)) return;
    const ids = WIZ_SCORING_FIELDS.map(([id]) => id);
    const els = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLInputElement => !!el);
    els.forEach((el) => el.addEventListener("input", wizRecalcGauge));
    wizRecalcGauge();
    return () => els.forEach((el) => el.removeEventListener("input", wizRecalcGauge));
  }, [S.creating, S.wizStep]);

  // Classement Battle Royale en direct (saisie des résultats) : même technique que la jauge de
  // cagnotte ci-dessus (écouteurs natifs, contenu hors réconciliation React) — recalcule
  // #br-leaderboard à chaque frappe sur un champ placement/éliminations, sans attendre la
  // validation du match ni perdre le focus. Ré-attaché à chaque changement de tournoi/onglet de
  // partie puisque les ids (par joueur) sont régénérés à chaque rendu.
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLInputElement>('[id^="br-pl-"], [id^="br-kl-"]'));
    if (!els.length) return;
    els.forEach((el) => el.addEventListener("input", brRecalcLeaderboard));
    return () => els.forEach((el) => el.removeEventListener("input", brRecalcLeaderboard));
  }, [S.detail, S.brActiveGame]);

  // Compteur de participants + cagnotte prévisionnelle en direct (étape Participants) : même
  // raisonnement que la jauge de barème ci-dessus — sans ça, le compteur reste figé (0, ou la
  // valeur du dernier passage) tant qu'on n'a pas quitté l'étape, ce qui donne l'impression que
  // la saisie n'est pas prise en compte.
  useEffect(() => {
    if (!(S.creating && S.wizStep === 2)) return;
    const el = document.getElementById("wz-players") as HTMLTextAreaElement | null;
    if (!el) return;
    const recalc = () => {
      const n = el.value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).length;
      const count = document.getElementById("wiz-players-count");
      const word = document.getElementById("wiz-players-word");
      const cagCount = document.getElementById("wiz-cagnotte-count");
      const cagTotal = document.getElementById("wiz-cagnotte-total");
      if (count) count.textContent = String(n);
      if (word) word.textContent = `participant${n > 1 ? "s" : ""}`;
      if (cagCount) cagCount.textContent = String(n);
      if (cagTotal) cagTotal.textContent = String(n * S.wizData.pointsPerPlayer);
      const dupeBox = document.getElementById("wiz-players-dupe-warning");
      if (dupeBox) {
        const lines = el.value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
        const dupes = findDuplicateNames(lines);
        dupeBox.style.display = dupes.length ? "" : "none";
        dupeBox.innerHTML = dupeWarningHtml(dupes);
      }
    };
    el.addEventListener("input", recalc);
    recalc();
    return () => el.removeEventListener("input", recalc);
  }, [S.creating, S.wizStep, S.wizData.pointsPerPlayer]);

  // Aperçu des tailles de poule / nombre de parties en direct (étape Poules) : le select ne
  // recalculait rien avant de changer d'étape, laissant l'aperçu affiché figé sur l'ancienne valeur.
  useEffect(() => {
    if (!(S.creating && S.wizStep === 3)) return;
    const sel = document.getElementById("wz-pools") as HTMLSelectElement | null;
    if (!sel) return;
    const isBR = S.wizData.format === "BATTLE_ROYALE";
    const recalc = () => {
      const n = Math.max(1, parseInt(sel.value) || 1);
      if (isBR) {
        const count = document.getElementById("wiz-pools-count");
        const suffix = document.getElementById("wiz-pools-count-s");
        if (count) count.textContent = String(n);
        if (suffix) suffix.textContent = n > 1 ? "s" : "";
      } else {
        const sizes = balancedSizesPreview(S.wizData.players.length, n);
        const sizesEl = document.getElementById("wiz-pools-sizes");
        const grid = document.getElementById("wiz-pools-grid");
        if (sizesEl) sizesEl.textContent = sizes.join(" / ");
        if (grid) grid.innerHTML = poolSizeBoxesHtml(sizes);
        // Une seule poule = pas de phase de groupes (voir Engine.usesPools) : "Mode des poules" et
        // "Qualifiés par poule" n'ont alors aucun effet, on les masque plutôt que de laisser un
        // réglage sans conséquence — change en direct avec le nombre de poules, pas seulement au
        // rechargement de l'étape.
        const isSurv = S.wizData.format === "SURVIVAL";
        // Poules en double élimination fusionné (hors Survival) : ni "qualifiés par poule" ni
        // "format de la phase finale" n'ont de sens (voir wizPoolsStep) — masqués aussi ici pour
        // rester cohérent si "Nombre de poules" change après avoir déjà choisi ce mode.
        const isDoubleMerged = !isSurv && S.wizData.poolFormat === "double";
        // Round Robin/Double élim comme format principal impliquent eux-mêmes le mode de poule (voir
        // wizPoolsStep, poolModeImplied) : le picker "Mode des poules" reste masqué même si "Nombre
        // de poules" repasse au-dessus de 1.
        const poolModeImplied = !isSurv && (S.wizData.format === "ROUND_ROBIN" || S.wizData.format === "DOUBLE_ELIM");
        const warn = document.getElementById("wiz-nopool-warning");
        const modeBlock = document.getElementById("wiz-poolmode-block");
        const qualifyBlock = document.getElementById("wiz-qualify-block");
        const finalsFmtBlock = document.getElementById("wiz-finalsformat-block");
        if (warn) warn.style.display = (!isSurv && n === 1) ? "" : "none";
        if (modeBlock) modeBlock.style.display = (isSurv || n > 1) && !poolModeImplied ? "" : "none";
        if (qualifyBlock) qualifyBlock.style.display = (isSurv || n > 1) && !isDoubleMerged ? "" : "none";
        if (finalsFmtBlock) finalsFmtBlock.style.display = !isSurv && n > 1 && !isDoubleMerged ? "" : "none";
        // Le plafond "Qualifiés par poule" suit l'effectif de la plus petite poule, quel que soit le
        // mode de poule : changer le nombre de poules sans repasser par l'étape le laissait figé sur
        // l'ancien max.
        const qtyInput = document.getElementById("wz-qualify") as HTMLInputElement | null;
        const note = document.getElementById("wiz-qualify-note");
        if (qtyInput && note) {
          const maxQ = wizMaxQualify(S.wizData.players.length, n);
          qtyInput.max = String(maxQ);
          const qualif = Math.min(parseInt(qtyInput.value) || 2, maxQ);
          qtyInput.value = String(qualif);
          note.textContent = `${qualif * n} qualifiés au total (${qualif} × ${n} poules) rejoignent la phase finale — jusqu'à ${maxQ} par poule (effectif de la plus petite).`;
        }
      }
    };
    sel.addEventListener("change", recalc);
    return () => sel.removeEventListener("change", recalc);
  }, [S.creating, S.wizStep, S.wizData.format, S.wizData.players.length]);

  // Note "Qualifiés par poule" en direct (étape Poules) : recalculée à la frappe, sans re-rendu
  // React (perdrait le focus/curseur du champ en cours de saisie). La saisie est libre quel que soit
  // le mode de poule — le plafond est l'effectif de la plus petite poule.
  useEffect(() => {
    if (!(S.creating && S.wizStep === 3)) return;
    const el = document.getElementById("wz-qualify") as HTMLInputElement | null;
    const note = document.getElementById("wiz-qualify-note");
    if (!el || !note) return;
    const maxQ = wizMaxQualify(S.wizData.players.length, S.wizData.nbPools);
    const recalc = () => {
      const qualif = Math.max(1, Math.min(parseInt(el.value) || 1, maxQ));
      note.textContent = `${qualif * S.wizData.nbPools} qualifiés au total (${qualif} × ${S.wizData.nbPools} poules) rejoignent la phase finale — jusqu'à ${maxQ} par poule (effectif de la plus petite).`;
    };
    el.addEventListener("input", recalc);
    return () => el.removeEventListener("input", recalc);
  }, [S.creating, S.wizStep, S.wizData.players.length, S.wizData.nbPools]);

  // Suggestions de jeu en direct (étape Infos générales) : masquées tant que le champ est vide,
  // filtrées par ce qui est tapé — évite de noyer la saisie sous tout le catalogue en permanence.
  useEffect(() => {
    if (!(S.creating && S.wizStep === 1)) return;
    const el = document.getElementById("wz-game") as HTMLInputElement | null;
    const box = document.getElementById("wiz-game-suggestions");
    if (!el || !box) return;
    const recalc = () => {
      const matches = filterGames(S.games ?? [], el.value);
      box.innerHTML = matches.map((g) => gameChipHtml(g.name, el.value.trim().toLowerCase() === g.name.toLowerCase())).join("");
    };
    el.addEventListener("input", recalc);
    return () => el.removeEventListener("input", recalc);
  }, [S.creating, S.wizStep, S.games]);

  // Note "Format des matchs" en direct (course à points, étape Infos générales) : recalculée à la
  // frappe, sans re-rendu React (perdrait le focus/curseur du champ en cours de saisie).
  useEffect(() => {
    if (!(S.creating && S.wizStep === 1 && S.wizData.matchMode === "ft")) return;
    const el = document.getElementById("wz-matchvalue") as HTMLInputElement | null;
    const note = document.getElementById("wiz-matchfmt-note");
    if (!el || !note) return;
    const recalc = () => { note.textContent = matchFormatNote("ft", Math.max(1, Math.min(99, parseInt(el.value) || 1))); };
    el.addEventListener("input", recalc);
    return () => el.removeEventListener("input", recalc);
  }, [S.creating, S.wizStep, S.wizData.matchMode]);

  /** Simples pages sans paramètre : le hash correspond directement à la clé de page. */
  function applyHash(h: string) {
    if (h.startsWith("#show=")) { openDetail(h.slice(6), "show"); return; }
    if (h.startsWith("#t=")) { openDetail(h.slice(3)); return; }
    if (h.startsWith("#ev=")) { openEvent(h.slice(4)); return; }
    if (h.startsWith("#ci=")) { checkInFromLink(h.slice(4)); return; }
    if (h.startsWith("#evshow=")) { const id = h.slice(8); setS((s) => ({ ...s, page: "evshow", openEventId: id, evShow: null })); loadEvShow(id); return; }
    if (h.startsWith("#joueur=")) { const [nm, uid] = h.slice(8).split("~"); openPlayerProfile(decodeURIComponent(nm), uid || undefined); return; }
    if (h === "#creer") { setS((s) => ({ ...s, page: "tournois", creating: true })); return; }
    // Lien reçu par e-mail : #reset=<jeton> ouvre directement le choix du nouveau mot de passe.
    if (h.startsWith("#reset=")) {
      const token = decodeURIComponent(h.slice(7));
      setS((s) => ({ ...s, page: "auth", authTab: "reset", resetToken: token, authError: "", authNotice: "" }));
      return;
    }
    if (h === "#connexion") { setS((s) => ({ ...s, page: "auth", authTab: "login" })); return; }
    if (h === "#inscription") { setS((s) => ({ ...s, page: "auth", authTab: "register" })); return; }
    if (h === "#panier") { setS((s) => ({ ...s, cartOpen: true, cartItems: [{ name: "Maillot officiel Miabe", price: 15000 }, { name: "Casquette Miabe", price: 8000 }] })); return; }
    // Console : #profil/<onglet> rouvre directement l'onglet où l'on était (un rechargement ne renvoie plus à l'aperçu).
    if (h.startsWith("#profil/")) {
      const tab = decodeURIComponent(h.slice(8));
      setS((s) => ({ ...s, page: "profil", adminTab: tab }));
      if (tab === "joueurs") loadRoster();
      if (tab === "events") loadMyEvents();
      return;
    }
    const key = h.replace(/^#/, "");
    if (SIMPLE_PAGES.includes(key)) setS((s) => ({ ...s, page: key }));
  }

  /** Lit les champs de l'étape actuellement affichée de l'assistant et les fusionne dans wizData. */
  function wizCapture(): typeof S.wizData {
    const val = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? "";
    const d = { ...S.wizData };
    if (S.wizStep === 1) {
      d.name = val("wz-name").trim() || d.name;
      d.game = val("wz-game").trim();
      d.date = val("wz-date");
      d.place = val("wz-place").trim();
      d.pointsPerPlayer = Math.max(1, parseInt(val("wz-pts")) || 5);
      d.entryFeeXof = Math.max(0, parseInt(val("wz-fee")) || 0);
      if (!S.wizEditId) d.teamSize = parseInt(val("wz-team")) || 0;
      d.givesLoyaltyPoint = (document.getElementById("wz-loyalty") as HTMLInputElement | null)?.checked ?? true;
      if (d.matchMode === "ft") d.matchValue = Math.max(1, Math.min(99, parseInt(val("wz-matchvalue")) || d.matchValue));
      d.countGoalDiff = (document.getElementById("wz-goaldiff") as HTMLInputElement | null)?.checked ?? true;
    } else if (S.wizStep === 2) {
      d.players = val("wz-players").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    } else if (S.wizStep === 3) {
      d.nbPools = Math.max(1, parseInt(val("wz-pools")) || 2);
      // "Qualifiés par poule" est une saisie libre quel que soit le mode de poule, bornée par
      // l'effectif réel de la plus petite poule (voir wizMaxQualify).
      {
        const maxQ = wizMaxQualify(d.players.length, d.nbPools);
        const raw = parseInt(val("wz-qualify"));
        d.qualifyPerPool = Math.max(1, Math.min(Number.isFinite(raw) ? raw : (d.qualifyPerPool || 2), maxQ));
      }
    } else if (S.wizStep === 4 && d.format === "BATTLE_ROYALE") {
      const nRanks = Math.max(4, Math.min(d.players.length || DEFAULT_BR_POINTS.length, 16));
      d.brPoints = Array.from({ length: nRanks }, (_, i) => Math.max(0, parseInt(val(`wz-br-pts-${i}`)) || 0));
      d.brKillPoints = Math.max(0, parseFloat(val("wz-br-kill")) || 0);
    } else if (S.wizStep === 4) {
      const num = (id: string, def: number) => { const n = parseFloat(val(id)); return Number.isFinite(n) ? n : def; };
      d.survWin = num("wz-sc-surv", 1); d.loserWin = num("wz-sc-loser", 0.5); d.poolFinalWin = num("wz-sc-poolfinal", 1.5);
      d.finalsWin = num("wz-sc-finals", 2); d.championBonus = num("wz-sc-champion", 3); d.streakBonus = num("wz-sc-streak", 1);
    }
    return d;
  }
  /** Recalcule la jauge de cagnotte en direct depuis les champs du barème (étape 4), sans re-rendu React — évite de perdre le focus/curseur pendant la saisie. */
  function wizRecalcGauge() {
    const prog = document.getElementById("wiz-gauge-prog"); const bar = document.getElementById("wiz-gauge-bar");
    const gap = document.getElementById("wiz-gauge-gap"); const badge = document.getElementById("wiz-gauge-badge");
    const badgeTxt = document.getElementById("wiz-gauge-badge-txt"); const badgeIcon = document.getElementById("wiz-gauge-badge-icon");
    if (!prog || !bar || !gap || !badge || !badgeTxt || !badgeIcon) return;
    const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";
    const num = (id: string, def: number) => { const n = parseFloat(val(id)); return Number.isFinite(n) ? n : def; };
    const scoring = {
      survWin: num("wz-sc-surv", 0), loserWin: num("wz-sc-loser", 0), poolFinalWin: num("wz-sc-poolfinal", 0),
      finalsWin: num("wz-sc-finals", 0), championBonus: num("wz-sc-champion", 0), streakBonus: num("wz-sc-streak", 0),
    };
    const d = S.wizData;
    const c = cagnottePreview(d.players.length, d.nbPools, d.pointsPerPlayer, scoring, d.finalsFormat, d.poolFormat, d.qualifyPerPool);
    const pct = Math.min(100, c.total ? (c.programmed / c.total) * 100 : 0);
    prog.textContent = String(c.programmed);
    prog.style.color = "var(--text)";
    bar.style.width = `${pct}%`;
    bar.style.background = c.valid ? "linear-gradient(90deg,#22D3EE,#7C82FF)" : "linear-gradient(90deg,#FB7185,#F43F7E)";
    gap.textContent = `${c.gap >= 0 ? "+" : ""}${c.gap}`;
    gap.style.color = c.valid ? "#34D399" : "#FB7185";
    badgeTxt.textContent = c.valid ? "Valide" : "Dépassement";
    badgeIcon.innerHTML = ic(c.valid ? I.plus : I.warn, 12);
    badge.style.color = c.valid ? "#34D399" : "#FB7185";
    badge.style.background = c.valid ? "rgba(52,211,153,.08)" : "rgba(251,113,133,.08)";
    badge.style.borderColor = c.valid ? "rgba(52,211,153,.35)" : "rgba(251,113,133,.35)";
    // Points calculés par ligne du barème, et barre de répartition par catégorie (si présentes sur l'étape actuelle).
    for (const key of Object.keys(c.breakdown) as (keyof typeof c.breakdown)[]) {
      const ptsEl = document.getElementById(`wiz-sc-pts-${key}`);
      if (ptsEl) ptsEl.textContent = `${c.breakdown[key].pts} pts`;
      const segEl = document.getElementById(`wiz-gauge-seg-${key}`);
      if (segEl) {
        const pct2 = c.programmed > 0 ? Math.round((c.breakdown[key].pts / c.programmed) * 1000) / 10 : 0;
        segEl.style.width = `${pct2}%`;
        segEl.innerHTML = pct2 >= 8 ? `<span id="wiz-gauge-seg-${key}-txt">${pct2}%</span>` : "";
      }
    }
  }
  /** Classement Battle Royale recalculé en direct depuis les champs de saisie (placement +
   * éliminations de la partie active), sans re-rendu React — même technique que wizRecalcGauge.
   * Projette les valeurs en cours de saisie sur la partie active PAR-DESSUS le classement déjà
   * acquis (t.finals.standings, qui exclut cette partie tant qu'elle n'est pas validée), et
   * régénère juste #br-leaderboard via brLeaderboardTable — même fonction que le rendu initial,
   * pour ne jamais dessiner une ligne différemment ici et là. */
  function brRecalcLeaderboard() {
    const board = document.getElementById("br-leaderboard");
    const t = S.detail;
    const f = t?.finals;
    if (!board || !f || f.format !== "battle_royale") return;
    const games: Detail[] = f.games;
    const active = games.find((g: Detail) => g.id === S.brActiveGame) || games.find((g: Detail) => !g.played) || games[games.length - 1];
    if (!active || active.played) return; // partie déjà jouée (lecture seule) ou aucune partie : rien à projeter, le rendu React normal suffit.
    const activeIdx = games.findIndex((g: Detail) => g.id === active.id);
    const players: { id: string }[] = Array.isArray(t.players) ? t.players : [];
    const pointsTable: number[] = f.pointsTable, killPoints: number = f.killPoints || 0;
    const projPts = (placement: number, kills: number) => (pointsTable[placement - 1] ?? pointsTable[pointsTable.length - 1] ?? 0) + killPoints * kills;
    const draft = new Map(players.map((p) => {
      const placement = Math.max(1, parseInt((document.getElementById(`br-pl-${p.id}`) as HTMLInputElement | null)?.value || "") || 1);
      const kills = Math.max(0, parseInt((document.getElementById(`br-kl-${p.id}`) as HTMLInputElement | null)?.value || "") || 0);
      return [p.id, { placement, kills }] as const;
    }));
    const preview = (f.standings as Detail[]).map((r: Detail) => {
      const d = draft.get(r.id);
      const gp = d ? projPts(d.placement, d.kills) : 0;
      const games2 = (r.games as Detail[]).map((g: Detail, i: number) => (i === activeIdx && d) ? { played: true, rank: d.placement, kills: d.kills, pts: gp, preview: true } : g);
      return { ...r, pts: r.pts + gp, kills: r.kills + (d ? d.kills : 0), wins: r.wins + (d && d.placement === 1 ? 1 : 0), games: games2 };
    }).sort((a: Detail, b: Detail) => b.pts - a.pts);
    board.innerHTML = brLeaderboardTable(preview, games.length);
  }
  function wizGoto(next: number) {
    if (next === 0) { setS((s) => ({ ...s, creating: false, wizEditId: null, wizFullEdit: false })); return; }
    const d = wizCapture();
    // L'étape Participants n'existe que dans le flux de création pur : en modification (abrégée ou
    // via "Changer le format"), les participants déjà saisis sont conservés tels quels.
    if (!S.wizEditId && next >= 3 && !d.teamSize && d.players.length < 2) { alert("Ajoute au moins 2 participants."); setS((s) => ({ ...s, wizData: d })); return; }
    setS((s) => ({ ...s, wizData: d, wizStep: next }));
    window.scrollTo({ top: 0 });
  }
  function wizToggleRoster(name: string, club: string) {
    const el = document.getElementById("wz-players") as HTMLTextAreaElement | null;
    if (!el) return;
    const lines = el.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const key = name.toLowerCase();
    const idx = lines.findIndex((l) => l.split("@")[0].trim().toLowerCase() === key);
    if (idx >= 0) lines.splice(idx, 1);
    else lines.push(club ? `${name} @${club}` : name);
    el.value = lines.join("\n");
    setS((s) => ({ ...s, wizData: { ...s.wizData, players: lines } }));
  }
  function wizAddAllRoster() {
    const el = document.getElementById("wz-players") as HTMLTextAreaElement | null;
    if (!el || !S.roster) return;
    const lines = el.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const existing = new Set(lines.map((l) => l.split("@")[0].trim().toLowerCase()));
    S.roster.forEach((p: Detail) => {
      if (!existing.has(p.name.toLowerCase())) { lines.push(p.clubName ? `${p.name} @${p.clubName}` : p.name); existing.add(p.name.toLowerCase()); }
    });
    el.value = lines.join("\n");
    setS((s) => ({ ...s, wizData: { ...s.wizData, players: lines } }));
  }
  async function submitCreate() {
    const d = S.wizData;
    if (!d.name.trim() || (!d.teamSize && d.players.length < 2)) return;
    const body: Detail = {
      name: d.name, game: d.game, format: d.format, place: d.place,
      date: d.date || undefined, pointsPerPlayer: d.pointsPerPlayer, players: d.teamSize ? [] : d.players,
      ...(d.teamSize ? { teamSize: d.teamSize } : {}),
      nbPools: d.nbPools, entryFeeXof: d.entryFeeXof, givesLoyaltyPoint: d.givesLoyaltyPoint,
      survWin: d.survWin, loserWin: d.loserWin, poolFinalWin: d.poolFinalWin,
      finalsWin: d.finalsWin, championBonus: d.championBonus, streakBonus: d.streakBonus,
      finalsFormat: d.finalsFormat, poolFormat: d.poolFormat, streakLength: d.streakLength,
      qualifyPerPool: d.qualifyPerPool,
      matchMode: d.matchMode, matchValue: d.matchValue, countGoalDiff: d.countGoalDiff,
      brPointsTable: d.brPoints, brKillPoints: d.brKillPoints,
      // Déjà envoyée à Cloudinary/au stockage dès le choix du fichier (étape 1) — voir onChange.
      ...(d.imageUrl ? { imageUrl: d.imageUrl } : {}),
      ...(S.wizEventId ? { eventId: S.wizEventId } : {}),
    };
    if (!token()) { setS((s) => ({ ...s, page: "auth" })); window.scrollTo({ top: 0 }); return; }
    setS((s) => ({ ...s, busy: true }));
    try {
      const r = await fetch(`${API}/api/tournaments`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(body),
      });
      if (r.status === 401) { setS((s) => ({ ...s, busy: false, page: "auth", user: null })); return; }
      if (!r.ok) {
        const err = await r.json().catch(() => ({} as Detail));
        setS((s) => ({ ...s, busy: false }));
        if (r.status === 409 && /crédit/i.test(err.message || "")) {
          if (confirm(`${err.message}\n\nOuvrir l'onglet Crédits pour en acheter ?`)) {
            setS((s) => ({ ...s, creating: false, page: "profil", adminTab: "credits" }));
            window.scrollTo({ top: 0 });
            loadCreditsMe();
          }
        } else {
          alert(err.message || "Création impossible.");
        }
        return;
      }
      const created = await r.json();
      const backToEvent = S.wizEventId ? { id: S.wizEventId, publicPage: S.page === "evenement" } : null;
      await loadTournaments();
      if (S.user?.role === "ORGANIZER") loadCreditsMe();
      setS((s) => ({
        ...s, busy: false, creating: false, wizEventId: null, fmt: "Tous", wizStep: 1, wizRosterSearch: "",
        wizData: { teamSize: 0, name: "", game: "", date: "", place: "", format: "SURVIVAL", pointsPerPlayer: 5, nbPools: 2, players: [], entryFeeXof: 0, givesLoyaltyPoint: true, survWin: 1, loserWin: 0.5, poolFinalWin: 1.5, finalsWin: 2, championBonus: 3, streakBonus: 0, finalsFormat: "double", poolFormat: "survival", streakLength: 5, qualifyPerPool: 2, matchMode: "bo", matchValue: 1, countGoalDiff: true, brPoints: DEFAULT_BR_POINTS.slice(), brKillPoints: DEFAULT_BR_KILL_POINTS, imageUrl: null },
      }));
      loadEvents(); loadMyEvents();
      if (backToEvent) { if (backToEvent.publicPage) openEvent(backToEvent.id); else openEventEditor(backToEvent.id); }
      else if (created?.id) openDetail(created.id);
    } catch {
      setS((s) => ({ ...s, busy: false }));
      alert("Création impossible — l'API est-elle démarrée ? (pnpm dev:api)");
    }
  }

  /** Enregistre les modifications d'un tournoi existant (assistant en mode édition) : infos générales
   * puis barème (un appel par valeur changée, l'endpoint /scoring accepte les changements à tout moment). */
  async function submitUpdate() {
    const id = S.wizEditId;
    if (!id) return;
    const d = S.wizData;
    if (!d.name.trim()) return;
    if (!token()) { setS((s) => ({ ...s, page: "auth" })); window.scrollTo({ top: 0 }); return; }
    setS((s) => ({ ...s, busy: true }));
    const body: Detail = {
      name: d.name, game: d.game, place: d.place, date: d.date || undefined,
      entryFeeXof: d.entryFeeXof, givesLoyaltyPoint: d.givesLoyaltyPoint, nbPools: d.nbPools, pointsPerPlayer: d.pointsPerPlayer,
      // Les reglages de poule concernent tous les formats qui en proposent, pas seulement Survival.
      ...(wizHasPools(d.format) ? { poolFormat: d.poolFormat, qualifyPerPool: d.qualifyPerPool } : {}),
      // Le format de la phase finale est un choix libre dès qu'il y a des poules, quel que soit le
      // format principal (voir Engine.launchTournament) — pas seulement Survival, qui garde en plus
      // son bonus striker (concept propre à ce format).
      ...(d.format === "SURVIVAL" || d.nbPools > 1 ? { finalsFormat: d.finalsFormat } : {}),
      ...(d.format === "SURVIVAL" ? { streakLength: d.streakLength } : {}),
      ...(d.format === "BATTLE_ROYALE" ? { brPointsTable: d.brPoints, brKillPoints: d.brKillPoints } : {}),
      // Format des matchs (Bo/Ft) : concerne tous les formats, modifiable tant que le tournoi n'est
      // pas lancé (voir TournamentsService.update).
      matchMode: d.matchMode, matchValue: d.matchValue, countGoalDiff: d.countGoalDiff,
      // Format envoyé uniquement depuis "Changer le format" (assistant complet) — le raccourci abrégé
      // ne le propose pas, pas la peine de le renvoyer à chaque enregistrement de barème.
      ...(S.wizFullEdit ? { format: d.format } : {}),
      // Déjà envoyée à Cloudinary/au stockage dès le choix du fichier (étape 1) — voir onChange.
      ...(d.imageUrl ? { imageUrl: d.imageUrl } : {}),
    };
    try {
      const r = await fetch(`${API}/api/tournaments/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(body),
      });
      if (r.status === 401) { setS((s) => ({ ...s, busy: false, page: "auth", user: null })); return; }
      if (!r.ok) throw new Error();
      const scoring: [string, number][] = [
        ["survWin", d.survWin], ["loserWin", d.loserWin], ["poolFinalWin", d.poolFinalWin],
        ["finalsWin", d.finalsWin], ["championBonus", d.championBonus], ["streakBonus", d.streakBonus],
      ];
      for (const [key, value] of scoring) {
        await fetch(`${API}/api/tournaments/${id}/scoring`, {
          method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ key, value }),
        });
      }
      await loadTournaments();
      setS((s) => ({ ...s, busy: false, creating: false, wizEditId: null, wizFullEdit: false, wizStep: 1 }));
      await openDetail(id);
    } catch {
      setS((s) => ({ ...s, busy: false }));
      alert("Enregistrement impossible — l'API est-elle démarrée ? (pnpm dev:api)");
    }
  }

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    // déconnexion : sous-élément du bouton utilisateur, à traiter avant data-menu-user
    if (target.closest("[data-logout]")) {
      setS((s) => ({ ...s, confirmBox: { title: "Déconnexion", message: "Tu vas être déconnecté de ton compte Miabe.", okLabel: "Se déconnecter", action: "logout" } }));
      return;
    }
    const el = target.closest<HTMLElement>("[data-go],[data-slide],[data-fmt],[data-tournstatus],[data-scope],[data-game],[data-cat],[data-act],[data-add-name],[data-themetoggle],[data-evshow],[data-evshowclose],[data-share],[data-shareclose],[data-sharecopy],[data-embed],[data-embedclose],[data-embedcopy],[data-launchnext],[data-notifymatch],[data-evgame],[data-predict],[data-duplicate],[data-matchstart],[data-matchminutes],[data-prodopen],[data-prodclose],[data-scanopen],[data-checkin],[data-stationsave],[data-streammatch],[data-exportresults],[data-exportregs],[data-playerprofile],[data-h2h],[data-openevent],[data-evlist],[data-evnew],[data-evedit],[data-evdel],[data-evsave],[data-evcancel],[data-evattach],[data-evdetach],[data-clubreview],[data-payopen],[data-payretry],[data-paychoose],[data-payclose],[data-cart-open],[data-cart-close],[data-cart-vieworders],[data-cart-remove],[data-cart-clear],[data-cartpaypick],[data-cartpts],[data-regpts],[data-checkout],[data-auth-open],[data-auth-tab],[data-auth-submit],[data-stop],[data-open],[data-back],[data-launch],[data-finals-start],[data-brgametab],[data-brsubmit],[data-scorestep],[data-matchvalidate],[data-matchforfeit],[data-activematch],[data-matchclose],[data-editmatch],[data-correctstep],[data-correctvalidate],[data-correctcancel],[data-viewpool],[data-regiepanel],[data-bracketview],[data-livescoresave],[data-reportscore],[data-del],[data-edit],[data-editcancel],[data-editsave],[data-authrole],[data-setrole],[data-userdel],[data-userpwd],[data-show],[data-showclose],[data-print],[data-clearq],[data-profileedit],[data-profilecancel],[data-profilesave],[data-passsave],[data-reg],[data-unreg],[data-admintab],[data-newsnew],[data-newsedit],[data-newscancel],[data-newssave],[data-newspub],[data-newsdel],[data-prodnew],[data-prodedit],[data-prodcancel],[data-prodsave],[data-proddel],[data-ordstatus],[data-filepick],[data-confirm-ok],[data-confirm-cancel],[data-sitesave],[data-loyaltysave],[data-legalsave],[data-creditssave],[data-confirmcredit],[data-orgapprove],[data-orgreject],[data-creditbuyqty],[data-creditbuypay],[data-creditbuy],[data-creditcancel],[data-herobgclear],[data-paypick],[data-confirmpay],[data-gallerynew],[data-galleryadd],[data-albumnew],[data-albumedit],[data-albumsave],[data-albumcancel],[data-albumdel],[data-albumopen],[data-albumback],[data-gallerysave],[data-gallerycancel],[data-gallerydel],[data-adnew],[data-adsave],[data-adcancel],[data-addel],[data-ptadd],[data-ptdel],[data-sladd],[data-sldel],[data-adslide],[data-gfilter],[data-gtype],[data-instock],[data-gopen],[data-gclose],[data-gprev],[data-gnext],[data-admsearchclear],[data-prodcat],[data-prodsort],[data-pladd],[data-plrem],[data-pldq],[data-reset],[data-pools-distribute],[data-pool-shuffle],[data-pool-move],[data-pool-moveto],[data-poolqualify-apply],[data-roster-move],[data-roster-shuffle],[data-changeformat],[data-pledit-open],[data-pledit-save],[data-pledit-cancel],[data-wizgoto],[data-wiztoggleroster],[data-wizaddall],[data-wizformat],[data-wizpoolformat],[data-wizfinalsformat],[data-wizmatchfmt],[data-wizqualify],[data-wizstreaklen],[data-rostertab],[data-rosteredit],[data-rosterdel],[data-rostersave],[data-rostercancel],[data-clubedit],[data-clubdel],[data-clubsave],[data-clubcancel],[data-gameedit],[data-gamedel],[data-gamesave],[data-gamecancel],[data-wizgame],[data-playerview],[data-playerviewclose],[data-classview],[data-rosterqclear],[data-consolemenu]");
    if (!el) return;
    const d = el.dataset;
    if (d.stop !== undefined) return; // clic à l'intérieur d'une modale : ne pas fermer
    if (d.open) { openDetail(d.open); }
    else if (d.back !== undefined) { setS((s) => ({ ...s, page: "tournois", detail: null, openId: null })); }
    else if (d.launch) { act(`${API}/api/tournaments/${d.launch}/launch`); }
    // Aucun format forcé ici : t.finalsFormat est déjà posé au lancement du tournoi (launchTournament),
    // que ce soit le choix Survival fait à la création ou le format principal des autres formats à
    // poules — l'envoyer en dur en "double" écrasait le choix réel (ex. Bracket simple lançait quand
    // même une double élimination).
    else if (d.finalsStart) { act(`${API}/api/tournaments/${d.finalsStart}/finals/start`, {}); }
    else if (d.reset) {
      setS((s) => ({ ...s, confirmBox: { title: "Réinitialiser le tournoi", message: "Tous les résultats, poules et la phase finale seront effacés — les joueurs et le barème sont conservés. Irréversible.", okLabel: "Réinitialiser", action: `treset|${d.reset}` } }));
    }
    else if (d.poolsDistribute) { act(`${API}/api/tournaments/${d.poolsDistribute}/pools/distribute`); }
    else if (d.poolShuffle) { const [tid, poolId] = d.poolShuffle.split("|"); act(`${API}/api/tournaments/${tid}/pools/${poolId}/shuffle`); }
    else if (d.poolMove) { const [tid, poolId, index, dir] = d.poolMove.split("|"); act(`${API}/api/tournaments/${tid}/pools/${poolId}/move`, { index: parseInt(index), dir: parseInt(dir) }); }
    else if (d.poolMoveto) { const [tid, poolId, playerId, dir] = d.poolMoveto.split("|"); act(`${API}/api/tournaments/${tid}/pools/${poolId}/players/move`, { playerId, dir: parseInt(dir) }); }
    // Endpoint dédié /pools/qualify (comme /scoring) plutôt que le PATCH générique du tournoi : ce
    // dernier renvoie la carte résumée (toCard), pas l'état complet (toState) qu'attend S.detail —
    // act() aurait sinon remplacé S.detail par un objet sans t.pools et cassé le rendu de la page.
    else if (d.poolqualifyApply) {
      const tid = d.poolqualifyApply!;
      const input = document.getElementById(`pq-input-${tid}`) as HTMLInputElement | null;
      const q = Math.max(1, parseInt(input?.value || "") || 1);
      act(`${API}/api/tournaments/${tid}/pools/qualify`, { value: q }, "PATCH");
    }
    else if (d.rosterMove) { const [tid, playerId, dir] = d.rosterMove.split("|"); act(`${API}/api/tournaments/${tid}/roster/move`, { playerId, dir: parseInt(dir) }); }
    else if (d.rosterShuffle) { act(`${API}/api/tournaments/${d.rosterShuffle}/roster/shuffle`); }
    else if (d.brgametab) setS((s) => ({ ...s, brActiveGame: d.brgametab! }));
    else if (d.brsubmit) {
      // Placement + éliminations lus directement sur les inputs (non contrôlés, comme le score des
      // poules — voir battleRoyaleCenter) plutôt que depuis un état React tenu à jour à chaque frappe.
      const players: { id: string }[] = Array.isArray(S.detail?.players) ? S.detail.players : [];
      const ranked = players
        .map((p) => ({ id: p.id, placement: Math.max(1, parseInt((document.getElementById(`br-pl-${p.id}`) as HTMLInputElement | null)?.value || "") || 1) }))
        .sort((a, b) => a.placement - b.placement);
      const kills: Record<string, number> = {};
      players.forEach((p) => {
        const k = Math.max(0, parseInt((document.getElementById(`br-kl-${p.id}`) as HTMLInputElement | null)?.value || "") || 0);
        if (k > 0) kills[p.id] = k;
      });
      act(`${API}/api/tournaments/${S.openId}/battle-royale-report`, { gameId: d.brsubmit, ranking: ranked.map((r) => r.id), kills });
      setS((s) => ({ ...s, brActiveGame: null }));
    }
    else if (d.scorestep) {
      const [key, side, dir] = d.scorestep.split("|") as [string, "a" | "b", string];
      setS((s) => {
        const cur = s.matchScores[key] || { a: 0, b: 0 };
        const next = { ...cur, [side]: Math.max(0, cur[side] + (dir === "1" ? 1 : -1)) };
        return { ...s, matchScores: { ...s.matchScores, [key]: next } };
      });
    }
    else if (d.matchvalidate) {
      const t = S.detail;
      const key = d.matchvalidate;
      const active = t ? getActiveMatches(S, t).find((a) => activeKey(a) === key) : null;
      if (t && active) {
        const sc = S.matchScores[key] || { a: 0, b: 0 };
        if (sc.a !== sc.b) {
          const winnerId = sc.a > sc.b ? active.aId : active.bId;
          const body = active.kind === "pool" ? { poolId: active.poolId, winnerId, scoreA: sc.a, scoreB: sc.b } : { matchId: active.matchId, winnerId, scoreA: sc.a, scoreB: sc.b };
          act(`${API}/api/tournaments/${t.id}/report`, body);
          setS((s) => { const ms = { ...s.matchScores }; delete ms[key]; return { ...s, activeMatchIds: s.activeMatchIds.filter((id) => id !== key), matchScores: ms }; });
        }
      }
    }
    else if (d.matchforfeit) {
      const [key, side] = d.matchforfeit.split("|");
      const t = S.detail;
      const active = t ? getActiveMatches(S, t).find((a) => activeKey(a) === key) : null;
      if (t && active) {
        const winnerId = side === "a" ? active.bId : active.aId;
        const body = active.kind === "pool" ? { poolId: active.poolId, winnerId, scoreA: 0, scoreB: 0 } : { matchId: active.matchId, winnerId, scoreA: 0, scoreB: 0 };
        act(`${API}/api/tournaments/${t.id}/report`, body);
        setS((s) => { const ms = { ...s.matchScores }; delete ms[key]; return { ...s, activeMatchIds: s.activeMatchIds.filter((id) => id !== key), matchScores: ms }; });
      }
    }
    // "Lancer" dans la file d'attente AJOUTE une carte de contrôle de plus (plusieurs confrontations
    // en cours en même temps), sans remplacer celles déjà affichées. Important : tant que
    // S.activeMatchIds est vide, ce qui est affiché vient du repli automatique de getActiveMatches
    // (le premier match jouable) — il faut d'abord le matérialiser dans la liste, sinon ajouter un
    // second match REMPLACE ce premier au lieu de s'y ajouter (la liste passerait de [] à [nouveau],
    // perdant le repli).
    else if (d.activematch) {
      const t = S.detail;
      if (t) {
        const currentKeys = getActiveMatches(S, t).map(activeKey);
        const next = currentKeys.includes(d.activematch!) ? currentKeys : [...currentKeys, d.activematch!];
        setS((s) => ({ ...s, activeMatchIds: next }));
        if (!t.matchStarts?.[d.activematch!]) act(`${API}/api/tournaments/${t.id}/match-start`, { key: d.activematch!, on: true });
      }
    }
    // Retirer une carte du panneau de contrôle sans rapporter de résultat : le match reste jouable et
    // revient dans la file d'attente. Si c'était la seule carte affichée et qu'un match reste jouable,
    // getActiveMatches en réaffiche un automatiquement (le contrôle n'est vide que si plus rien à jouer).
    else if (d.matchclose) setS((s) => ({ ...s, activeMatchIds: s.activeMatchIds.filter((id) => id !== d.matchclose) }));
    // Correction d'un match déjà joué (crayon) — ouvre la modale (matchCorrectModal), pré-remplie
    // avec le score existant. Distincte de data-activematch : un match à VENIR se "lance" (file
    // d'attente/panneau de contrôle), un match déjà joué se "corrige" (modale dédiée, /correct).
    else if (d.editmatch) setS((s) => ({ ...s, correctingId: d.editmatch! }));
    else if (d.correctcancel !== undefined) setS((s) => {
      const t = s.detail;
      const entry = t && (t.log || []).find((l: Detail) => l.id === s.correctingId);
      const ms = { ...s.matchScores };
      if (entry) delete ms["c:" + entry.id];
      return { ...s, correctingId: null, matchScores: ms };
    });
    else if (d.correctstep) {
      const [key, side, dir] = d.correctstep.split("|") as [string, "a" | "b", string];
      setS((s) => {
        const cur = s.matchScores[key] || { a: 0, b: 0 };
        const next = { ...cur, [side]: Math.max(0, cur[side] + (dir === "1" ? 1 : -1)) };
        return { ...s, matchScores: { ...s.matchScores, [key]: next } };
      });
    }
    else if (d.correctvalidate) {
      const t = S.detail;
      const logId = d.correctvalidate;
      const entry = t && (t.log || []).find((l: Detail) => l.id === logId);
      if (t && entry) {
        const key = "c:" + logId;
        const sc = S.matchScores[key] || { a: entry.sa ?? 0, b: entry.sb ?? 0 };
        if (sc.a !== sc.b) {
          const winnerId = sc.a > sc.b ? entry.aId : entry.bId;
          act(`${API}/api/tournaments/${t.id}/correct`, { logId, winnerId, scoreA: sc.a, scoreB: sc.b });
          setS((s) => { const ms = { ...s.matchScores }; delete ms[key]; return { ...s, correctingId: null, matchScores: ms }; });
        }
      }
    }
    // Choix d'une poule dans le rail : toutes les poules sont déjà affichées côte à côte dans le
    // centre (voir regieCenter), donc on se contente d'y faire défiler jusqu'à la carte visée. Si
    // cette poule a un match en cours, elle s'ajoute aussi au panneau de contrôle (même précaution de
    // matérialisation du repli que ci-dessus) — sinon on ne touche pas au contrôle.
    else if (d.viewpool) {
      const t = S.detail;
      const p = t?.pools?.find((pp: Detail) => pp.id === d.viewpool);
      if (t && p?.current) {
        const currentKeys = getActiveMatches(S, t).map(activeKey);
        const next = currentKeys.includes(d.viewpool!) ? currentKeys : [...currentKeys, d.viewpool!];
        setS((s) => ({ ...s, activeMatchIds: next }));
      }
      document.getElementById(`poolcard-${d.viewpool}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    else if (d.regiepanel !== undefined) setS((s) => ({ ...s, regiePanel: (d.regiepanel || null) as State["regiePanel"], rosterQ: "" }));
    else if (d.bracketview) setS((s) => ({ ...s, bracketView: d.bracketview as State["bracketView"] }));
    else if (d.rosterqclear !== undefined) setS((s) => ({ ...s, rosterQ: "" }));
    else if (d.livescoresave) saveLiveScoring(d.livescoresave);
    else if (d.reportscore) {
      const poolId = d.reportscore;
      const sa = parseInt((document.getElementById("sc-a-" + poolId) as HTMLInputElement)?.value || "0");
      const sb = parseInt((document.getElementById("sc-b-" + poolId) as HTMLInputElement)?.value || "0");
      if (sa === sb) { alert("Le score ne peut pas être une égalité (match FT)."); return; }
      act(`${API}/api/tournaments/${S.openId}/report`, { poolId, scoreA: sa, scoreB: sb });
    }
    else if (d.del) {
      const name = S.detail?.name ? ` « ${S.detail.name} »` : "";
      setS((s) => ({ ...s, confirmBox: { title: "Supprimer le tournoi", message: `Le tournoi${name} et tous ses résultats seront définitivement supprimés.`, okLabel: "Supprimer", action: `delT|${d.del}` } }));
    }
    else if (d.edit !== undefined || d.changeformat !== undefined) {
      // Tournoi pas encore lancé : on réutilise l'assistant de création, pré-rempli (poules/points/participants modifiables).
      // Une fois lancé : le petit formulaire inline reste plus adapté (poules/points verrouillés par le moteur).
      // "Changer le format" (d.changeformat) rouvre l'assistant COMPLET (wizFullEdit) — toutes les
      // étapes, y compris le choix du format — plutôt que le raccourci abrégé (barème uniquement).
      const t = S.detail;
      const fullEdit = d.changeformat !== undefined;
      if (t && t.status === "setup") {
        const roster: { name: string; club?: string }[] = Array.isArray(t.players) ? t.players : [];
        setS((s) => ({
          ...s, creating: true, wizEditId: t.id, wizFullEdit: fullEdit, wizStep: 1, wizRosterSearch: "",
          wizData: {
            teamSize: t.teamSize || 0,
            name: t.name || "", game: t.game || "", date: "", place: t.place || "", format: ENGINE_TO_DB_FORMAT[t.mainFormat] || "SURVIVAL",
            pointsPerPlayer: t.pointsPerPlayer || 5, nbPools: t.nbPools || 2,
            players: roster.map((p) => (p.club ? `${p.name} @${p.club}` : p.name)),
            entryFeeXof: t.entryFeeXof || 0, givesLoyaltyPoint: t.givesLoyaltyPoint ?? true,
            survWin: t.scoring?.survWin ?? 1, loserWin: t.scoring?.loserWin ?? 0.5, poolFinalWin: t.scoring?.poolFinalWin ?? 1.5,
            finalsWin: t.scoring?.finalsWin ?? 2, championBonus: t.scoring?.championBonus ?? 3, streakBonus: t.scoring?.streakBonus ?? 0,
            finalsFormat: t.finalsFormat || "single",
            poolFormat: t.poolFormat || "survival",
            streakLength: t.streakLength === 3 ? 3 : 5,
            qualifyPerPool: t.qualifyPerPool || 2,
            matchMode: t.matchFormat?.mode === "ft" ? "ft" : "bo",
            matchValue: t.matchFormat?.value || 1,
            countGoalDiff: t.countGoalDiff ?? true,
            brPoints: (t.brPointsTable && t.brPointsTable.length ? t.brPointsTable : DEFAULT_BR_POINTS).slice(),
            brKillPoints: t.brKillPoints ?? DEFAULT_BR_KILL_POINTS,
            imageUrl: t.imageUrl || null,
          },
        }));
        loadRoster();
      } else {
        setS((s) => ({ ...s, editing: true }));
      }
    }
    else if (d.editcancel !== undefined) { setS((s) => ({ ...s, editing: false })); }
    else if (d.editsave) {
      const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";
      const body: Record<string, string | number> = { name: val("e-name"), game: val("e-game"), place: val("e-place"), date: val("e-date"), entryFeeXof: parseInt(val("e-fee")) || 0, prize: val("e-prize"), rules: val("e-rules") };
      if (S.detail?.status === "setup") { body.nbPools = parseInt(val("e-pools")) || 1; body.pointsPerPlayer = parseInt(val("e-pts")) || 1; }
      editSave(d.editsave, body);
    }
    else if (d.pladd) {
      const nameEl = document.getElementById("pl-add-name") as HTMLInputElement | null;
      const name = (nameEl?.value || "").trim();
      const memEl = document.getElementById("pl-add-members") as HTMLInputElement | null;
      const members = memEl ? memEl.value.split(",").map((m) => m.trim()).filter(Boolean) : undefined;
      if (name) { act(`${API}/api/tournaments/${d.pladd}/players`, { name, ...(members ? { members } : {}) }); if (nameEl) nameEl.value = ""; if (memEl) memEl.value = ""; }
    }
    else if (d.plrem) {
      const [tid, pid] = d.plrem.split("|");
      const pname = S.detail?.players?.find((p: Detail) => p.id === pid)?.name;
      setS((s) => ({ ...s, confirmBox: { title: "Retirer le joueur", message: `« ${pname || "Ce joueur"} » sera retiré de la liste des participants.`, okLabel: "Retirer", action: `plrem|${tid}|${pid}` } }));
    }
    else if (d.pldq) {
      const [tid, pid] = d.pldq.split("|");
      const pname = S.detail?.players?.find((p: Detail) => p.id === pid)?.name;
      setS((s) => ({ ...s, confirmBox: { title: "Disqualifier le joueur", message: `« ${pname || "Ce joueur"} » perdra par forfait son match en cours (et tous ses matchs restants) — irréversible.`, okLabel: "Disqualifier", action: `pldq|${tid}|${pid}` } }));
    }
    else if (d.pleditOpen) { setS((s) => ({ ...s, editingPlayerId: d.pleditOpen! })); }
    else if (d.pleditCancel !== undefined) { setS((s) => ({ ...s, editingPlayerId: null })); }
    else if (d.pleditSave) { const [tid, pid] = d.pleditSave.split("|"); savePlayerEdit(tid, pid); }
    else if (d.wizgoto) wizGoto(parseInt(d.wizgoto));
    else if (d.wiztoggleroster) { const [name, club] = d.wiztoggleroster.split("|"); wizToggleRoster(name, club); }
    else if (d.wizaddall !== undefined) wizAddAllRoster();
    else if (d.wizformat) setS((s) => {
      // Round Robin et Double élim SONT eux-mêmes des modes de poule valides : redemander "Mode des
      // poules" séparément serait une question redondante (voir wizPoolsStep, poolModeImplied) — le
      // mode de poule suit alors automatiquement le format choisi ici, sans repasser par ce picker.
      // Bracket simple n'a pas cette correspondance directe : il garde un vrai choix de mode de poule
      // (jamais "survival", masqué hors Survival — voir wizPoolModes) — Round Robin par défaut, le
      // choix le plus courant pour une phase de groupes.
      const nextPoolFormat = d.wizformat === "SURVIVAL" ? s.wizData.poolFormat
        : d.wizformat === "ROUND_ROBIN" ? "roundrobin"
        : d.wizformat === "DOUBLE_ELIM" ? "double"
        : (s.wizData.poolFormat === "survival" ? "roundrobin" : s.wizData.poolFormat);
      const nextNbPools = d.wizformat === "SURVIVAL" ? 2 : d.wizformat === "BATTLE_ROYALE" ? s.wizData.nbPools : 1;
      const maxQ = wizMaxQualify(s.wizData.players.length, nextNbPools);
      // Format de la phase finale : par défaut celui du format principal (même règle que le moteur,
      // voir Engine.newTournament) — reste un choix libre ensuite via le sélecteur dédié (étape
      // Poules pour les formats à bracket, étape Barème pour Survival, qui garde sa propre valeur ici).
      const nextFinalsFormat = d.wizformat === "SURVIVAL" ? s.wizData.finalsFormat
        : d.wizformat === "DOUBLE_ELIM" ? "double" : d.wizformat === "ROUND_ROBIN" ? "roundrobin" : "single";
      return {
        ...s,
        wizData: {
          ...s.wizData,
          format: d.wizformat!,
          // Survival = format a poules (2). Les formats a bracket restent des brackets directs
          // par defaut (1 poule = pas de phase de groupes) ; Battle Royale garde son nb de parties.
          nbPools: nextNbPools,
          poolFormat: nextPoolFormat,
          qualifyPerPool: Math.min(s.wizData.qualifyPerPool || 2, maxQ),
          finalsFormat: nextFinalsFormat,
        },
      };
    });
    else if (d.wizpoolformat) {
      // wizCapture() relit d'abord "Qualifiés par poule" (saisie libre en Round Robin) : sans ça,
      // basculer de mode juste après y avoir tapé une valeur la perdrait au profit de l'état React
      // pas encore synchronisé.
      const captured = wizCapture();
      const nextPoolFormat = d.wizpoolformat as "survival" | "double" | "roundrobin";
      // Une phase finale Survival fusionne les qualifiés de poules Round Robin en une seule grande
      // poule (voir Engine.startFinalsSurvivalPool) : en sortir invalide ce choix, retombe sur
      // "double" comme les autres formats à poules non-Round-Robin.
      const nextFinalsFormat = captured.finalsFormat === "survival" && nextPoolFormat !== "roundrobin" ? "double" : captured.finalsFormat;
      setS((s) => ({
        ...s,
        wizData: {
          ...captured,
          poolFormat: nextPoolFormat,
          finalsFormat: nextFinalsFormat,
        },
      }));
    }
    else if (d.wizfinalsformat) {
      // wizCapture() relit d'abord le barème en cours de saisie — même raison que pour wizpoolformat.
      const captured = wizCapture();
      setS((s) => ({ ...s, wizData: { ...captured, finalsFormat: d.wizfinalsformat! } }));
    }
    else if (d.wizmatchfmt) {
      // wizCapture() relit d'abord les champs de l'étape Infos en cours de saisie — même raison que
      // pour wizpoolformat/wizfinalsformat.
      const [mode, value] = d.wizmatchfmt.split("|");
      const captured = wizCapture();
      setS((s) => ({ ...s, wizData: { ...captured, matchMode: mode as "bo" | "ft", matchValue: parseInt(value) || 1 } }));
    }
    else if (d.wizqualify) setS((s) => ({ ...s, wizData: { ...s.wizData, qualifyPerPool: parseInt(d.wizqualify!) || 2 } }));
    else if (d.wizstreaklen) setS((s) => ({ ...s, wizData: { ...s.wizData, streakLength: (d.wizstreaklen === "3" ? 3 : 5) } }));
    else if (d.wizgame) setS((s) => ({ ...s, wizData: { ...s.wizData, game: d.wizgame! } }));
    else if (d.go) { setS((s) => ({ ...s, page: d.go! })); window.scrollTo({ top: 0 }); }
    else if (d.slide) setS((s) => ({ ...s, slide: parseInt(d.slide!) }));
    else if (d.adslide) setS((s) => ({ ...s, adSlide: parseInt(d.adslide!) }));
    else if (d.fmt) setS((s) => ({ ...s, fmt: d.fmt! }));
    else if (d.tournstatus) setS((s) => ({ ...s, tournStatus: d.tournstatus! }));
    else if (d.scope) setS((s) => ({ ...s, scope: d.scope! }));
    else if (d.game) setS((s) => ({ ...s, game: d.game! }));
    else if (d.cat) setS((s) => ({ ...s, cat: d.cat! }));
    else if (d.addName) setS((s) => ({ ...s, productOpen: null, cartItems: [...s.cartItems, { name: d.addName!, price: parseInt(d.addPrice || "0"), id: d.addId }] }));
    else if (d.prodopen) setS((s) => ({ ...s, productOpen: d.prodopen! }));
    else if (d.prodclose !== undefined) setS((s) => ({ ...s, productOpen: null }));
    else if (d.cartOpen !== undefined) { setS((s) => ({ ...s, cartOpen: true })); loadLoyaltyMe(); }
    else if (d.cartpts) setS((s) => ({ ...s, cartPointsToRedeem: parseInt(d.cartpts!) || 0 }));
    else if (d.regpts) { captureTeamDraft(); setS((s) => ({ ...s, regPointsToRedeem: parseInt(d.regpts!) || 0 })); }
    else if (d.cartClose !== undefined) setS((s) => ({ ...s, cartOpen: false, lastOrder: null, cartPayPick: "" }));
    else if (d.cartVieworders !== undefined) { setS((s) => ({ ...s, cartOpen: false, lastOrder: null, cartPayPick: "", page: "profil" })); window.scrollTo({ top: 0 }); }
    else if (d.cartRemove !== undefined) setS((s) => ({ ...s, cartItems: s.cartItems.filter((_, i) => i !== parseInt(d.cartRemove!)) }));
    else if (d.cartClear !== undefined) setS((s) => ({ ...s, cartItems: [] }));
    else if (d.payopen) { captureTeamDraft(); setS((s) => ({ ...s, payModal: d.payopen as "reg" | "cart" | "credit" })); }
    else if (d.payretry) { const [k, id, m] = d.payretry.split("|"); void startOnlinePay(k as PayKind, id, m); }
    else if (d.payclose !== undefined) setS((s) => ({ ...s, payModal: null }));
    else if (d.paychoose) {
      // « Visa » : la carte se règle sur la page FedaPay ; FedaPay / KkiaPay = paiements mobiles.
      const method = d.paychoose === "Visa" ? "FedaPay" : d.paychoose;
      const kind = S.payModal;
      setS((s) => ({ ...s, payModal: null }));
      if (kind === "reg" && S.openId) toggleReg(S.openId, true, method);
      else if (kind === "cart") checkout(method);
      else if (kind === "credit") buyCredits(method);
    }
    else if (d.cartpaypick) setS((s) => ({ ...s, cartPayPick: d.cartpaypick! }));
    else if (d.checkout !== undefined) { checkout(); }
    else if (d.authOpen !== undefined) { setS((s) => ({ ...s, page: "auth", authError: "" })); window.scrollTo({ top: 0 }); }
    else if (d.authTab) setS((s) => ({ ...s, authTab: d.authTab as State["authTab"], authError: "", authNotice: "" }));
    else if (d.authrole) setS((s) => ({ ...s, authRole: d.authrole! }));
    else if (d.authSubmit !== undefined) submitAuth();
    else if (d.evshow) window.open(window.location.pathname + "#evshow=" + d.evshow, "_blank");
    else if (d.evshowclose !== undefined) { const id = S.openEventId; if (id) openEvent(id); else setS((s) => ({ ...s, page: "evenements" })); }
    else if (d.share) {
      const [kind, id] = d.share.split("|") as ["tournoi" | "evenement", string];
      const title = kind === "tournoi" ? S.detail?.name : S.eventDetail?.name;
      void openShare(kind, id, title || "Miabe Esport");
    }
    else if (d.shareclose !== undefined) setS((s) => ({ ...s, shareTarget: null }));
    else if (d.sharecopy) copyShareLink();
    else if (d.embed) openEmbed(d.embed);
    else if (d.launchnext) launchNext(d.launchnext);
    else if (d.evgame) setS((s) => ({ ...s, evGame: d.evgame! }));
    else if (d.predict) { const [tid, key, idx] = d.predict.split("|"); predict(tid, key, parseInt(idx) || 0); }
    else if (d.duplicate) duplicateTournament(d.duplicate);
    else if (d.matchstart) { const [tid, key] = d.matchstart.split("|"); act(`${API}/api/tournaments/${tid}/match-start`, { key, on: true }); }
    else if (d.matchminutes) { const v = parseInt((document.getElementById("match-minutes") as HTMLInputElement | null)?.value || "0") || 0; act(`${API}/api/tournaments/${d.matchminutes}/match-minutes`, { minutes: v }); }
    else if (d.notifymatch) { const [tid, key] = d.notifymatch.split("|"); notifyMatch(tid, key); }
    else if (d.embedclose !== undefined) setS((s) => ({ ...s, embedTarget: null }));
    else if (d.embedcopy) copyEmbedCode();
    else if (d.themetoggle) {
      const next = S.theme === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("vlome_theme", next); } catch { /* ignore */ }
      setS((s) => ({ ...s, theme: next }));
    }
    else if (d.scanopen) setS((s) => ({ ...s, scanOpen: true }));
    else if (d.checkin) { const [tid, rid, on] = d.checkin.split("|"); toggleCheckIn(tid, rid, on === "1"); }
    else if (d.stationsave) {
      const [tid, key] = d.stationsave.split("|");
      const label = (document.getElementById(`station-${key}`) as HTMLInputElement | null)?.value ?? "";
      act(`${API}/api/tournaments/${tid}/station`, { key, label });
    }
    else if (d.streammatch) {
      const [tid, key, on] = d.streammatch.split("|");
      act(`${API}/api/tournaments/${tid}/stream-match`, { key, on: on === "1" });
    }
    else if (d.exportresults) downloadExport(`${API}/api/tournaments/${d.exportresults}/results/export`);
    else if (d.exportregs) downloadExport(`${API}/api/tournaments/${d.exportregs}/registrations/export`);
    else if (d.playerprofile) openPlayerProfile(d.playerprofile, d.playeruid || undefined);
    else if (d.h2h) {
      const opponent = (document.getElementById("h2h-opponent") as HTMLInputElement | null)?.value ?? "";
      setS((s) => ({ ...s, h2hOpponent: opponent }));
      loadHeadToHead(d.h2h, opponent, S.playerProfile?.userId || undefined);
    }
    else if (d.openevent) openEvent(d.openevent);
    else if (d.evlist) { setS((s) => ({ ...s, page: "profil", adminTab: "events", eventEdit: null, eventManage: null, eventMsg: "" })); window.scrollTo({ top: 0 }); loadMyEvents(); }
    else if (d.evnew) setS((s) => ({ ...s, eventEdit: { id: null, name: "", tagline: "", description: "", startDate: null, endDate: null, place: "", accentColor: "", status: "DRAFT", posterUrl: null, bannerUrl: null }, eventManage: null, eventMsg: "" }));
    else if (d.evedit) openEventEditor(d.evedit);
    else if (d.evcancel) setS((s) => ({ ...s, eventEdit: null, eventManage: null, eventMsg: "" }));
    else if (d.evsave) saveEvent();
    else if (d.evdel) {
      const ev = (S.myEvents ?? []).find((x: Detail) => x.id === d.evdel);
      setS((s) => ({ ...s, confirmBox: { title: "Supprimer l'événement", message: `« ${ev?.name || "Cet événement"} » sera supprimé. Ses tournois ne sont PAS supprimés : ils redeviennent des tournois indépendants.`, okLabel: "Supprimer", action: `evdel|${d.evdel}` } }));
    }
    else if (d.evattach) {
      const sel = document.getElementById("ev-attach-sel") as HTMLSelectElement | null;
      if (sel?.value && S.eventEdit?.id) eventTournamentLink(S.eventEdit.id, sel.value, true);
    }
    else if (d.evdetach) {
      const [eid, tid] = d.evdetach.split("|");
      const t = (S.eventManage?.tournaments ?? []).find((x: Detail) => x.id === tid);
      setS((s) => ({ ...s, confirmBox: { title: "Retirer le tournoi", message: `« ${t?.name || "Ce tournoi"} » ne fera plus partie de l'événement (il n'est pas supprimé).`, okLabel: "Retirer", action: `evdetach|${eid}|${tid}` } }));
    }
    else if (d.clubreview) {
      const [uid, decision] = d.clubreview.split("|");
      const r = (S.admin?.clubRequests ?? []).find((x: Detail) => x.id === uid);
      const ok = decision === "approve";
      setS((s) => ({ ...s, confirmBox: {
        title: ok ? "Valider le club" : "Refuser le club",
        message: ok
          ? `Le club « ${r?.clubRequested || ""} » sera ajouté à la base de données et rattaché à ${r?.displayName || "ce joueur"}, dont le compte sera débloqué.`
          : `Le club « ${r?.clubRequested || ""} » ne sera pas ajouté. Le compte de ${r?.displayName || "ce joueur"} sera débloqué, sans club.`,
        okLabel: ok ? "Valider" : "Refuser", action: `clubreview|${uid}|${decision}`,
      } }));
    }
    else if (d.setrole) {
      const [uid, role] = d.setrole.split("|");
      const u = S.admin?.users.find((x: Detail) => x.id === uid);
      if (!u || u.role === role) return; // rôle déjà actif : rien à confirmer
      const who = `« ${u.displayName || "Ce compte"} » (${u.email || ""})`;
      const extra = role === "ADMIN" ? " Il aura accès à toute l'administration du site (utilisateurs, paiements, commandes…)." : u.role === "ADMIN" ? " Il perdra l'accès à l'administration." : "";
      setS((s) => ({ ...s, confirmBox: { title: "Changer le rôle", message: `${who} passera de ${ROLE_LABEL[u.role] || u.role} à ${ROLE_LABEL[role] || role}.${extra}`, okLabel: "Confirmer le changement", action: `setrole|${uid}|${role}` } }));
    }
    else if (d.userpwd) {
      const u = S.admin?.users.find((x: Detail) => x.id === d.userpwd);
      setS((s) => ({ ...s, confirmBox: { title: "Réinitialiser le mot de passe", message: `Un mot de passe temporaire sera généré pour « ${u?.displayName || "ce compte"} » (${u?.email || ""}). Son ancien mot de passe cessera immédiatement de fonctionner.`, okLabel: "Réinitialiser", action: `userpwd|${d.userpwd}` } }));
    }
    else if (d.userdel) {
      const u = S.admin?.users.find((x: Detail) => x.id === d.userdel);
      setS((s) => ({ ...s, confirmBox: { title: "Supprimer le compte", message: `« ${u?.displayName || "Ce compte"} » (${u?.email || ""}) sera définitivement supprimé, avec ses inscriptions et commandes. Les tournois créés depuis ce compte sont conservés.`, okLabel: "Supprimer", action: `userdel|${d.userdel}` } }));
    }
    else if (d.admintab) { setS((s) => ({ ...s, adminTab: d.admintab!, newsEdit: null, prodEdit: null, siteMsg: "", adminSearch: "", prodCat: "Tous", prodSort: "", consoleMenuOpen: false })); if (d.admintab === "joueurs" && !S.roster) loadRoster(); if (d.admintab === "events") loadMyEvents(); }
    else if (d.consolemenu !== undefined) setS((s) => ({ ...s, consoleMenuOpen: d.consolemenu === "1" }));
    else if (d.admsearchclear !== undefined) setS((s) => ({ ...s, adminSearch: "" }));
    else if (d.sitesave !== undefined) saveSite();
    else if (d.loyaltysave !== undefined) saveLoyalty();
    else if (d.legalsave !== undefined) saveLegalPages();
    else if (d.creditssave !== undefined) saveCreditsSettings();
    else if (d.confirmcredit) confirmCreditPurchaseAdmin(d.confirmcredit);
    else if (d.orgapprove) reviewOrganizer(d.orgapprove, "APPROVED");
    else if (d.orgreject) reviewOrganizer(d.orgreject, "REJECTED");
    else if (d.creditbuyqty) setS((s) => ({ ...s, creditBuyQty: Math.max(1, parseInt(d.creditbuyqty!) || 1) }));
    else if (d.creditbuypay) setS((s) => ({ ...s, creditBuyPay: d.creditbuypay! }));
    else if (d.creditbuy !== undefined) buyCredits();
    else if (d.creditcancel) cancelCreditPurchase(d.creditcancel);
    else if (d.herobgclear !== undefined) clearHeroBg();
    else if (d.ptadd !== undefined) setS((s) => ({ ...s, partnersEdit: [...syncPartnersFromDom(s.partnersEdit ?? []), { key: newKey(), name: "", logoUrl: null, display: "both" }] }));
    else if (d.ptdel) setS((s) => ({ ...s, partnersEdit: syncPartnersFromDom(s.partnersEdit ?? []), confirmBox: { title: "Supprimer le partenaire", message: "Cette ligne sera retirée du bandeau partenaires.", okLabel: "Supprimer", action: `ptdel|${d.ptdel}` } }));
    else if (d.adnew !== undefined) setS((s) => ({ ...s, adsEdit: [...syncAdsFromDom(s.adsEdit ?? []), { key: newKey(), label: "", linkUrl: "", imageUrl: null, page: "accueil" }] }));
    else if (d.addel) setS((s) => ({ ...s, adsEdit: syncAdsFromDom(s.adsEdit ?? []), confirmBox: { title: "Supprimer la publicité", message: "Cette annonce sera retirée de la liste.", okLabel: "Supprimer", action: `addel|${d.addel}` } }));
    else if (d.sladd !== undefined) setS((s) => ({ ...s, slidesEdit: [...syncSlidesFromDom(s.slidesEdit ?? []), { key: newKey(), tag: "", title: "", sub: "", cta: "", imageUrl: null }] }));
    else if (d.sldel) setS((s) => ({ ...s, slidesEdit: syncSlidesFromDom(s.slidesEdit ?? []), confirmBox: { title: "Supprimer la diapo", message: "Cette diapo sera retirée du slider « À la une ».", okLabel: "Supprimer", action: `sldel|${d.sldel}` } }));
    else if (d.newsnew !== undefined) setS((s) => ({ ...s, newsEdit: { title: "", category: "", body: "" } }));
    else if (d.newsedit) { const n = S.admin?.news.find((x: Detail) => x.id === d.newsedit); if (n) setS((s) => ({ ...s, newsEdit: n })); }
    else if (d.newscancel !== undefined) setS((s) => ({ ...s, newsEdit: null }));
    else if (d.newssave) saveNews(d.newssave);
    else if (d.newspub) { const [nid, pub] = d.newspub.split("|"); adminAct(`news/${nid}`, "PATCH", { published: pub === "1" }); }
    else if (d.newsdel) {
      const n = S.admin?.news.find((x: Detail) => x.id === d.newsdel);
      setS((s) => ({ ...s, confirmBox: { title: "Supprimer l'article", message: `« ${n?.title || "Cet article"} » sera définitivement supprimé du site.`, okLabel: "Supprimer", action: `newsdel|${d.newsdel}` } }));
    }
    else if (d.rostertab) setS((s) => ({ ...s, rosterTab: d.rostertab as "joueurs" | "clubs", adminSearch: "" }));
    else if (d.rosteredit) {
      if (d.rosteredit === "new") setS((s) => ({ ...s, rosterEdit: { name: "", city: "", clubId: "" } }));
      else { const p = S.roster?.find((x: Detail) => x.id === d.rosteredit); if (p) setS((s) => ({ ...s, rosterEdit: p })); }
    }
    else if (d.rostercancel !== undefined) setS((s) => ({ ...s, rosterEdit: null }));
    else if (d.rostersave) saveRosterPlayer(d.rostersave);
    else if (d.rosterdel) {
      const p = S.roster?.find((x: Detail) => x.id === d.rosterdel);
      setS((s) => ({ ...s, confirmBox: { title: "Retirer le joueur", message: `« ${p?.name || "Ce joueur"} » sera retiré de la base de joueurs (les tournois passés ne sont pas affectés).`, okLabel: "Retirer", action: `rosterdel|${d.rosterdel}` } }));
    }
    else if (d.clubedit) {
      if (d.clubedit === "new") setS((s) => ({ ...s, clubEdit: { name: "", city: "" } }));
      else { const c = S.clubs?.find((x: Detail) => x.id === d.clubedit); if (c) setS((s) => ({ ...s, clubEdit: c })); }
    }
    else if (d.clubcancel !== undefined) setS((s) => ({ ...s, clubEdit: null }));
    else if (d.clubsave) saveClub(d.clubsave);
    else if (d.clubdel) {
      const c = S.clubs?.find((x: Detail) => x.id === d.clubdel);
      setS((s) => ({ ...s, confirmBox: { title: "Supprimer le club", message: `« ${c?.name || "Ce club"} » sera supprimé — ses joueurs resteront dans la base, simplement sans club.`, okLabel: "Supprimer", action: `clubdel|${d.clubdel}` } }));
    }
    else if (d.gameedit) {
      if (d.gameedit === "new") setS((s) => ({ ...s, gameEdit: { name: "" } }));
      else { const g = S.games?.find((x: Detail) => x.id === d.gameedit); if (g) setS((s) => ({ ...s, gameEdit: g })); }
    }
    else if (d.gamecancel !== undefined) setS((s) => ({ ...s, gameEdit: null }));
    else if (d.gamesave) saveGame(d.gamesave);
    else if (d.gamedel) {
      const g = S.games?.find((x: Detail) => x.id === d.gamedel);
      setS((s) => ({ ...s, confirmBox: { title: "Supprimer le jeu", message: `« ${g?.name || "Ce jeu"} » sera retiré du catalogue — les tournois déjà créés ne sont pas affectés.`, okLabel: "Supprimer", action: `gamedel|${d.gamedel}` } }));
    }
    else if (d.playerview) loadPlayerDetail(d.playerview);
    else if (d.playerviewclose !== undefined) setS((s) => ({ ...s, playerDetail: null }));
    else if (d.gallerynew !== undefined) setS((s) => ({ ...s, galleryEdit: { title: "", tournamentId: "", albumId: "" } }));
    // « + Ajouter » sur une carte de catalogue : ouvre le formulaire d'import pré-rattaché à ce catalogue.
    else if (d.galleryadd) setS((s) => ({ ...s, galleryEdit: { title: "", tournamentId: "", albumId: d.galleryadd } }));
    else if (d.gallerycancel !== undefined) setS((s) => ({ ...s, galleryEdit: null }));
    else if (d.albumnew !== undefined) setS((s) => ({ ...s, albumEdit: { title: "", description: "" } }));
    else if (d.albumedit) { const a = S.albums?.find((x: Detail) => x.id === d.albumedit); if (a) setS((s) => ({ ...s, albumEdit: { id: a.id, title: a.title, description: a.description || "" } })); }
    else if (d.albumcancel !== undefined) setS((s) => ({ ...s, albumEdit: null }));
    else if (d.albumsave !== undefined) saveAlbum();
    else if (d.albumdel) {
      const a = S.albums?.find((x: Detail) => x.id === d.albumdel);
      setS((s) => ({ ...s, confirmBox: { title: "Supprimer le catalogue", message: `« ${a?.title || "Ce catalogue"} » sera supprimé. Ses ${a?.count ?? 0} média(s) sont conservés et repassent hors catalogue.`, okLabel: "Supprimer", action: `albumdel|${d.albumdel}` } }));
    }
    else if (d.albumopen) setS((s) => ({ ...s, albumOpen: d.albumopen!, galleryFilter: "", galleryType: "" }));
    else if (d.albumback !== undefined) setS((s) => ({ ...s, albumOpen: null }));
    else if (d.gallerysave !== undefined) saveGalleryItem();
    else if (d.gallerydel) {
      const it = S.gallery?.find((x: Detail) => x.id === d.gallerydel);
      setS((s) => ({ ...s, confirmBox: { title: "Supprimer ce média", message: `« ${it?.title || "Ce média"} » sera définitivement supprimé de la galerie.`, okLabel: "Supprimer", action: `gallerydel|${d.gallerydel}` } }));
    }
    else if (d.gfilter !== undefined) setS((s) => ({ ...s, galleryFilter: d.gfilter! }));
    else if (d.gtype !== undefined) setS((s) => ({ ...s, galleryType: d.gtype as State["galleryType"] }));
    else if (d.instock !== undefined) setS((s) => ({ ...s, boutiqueInStock: d.instock === "1" }));
    else if (d.classview) { setS((s) => ({ ...s, classementView: d.classview as "joueurs" | "clubs" | "equipes" | "pronos" })); if (d.classview === "pronos") void loadPredictors(); }
    else if (d.gopen) setS((s) => ({ ...s, galleryOpen: d.gopen! }));
    else if (d.gclose !== undefined) setS((s) => ({ ...s, galleryOpen: null }));
    else if (d.gprev !== undefined || d.gnext !== undefined) {
      const items = S.galleryFilter ? (S.gallery ?? []).filter((it: Detail) => it.tournament?.id === S.galleryFilter) : (S.gallery ?? []);
      const idx = items.findIndex((it: Detail) => it.id === S.galleryOpen);
      const next = d.gprev !== undefined ? idx - 1 : idx + 1;
      if (items[next]) setS((s) => ({ ...s, galleryOpen: items[next].id }));
    }
    else if (d.prodcat) setS((s) => ({ ...s, prodCat: d.prodcat! }));
    else if (d.prodsort) setS((s) => ({ ...s, prodSort: d.prodsort!, prodSortDir: s.prodSort === d.prodsort && s.prodSortDir === "asc" ? "desc" : "asc" }));
    else if (d.prodnew !== undefined) setS((s) => ({ ...s, prodEdit: { name: "", category: "", priceXof: 0, stock: 0, loyaltyEligible: false, showOnHome: false } }));
    else if (d.prodedit) { const p = S.admin?.products.find((x: Detail) => x.id === d.prodedit); if (p) setS((s) => ({ ...s, prodEdit: p })); }
    else if (d.prodcancel !== undefined) setS((s) => ({ ...s, prodEdit: null }));
    else if (d.prodsave) saveProd(d.prodsave);
    else if (d.proddel) {
      const p = S.admin?.products.find((x: Detail) => x.id === d.proddel);
      setS((s) => ({ ...s, confirmBox: { title: "Supprimer le produit", message: `« ${p?.name || "Ce produit"} » sera retiré définitivement de la boutique.`, okLabel: "Supprimer", action: `proddel|${d.proddel}` } }));
    }
    else if (d.ordstatus) { const [oid, st] = d.ordstatus.split("|"); adminAct(`orders/${oid}/status`, "PATCH", { status: st }); }
    else if (d.filepick) (document.getElementById(d.filepick) as HTMLInputElement | null)?.click();
    else if (d.confirmCancel !== undefined) setS((s) => ({ ...s, confirmBox: null }));
    else if (d.confirmOk !== undefined) {
      const c = S.confirmBox;
      setS((s) => ({ ...s, confirmBox: null }));
      if (c) {
        const [kind, ...rest] = c.action.split("|");
        const arg = rest.join("|");
        if (kind === "logout") logout();
        else if (kind === "delT") deleteT(arg);
        else if (kind === "newsdel") adminAct(`news/${arg}`, "DELETE");
        else if (kind === "proddel") adminAct(`products/${arg}`, "DELETE");
        else if (kind === "gallerydel") deleteGalleryItem(arg);
        else if (kind === "evdel") deleteEvent(arg);
        else if (kind === "evdetach") { const [eid, tid] = arg.split("|"); eventTournamentLink(eid, tid, false); }
        else if (kind === "clubreview") { const [uid, decision] = arg.split("|"); adminAct(`club-requests/${uid}/${decision}`, "POST"); }
        else if (kind === "setrole") { const [uid, role] = arg.split("|"); setRole(uid, role); }
        else if (kind === "userdel") adminAct(`users/${arg}`, "DELETE");
        else if (kind === "userpwd") resetUserPassword(arg);
        else if (kind === "albumdel") deleteAlbum(arg);
        else if (kind === "ptdel") setS((s) => ({ ...s, partnersEdit: (s.partnersEdit ?? []).filter((p) => p.key !== arg) }));
        else if (kind === "addel") setS((s) => ({ ...s, adsEdit: (s.adsEdit ?? []).filter((a) => a.key !== arg) }));
        else if (kind === "sldel") setS((s) => ({ ...s, slidesEdit: (s.slidesEdit ?? []).filter((sl) => sl.key !== arg) }));
        else if (kind === "plrem") { const [tid, pid] = rest; act(`${API}/api/tournaments/${tid}/players/${pid}`, undefined, "DELETE"); }
        else if (kind === "pldq") { const [tid, pid] = rest; act(`${API}/api/tournaments/${tid}/players/${pid}/disqualify`, undefined, "POST"); }
        else if (kind === "treset") { act(`${API}/api/tournaments/${arg}/reset`, undefined, "POST"); }
        else if (kind === "rosterdel") rosterAct(`${API}/api/roster/${arg}`, "DELETE");
        else if (kind === "clubdel") rosterAct(`${API}/api/clubs/${arg}`, "DELETE");
        else if (kind === "gamedel") rosterAct(`${API}/api/games/${arg}`, "DELETE");
      }
    }
    else if (d.profileedit !== undefined) setS((s) => ({ ...s, profileEdit: true, profileMsg: "", page: "profil" }));
    else if (d.profilecancel !== undefined) setS((s) => ({ ...s, profileEdit: false, profileMsg: "" }));
    else if (d.profilesave !== undefined) saveProfile();
    else if (d.passsave !== undefined) savePassword();
    else if (d.reg) toggleReg(d.reg, true);
    else if (d.unreg) toggleReg(d.unreg, false);
    else if (d.paypick) { captureTeamDraft(); setS((s) => ({ ...s, payPick: d.paypick! })); }
    else if (d.confirmpay) { const [tid, regId] = d.confirmpay.split("|"); confirmRegPayment(tid, regId); }
    else if (d.show) window.open(window.location.pathname + "#show=" + d.show, "_blank");
    else if (d.print) {
      if (!S.detail || S.detail.id !== d.print) return;
      let area = document.getElementById("print-area");
      // data-force-theme="dark" : l'affiche réutilise les VRAIS composants de l'écran (bracketTree,
      // journeeCalendar, poolCard…), qui suivent maintenant le thème choisi sur le site — l'affiche, elle,
      // reste toujours sombre à l'impression, quel que soit ce choix (voir le commentaire sur unscroll ci-dessous).
      if (!area) { area = document.createElement("div"); area.id = "print-area"; area.setAttribute("data-force-theme", "dark"); document.body.appendChild(area); }
      area.innerHTML = buildPoster(S.detail);
      document.body.classList.add("printing");
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        document.body.classList.remove("printing");
        if (area) area.innerHTML = "";
        window.removeEventListener("afterprint", cleanup);
      };
      window.addEventListener("afterprint", cleanup);
      setTimeout(cleanup, 15000); // filet de sécurité si le dialogue d'impression ne s'ouvre pas (afterprint ne se déclenche jamais)
      setTimeout(() => window.print(), 60);
    }
    else if (d.showclose !== undefined) { history.replaceState(null, "", window.location.pathname); setS((s) => ({ ...s, page: "accueil", openId: null, detail: null })); }
    else if (d.act === "create-open") {
      if (S.user?.role === "ORGANIZER" && S.user.organizerStatus !== "APPROVED") {
        alert(S.user.organizerStatus === "REJECTED"
          ? "Ta demande d'organisateur a été refusée par l'équipe Miabe."
          : "Ton compte organisateur est en attente de validation par l'équipe Miabe — tu pourras créer des tournois une fois approuvé.");
        return;
      }
      setS((s) => ({
        ...s, creating: true, wizEventId: d.evid || null, wizStep: 1, wizRosterSearch: "", wizEditId: null, wizFullEdit: false,
        wizData: { teamSize: 0, name: "", game: "", date: "", place: "", format: "SURVIVAL", pointsPerPlayer: 5, nbPools: 2, players: [], entryFeeXof: 0, givesLoyaltyPoint: true, survWin: 1, loserWin: 0.5, poolFinalWin: 1.5, finalsWin: 2, championBonus: 3, streakBonus: 0, finalsFormat: "double", poolFormat: "survival", streakLength: 5, qualifyPerPool: 2, matchMode: "bo", matchValue: 1, countGoalDiff: true, brPoints: DEFAULT_BR_POINTS.slice(), brKillPoints: DEFAULT_BR_KILL_POINTS, imageUrl: null },
      }));
      loadRoster();
    }
    else if (d.act === "create-cancel") setS((s) => ({ ...s, creating: false, wizEditId: null, wizFullEdit: false }));
    else if (d.act === "wiz-submit") submitCreate();
    else if (d.act === "wiz-update") submitUpdate();
    else if (d.clearq !== undefined) setS((s) => ({ ...s, q: "" }));
  }

  // Affiche le nom du fichier choisi à côté du bouton d'envoi d'image.
  // (mise à jour DOM directe : pas de re-rendu, l'input garde son fichier)
  function handleFileChange(t: HTMLInputElement) {
    if (t.type === "file" && t.id) {
      const file = t.files?.[0];
      const count = t.files?.length ?? 0;
      const span = document.getElementById(t.id + "-name");
      // Sélection multiple (galerie) : on annonce le nombre plutôt que le seul premier nom.
      if (span) span.textContent = count > 1 ? `${count} fichiers sélectionnés` : file?.name || "Aucun fichier";
      // Aperçu instantané (avant tout envoi/enregistrement) depuis le fichier local choisi.
      const pv = document.getElementById("pv-" + t.id);
      if (pv && file) {
        const url = URL.createObjectURL(file);
        if (file.type.startsWith("video/")) {
          pv.style.background = "var(--surface-3)";
          pv.innerHTML = `<video src="${url}" muted autoplay loop playsinline style="width:100%;height:100%;object-fit:cover"></video>`;
        } else {
          pv.style.background = `url('${url}') center/cover`;
          pv.innerHTML = "";
        }
      }
      // L'assistant de création régénère tout le DOM à chaque étape franchie : l'input
      // file de l'étape 1 (affiche du tournoi) n'existe plus au moment de l'envoi final,
      // donc un upload différé au clic "Créer/Enregistrer" échoue silencieusement. On
      // envoie l'affiche tout de suite au choix du fichier et on garde l'URL dans
      // wizData, qui lui survit à la navigation entre étapes.
      if (t.id === "wz-img" && file) {
        uploadOrNotify("wz-img")
          .then((url2) => {
            if (!url2) return;
            // wizCapture() relit d'abord les champs de l'étape affichée : le re-rendu déclenché
            // ici régénère tout le HTML de l'assistant, et sans cette capture les valeurs saisies
            // mais pas encore validées (nom, jeu, date, lieu…) seraient effacées à l'écran.
            const captured = wizCapture();
            setS((s) => ({ ...s, wizData: { ...captured, imageUrl: url2 } }));
          })
          .catch(() => {
            // Message déjà affiché par uploadOrNotify ; on remet le sélecteur à zéro pour que
            // l'organisateur voie clairement qu'aucune affiche n'est associée.
            const span = document.getElementById("wz-img-name");
            if (span) span.textContent = "Aucun fichier";
          });
      }
    }
  }

  /** Bouton d'action principal correspondant au champ saisi : valider par Entrée revient à cliquer
   * ce bouton, ce qui réutilise toute la logique déjà branchée sur le dispatcher (aucun doublon). */
  function enterTargetSelector(id: string): string | null {
    if (id.startsWith("a-")) return "[data-auth-submit]";
    if (id.startsWith("pw-")) return "[data-passsave]";
    if (id.startsWith("p-")) return "[data-profilesave]";
    if (id.startsWith("n-")) return "[data-newssave]";
    if (id.startsWith("pr-")) return "[data-prodsave]";
    if (id.startsWith("ro-")) return "[data-rostersave]";
    if (id.startsWith("cl-")) return "[data-clubsave]";
    if (id.startsWith("gm-")) return "[data-gamesave]";
    if (id.startsWith("ga-")) return "[data-gallerysave]";
    if (id.startsWith("al-")) return "[data-albumsave]";
    if (id.startsWith("ly-")) return "[data-loyaltysave],[data-legalsave]";
    if (id.startsWith("cr-")) return "[data-creditssave]";
    if (id.startsWith("e-")) return "[data-editsave]";
    if (id === "pl-add-name") return "[data-pladd]";
    if (id.startsWith("pl-edit-")) return "[data-pledit-save]";
    // Réglages du site : identité, héro, diapos, partenaires, publicités — un seul bouton d'enregistrement.
    if (/^(b-name|h-|sl-|pt-|ad-)/.test(id)) return "[data-sitesave]";
    return null;
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const t = e.target as HTMLElement;
    if (e.key === "Escape") {
      // Échap ferme les panneaux légers. Volontairement PAS l'assistant de création : cinq étapes
      // de saisie ne doivent pas partir sur une touche pressée par mégarde (le bouton « retour »
      // du téléphone, lui, le ferme — c'est un geste explicite).
      if (S.galleryOpen || S.confirmBox || S.cartOpen || S.consoleMenuOpen) {
        setS((s) => ({ ...s, galleryOpen: s.galleryOpen ? null : s.galleryOpen, confirmBox: null, cartOpen: false, consoleMenuOpen: false }));
      }
      return;
    }
    if (e.key !== "Enter") return;
    if (t.tagName === "TEXTAREA") return; // Entrée = retour à la ligne dans un texte libre, jamais « enregistrer »
    if (t.id === "hsearch") {
      const q = (t as HTMLInputElement).value.trim();
      setS((s) => ({ ...s, q, page: "tournois", creating: false }));
      window.scrollTo({ top: 0 });
      return;
    }
    if (t.id === "adm-search") { setS((s) => ({ ...s, adminSearch: (t as HTMLInputElement).value.trim() })); return; }
    if (t.id === "wiz-roster-search") { setS((s) => ({ ...s, wizRosterSearch: (t as HTMLInputElement).value.trim() })); return; }
    if (t.id === "regie-roster-search") { setS((s) => ({ ...s, rosterQ: (t as HTMLInputElement).value.trim() })); return; }

    // Entrée ne valide que depuis un champ de saisie sur une seule ligne : dans un <textarea>
    // (description, texte d'article…) elle doit rester un simple retour à la ligne.
    const input = t as HTMLInputElement;
    if (t.tagName !== "INPUT" || ["file", "checkbox", "radio", "button", "submit"].includes(input.type)) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;

    // Assistant de création : Entrée passe à l'étape suivante (ou crée le tournoi à la dernière).
    if (input.id.startsWith("wz-") && S.creating) {
      e.preventDefault();
      const btn = S.wizStep >= 5
        ? document.querySelector<HTMLElement>(`[data-act="${S.wizEditId ? "wiz-update" : "wiz-submit"}"]`)
        : document.querySelector<HTMLElement>(`[data-wizgoto="${S.wizStep + 1}"]`);
      if (btn && !(btn as HTMLButtonElement).disabled) btn.click();
      return;
    }
    const sel = enterTargetSelector(input.id);
    if (!sel) return;
    // On cherche d'abord dans la carte/formulaire courant, pour ne pas déclencher le bouton
    // d'un autre bloc quand plusieurs formulaires du même type sont affichés.
    const scope = input.closest<HTMLElement>("form, [data-formscope]") ?? document;
    const btn = scope.querySelector<HTMLElement>(sel) ?? document.querySelector<HTMLElement>(sel);
    if (btn && !(btn as HTMLButtonElement).disabled) { e.preventDefault(); btn.click(); }
  }

  return (
    <div
      ref={rootRef}
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(1200px 620px at 82% -12%,rgba(34,211,238,.10),transparent 62%),radial-gradient(1000px 520px at -6% 108%,rgba(244,63,126,.09),transparent 60%),var(--bg)",
        ...(pageChanged ? {} : ({ "--rise-anim": "none" } as React.CSSProperties)),
      }}
      onClick={onClick}
      onKeyDown={onKeyDown}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
