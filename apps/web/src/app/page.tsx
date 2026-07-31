"use client";
import { useEffect, useMemo, useRef, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
/** URL d'un média envoyé (image/vidéo) : le stockage objet (Vercel Blob) renvoie déjà une URL absolue,
 * l'ancien stockage disque local renvoyait un chemin relatif "/uploads/..." à préfixer par l'API. */
function mediaUrl(path?: string | null): string { return !path ? "" : /^https?:\/\//.test(path) ? path : `${API}${path}`; }

function token(): string | null { return typeof window !== "undefined" ? localStorage.getItem("vlome_token") : null; }
function authHeaders(): Record<string, string> { const t = token(); return t ? { Authorization: "Bearer " + t } : {}; }

/* ================= Données ================= */
type TournCard = { id?: string; name: string; format: string; game: string; players: number; date: string; place: string; live: boolean; cagnotte: number; status: string; imageUrl?: string | null };
/* eslint-disable @typescript-eslint/no-explicit-any */
type Detail = any; // DTO cockpit renvoyé par l'API (/tournaments/:id/state)
type CartItem = { name: string; price: number; id?: string };
type AuthUser = { displayName: string; role: string; email: string };
type State = {
  page: string; slide: number; fmt: string; scope: string; game: string; cat: string; tournStatus: string;
  tourns: TournCard[] | null; creating: boolean; busy: boolean; leaderboard: Detail[] | null;
  cartItems: CartItem[]; cartOpen: boolean; products: { id: string; cat: string; name: string; price: number; ph: string; img?: string | null; stock?: number; loyaltyEligible?: boolean }[] | null; boutiqueInStock: boolean;
  cartPayPick: string; cartBusy: boolean; lastOrder: { reference: string; totalXof: number; paymentMethod: string } | null;
  cartPointsToRedeem: number; // points fidélité que l'utilisateur choisit d'appliquer au panier
  regPointsToRedeem: number; // idem, pour réduire les frais d'inscription à un tournoi
  loyaltySettings: { pointValueXof: number; maxRedeemPercent: number } | null;
  loyaltyHistory: Detail[] | null; loyaltyBalance: number;
  user: AuthUser | null; authTab: "login" | "register"; authBusy: boolean; authError: string; authRole: string;
  q: string;
  openId: string | null; detail: Detail | null; detailBusy: boolean; editing: boolean;
  admin: { overview: Detail; users: Detail[]; news: Detail[]; products: Detail[]; orders: Detail[]; payments: Detail[] } | null;
  adminTab: string; adminSearch: string; newsEdit: Detail | null; prodEdit: Detail | null;
  prodCat: string; prodSort: string; prodSortDir: "asc" | "desc";
  confirmBox: { title: string; message: string; okLabel: string; action: string } | null;
  site: Detail | null; siteMsg: string;
  news: Detail[] | null;
  me: Detail | null; myRegs: Detail[] | null; myOrders: Detail[] | null; myTourns: Detail[] | null; myResults: Detail[] | null;
  regIds: { id: string; status: string; amountXof: number }[]; profileMsg: string; passMsg: string; profileEdit: boolean;
  payPick: string; // moyen de paiement choisi sur la page d'un tournoi payant
  gallery: Detail[] | null; galleryEdit: Detail | null; galleryFilter: string; galleryOpen: string | null; galleryType: "" | "video" | "image";
  partnersEdit: { key: string; name: string; logoUrl: string | null }[] | null;
  slidesEdit: { key: string; tag: string; title: string; sub: string; cta: string; imageUrl: string | null }[] | null;
  adsEdit: { key: string; label: string; linkUrl: string; imageUrl: string | null; page: string }[] | null;
  adSlide: number;
  regsPanel: Detail[] | null; // inscriptions du tournoi ouvert (cockpit organisateur)
  editingPlayerId: string | null; // joueur en cours d'édition (renommer/club/ajustement) dans le panneau Joueurs
  brPick: string[]; // classement en cours de saisie (Battle Royale) — ids dans l'ordre cliqué, 1er = vainqueur de la partie
  activeMatchId: string | null; // match mis en avant dans le panneau de contrôle de la régie (null = auto : premier jouable)
  matchScoreA: number; matchScoreB: number; // score en cours de saisie (stepper) pour le match actif de la régie
  regiePanel: "joueurs" | "paiements" | "reglages" | null; // overlay ouvert depuis le bas du rail de régie
  bracketView: "tree" | "list"; // bascule d'affichage de la phase finale en régie
  rosterQ: string; // recherche dans le panneau Joueurs de la régie
  showSlide: number; // diapositive active du Mode Show (classement / matchs en direct / derniers résultats…), tourne automatiquement
  consoleMenuOpen: boolean; // tiroir de navigation de la console admin/organisateur ouvert (mobile/tablette uniquement)
  finalsFormatPick: string; // format de phase finale choisi avant de lancer les finales
  // Assistant de création (5 étapes) — accumule les champs au fil des étapes avant l'envoi final.
  wizStep: number;
  wizData: {
    name: string; game: string; date: string; place: string; format: string;
    pointsPerPlayer: number; nbPools: number; players: string[]; entryFeeXof: number; givesLoyaltyPoint: boolean;
    survWin: number; loserWin: number; poolFinalWin: number; finalsWin: number; championBonus: number;
    imageUrl: string | null;
  };
  wizRosterSearch: string;
  wizEditId: string | null; // id du tournoi en cours de modification via l'assistant (null = création)
  // Base de joueurs & clubs (site-wide, gérée depuis l'admin — aussi utilisée par l'assistant de création).
  roster: Detail[] | null; clubs: Detail[] | null;
  rosterEdit: Detail | null; clubEdit: Detail | null; rosterTab: "joueurs" | "clubs";
  classementView: "joueurs" | "clubs"; // bascule joueurs / clubs sur la page Classements
};

const NAV = ["Accueil", "Tournois", "Classements", "Galerie", "Boutique", "Profil"];
// Pages simples (sans paramètre) dont le hash d'URL correspond directement à la clé de page.
const SIMPLE_PAGES = ["accueil", "tournois", "classements", "galerie", "boutique", "profil"];

const SLIDES = [
  { tag: "Grand tournoi", title: "SURVIVAL CUP LOMÉ 2026", sub: "32 joueurs, mode Survival — le vainqueur reste sur le terrain. Cagnotte 160 points.", cta: "S'inscrire" },
  { tag: "Nouveau", title: "FREE FIRE TOGO SERIES", sub: "48 joueurs en Battle Royale sur 3 jours. Qualifications en ligne ouvertes.", cta: "Voir le tournoi" },
  { tag: "Communauté", title: "GAMING ARENA LOMÉ", sub: "LAN mensuelle : viens jouer, streamer et rencontrer la communauté esport togolaise.", cta: "Découvrir" },
];

const EVENTS = [
  { d: "12", mo: "JUL", t: "Survival Cup Lomé", type: "Tournoi LAN", place: "Palais des Congrès" },
  { d: "19", mo: "JUL", t: "Tekken Kings Cup", type: "Tournoi", place: "Gaming Arena Lomé" },
  { d: "26", mo: "JUL", t: "Free Fire Togo Series", type: "Battle Royale", place: "Kara" },
  { d: "03", mo: "AOÛ", t: "Conférence Esport & Emploi", type: "Conférence", place: "Université de Lomé" },
];

const NEWS = [
  { cat: "EA FC", ph: "ea-fc-26-patch", t: "EA FC 26 : le patch qui change la méta au Togo", date: "Il y a 2 jours" },
  { cat: "Esport Togo", ph: "vlome-partenariat", t: "VLOME signe un partenariat avec Gaming Arena Lomé", date: "Il y a 4 jours" },
  { cat: "Free Fire", ph: "free-fire-series", t: "Free Fire Togo Series : 48 joueurs déjà inscrits", date: "Il y a 6 jours" },
];

const PARTNERS = ["Gaming Arena Lomé", "Yas Togo", "Moov Africa", "Université de Lomé", "CIC Lomé", "Togocom"];

const PAYMENTS = ["Flooz", "Mixx by Yas", "Visa", "Mastercard", "PayPal", "Espèces"];

const FORMATS = ["Tous", "Survival", "Bracket simple", "Double élim", "Swiss", "Round Robin", "Poules", "Battle Royale"];

/** Formats sélectionnables à la création : [étiquette DB envoyée à l'API, libellé, explication courte du déroulé]. */
const WIZ_FORMATS: [string, string, string][] = [
  ["SURVIVAL", "Survival", "Poules avec repêchage, puis phase finale — le format historique VLOME, barème détaillé réglable."],
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
function cagnottePreview(nPlayers: number, nbPools: number, pointsPerPlayer: number, scoring: { survWin: number; loserWin: number; poolFinalWin: number; finalsWin: number; championBonus: number }) {
  const total = nPlayers * pointsPerPlayer;
  const sizes = balancedSizesPreview(nPlayers, nbPools);
  let surv = 0, los = 0, pf = 0;
  sizes.forEach((n) => { if (n >= 2) { surv += n - 1; los += Math.max(0, n - 2); pf += 1; } });
  const q = sizes.filter((n) => n >= 2).length * 2 + sizes.filter((n) => n === 1).length;
  const finalsMatches = Math.max(0, q - 1);
  const breakdown = {
    survWin: { matches: surv, pts: Math.round(surv * scoring.survWin * 100) / 100 },
    loserWin: { matches: los, pts: Math.round(los * scoring.loserWin * 100) / 100 },
    poolFinalWin: { matches: pf, pts: Math.round(pf * scoring.poolFinalWin * 100) / 100 },
    finalsWin: { matches: finalsMatches, pts: Math.round(finalsMatches * scoring.finalsWin * 100) / 100 },
    championBonus: { matches: 1, pts: Math.round(scoring.championBonus * 100) / 100 },
  };
  const programmed = Math.round((surv * scoring.survWin + los * scoring.loserWin + pf * scoring.poolFinalWin + finalsMatches * scoring.finalsWin + scoring.championBonus) * 100) / 100;
  return { total, programmed, gap: Math.round((total - programmed) * 100) / 100, valid: programmed <= total, sizes, breakdown };
}

/** Partenaires normalisés (compat : d'anciens réglages stockaient de simples chaînes). */
function normPartners(S: State): { name: string; logoUrl: string | null }[] {
  const raw: Detail[] = S.site?.partners?.length ? S.site.partners : PARTNERS;
  return raw.map((p: Detail) => (typeof p === "string" ? { name: p, logoUrl: null } : { name: p.name, logoUrl: p.logoUrl ?? null }));
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
      <span style="color:${on ? "#22D3EE" : "#8E8FA6"};font-weight:${on ? 700 : 600};font-size:13.5px;letter-spacing:.3px">${label}</span>
      ${on ? '<span style="position:absolute;left:14px;right:14px;bottom:-14px;height:2px;background:#22D3EE;border-radius:2px"></span>' : ""}</button>`;
  }).join("");
  return `<header style="position:sticky;top:0;z-index:50;display:flex;align-items:center;gap:18px;flex-wrap:wrap;padding:13px 22px;border-bottom:1px solid #282838;background:rgba(11,11,17,.82);backdrop-filter:blur(12px)">
    <div data-go="accueil" style="display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none">
      ${brandLogo(S, 34, 20)}
      <span style="font-family:'Bebas Neue',sans-serif;font-size:25px;letter-spacing:1.6px">${escHtml(S.site?.brand?.name1 ?? "VLOME")} <span style="color:#22D3EE">${escHtml(S.site?.brand?.name2 ?? "ESPORT")}</span></span></div>
    <nav style="display:flex;gap:2px;flex-wrap:wrap">${nav}</nav>
    <div style="flex:1;min-width:12px"></div>
    <div style="position:relative;min-width:170px">
      <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#5D5E72;pointer-events:none">${ic(I.search, 16)}</span>
      <input id="hsearch" value="${(S.q || "").replace(/"/g, "&quot;")}" placeholder="Tournoi, jeu… (Entrée)" style="width:100%;background:#1B1B27;border:1px solid #282838;border-radius:11px;color:#F4F5FB;font-family:inherit;font-size:13px;padding:9px 12px 9px 36px" /></div>
    <button data-cart-open="1" style="position:relative;display:grid;place-items:center;width:42px;height:42px;background:#1B1B27;border:1px solid #33334A;border-radius:11px;color:#F4F5FB;cursor:pointer">${ic(I.cart, 19)}
      ${S.cartItems.length ? `<span style="position:absolute;top:-6px;right:-6px;min-width:19px;height:19px;padding:0 5px;display:grid;place-items:center;background:#F43F7E;color:#fff;font-size:11px;font-weight:800;border-radius:99px">${S.cartItems.length}</span>` : ""}</button>
    ${S.user
      ? `<button data-menu-user="1" style="display:inline-flex;align-items:center;gap:9px;background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:7px 13px 7px 8px;font-weight:700;font-size:13.5px;cursor:pointer"><span style="display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#22D3EE,#7C82FF);color:#04222a;font-weight:800;font-size:13px">${(S.user.displayName || "?").charAt(0).toUpperCase()}</span>${S.user.displayName}<span data-logout="1" title="Déconnexion" style="color:#8E8FA6;margin-left:2px">${ic(I.logout, 15)}</span></button>`
      : `<button data-auth-open="1" style="background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:11px;padding:10px 16px;font-weight:750;font-size:13.5px;cursor:pointer;box-shadow:0 0 30px rgba(34,211,238,.22)">Connexion</button>`}
    </header>`;
}

/* ================= Shell rail (module Tournois/Classements/Galerie/Boutique) ================= */
const RAIL_NAV: [string, string, string][] = [
  ["accueil", "Accueil", I.bolt],
  ["tournois", "Tournois", I.flame],
  ["classements", "Classements", I.medal],
  ["galerie", "Galerie", I.image],
  ["boutique", "Boutique", I.cart],
];

/** Barre "en direct" épinglée en haut du shell rail — pointe vers le premier tournoi live trouvé (rien si aucun). */
function railLiveBar(S: State): string {
  const live = (S.tourns ?? []).find((t) => t.live);
  if (!live) return "";
  return `<div data-open="${live.id}" class="rise" style="display:flex;align-items:center;gap:14px;height:46px;padding:0 20px;background:#04222a;border-bottom:1px solid rgba(34,211,238,.35);cursor:pointer;flex:none">
    <span style="display:inline-flex;align-items:center;gap:8px;font-size:11.5px;font-weight:800;letter-spacing:1.6px;text-transform:uppercase;color:#22D3EE"><span style="width:7px;height:7px;border-radius:50%;background:#22D3EE;animation:blink 1.2s infinite"></span>En direct</span>
    <span style="color:#D5F6FC;font-size:13px">${escHtml(live.name)}${live.game ? " · " + escHtml(live.game) : ""}</span>
    <span style="flex:1"></span>
    <span style="font-size:12.5px;color:#63C6DA;font-weight:700">Suivre →</span>
  </div>`;
}

/** Rail de navigation à icônes (88px) — remplace le header public sur les pages du module contenu. */
function railNav(S: State, activeKey: string): string {
  const items = RAIL_NAV.map(([key, label, icon]) => {
    const on = key === activeKey;
    return `<button data-go="${key}" class="hbtn" style="display:flex;flex-direction:column;align-items:center;gap:4px;width:100%;padding:10px 0;border:0;border-left:2px solid ${on ? "#22D3EE" : "transparent"};background:${on ? "linear-gradient(90deg,rgba(34,211,238,.12),transparent)" : "transparent"};cursor:pointer">
      <span style="color:${on ? "#22D3EE" : "#8E8FA6"}">${ic(icon, 20)}</span>
      <span style="font-size:9.5px;font-weight:${on ? 800 : 700};letter-spacing:.6px;color:${on ? "#22D3EE" : "#8E8FA6"};text-transform:uppercase">${label}</span>
    </button>`;
  }).join("");
  const cartBtn = `<button data-cart-open="1" title="Panier" style="position:relative;display:grid;place-items:center;width:38px;height:38px;border-radius:11px;background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;cursor:pointer">${ic(I.cart, 17)}
    ${S.cartItems.length ? `<span style="position:absolute;top:-6px;right:-6px;min-width:17px;height:17px;padding:0 4px;display:grid;place-items:center;background:#F43F7E;color:#fff;font-size:10px;font-weight:800;border-radius:99px">${S.cartItems.length}</span>` : ""}</button>`;
  const userBtn = S.user
    ? `<button data-go="profil" title="${escAttr(S.user.displayName)}" style="display:grid;place-items:center;width:38px;height:38px;border-radius:11px;background:linear-gradient(135deg,#22D3EE,#7C82FF);color:#04222a;font-weight:800;font-size:15px;border:0;cursor:pointer">${(S.user.displayName || "?").charAt(0).toUpperCase()}</button>`
    : `<button data-auth-open="1" title="Connexion" style="display:grid;place-items:center;width:38px;height:38px;border-radius:11px;background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;cursor:pointer">${ic(I.user, 18)}</button>`;
  return `<div class="rail-desktop" style="position:fixed;top:0;left:0;bottom:0;width:88px;z-index:40;overflow-y:auto;border-right:1px solid #1B1B27;display:flex;flex-direction:column;align-items:center;padding:18px 0 24px;gap:6px;background:#0B0B11">
    <div data-go="accueil" class="hbtn" style="display:grid;place-items:center;margin-bottom:16px;cursor:pointer">${brandLogo(S, 40, 22)}</div>
    ${items}
    <div style="width:32px;height:1px;background:#1B1B27;margin:10px 0"></div>
    ${cartBtn}
    ${userBtn}
  </div>`;
}

/** Équivalent mobile du rail d'icônes : bandeau haut compact (logo + panier + profil) + barre d'onglets fixée en bas
 * (les 5 destinations de RAIL_NAV). Toujours émis, masqué en CSS au-dessus de 1024px (voir globals.css). */
function railMobileBars(S: State, activeKey: string): string {
  const top = `<div class="rail-mobile-top" style="position:sticky;top:0;z-index:45;align-items:center;gap:10px;padding:11px 16px;border-bottom:1px solid #1B1B27;background:rgba(11,11,17,.92);backdrop-filter:blur(10px)">
    <div data-go="accueil" style="display:flex;align-items:center;gap:8px;cursor:pointer;flex:1;min-width:0">${brandLogo(S, 28, 16)}<span style="font-family:'Bebas Neue',sans-serif;font-size:17px;letter-spacing:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(S.site?.brand?.name1 ?? "VLOME")} <span style="color:#22D3EE">${escHtml(S.site?.brand?.name2 ?? "ESPORT")}</span></span></div>
    <button data-cart-open="1" title="Panier" style="position:relative;display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;cursor:pointer;flex:none">${ic(I.cart, 16)}
      ${S.cartItems.length ? `<span style="position:absolute;top:-5px;right:-5px;min-width:16px;height:16px;padding:0 4px;display:grid;place-items:center;background:#F43F7E;color:#fff;font-size:9.5px;font-weight:800;border-radius:99px">${S.cartItems.length}</span>` : ""}</button>
    ${S.user
      ? `<button data-go="profil" title="${escAttr(S.user.displayName)}" style="display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#22D3EE,#7C82FF);color:#04222a;font-weight:800;font-size:14px;border:0;cursor:pointer;flex:none">${(S.user.displayName || "?").charAt(0).toUpperCase()}</button>`
      : `<button data-auth-open="1" title="Connexion" style="display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;cursor:pointer;flex:none">${ic(I.user, 16)}</button>`}
  </div>`;
  const tabs = RAIL_NAV.map(([key, label, icon]) => {
    const on = key === activeKey;
    return `<button data-go="${key}" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;flex:1;height:100%;border:0;background:transparent;cursor:pointer">
      <span style="color:${on ? "#22D3EE" : "#8E8FA6"}">${ic(icon, 19)}</span>
      <span style="font-size:9px;font-weight:${on ? 800 : 700};letter-spacing:.3px;color:${on ? "#22D3EE" : "#8E8FA6"};text-transform:uppercase">${label}</span>
    </button>`;
  }).join("");
  const bottom = `<div class="rail-mobile-bottom" style="position:fixed;left:0;right:0;bottom:0;z-index:45;height:64px;border-top:1px solid #1B1B27;background:rgba(11,11,17,.96);backdrop-filter:blur(10px);padding-bottom:env(safe-area-inset-bottom)">${tabs}</div>`;
  return top + bottom;
}

/** Shell rail complet : barre live + rail d'icônes + contenu de la page. Utilisé par Tournois/Classements/Galerie/Boutique.
 * Sous 1024px, le rail à icônes cède la place à railMobileBars() (bandeau haut + barre d'onglets bas), voir globals.css. */
function railShell(S: State, activeKey: string, body: string): string {
  return `${railNav(S, activeKey)}${railMobileBars(S, activeKey)}
  <div class="rail-content" style="margin-left:88px;min-height:100vh;display:flex;flex-direction:column">
    ${railLiveBar(S)}
    <div style="flex:1;min-width:0">${body}</div>
  </div>`;
}

/** En-tête de page réutilisé par les pages du shell rail : titre + sous-titre + zone d'actions (recherche, boutons…). */
function railPageHead(title: string, sub: string, actions = ""): string {
  return `<div class="rise page-hpad" style="display:flex;align-items:flex-end;gap:20px;padding:32px 44px 20px;flex-wrap:wrap">
    <div><h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(38px,4.5vw,56px);letter-spacing:1.5px;margin:0;line-height:.92">${title}</h1><p style="color:#8E8FA6;font-size:14px;margin:8px 0 0;max-width:640px">${sub}</p></div>
    <span style="flex:1"></span>
    ${actions}
  </div>`;
}

/* ================= Composants ================= */
function tournCard(t: TournCard, big: boolean) {
  const badge = t.live ? '<span style="display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#04222a;background:#22D3EE;border-radius:99px;padding:4px 9px"><span style="width:6px;height:6px;border-radius:50%;background:#04222a;animation:blink 1.2s infinite"></span>Live</span>' : "";
  const foot = t.live ? '<span style="font-size:12px;color:#22D3EE;font-weight:700">En direct</span>' : `<span style="font-size:12px;color:#8E8FA6;font-weight:600">${t.status}</span>`;
  const openAttr = t.id ? `data-open="${t.id}"` : `data-go="tournois"`;
  // Bandeau : image du tournoi si fournie, sinon dégradé par défaut.
  const bannerBg = t.imageUrl
    ? `background-image:linear-gradient(180deg,rgba(11,11,17,.15),rgba(11,11,17,.55)),url('${mediaUrl(t.imageUrl)}');background-size:cover;background-position:center`
    : "background:linear-gradient(135deg,rgba(34,211,238,.16),rgba(124,130,255,.11))";
  return `<div ${openAttr} class="hcard" style="border:1px solid #282838;border-radius:16px;overflow:hidden;cursor:pointer;background:linear-gradient(180deg,#14141D,#0E0E16)">
    <div class="zoom" style="height:${t.imageUrl ? (big ? 130 : 110) : big ? 80 : 74}px;display:flex;align-items:flex-start;justify-content:space-between;padding:13px 14px;${bannerBg}">
      <span style="font-size:11px;font-weight:700;color:#04222a;background:rgba(255,255,255,.55);border-radius:99px;padding:3px 9px">${t.format}</span>${badge}</div>
    <div style="padding:${big ? "15px 16px 17px" : "14px 15px 16px"}">
      <h4 style="margin:0 0 6px;font-size:${big ? 18 : 17}px">${t.name}</h4>
      <div style="color:#8E8FA6;font-size:12.5px;line-height:1.7">${t.game} · ${t.players} joueurs<br>${t.date} · ${t.place}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:13px;padding-top:13px;border-top:1px solid #282838">${foot}
        <span style="font-size:12px;color:#FBBF24;font-weight:700">${big ? "Cagnotte " : ""}<span style="font-family:'JetBrains Mono',monospace">${t.cagnotte}</span> pts</span></div></div></div>`;
}
/** Sélecteur de fichier stylé : input masqué + bouton + nom du fichier choisi. */
function filePicker(id: string, label = "Choisir une image", accept = "image/*", existingUrl?: string | null) {
  const isVideo = !!existingUrl && /\.(mp4|webm)$/i.test(existingUrl);
  const preview = `<div id="pv-${id}" style="width:50px;height:50px;border-radius:11px;border:1px solid #282838;overflow:hidden;flex:none;display:flex;align-items:center;justify-content:center;color:#5D5E72;background:${existingUrl && !isVideo ? `url('${mediaUrl(existingUrl)}') center/cover` : "#1B1B27"}">${isVideo ? ic(I.tv, 18) : !existingUrl ? ic(I.image, 18) : ""}</div>`;
  return `<div style="display:flex;align-items:center;gap:10px;margin-top:6px;min-width:0;flex-wrap:wrap">
    ${preview}
    <input id="${id}" type="file" accept="${accept}" style="display:none" />
    <button data-filepick="${id}" style="display:inline-flex;align-items:center;gap:8px;background:#1B1B27;border:1px dashed #33334A;color:#22D3EE;border-radius:11px;padding:11px 16px;font-weight:700;font-size:13px;cursor:pointer;flex:none">${ic(I.image, 16)}${label}</button>
    <span id="${id}-name" style="font-size:12.5px;color:#5D5E72;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Aucun fichier</span>
  </div>`;
}

function chips(list: string[], active: string, attr: string, color = "#22D3EE") {
  return list.map((l) => {
    const on = l === active;
    return `<button class="chip" data-${attr}="${l}" style="font-family:inherit;font-size:12.5px;font-weight:${on ? 700 : 600};color:${on ? color : "#8E8FA6"};background:${on ? "rgba(34,211,238,.08)" : "#14141D"};border:1px solid ${on ? color : "#282838"};border-radius:999px;padding:8px 15px;cursor:pointer">${l}</button>`;
  }).join("");
}

/* ================= Pages ================= */
function pAccueil(S: State) {
  const slides: Detail[] = (S.site?.slides && S.site.slides.length ? S.site.slides : SLIDES) as Detail[];
  const s = slides[S.slide] || slides[0];
  const hero0 = S.site?.hero;
  const heroTitle = escHtml(hero0?.title ?? "LE HUB DE L'ESPORT\nTOGOLAIS & OUEST-AFRICAIN").replace(/\r?\n/g, "<br>");
  const heroKicker = escHtml(hero0?.kicker ?? "VLOME Esport · Togo");
  const heroSub = escHtml(hero0?.subtitle ?? "Compétitions, classements, communauté et boutique — une seule plateforme pour fédérer les gamers du Togo et professionnaliser l'esport de la région.");
  const heroStats: { v: string; k: string }[] = hero0?.stats?.length ? hero0.stats : [{ v: "2 400+", k: "Joueurs" }, { v: "18", k: "Tournois / an" }, { v: "24", k: "Clubs" }];
  const tourns = S.tourns ?? [];
  const dots = slides.map((_, i) => { const on = i === S.slide; return `<span data-slide="${i}" style="width:${on ? 26 : 10}px;height:6px;border-radius:99px;background:${on ? "#22D3EE" : "#33334A"};cursor:pointer"></span>`; }).join("");
  // Fond du héro : vidéo ou image (réglages admin), sinon halos lumineux animés.
  const heroBg = hero0?.bgUrl as string | undefined;
  const heroIsVideo = !!heroBg && /\.(mp4|webm)$/i.test(heroBg);
  const heroMedia = heroBg
    ? (heroIsVideo
      ? `<video class="heromedia" src="${mediaUrl(heroBg)}" autoplay muted loop playsinline></video>`
      : `<div class="heromedia kb" style="background-image:url('${mediaUrl(heroBg)}');background-size:cover;background-position:center"></div>`)
      + `<div style="position:absolute;inset:0;background:linear-gradient(105deg,rgba(11,11,17,.92) 25%,rgba(11,11,17,.55) 60%,rgba(11,11,17,.3));pointer-events:none"></div>`
    : `<span class="blob b1"></span><span class="blob b2"></span><span class="blob b3"></span>`;
  const hero = `<section class="grid2 rise" style="display:grid;grid-template-columns:1.35fr 1fr;gap:20px;align-items:stretch;margin-bottom:20px">
    <div style="display:flex;flex-direction:column;justify-content:center;padding:34px 32px;border-radius:20px;border:1px solid #282838;background:linear-gradient(150deg,rgba(34,211,238,.10),rgba(124,130,255,.06) 55%,#0E0E16);position:relative;overflow:hidden">
      ${heroMedia}
      <div style="position:relative;z-index:1">
      <span style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#22D3EE;font-weight:800">${heroKicker}</span>
      <h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(40px,6vw,72px);letter-spacing:1.5px;line-height:.92;margin:12px 0 0">${heroTitle}</h1>
      <p style="color:#8E8FA6;font-size:15px;line-height:1.6;max-width:560px;margin:16px 0 24px">${heroSub}</p>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <button data-go="tournois" class="glow" style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:14px 22px;font-weight:750;font-size:15px;cursor:pointer">Voir les tournois ${ic(I.arrow)}</button>
        ${S.user ? `<button data-go="profil" style="background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:12px;padding:14px 22px;font-weight:700;font-size:15px;cursor:pointer">Mon espace</button>` : `<button data-auth-open="1" style="background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:12px;padding:14px 22px;font-weight:700;font-size:15px;cursor:pointer">Rejoindre la communauté</button>`}</div>
      <div style="display:flex;gap:30px;margin-top:30px;flex-wrap:wrap">
        ${heroStats.map((st, i) => `<div><div style="font-family:'Bebas Neue',sans-serif;font-size:34px;line-height:1;${i === 0 ? "color:#22D3EE" : ""}">${escHtml(st.v)}</div><div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8E8FA6;font-weight:700">${escHtml(st.k)}</div></div>`).join("")}</div>
      </div></div>
    <div style="border-radius:20px;border:1px solid #282838;background:linear-gradient(180deg,#14141D,#0E0E16);padding:22px;display:flex;flex-direction:column;position:relative;overflow:hidden">
      ${s.imageUrl
        ? `<div class="kb" style="position:absolute;inset:0;background-image:url('${mediaUrl(s.imageUrl)}');background-size:cover;background-position:center"></div><div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(11,11,17,.5),rgba(11,11,17,.86) 78%);pointer-events:none"></div>`
        : `<div style="position:absolute;inset:0;background:linear-gradient(135deg,rgba(34,211,238,.14),transparent 55%);pointer-events:none"></div>`}
      <div style="display:flex;align-items:center;justify-content:space-between;position:relative;z-index:1"><span style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:#22D3EE;font-weight:800">À la une</span><span style="font-size:11px;color:#5D5E72;font-weight:600">${S.slide + 1} / ${slides.length}</span></div>
      <div class="slidein" style="flex:1;display:flex;flex-direction:column;justify-content:center;padding:26px 4px;position:relative;z-index:1;min-height:240px">
        <span style="align-self:flex-start;font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#04222a;background:#22D3EE;border-radius:99px;padding:5px 11px">${escHtml(s.tag)}</span>
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(30px,4vw,46px);letter-spacing:1px;line-height:.95;margin:14px 0 8px">${escHtml(s.title)}</h2>
        <p style="color:#8E8FA6;font-size:14px;line-height:1.55;margin:0">${escHtml(s.sub)}</p>
        <button data-go="tournois" style="align-self:flex-start;margin-top:20px;display:inline-flex;align-items:center;gap:7px;background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer">${escHtml(s.cta)} ${ic(I.arrow, 16)}</button></div>
      <div style="display:flex;gap:8px;position:relative;z-index:1">${dots}</div></div></section>`;

  // Tournoi en direct : barre fixe bien visible (au lieu du bandeau défilant) — sinon repli sur le bandeau des tournois à venir.
  const liveT = tourns.filter((t) => t.live);
  const liveBar = liveT.length ? `<div data-open="${liveT[0].id}" class="rise d1" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;border:1px solid rgba(34,211,238,.4);border-radius:14px;background:rgba(34,211,238,.08);margin-bottom:30px;padding:13px 18px;cursor:pointer">
    <span style="display:inline-flex;align-items:center;gap:7px;font-size:10.5px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#04222a;background:#22D3EE;border-radius:99px;padding:5px 11px;flex:none"><span style="width:6px;height:6px;border-radius:50%;background:#04222a;animation:blink 1.2s infinite"></span>En direct</span>
    <b style="font-size:14.5px">${escHtml(liveT[0].name)}</b>
    <span style="color:#8E8FA6;font-size:13px">${escHtml(liveT[0].game)}${liveT[0].place ? " · " + escHtml(liveT[0].place) : ""}</span>
    <span style="flex:1"></span>
    <span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:#22D3EE;flex:none">Suivre en direct ${ic(I.arrow, 14)}</span>
  </div>` : "";
  const tickerItems = tourns.slice(0, 4).map((t) =>
    `<span style="display:inline-flex;align-items:center;gap:8px;margin:0 26px"><span style="display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#8E8FA6;background:#22222F;border-radius:99px;padding:3px 9px">À venir</span><span style="font-weight:700;font-size:13px;color:#F4F5FB">${t.name}</span><span style="font-size:12px;color:#5D5E72">${t.game}${t.place ? " · " + t.place : ""}</span></span>`
  ).join(`<span style="color:#33334A">·</span>`);
  const ticker = !liveT.length && tourns.length ? `<div class="marquee rise d1" style="border:1px solid #282838;border-radius:14px;background:linear-gradient(90deg,#14141D,#0E0E16);margin-bottom:30px;padding:11px 0">
    <div class="marquee-track">${tickerItems}${tickerItems}</div></div>` : "";

  const tournHead = `<div class="rise d1" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px"><h3 style="font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:1px;margin:0;display:flex;align-items:center;gap:10px"><span style="width:5px;height:22px;border-radius:3px;background:#22D3EE;display:inline-block"></span>Tournois en cours</h3><a data-go="tournois" style="font-size:13px;font-weight:700;cursor:pointer">Tout voir →</a></div>`;
  const tournGrid = tourns.length
    ? `<div class="rise d2" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-bottom:40px">${tourns.slice(0, 3).map((t) => tournCard(t, false)).join("")}</div>`
    : `<div class="rise d2" style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:36px 24px;text-align:center;color:#8E8FA6;margin-bottom:40px">Aucun tournoi pour l'instant — reviens bientôt !</div>`;

  // Teaser d'accueil : la meilleure performance de chaque joueur (un seul jeu à la fois, jamais de points additionnés entre jeux).
  let rankSource: Detail[] = [];
  if (S.leaderboard?.length) {
    const bestByPlayer = new Map<string, Detail>();
    for (const r of S.leaderboard) { if (!bestByPlayer.has(r.name) || r.points > bestByPlayer.get(r.name)!.points) bestByPlayer.set(r.name, r); }
    rankSource = Array.from(bestByPlayer.values()).sort((a, b) => b.points - a.points);
  }
  const rankRows = rankSource.length
    ? rankSource.slice(0, 5).map((r: Detail, i: number) => `<tr style="border-top:1px solid #282838"><td style="padding:9px 6px;font-family:'Bebas Neue',sans-serif;font-size:18px;color:#5D5E72;width:30px">${i + 1}</td><td style="padding:9px 6px"><div style="display:flex;align-items:center;gap:9px"><span style="display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:#22222F;border:1px solid #282838;font-size:11px;font-weight:800;color:#8E8FA6">${r.name.charAt(0).toUpperCase()}</span><div><div style="font-weight:650">${escHtml(r.name)}</div><div style="font-size:11px;color:#5D5E72">${escHtml(r.city) || r.game || ""}</div></div></div></td><td style="padding:9px 6px;color:#8E8FA6;font-size:12.5px">${escHtml(r.game)}</td><td style="padding:9px 6px;text-align:right;font-weight:750;color:#22D3EE;font-family:'JetBrains Mono',monospace">${r.points}</td></tr>`).join("")
    : `<tr><td style="padding:16px 6px;color:#5D5E72;font-size:13px" colspan="4">Aucun résultat pour l'instant.</td></tr>`;
  const evRows = EVENTS.map((e) => `<div style="display:flex;gap:13px;align-items:center"><div style="flex:none;width:52px;text-align:center;border:1px solid #282838;border-radius:11px;padding:7px 4px;background:#14141D"><div style="font-family:'Bebas Neue',sans-serif;font-size:22px;line-height:1;color:#22D3EE">${e.d}</div><div style="font-size:9px;letter-spacing:1px;color:#8E8FA6;font-weight:700">${e.mo}</div></div><div style="min-width:0"><div style="font-weight:650;font-size:14px">${e.t}</div><div style="font-size:12px;color:#8E8FA6">${e.type} · ${e.place}</div></div></div>`).join("");
  const mid = `<section class="grid2b rise d3" style="display:grid;grid-template-columns:1.45fr 1fr;gap:18px;margin-bottom:40px"><div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px"><h3 style="margin:0;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6;font-weight:750">Classement · Top joueurs</h3><a data-go="classements" style="font-size:12px;font-weight:700;cursor:pointer">Complet →</a></div><table style="width:100%;border-collapse:collapse;font-size:14px">${rankRows}</table></div><div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px"><h3 style="margin:0 0 14px;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6;font-weight:750">Prochains événements</h3><div style="display:flex;flex-direction:column;gap:12px">${evRows}</div></div></section>`;

  const newsItems: { cat: string; ph: string; t: string; date: string; img?: string | null }[] = S.news
    ? S.news.slice(0, 3).map((n: Detail) => ({ cat: n.category, ph: n.slug, t: n.title, date: n.date, img: n.imageUrl }))
    : NEWS;
  const newsGrid = `<div class="rise d4" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px"><h3 style="font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:1px;margin:0;display:flex;align-items:center;gap:10px"><span style="width:5px;height:22px;border-radius:3px;background:#7C82FF;display:inline-block"></span>Actualités</h3></div><div class="rise d4" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;margin-bottom:44px">${newsItems.map((a) => `<div class="hcard" style="border:1px solid #282838;border-radius:16px;overflow:hidden;background:linear-gradient(180deg,#14141D,#0E0E16)">${a.img ? `<div class="zoom" style="height:132px;background-image:url('${mediaUrl(a.img)}');background-size:cover;background-position:center"></div>` : `<div class="zoom" style="height:132px;background:repeating-linear-gradient(45deg,#191922,#191922 12px,#14141D 12px,#14141D 24px);display:grid;place-items:center;color:#5D5E72;font-family:monospace;font-size:11px;letter-spacing:1px">// ${a.ph}</div>`}<div style="padding:14px 15px 16px"><span style="font-size:11px;font-weight:700;color:#7C82FF;letter-spacing:.5px">${a.cat}</span><h4 style="margin:6px 0 0;font-size:15.5px;line-height:1.35">${a.t}</h4><div style="font-size:12px;color:#5D5E72;margin-top:8px">${a.date}</div></div></div>`).join("")}</div>`;

  const shopProducts: { name: string; price: number; ph: string; img?: string | null }[] = S.products ?? [];
  const shopSec = shopProducts.length
    ? `<section class="rise d5" style="border:1px solid #282838;border-radius:18px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:24px;margin-bottom:40px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:10px"><h3 style="font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:1px;margin:0">La boutique ${escHtml(S.site?.brand?.name1 ?? "VLOME")}</h3><a data-go="boutique" style="font-size:13px;font-weight:700;cursor:pointer">Voir la boutique →</a></div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px">${shopProducts.slice(0, 4).map((p) => `<div class="hcard" style="border:1px solid #282838;border-radius:14px;overflow:hidden;background:#14141D">${p.img ? `<div class="zoom" style="height:120px;background-image:url('${mediaUrl(p.img)}');background-size:cover;background-position:center"></div>` : `<div class="zoom" style="height:120px;background:repeating-linear-gradient(45deg,#191922,#191922 12px,#14141D 12px,#14141D 24px);display:grid;place-items:center;color:#5D5E72;font-family:monospace;font-size:10px;letter-spacing:1px">// ${p.ph}</div>`}<div style="padding:12px 13px"><div style="font-weight:650;font-size:13.5px">${p.name}</div><div style="font-weight:800;color:#22D3EE;font-size:13px;margin-top:5px">${money(p.price)}</div></div></div>`).join("")}</div></section>`
    : "";

  const partnerList = normPartners(S);
  const partners = `<div class="rise d6" style="border:1px solid #282838;border-radius:16px;background:#0E0E16;padding:22px 24px"><div style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:#8E8FA6;font-weight:750;margin-bottom:14px">Partenaires &amp; sponsors</div><div style="display:flex;gap:12px;flex-wrap:wrap">${partnerList.map((p) => `<span style="display:inline-flex;align-items:center;gap:9px;height:44px;padding:0 18px;border:1px solid #282838;border-radius:11px;background:#14141D;color:#8E8FA6;font-weight:700;font-size:13px">${p.logoUrl ? `<img src="${mediaUrl(p.logoUrl)}" alt="" style="width:22px;height:22px;object-fit:contain;border-radius:5px" />` : ""}${escHtml(p.name)}</span>`).join("")}</div></div>`;

  return `<main class="rise" style="width:100%;padding:28px clamp(22px,3vw,64px) 60px">${hero}${liveBar}${ticker}${tournHead}${tournGrid}${mid}${newsGrid}${shopSec}${partners}${adCarousel(S, "accueil")}</main>`;
}

/* ================= Assistant de création de tournoi (5 étapes) ================= */

const WIZ_INP = "width:100%;background:#1B1B27;border:1px solid #282838;border-radius:11px;color:#F4F5FB;font-family:inherit;font-size:14px;padding:11px 13px";
const WIZ_LBL = "font-size:12px;color:#8E8FA6;font-weight:600;display:block;margin-bottom:6px";
const wizField = (label: string, inner: string, help?: string) => `<div><label style="${WIZ_LBL}">${label}</label>${inner}${help ? `<span style="display:block;font-size:11px;color:#5D5E72;margin-top:5px">${help}</span>` : ""}</div>`;
const wizCard = (inner: string) => `<div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:22px">${inner}</div>`;

/** Liste verticale des étapes (barre latérale de l'assistant) — coche + sous-titre contextuel pour les étapes déjà validées. */
function wizSteps(S: State) {
  const d = S.wizData;
  const isSurvival = d.format === "SURVIVAL";
  const isBR = d.format === "BATTLE_ROYALE";
  const subtitle = (n: number): string => {
    if (n === 1) return d.name || "—";
    if (n === 2) return `${d.players.length} joueur${d.players.length > 1 ? "s" : ""}`;
    if (n === 3) return isBR ? `${d.nbPools} partie${d.nbPools > 1 ? "s" : ""}` : `${d.nbPools} poule${d.nbPools > 1 ? "s" : ""} · ${balancedSizesPreview(d.players.length, d.nbPools).join("/")}`;
    if (n === 4) return "Barème réglé";
    return "";
  };
  const full = [["Infos générales", 1], ["Participants", 2], [isBR ? "Parties" : "Poules", 3], ["Barème des points", 4], ["Validation", 5]] as [string, number][];
  // En modification, Participants/Poules sont gérés depuis la page du tournoi (pas via l'assistant) : on saute directement à Barème.
  // Sinon, seul Survival utilise poules + barème détaillé ; Battle Royale garde "Parties" (poules réutilisées) mais saute le barème ; les autres formats sautent les deux.
  const defs = S.wizEditId ? [full[0], full[3], full[4]] : isSurvival ? full : isBR ? [full[0], full[1], full[2], full[4]] : [full[0], full[1], full[4]];
  return `<div style="padding:14px 0">${defs.map(([label, n]) => {
    const active = n === S.wizStep, done = n < S.wizStep;
    const sub = done ? subtitle(n) : active ? "En cours" : "";
    return `<button data-wizgoto="${n}" style="display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:${active ? "rgba(34,211,238,.08)" : "transparent"};border:0;border-left:2px solid ${active ? "#22D3EE" : "transparent"};padding:11px 18px;cursor:pointer">
      <span style="display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:${active ? "#22D3EE" : done ? "rgba(52,211,153,.14)" : "#22222F"};color:${active ? "#04222a" : done ? "#34D399" : "#5D5E72"};font-size:12px;font-weight:800;flex:none">${done ? "✓" : n}</span>
      <span style="min-width:0"><div style="font-size:13.5px;font-weight:${active ? 700 : 600};color:${active ? "#F4F5FB" : done ? "#F4F5FB" : "#5D5E72"};line-height:1.3">${label}</div>${sub ? `<div style="font-size:11px;color:${active ? "#22D3EE" : "#5D5E72"};margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(sub)}</div>` : ""}</span>
    </button>`;
  }).join("")}</div>`;
}

const wizFoot = (prevLabel: string, prev: number, next: number, nextLabel?: string) => `<div style="display:flex;justify-content:space-between;gap:10px;margin-top:20px">
  <button data-wizgoto="${prev}" style="display:inline-flex;align-items:center;gap:7px;background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:11px 18px;font-weight:700;font-size:13.5px;cursor:pointer">${icBack(15)}${prevLabel}</button>
  ${next ? `<button data-wizgoto="${next}" style="display:inline-flex;align-items:center;gap:7px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:11px;padding:11px 20px;font-weight:750;font-size:13.5px;cursor:pointer">${nextLabel || "Continuer"}${ic(I.arrow, 15)}</button>` : ""}
</div>`;

const WIZ_BREAKDOWN_SEGMENTS: [string, string, string][] = [
  ["survWin", "Survival", "#22D3EE"],
  ["loserWin", "Repêchage", "#7C82FF"],
  ["poolFinalWin", "Finales de poule", "#34D399"],
  ["finalsWin", "Phase finale", "#FBBF24"],
  ["championBonus", "Bonus", "#F43F7E"],
];

/** Barre de répartition en pourcentage de la cagnotte programmée par catégorie de match — recalculée en direct par wizRecalcGauge. */
function wizBreakdownBar(breakdown: Record<string, { matches: number; pts: number }>, programmed: number) {
  const pct = (key: string) => programmed > 0 ? Math.round(((breakdown[key]?.pts ?? 0) / programmed) * 1000) / 10 : 0;
  const segs = WIZ_BREAKDOWN_SEGMENTS.map(([key, , color]) => `<span id="wiz-gauge-seg-${key}" style="width:${pct(key)}%;background:${color};display:flex;align-items:center;justify-content:center;overflow:hidden;transition:width .15s ease">${pct(key) >= 8 ? `<span id="wiz-gauge-seg-${key}-txt">${pct(key)}%</span>` : ""}</span>`).join("");
  const legend = WIZ_BREAKDOWN_SEGMENTS.map(([, label, color]) => `<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:2px;background:${color}"></span>${label}</span>`).join("");
  return `<div style="margin-top:16px;padding-top:14px;border-top:1px solid #1B1B27">
    <div style="font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:#5D5E72;font-weight:800;margin-bottom:10px">Répartition prévue</div>
    <div id="wiz-gauge-breakdown" style="display:flex;height:26px;border-radius:7px;overflow:hidden;font-size:10px;font-weight:800;color:#04222a">${segs}</div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:10px;font-size:11px;color:#8E8FA6">${legend}</div>
  </div>`;
}

function wizGaugeCard(c: { total: number; programmed: number; gap: number; valid: boolean; breakdown?: Record<string, { matches: number; pts: number }> }, title = "Contrôle de la cagnotte") {
  const pct = Math.min(100, c.total ? (c.programmed / c.total) * 100 : 0);
  return wizCard(`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px"><h3 style="margin:0;font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:.5px">${title}</h3><span id="wiz-gauge-badge" style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:${c.valid ? "#34D399" : "#FB7185"};background:${c.valid ? "rgba(52,211,153,.08)" : "rgba(251,113,133,.08)"};border:1px solid ${c.valid ? "rgba(52,211,153,.35)" : "rgba(251,113,133,.35)"};border-radius:99px;padding:4px 10px"><span id="wiz-gauge-badge-icon" style="display:inline-flex">${ic(c.valid ? I.plus : I.warn, 12)}</span><span id="wiz-gauge-badge-txt">${c.valid ? "Valide" : "Dépassement"}</span></span></div>
    <div style="display:flex;justify-content:space-between;font-size:13px;color:#8E8FA6;margin-bottom:5px"><span>Points disponibles</span><b style="color:#F4F5FB;font-family:'JetBrains Mono',monospace">${c.total}</b></div>
    <div style="display:flex;justify-content:space-between;font-size:13px;color:#8E8FA6;margin-bottom:10px"><span>Points programmés</span><b id="wiz-gauge-prog" style="color:#F4F5FB;font-family:'JetBrains Mono',monospace">${c.programmed}</b></div>
    <div style="height:9px;border-radius:99px;background:#22222F;border:1px solid #282838;overflow:hidden"><span id="wiz-gauge-bar" style="display:block;height:100%;width:${pct}%;background:${c.valid ? "linear-gradient(90deg,#22D3EE,#7C82FF)" : "linear-gradient(90deg,#FB7185,#F43F7E)"};transition:width .15s ease"></span></div>
    <div style="display:flex;justify-content:space-between;font-size:13px;color:#8E8FA6;margin-top:10px"><span>Écart restant</span><b id="wiz-gauge-gap" style="color:${c.valid ? "#34D399" : "#FB7185"};font-family:'JetBrains Mono',monospace">${c.gap >= 0 ? "+" : ""}${c.gap}</b></div>
    <p style="color:#5D5E72;font-size:11.5px;margin:12px 0 0">Le tournoi ne peut être lancé que si les points programmés tiennent dans la cagnotte.</p>
    ${c.breakdown ? wizBreakdownBar(c.breakdown, c.programmed) : ""}`);
}

function wizInfosStep(S: State) {
  const d = S.wizData;
  const editing = !!S.wizEditId;
  const formatPicker = editing ? "" : `<div style="margin-top:14px">
    <label style="${WIZ_LBL}">Format</label>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px">
      ${WIZ_FORMATS.map(([key, label]) => {
        const on = d.format === key;
        return `<button data-wizformat="${key}" style="text-align:left;border-radius:11px;padding:11px 13px;cursor:pointer;background:${on ? "rgba(34,211,238,.1)" : "#1B1B27"};border:1px solid ${on ? "#22D3EE" : "#282838"};color:${on ? "#22D3EE" : "#F4F5FB"};font-family:inherit;font-weight:${on ? 700 : 600};font-size:13px">${label}</button>`;
      }).join("")}
    </div>
  </div>`;
  const chosen = WIZ_FORMATS.find(([key]) => key === d.format) || WIZ_FORMATS[0];
  return `<div class="grid2b" style="display:grid;grid-template-columns:1.4fr 1fr;gap:16px">
    ${wizCard(`<h3 style="margin:0 0 16px;font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:.5px;display:flex;align-items:center;gap:9px">${ic(I.bolt, 17)}${editing ? "Informations générales" : "Étape 1 — Informations générales"}</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px">
        ${wizField("Nom du tournoi", `<input id="wz-name" value="${escAttr(d.name)}" placeholder="Survival Summer Cup" style="${WIZ_INP}" />`)}
        ${wizField("Jeu concerné", `<input id="wz-game" value="${escAttr(d.game)}" placeholder="EA FC 26, Tekken 8…" style="${WIZ_INP}" />`)}
        ${wizField("Date", `<input id="wz-date" type="date" value="${escAttr(d.date)}" style="${WIZ_INP}" />`)}
        ${wizField("Lieu", `<input id="wz-place" value="${escAttr(d.place)}" placeholder="Salle, club, adresse…" style="${WIZ_INP}" />`)}
        ${wizField("Points en jeu par participant", `<input id="wz-pts" type="number" min="1" value="${d.pointsPerPlayer}" ${d.format === "SURVIVAL" ? "" : "disabled"} style="${WIZ_INP};${d.format === "SURVIVAL" ? "" : "opacity:.5;cursor:not-allowed"}" />`, d.format === "SURVIVAL" ? "Détermine la cagnotte totale." : "Ne s'applique pas à ce format — la cagnotte par point ne concerne que le mode Survival.")}
        ${wizField("Frais d'inscription (FCFA, 0 = gratuit)", `<input id="wz-fee" type="number" min="0" step="100" value="${d.entryFeeXof ?? 0}" style="${WIZ_INP}" />`)}
        ${wizField("Points fidélité", `<label style="display:flex;align-items:center;gap:8px;height:38px;cursor:pointer"><input id="wz-loyalty" type="checkbox" ${d.givesLoyaltyPoint !== false ? "checked" : ""} style="width:16px;height:16px;accent-color:#22D3EE" /><span style="font-size:13px;color:#F4F5FB">Ce tournoi rapporte 1 point</span></label>`, "Décoche si ce tournoi est organisé par un tiers.")}
      </div>
      <div style="margin-top:14px">${wizField("Affiche du tournoi (optionnel)", filePicker("wz-img", "Choisir l'affiche", "image/*", d.imageUrl))}</div>
      ${formatPicker}`)}
    ${wizCard(`<h3 style="margin:0 0 14px;font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:.5px;display:flex;align-items:center;gap:9px">${ic(I.warn, 16)}Comment ça marche</h3>
      <div style="color:#8E8FA6;font-size:13px;line-height:1.9">${WIZ_FORMAT_EXPLAIN[chosen[0]] || ""}</div>`)}
  </div>${wizFoot("Annuler", 0, editing ? 4 : 2)}`;
}

const WIZ_FORMAT_EXPLAIN: Record<string, string> = {
  SURVIVAL: `<b style="color:#F4F5FB">Cagnotte</b> = participants × points en jeu.<br>Chaque victoire distribue une part de cette cagnotte selon le barème que tu définiras à l'étape 4.<br><br><b style="color:#F4F5FB">Déroulé</b> : dans chaque poule, le vainqueur reste sur le terrain et enchaîne les adversaires. Les perdants ont une seconde chance (repêchage), puis les meilleurs se rejoignent en phase finale.`,
  SINGLE_ELIM: `<b style="color:#F4F5FB">Bracket simple</b> : tous les participants sont placés directement dans un bracket à élimination directe — pas de poules. Une défaite élimine. Chaque victoire vaut les points en jeu ; un bonus couronne le champion.`,
  DOUBLE_ELIM: `<b style="color:#F4F5FB">Double élimination</b> : deux brackets (vainqueurs et perdants). Une première défaite fait basculer dans le bracket des perdants, une deuxième élimine. La grande finale peut se rejouer une fois si le finaliste du bracket des perdants gagne.`,
  ROUND_ROBIN: `<b style="color:#F4F5FB">Round Robin</b> : chaque participant affronte tous les autres, une seule fois. Classement final aux victoires (départage à la différence de manches). Pas de poules, pas d'élimination en cours de route.`,
  SWISS: `<b style="color:#F4F5FB">Système suisse</b> : à chaque ronde, les joueurs sont réappariés selon leur classement du moment (le moteur évite de refaire jouer deux adversaires déjà rencontrés quand c'est possible). Le nombre de rondes est calculé automatiquement selon l'effectif. Pas d'élimination : tout le monde joue toutes les rondes.`,
  BATTLE_ROYALE: `<b style="color:#F4F5FB">Battle Royale</b> : des parties à plusieurs joueurs, classées du 1er au dernier à chaque fois. Des points sont attribués par palier de classement (1er, 2e, 3e…) et cumulés sur l'ensemble des parties. Le nombre de parties se règle à l'étape suivante.`,
};

function wizParticipantsStep(S: State) {
  const d = S.wizData;
  const names = d.players.join("\n");
  const fullRoster: Detail[] = S.roster ?? [];
  const inList = (nm: string) => d.players.some((p) => p.split("@")[0].trim().toLowerCase() === nm.toLowerCase());
  const selCount = fullRoster.filter((p: Detail) => inList(p.name)).length;
  const q = S.wizRosterSearch.trim().toLowerCase();
  const roster = q ? fullRoster.filter((p: Detail) => `${p.name} ${p.clubName || ""} ${p.city || ""}`.toLowerCase().includes(q)) : fullRoster;
  const chip = (p: Detail) => {
    const on = inList(p.name);
    return `<button data-wiztoggleroster="${escAttr(p.name)}|${escAttr(p.clubName || "")}" style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;border-radius:999px;padding:6px 10px 6px 6px;cursor:pointer;background:${on ? "rgba(34,211,238,.1)" : "#1B1B27"};border:1px solid ${on ? "#22D3EE" : "#282838"};color:${on ? "#22D3EE" : "#8E8FA6"}"><span style="display:grid;place-items:center;width:18px;height:18px;border-radius:50%;background:#22222F;font-size:9px;font-weight:800;color:#8E8FA6;overflow:hidden">${p.clubLogoUrl ? `<img src="${mediaUrl(p.clubLogoUrl)}" style="width:100%;height:100%;object-fit:cover" />` : p.name.charAt(0).toUpperCase()}</span>${escHtml(p.name)}${ic(I.plus, 11)}</button>`;
  };
  // Regroupe par club (« Sans club » toujours en dernier) pour repérer vite une équipe entière.
  const byClub = new Map<string, Detail[]>();
  for (const p of roster) { const k = p.clubName || "Sans club"; if (!byClub.has(k)) byClub.set(k, []); byClub.get(k)!.push(p); }
  const clubKeys = Array.from(byClub.keys()).sort((a, b) => a === "Sans club" ? 1 : b === "Sans club" ? -1 : a.localeCompare(b));
  const groups = clubKeys.map((k) => `<div style="margin-bottom:12px">
      <div style="font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#5D5E72;margin-bottom:6px">${escHtml(k)} <span style="color:#33334A">· ${byClub.get(k)!.length}</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">${byClub.get(k)!.map(chip).join("")}</div>
    </div>`).join("");
  const rosterPanel = fullRoster.length ? wizCard(`<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <h3 style="margin:0;font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:.5px">Depuis la base de joueurs</h3>
        <button data-wizaddall="1" style="font-size:12px;font-weight:700;color:#22D3EE;background:transparent;border:0;cursor:pointer">${ic(I.plus, 13)}Tout sélectionner</button>
      </div>
      <div style="position:relative;margin-bottom:12px;max-width:320px">
        <span style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:#5D5E72;pointer-events:none">${ic(I.search, 14)}</span>
        <input id="wiz-roster-search" value="${escAttr(S.wizRosterSearch)}" placeholder="Rechercher un joueur ou un club… (Entrée)" style="${WIZ_INP};padding-left:32px" />
      </div>
      <div style="max-height:260px;overflow-y:auto">${groups || `<p style="color:#5D5E72;font-size:12.5px">Aucun joueur trouvé pour « ${escHtml(S.wizRosterSearch)} ».</p>`}</div>
      <p style="color:#5D5E72;font-size:11.5px;margin:10px 0 0">${selCount} / ${fullRoster.length} sélectionné${selCount > 1 ? "s" : ""}. Clique un joueur pour l'ajouter ou le retirer.</p>`)
    : wizCard(`<h3 style="margin:0 0 8px;font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:.5px">Base de joueurs</h3><p style="color:#5D5E72;font-size:12.5px">La base est vide pour l'instant. Les participants saisis ici pourront l'alimenter — gère-la depuis Admin → Joueurs.</p>`);
  return `<div class="grid2b" style="display:grid;grid-template-columns:1.4fr 1fr;gap:16px;margin-bottom:16px">
    ${wizCard(`<h3 style="margin:0 0 16px;font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:.5px;display:flex;align-items:center;gap:9px">${ic(I.user, 17)}Étape 2 — Participants</h3>
      ${wizField("Un nom par ligne", `<textarea id="wz-players" rows="8" placeholder="Marie @Lomé&#10;Paul @Kara&#10;Léa…" style="${WIZ_INP};resize:vertical">${escHtml(names)}</textarea>`, "Doublons fusionnés. Club optionnel avec la syntaxe « Nom @Club ».")}
      <div style="display:flex;align-items:center;gap:10px;margin-top:12px"><span style="display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700;color:#22D3EE;background:rgba(34,211,238,.08);border:1px solid rgba(34,211,238,.3);border-radius:99px;padding:6px 13px">${ic(I.user, 13)}${d.players.length} participant${d.players.length > 1 ? "s" : ""}</span></div>`)}
    ${wizCard(`<h3 style="margin:0 0 14px;font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:.5px">Cagnotte prévisionnelle</h3>
      <div style="display:flex;justify-content:space-between;font-size:13px;color:#8E8FA6;margin-bottom:6px"><span>Participants</span><b style="color:#F4F5FB">${d.players.length}</b></div>
      <div style="display:flex;justify-content:space-between;font-size:13px;color:#8E8FA6"><span>Points / participant</span><b style="color:#F4F5FB">${d.pointsPerPlayer}</b></div>
      <hr style="border:0;border-top:1px solid #282838;margin:12px 0" />
      <div style="display:flex;justify-content:space-between;font-size:14px"><span style="color:#8E8FA6">Cagnotte totale</span><b style="color:#34D399;font-size:18px">${d.players.length * d.pointsPerPlayer}</b></div>`)}
  </div>
  ${rosterPanel}${wizFoot("Retour", 1, d.format === "SURVIVAL" || d.format === "BATTLE_ROYALE" ? 3 : 5)}`;
}

function wizPoolsStep(S: State) {
  const d = S.wizData;
  if (d.format === "BATTLE_ROYALE") {
    return `${wizCard(`<h3 style="margin:0 0 10px;font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:.5px;display:flex;align-items:center;gap:9px">${ic(I.tv, 17)}Étape 3 — Parties</h3>
      <div style="display:flex;align-items:center;gap:9px;margin-bottom:14px"><label style="font-size:12.5px;color:#8E8FA6;font-weight:600">Nombre de parties</label><select id="wz-pools" style="${WIZ_INP};width:auto;padding:9px 12px">${[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => `<option value="${n}" ${n === d.nbPools ? "selected" : ""}>${n}</option>`).join("")}</select></div>
      <p style="color:#8E8FA6;font-size:13px;line-height:1.7">Après chaque partie, l'organisateur saisit le classement complet (du 1er au dernier). Les points par palier de classement se cumulent sur l'ensemble des <b style="color:#F4F5FB">${d.nbPools}</b> partie${d.nbPools > 1 ? "s" : ""} — le plus haut total à la fin remporte le tournoi.</p>`)}
    ${wizFoot("Retour", 2, 5, "Validation")}`;
  }
  const sizes = balancedSizesPreview(d.players.length, d.nbPools);
  return `${wizCard(`<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:10px">
      <h3 style="margin:0;font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:.5px;display:flex;align-items:center;gap:9px">${ic(I.tv, 17)}Étape 3 — Poules</h3>
      <div style="display:flex;align-items:center;gap:9px"><label style="font-size:12.5px;color:#8E8FA6;font-weight:600">Nombre de poules</label><select id="wz-pools" style="${WIZ_INP};width:auto;padding:9px 12px">${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<option value="${n}" ${n === d.nbPools ? "selected" : ""}>${n}</option>`).join("")}</select></div>
    </div>
    <p style="color:#8E8FA6;font-size:13px;line-height:1.7">Répartition automatique équilibrée : <b style="color:#F4F5FB">${sizes.join(" / ")}</b> joueur${d.players.length > 1 ? "s" : ""}. L'ordre de passage définit qui entre sur le terrain en premier — le 1er affronte le 2e, le vainqueur affronte le 3e, etc. Tu pourras prévisualiser et réordonner les poules juste avant de lancer le tournoi, une fois créé.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-top:14px">${sizes.map((n, i) => `<div style="border:1px solid #282838;border-radius:12px;padding:14px;text-align:center"><div style="font-family:'Bebas Neue',sans-serif;font-size:22px;color:#22D3EE">${n}</div><div style="font-size:11px;color:#8E8FA6;margin-top:2px">Poule ${String.fromCharCode(65 + i)}</div></div>`).join("")}</div>`)}
  ${wizFoot("Retour", 2, 4)}`;
}

const WIZ_SCORING_FIELDS: [string, string, string][] = [
  ["wz-sc-surv", "Victoire en poule Survival", "survWin"],
  ["wz-sc-loser", "Victoire en poule des perdants", "loserWin"],
  ["wz-sc-poolfinal", "Victoire en finale de poule", "poolFinalWin"],
  ["wz-sc-finals", "Victoire en phase finale", "finalsWin"],
  ["wz-sc-champion", "Bonus champion du tournoi", "championBonus"],
];

function wizScoringStep(S: State) {
  const d = S.wizData;
  const c = cagnottePreview(d.players.length, d.nbPools, d.pointsPerPlayer, d);
  const rows = WIZ_SCORING_FIELDS.map(([id, label, key], i) => {
    const b = c.breakdown[key as keyof typeof c.breakdown];
    const sub = key === "championBonus" ? "une seule fois" : `× ${b.matches} match${b.matches > 1 ? "s" : ""} prévu${b.matches > 1 ? "s" : ""}`;
    const last = i === WIZ_SCORING_FIELDS.length - 1;
    return `<div style="display:flex;align-items:center;gap:16px;padding:14px 18px;${last ? "" : "border-bottom:1px solid #1B1B27;"}">
      <div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:650">${label}</div><div id="wiz-sc-sub-${key}" style="font-size:11.5px;color:#5D5E72;margin-top:2px">${sub}</div></div>
      <input id="${id}" type="number" min="0" step="0.25" value="${(d as unknown as Record<string, number>)[key]}" style="width:88px;text-align:center;border:1px solid #33334A;border-radius:9px;background:#1B1B27;color:#F4F5FB;font-family:'JetBrains Mono',monospace;font-size:14px;padding:9px" />
      <span id="wiz-sc-pts-${key}" style="width:70px;text-align:right;font-family:'JetBrains Mono',monospace;font-size:13px;color:#8E8FA6;flex:none">${b.pts} pts</span>
    </div>`;
  }).join("");
  return `<div class="grid2b" style="display:grid;grid-template-columns:1.4fr 1fr;gap:16px">
    <div>
      <h3 style="margin:0 0 6px;font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:.5px;display:flex;align-items:center;gap:9px">${ic(I.cart, 17)}${S.wizEditId ? "Barème des points" : "Étape 4 — Barème des points"}</h3>
      <p style="color:#8E8FA6;font-size:13.5px;margin:6px 0 16px;max-width:520px">Chaque valeur est librement réglable à partir de 0,25 point. Le total programmé doit tenir dans la cagnotte disponible.</p>
      <div style="border:1px solid #282838;border-radius:12px;background:#14141D;overflow:hidden">${rows}</div>
    </div>
    ${wizGaugeCard(c)}
  </div>${wizFoot("Retour", S.wizEditId ? 1 : 3, 5, "Validation")}`;
}

function wizValidateStep(S: State) {
  const d = S.wizData;
  const editing = !!S.wizEditId;
  const isSurvival = d.format === "SURVIVAL";
  const isBR = d.format === "BATTLE_ROYALE";
  const c = cagnottePreview(d.players.length, d.nbPools, d.pointsPerPlayer, d);
  // Le barème détaillé (et sa jauge de validité) ne concerne que Survival — les autres formats n'ont rien à dépasser.
  const canSubmit = (isSurvival ? c.valid : true) && d.name.trim().length > 0 && (editing || d.players.length >= 2);
  const row = (label: string, value: string) => `<tr><td style="padding:9px 6px;color:#8E8FA6;font-size:13px">${label}</td><td style="padding:9px 6px;text-align:right;font-weight:650">${value}</td></tr>`;
  const brk = WIZ_SCORING_FIELDS.map(([, label, key]) => row(label, String((d as unknown as Record<string, number>)[key]))).join("");
  const formatLabel = (WIZ_FORMATS.find(([key]) => key === d.format) || WIZ_FORMATS[0])[1];
  const structureRow = isSurvival
    ? row("Poules", `${d.nbPools} (${balancedSizesPreview(d.players.length, d.nbPools).join(" / ")})`)
    : isBR ? row("Parties", String(d.nbPools)) : "";
  const participantsRows = editing ? "" : `${row("Format", formatLabel)}${row("Participants", String(d.players.length))}${structureRow}${isSurvival ? row("Qualification", "Top 1 + Top 2 de chaque poule → phase finale") : ""}`;
  const backTarget = editing ? 4 : (isSurvival ? 4 : isBR ? 3 : 2);
  const bareme = isSurvival ? `<hr style="border:0;border-top:1px solid #282838;margin:14px 0" />
      <h3 style="margin:0 0 10px;font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:.5px">Barème</h3>
      <table style="width:100%;border-collapse:collapse">${brk}</table>` : "";
  return `<div class="grid2b" style="display:grid;grid-template-columns:1.4fr 1fr;gap:16px">
    ${wizCard(`<h3 style="margin:0 0 14px;font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:.5px;display:flex;align-items:center;gap:9px">${ic(I.crown, 17)}${editing ? "Récapitulatif" : "Étape 5 — Récapitulatif"}</h3>
      <table style="width:100%;border-collapse:collapse">
        ${row("Tournoi", escHtml(d.name) || "—")}${row("Jeu", escHtml(d.game) || "—")}${row("Date / lieu", `${escHtml(d.date) || "—"}${d.place ? " · " + escHtml(d.place) : ""}`)}
        ${participantsRows}${row("Frais d'inscription", d.entryFeeXof ? money(d.entryFeeXof) : "Gratuit")}
      </table>
      ${bareme}
      <button data-act="${editing ? "wiz-update" : "wiz-submit"}" ${!canSubmit || S.busy ? "disabled" : ""} style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin-top:20px;background:${canSubmit ? "linear-gradient(135deg,#22D3EE,#12aec4)" : "#22222F"};color:${canSubmit ? "#04222a" : "#5D5E72"};border:0;border-radius:12px;padding:14px 22px;font-weight:750;font-size:15px;cursor:${canSubmit && !S.busy ? "pointer" : "default"}">${ic(I.bolt, 17)}${S.busy ? (editing ? "Enregistrement…" : "Création…") : (editing ? "Enregistrer les modifications" : "Créer le tournoi")}</button>
      ${canSubmit ? (editing ? "" : `<p style="color:#5D5E72;font-size:11.5px;text-align:center;margin-top:9px">${isSurvival ? "Tu pourras répartir/réordonner les poules et lancer le tournoi depuis sa page." : "Tu pourras lancer le tournoi depuis sa page."}</p>`) : `<p style="color:#FB7185;font-size:11.5px;text-align:center;margin-top:9px">${ic(I.warn, 12)} Corrige le nom${editing ? "" : ", les participants (min. 2)"}${isSurvival ? " ou le barème (dépassement)" : ""} avant de ${editing ? "enregistrer" : "créer"}.</p>`}`)}
    ${isSurvival ? wizGaugeCard(c) : ""}
  </div>${wizFoot("Retour", backTarget, 0)}`;
}

/** Assistant de création/modification : modal plein écran (fond flouté), sidebar d'étapes + contenu.
 * Ne se ferme jamais au clic extérieur — un formulaire à 5 étapes est trop long à ressaisir pour un
 * clic accidentel ; seule la croix ferme explicitement. */
/** Libellé court de l'étape active, pour l'indicateur compact affiché à la place de la liste complète sous 1024px. */
const WIZ_STEP_LABELS: Record<number, string> = { 1: "Infos générales", 2: "Participants", 3: "Poules", 4: "Barème des points", 5: "Validation" };
function tournamentWizard(S: State) {
  const editing = !!S.wizEditId;
  const body = [wizInfosStep, wizParticipantsStep, wizPoolsStep, wizScoringStep, wizValidateStep][S.wizStep - 1](S);
  const stepLabel = S.wizStep === 3 && S.wizData.format === "BATTLE_ROYALE" ? "Parties" : (WIZ_STEP_LABELS[S.wizStep] || "");
  const mobileProgress = `<div class="wiz-mobile-progress" style="border-bottom:1px solid #1B1B27">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px">
      <div><span style="font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:.5px">${editing ? "Modifier" : "Nouveau tournoi"}</span><div style="font-size:11.5px;color:#8E8FA6;margin-top:2px">Étape ${S.wizStep}/5 — ${stepLabel}</div></div>
      <button data-act="create-cancel" style="display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:#1B1B27;border:1px solid #282838;color:#8E8FA6;cursor:pointer;flex:none">${ic(I.x, 14)}</button>
    </div>
    <div style="height:3px;background:#1B1B27"><span style="display:block;height:100%;width:${(S.wizStep / 5) * 100}%;background:#22D3EE;transition:width .25s ease"></span></div>
  </div>`;
  return `<div class="wiz-overlay" style="position:fixed;inset:0;z-index:260;display:flex;align-items:flex-start;justify-content:center;padding:min(5vh,36px) 18px;background:rgba(6,6,10,.82);backdrop-filter:blur(8px);overflow-y:auto">
    <div data-stop="1" class="wiz-dialog" style="width:100%;max-width:1160px;border:1px solid #282838;border-radius:20px;background:#0B0B11;box-shadow:0 40px 100px rgba(0,0,0,.6);animation:fadeUp .18s ease both;margin-bottom:36px;display:flex;overflow:hidden;min-height:600px">
      ${mobileProgress}
      <div class="wiz-sidebar" style="width:230px;flex:none;border-right:1px solid #1B1B27;background:#0E0E16;display:flex;flex-direction:column">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 16px 16px 18px;border-bottom:1px solid #1B1B27">
          <span style="font-family:'Bebas Neue',sans-serif;font-size:19px;letter-spacing:1px">${editing ? "Modifier" : "Nouveau tournoi"}</span>
          <button data-act="create-cancel" style="display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:#1B1B27;border:1px solid #282838;color:#8E8FA6;cursor:pointer;flex:none">${ic(I.x, 13)}</button>
        </div>
        ${wizSteps(S)}
        <div style="flex:1"></div>
        <div style="padding:14px 18px 18px;border-top:1px solid #1B1B27;font-size:11px;color:#5D5E72;line-height:1.6">Format : <b style="color:#8E8FA6">${(WIZ_FORMATS.find(([key]) => key === S.wizData.format) || WIZ_FORMATS[0])[1]}</b>${S.wizData.format === "SURVIVAL" ? " — barème détaillé réglable à l'étape 4." : " — points par victoire génériques (pas de barème détaillé, réservé à Survival)."}</div>
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
  const searchBox = `<div style="position:relative;width:240px"><span style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:#5D5E72">${ic(I.search, 15)}</span><input id="hsearch" value="${escAttr(S.q)}" placeholder="Tournoi, jeu, lieu…" style="width:100%;background:#14141D;border:1px solid #282838;border-radius:9px;color:#F4F5FB;font-family:inherit;font-size:13px;padding:10px 12px 10px 34px" /></div>`;
  const statusCounts = TOURN_STATUSES.map((st) => [st, st === "Tous" ? source.length : source.filter((t) => matchesTournStatus(t, st)).length] as const);
  const statusBar = `<div style="display:flex;border:1px solid #282838;border-radius:9px;overflow-x:auto;max-width:100%">${statusCounts.map(([st, n], i) => {
    const on = S.tournStatus === st;
    return `<span data-tournstatus="${st}" style="padding:8px 15px;font-size:12.5px;font-weight:${on ? 750 : 600};cursor:pointer;background:${on ? "#22D3EE" : "transparent"};color:${on ? "#04222a" : "#8E8FA6"};transition:background .2s ease,color .2s ease;white-space:nowrap;flex:none;${i > 0 ? "border-left:1px solid #282838" : ""}">${st} <span style="font-family:'JetBrains Mono',monospace;opacity:${on ? .7 : 1};color:${on ? "#04222a" : "#5D5E72"}">${n}</span></span>`;
  }).join("")}</div>`;
  const filt = `<div class="rise d1 page-hpad" style="display:flex;align-items:center;gap:22px;padding:14px 44px;border-bottom:1px solid #1B1B27;flex-wrap:wrap">${statusBar}<span style="width:1px;height:22px;background:#22222F"></span><div style="display:flex;gap:7px;flex-wrap:wrap">${chips(FORMATS, S.fmt, "fmt")}</div></div>`;

  const head = railPageHead("Tournois", `${source.length} tournoi${source.length > 1 ? "s" : ""} · ${source.filter((t) => t.live).length} en direct · ${source.filter((t) => matchesTournStatus(t, "Ouverts")).length} inscription${source.filter((t) => matchesTournStatus(t, "Ouverts")).length > 1 ? "s" : ""} ouverte${source.filter((t) => matchesTournStatus(t, "Ouverts")).length > 1 ? "s" : ""}`, `${searchBox}${createBtn}`);

  const form = S.creating && manage ? tournamentWizard(S) : "";

  // Tournoi en direct mis en avant, extrait de la grille.
  const liveT = source.find((t) => t.live);
  const featured = liveT ? `<div class="rise d2 page-hpad" style="padding:26px 44px 0"><div data-open="${liveT.id}" class="hcard glow" style="position:relative;border:1px solid rgba(34,211,238,.4);border-radius:14px;overflow:hidden;background:linear-gradient(100deg,#0f2932 10%,#13303a 45%,#1a1435);padding:26px 30px;cursor:pointer">
    <div style="display:flex;align-items:center;gap:10px"><span style="display:inline-flex;align-items:center;gap:6px;font-size:10.5px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:#04222a;background:#22D3EE;border-radius:99px;padding:4px 10px"><span style="width:6px;height:6px;border-radius:50%;background:#04222a;animation:blink 1.2s infinite"></span>En direct</span><span style="font-size:12px;color:#63C6DA;font-weight:600">${escHtml(liveT.format)}</span></div>
    <h3 style="font-family:'Bebas Neue',sans-serif;font-size:38px;letter-spacing:1.2px;margin:12px 0 0;line-height:.95">${escHtml(liveT.name)}</h3>
    <div style="color:#A6C9D3;font-size:13.5px;margin-top:8px">${[liveT.game, liveT.players + " joueurs", liveT.place, liveT.date].filter(Boolean).map(escHtml).join(" · ")}</div>
    <div style="display:flex;align-items:center;gap:14px;margin-top:18px;flex-wrap:wrap">
      <span style="display:inline-flex;align-items:center;gap:8px;background:#22D3EE;color:#04222a;border-radius:10px;padding:11px 17px;font-weight:750;font-size:13.5px">Ouvrir la régie ${ic(I.arrow, 15)}</span>
      <span data-show="${liveT.id}" style="display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.22);color:#fff;border-radius:10px;padding:11px 17px;font-weight:700;font-size:13.5px">${ic(I.tv, 15)}Mode Show</span>
    </div>
  </div></div>` : "";

  const emptyMsg = source.length === 0 ? "Aucun tournoi pour l'instant." : `Aucun tournoi ne correspond${q ? ` à « ${S.q} »` : ""}.`;
  const empty = `<div class="page-hpad-m" style="margin:26px 44px 0;border:1px solid #282838;border-radius:16px;background:#14141D;padding:48px 24px;text-align:center;color:#8E8FA6">${emptyMsg}</div>`;
  const rest = list.filter((t) => !liveT || t.id !== liveT.id);
  const filetCard = (t: TournCard, i: number) => {
    const n = rest.length;
    const isRight = (i + 1) % 3 === 0 || i === n - 1;
    const isLastRow = i >= n - (n % 3 === 0 ? 3 : n % 3);
    const bannerBg = t.imageUrl
      ? `background-image:linear-gradient(180deg,rgba(11,11,17,.15),rgba(11,11,17,.6)),url('${mediaUrl(t.imageUrl)}');background-size:cover;background-position:center`
      : "background:linear-gradient(135deg,rgba(34,211,238,.16),rgba(124,130,255,.11))";
    const statusBadge = t.live
      ? `<span style="position:absolute;top:12px;right:12px;display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#04222a;background:#22D3EE;border-radius:99px;padding:4px 9px"><span style="width:5px;height:5px;border-radius:50%;background:#04222a;animation:blink 1.2s infinite"></span>Live</span>`
      : `<span style="position:absolute;top:12px;right:12px;font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:${t.status === "Terminé" ? "#FBBF24" : "#7C82FF"};background:rgba(11,11,17,.7);border:1px solid ${t.status === "Terminé" ? "rgba(251,191,36,.4)" : "rgba(124,130,255,.45)"};border-radius:99px;padding:4px 9px">${escHtml(t.status)}</span>`;
    const openAttr = t.id ? `data-open="${t.id}"` : `data-go="tournois"`;
    return `<div ${openAttr} class="fcell" style="padding:20px ${isRight ? "0" : "24px"} 24px ${i % 3 === 0 ? "0" : "24px"};${isRight ? "" : "border-right:1px solid #1B1B27;"}${isLastRow ? "" : "border-bottom:1px solid #1B1B27;"}cursor:pointer">
      <div class="zoom" style="position:relative;height:158px;border-radius:10px;overflow:hidden;${bannerBg};margin-bottom:14px">
        <span style="position:absolute;bottom:12px;left:12px;font-size:10.5px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#fff;background:rgba(11,11,17,.6);border:1px solid rgba(255,255,255,.16);border-radius:99px;padding:4px 10px">${escHtml(t.format)}</span>
        ${statusBadge}
      </div>
      <h4 style="margin:0 0 8px;font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:.8px">${escHtml(t.name)}</h4>
      <div style="color:#8E8FA6;font-size:13px;line-height:1.65">${escHtml(t.game)} · <span style="font-family:'JetBrains Mono',monospace">${t.players}</span> joueurs<br>${escHtml(t.date)} · ${escHtml(t.place)}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;padding-top:12px;border-top:1px solid #1B1B27"><span style="font-size:12.5px;color:${t.live ? "#22D3EE" : "#8E8FA6"};font-weight:${t.live ? 700 : 600}">${t.live ? "En direct" : escHtml(t.status)}</span><span style="font-size:12.5px;color:#FBBF24;font-weight:700;font-family:'JetBrains Mono',monospace">${t.cagnotte} pts</span></div>
    </div>`;
  };
  const gridHead = `<div style="display:flex;align-items:center;gap:10px;margin:0 0 4px"><h3 style="font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:1.2px;margin:0">${liveT ? "Tous les tournois" : "Tournois"}</h3><span style="font-size:12px;color:#5D5E72;font-family:'JetBrains Mono',monospace">${rest.length}</span></div>`;
  const grid = rest.length
    ? `<div class="rise d3 page-hpad" style="padding:34px 44px 44px">${gridHead}<div class="tourn-grid" style="display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid #22222F;margin-top:12px">${rest.map(filetCard).join("")}</div></div>`
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
      return `<div class="podium-item" style="display:flex;flex-direction:column;align-items:center;gap:9px;width:112px"><div style="display:grid;place-items:center;width:52px;height:52px;border-radius:14px;font-family:'Bebas Neue',sans-serif;font-size:24px;color:#04222a;background:linear-gradient(135deg,${plColor},${avA})">${r.name.charAt(0).toUpperCase()}</div><div style="text-align:center;max-width:110px"><div style="font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(r.name)}</div><div style="font-size:11px;color:#8E8FA6">${r.points} pts</div></div><div style="width:100%;border-radius:12px 12px 0 0;border:1px solid #282838;border-bottom:0;background:#1B1B27;display:flex;align-items:center;justify-content:center;padding-top:8px;height:${h}"><span style="font-family:'Bebas Neue',sans-serif;font-size:28px;color:${plColor}">${rank + 1}</span></div></div>`;
    }).join("")}</div>`;
  }
  const th = (t: string, r?: boolean) => `<th style="text-align:${r ? "right" : "left"};color:#8E8FA6;font-size:10.5px;text-transform:uppercase;letter-spacing:1px;padding:12px 8px;font-weight:750">${t}</th>`;
  const trs = list.map((r: Detail, i: number) => `<tr style="border-top:1px solid #282838"><td style="padding:11px 8px;font-family:'Bebas Neue',sans-serif;font-size:19px;color:${i < 3 ? "#FBBF24" : "#5D5E72"}">${i + 1}</td><td style="padding:11px 8px"><div style="display:flex;align-items:center;gap:10px"><span style="display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#22222F;border:1px solid #282838;font-size:11px;font-weight:800;color:#8E8FA6">${r.name.charAt(0).toUpperCase()}</span><div><div style="font-weight:650">${escHtml(r.name)}${r.championships > 0 ? ` <span title="Titres remportés" style="color:#FBBF24">${ic(I.crown, 12)} ${r.championships}</span>` : ""}</div><div style="font-size:11px;color:#5D5E72">${escHtml(r.city) || "—"}</div></div></div></td><td style="padding:11px 8px;text-align:right;color:#8E8FA6;font-variant-numeric:tabular-nums">${r.tournamentsPlayed}</td><td style="padding:11px 8px;text-align:right;font-variant-numeric:tabular-nums">${r.wins}-${r.losses}</td><td style="padding:11px 8px;text-align:right;color:#34D399;font-weight:700">${r.winrate}%</td><td style="padding:11px 8px;text-align:right;font-weight:800;color:#22D3EE;font-variant-numeric:tabular-nums">${r.points}</td></tr>`).join("");
  const table = `<div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:8px 18px 14px;overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px;min-width:560px"><tr>${th("#")}${th("Joueur")}${th("Tournois", true)}${th("V-D", true)}${th("Winrate", true)}${th("Points", true)}</tr>${trs}</table></div>`;
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
    return `<div style="border:1px solid #282838;border-radius:18px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:48px 24px;text-align:center;color:#8E8FA6">Aucun joueur classé n'est encore rattaché à un club (à faire depuis Admin → Joueurs).</div>`;
  }
  const th = (t: string, r?: boolean) => `<th style="text-align:${r ? "right" : "left"};color:#8E8FA6;font-size:10.5px;text-transform:uppercase;letter-spacing:1px;padding:12px 8px;font-weight:750">${t}</th>`;
  const trs = list.map((c, i) => `<tr style="border-top:1px solid #282838"><td style="padding:11px 8px;font-family:'Bebas Neue',sans-serif;font-size:19px;color:${i < 3 ? "#FBBF24" : "#5D5E72"}">${i + 1}</td><td style="padding:11px 8px"><div style="display:flex;align-items:center;gap:10px"><span style="display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#22222F;border:1px solid #282838;font-size:11px;font-weight:800;color:#8E8FA6">${c.name.charAt(0).toUpperCase()}</span><div><div style="font-weight:650">${escHtml(c.name)}${c.championships > 0 ? ` <span title="Titres remportés par des joueurs du club" style="color:#FBBF24">${ic(I.crown, 12)} ${c.championships}</span>` : ""}</div><div style="font-size:11px;color:#5D5E72">${c.playerCount} joueur${c.playerCount > 1 ? "s" : ""} classé${c.playerCount > 1 ? "s" : ""}</div></div></div></td><td style="padding:11px 8px;text-align:right;font-variant-numeric:tabular-nums">${c.wins}-${c.losses}</td><td style="padding:11px 8px;text-align:right;color:#34D399;font-weight:700">${c.winrate}%</td><td style="padding:11px 8px;text-align:right;font-weight:800;color:#22D3EE;font-variant-numeric:tabular-nums">${c.points}</td></tr>`).join("");
  return `<div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:8px 18px 14px;overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px;min-width:480px"><tr>${th("#")}${th("Club")}${th("V-D", true)}${th("Winrate", true)}${th("Points", true)}</tr>${trs}</table></div>`;
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
  const all: Detail[] = S.leaderboard ?? [];
  const viewToggle = (v: "joueurs" | "clubs", label: string) => `<span data-classview="${v}" style="padding:9px 16px;font-size:12.5px;font-weight:${S.classementView === v ? 750 : 600};cursor:pointer;transition:background .2s ease,color .2s ease;background:${S.classementView === v ? "#22D3EE" : "transparent"};color:${S.classementView === v ? "#04222a" : "#8E8FA6"}">${label}</span>`;
  const head = railPageHead("Classements", `Points, victoires et titres calculés depuis les résultats réels. <b style="color:#F4F5FB">Un classement distinct par jeu</b> — les points ne sont jamais additionnés entre deux jeux.`,
    `<div style="display:flex;border:1px solid #282838;border-radius:9px;overflow:hidden">${viewToggle("joueurs", "Joueurs")}${viewToggle("clubs", "Clubs")}</div>`);
  if (S.leaderboard === null) return `${head}<div class="page-hpad" style="padding:0 44px;color:#5D5E72;text-align:center">Chargement…</div>`;
  if (!all.length) {
    return `${head}<div class="page-hpad-m" style="margin:0 44px 40px;border:1px solid #282838;border-radius:18px;background:#14141D;padding:56px 24px;text-align:center;color:#8E8FA6">
      <div style="display:grid;place-items:center;width:60px;height:60px;border-radius:18px;background:#1B1B27;border:1px solid #33334A;color:#FBBF24;margin:0 auto 14px">${ic(I.medal, 26)}</div>
      Aucun résultat pour l'instant. Le classement se remplit au fil des matchs joués !</div>`;
  }
  // Chaque jeu garde son propre classement (points/winrate/tournois) — jamais additionné avec un autre jeu.
  const byGame = new Map<string, Detail[]>();
  for (const r of all) { const g = r.game || "Autre"; if (!byGame.has(g)) byGame.set(g, []); byGame.get(g)!.push(r); }
  const gamesPresent = GAMES.filter((g) => g !== "Tous" && byGame.has(g)).concat(Array.from(byGame.keys()).filter((g) => !GAMES.includes(g)));
  const activeGame = gamesPresent.includes(S.game) ? S.game : (gamesPresent[0] || "Tous");
  const block = (rows: Detail[], opts: { podium: boolean; limit?: number }) => S.classementView === "clubs" ? clubLeaderboardBlock(rows) : gameLeaderboardBlock(rows, opts);

  const tabs = `<div class="rise d1 page-hpad" style="display:flex;gap:0;padding:0 44px;border-bottom:1px solid #1B1B27;overflow-x:auto">${gamesPresent.map((g) => {
    const on = g === activeGame;
    return `<span data-game="${g}" style="padding:14px 22px 13px;border-bottom:2px solid ${on ? "#22D3EE" : "transparent"};display:flex;align-items:baseline;gap:9px;cursor:pointer;flex:none;transition:border-color .2s ease"><span style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:1px;color:${on ? "#fff" : "#8E8FA6"};transition:color .2s ease">${escHtml(g)}</span><span style="font-family:'JetBrains Mono',monospace;font-size:11.5px;color:${on ? "#22D3EE" : "#5D5E72"}">${(byGame.get(g) ?? []).length}</span></span>`;
  }).join("")}</div>`;

  const rows = byGame.get(activeGame) ?? [];
  if (!rows.length) {
    return `${head}${tabs}<div class="page-hpad-m" style="margin:26px 44px 40px;border:1px solid #282838;border-radius:18px;background:#14141D;padding:48px 24px;text-align:center;color:#8E8FA6">Aucun résultat pour « ${escHtml(activeGame)} » pour l'instant.</div>`;
  }
  const topClubs = topClubsCompact(rows);
  const sidePanel = `<div style="display:flex;flex-direction:column;gap:16px">
    ${topClubs.length ? `<div style="border:1px solid #282838;border-radius:12px;background:#14141D;padding:18px">
      <div style="font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6;font-weight:800;margin-bottom:14px">Top clubs · ${escHtml(activeGame)}</div>
      ${topClubs.map((c, i) => `<div style="display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid #1B1B27"><span style="font-family:'Bebas Neue',sans-serif;font-size:17px;color:#FBBF24;width:16px">${i + 1}</span><div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:650">${escHtml(c.name)}</div><div style="font-size:11px;color:#5D5E72">${c.playerCount} joueur${c.playerCount > 1 ? "s" : ""} classé${c.playerCount > 1 ? "s" : ""}</div></div><span style="color:#22D3EE;font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:600">${c.points}</span></div>`).join("")}
    </div>` : ""}
    <div style="border:1px solid #282838;border-radius:12px;background:#0E0E16;padding:18px">
      <div style="font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:#5D5E72;font-weight:800;margin-bottom:10px">Comment les points sont calculés</div>
      <div style="font-size:12.5px;color:#8E8FA6;line-height:1.7">Chaque tournoi distribue une cagnotte fixée à l'avance (participants × points par joueur). Les points gagnés en match s'ajoutent au classement du jeu concerné. Un joueur peut figurer dans plusieurs classements sans jamais cumuler.</div>
    </div>
  </div>`;
  const body = `<div class="rise d2 page-hpad" style="padding:30px 44px 44px"><div class="grid2c" style="display:grid;grid-template-columns:1fr 320px;gap:22px;align-items:start">
    <div>${block(rows, { podium: true })}</div>
    ${S.classementView === "joueurs" ? sidePanel : ""}
  </div></div>`;
  return `${head}${tabs}${body}`;
}

function pGalerie(S: State) {
  const all: Detail[] = S.gallery ?? [];
  const tournFilters = Array.from(
    new Map(all.filter((it) => it.tournament).map((it: Detail) => [it.tournament.id, it.tournament.name])).entries()
  );
  const count = all.length;
  if (!count) {
    const head = railPageHead("Galerie", "Photos et vidéos des tournois, LAN et remises de prix VLOME");
    return `${head}<div class="rise d1" style="margin:0 44px 40px;border:1px solid #282838;border-radius:18px;background:#14141D;padding:64px 24px;text-align:center;color:#8E8FA6">
      <div style="display:grid;place-items:center;width:64px;height:64px;border-radius:18px;background:#1B1B27;border:1px solid #33334A;color:#7C82FF;margin:0 auto 16px">${ic(I.image, 28)}</div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:1px;color:#F4F5FB;margin-bottom:6px">Galerie vide pour l'instant</div>
      Reviens après le prochain événement pour revivre les meilleurs moments !</div>`;
  }
  let items = S.galleryFilter ? all.filter((it) => it.tournament?.id === S.galleryFilter) : all;
  if (S.galleryType === "video") items = items.filter((it) => it.mediaType === "video");
  else if (S.galleryType === "image") items = items.filter((it) => it.mediaType !== "video");

  const eventRow = (id: string, label: string, n: number) => {
    const on = S.galleryFilter === id;
    return `<div data-gfilter="${id}" style="display:flex;align-items:center;justify-content:space-between;padding:9px 11px;border-radius:8px;cursor:pointer;transition:background .2s ease,color .2s ease;background:${on ? "rgba(124,130,255,.14)" : "transparent"};color:${on ? "#fff" : "#8E8FA6"};font-size:13px;font-weight:${on ? 700 : 600}">${escHtml(label)} <span style="font-family:'JetBrains Mono',monospace;font-size:11.5px;color:${on ? "#7C82FF" : "#5D5E72"}">${n}</span></div>`;
  };
  const typeChip = (v: "" | "image" | "video", label: string) => {
    const on = S.galleryType === v;
    return `<span data-gtype="${v}" class="chip" style="font-size:12px;font-weight:${on ? 700 : 600};color:${on ? "#7C82FF" : "#8E8FA6"};background:${on ? "rgba(124,130,255,.1)" : "transparent"};border:1px solid ${on ? "#7C82FF" : "#282838"};border-radius:99px;padding:6px 12px;cursor:pointer;transition:background .2s ease,color .2s ease,border-color .2s ease">${label}</span>`;
  };
  const rail = `<div class="rise d1 page-filter-rail" style="width:220px;flex:none;border-right:1px solid #1B1B27;padding:32px 20px">
    <div style="font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:#5D5E72;font-weight:800;margin-bottom:14px">Événements</div>
    <div style="display:flex;flex-direction:column;gap:2px">${eventRow("", "Tous", all.length)}${tournFilters.map(([id, name]) => eventRow(id as string, name as string, all.filter((it) => it.tournament?.id === id).length)).join("")}</div>
    <div style="margin-top:24px;padding-top:18px;border-top:1px solid #1B1B27">
      <div style="font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:#5D5E72;font-weight:800;margin-bottom:12px">Type</div>
      <div style="display:flex;gap:7px;flex-wrap:wrap">${typeChip("", "Tout")}${typeChip("image", "Photos")}${typeChip("video", "Vidéos")}</div>
    </div>
  </div>`;

  // Mosaïque à hauteurs variables : quelques tuiles plus grandes selon un rythme fixe, plutôt qu'une grille uniforme.
  const SPANS = ["grid-column:span 2;grid-row:span 2", "", "", "grid-column:span 2", "grid-row:span 2", ""];
  const card = (it: Detail, i: number) => {
    const media = it.mediaType === "video"
      ? `<video class="zoom" src="${mediaUrl(it.mediaUrl)}" muted loop playsinline onmouseover="this.play()" onmouseout="this.pause()" style="width:100%;height:100%;object-fit:cover"></video>`
      : `<div class="zoom" style="width:100%;height:100%;background-image:url('${mediaUrl(it.mediaUrl)}');background-size:cover;background-position:center"></div>`;
    return `<div data-gopen="${it.id}" class="hcard" style="${SPANS[i % SPANS.length]};cursor:pointer;border-radius:12px;overflow:hidden;background:#14141D;position:relative">
      <div style="position:absolute;inset:0">${media}</div>
      <div style="position:absolute;inset:0;background:linear-gradient(180deg,transparent 50%,rgba(11,11,17,.9));pointer-events:none"></div>
      ${it.mediaType === "video" ? `<span style="position:absolute;top:10px;right:10px;display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:rgba(11,11,17,.7);border:1px solid rgba(255,255,255,.2);color:#fff">${ic(I.tv, 13)}</span>` : ""}
      <div style="position:absolute;left:12px;right:12px;bottom:11px"><div style="font-weight:700;font-size:13.5px;color:#fff;line-height:1.3">${escHtml(it.title)}</div>${it.tournament ? `<div style="font-size:11.5px;color:#22D3EE;font-weight:700;margin-top:3px">${escHtml(it.tournament.name)}</div>` : ""}</div></div>`;
  };
  const grid = items.length
    ? `<div class="rise d2 gallery-grid" style="padding:0 40px 40px;display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:150px;gap:12px">${items.map(card).join("")}</div>`
    : `<div class="rise d2" style="margin:0 40px 40px;border:1px solid #282838;border-radius:16px;background:#14141D;padding:48px 24px;text-align:center;color:#8E8FA6">Aucun média ne correspond à ce filtre.</div>`;
  const content = `<div style="flex:1;min-width:0">
    <div class="rise d1" style="display:flex;align-items:flex-end;gap:20px;padding:32px 40px 22px"><div><h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(38px,4.5vw,56px);letter-spacing:1.5px;margin:0;line-height:.92">Galerie</h1><p style="color:#8E8FA6;font-size:14px;margin:8px 0 0">${count} photo${count > 1 ? "s" : ""} et vidéo${count > 1 ? "s" : ""} des tournois, LAN et remises de prix VLOME</p></div></div>
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
  const nav = (dir: "prev" | "next", disabled: boolean) => `<button data-g${dir}="1" ${disabled ? "disabled" : ""} style="display:grid;place-items:center;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);color:${disabled ? "#33334A" : "#F4F5FB"};cursor:${disabled ? "default" : "pointer"};flex:none;transform:${dir === "prev" ? "scaleX(-1)" : "none"}">${ic(I.arrow, 18)}</button>`;
  return `<div data-gclose="1" style="position:fixed;inset:0;z-index:250;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;background:rgba(6,6,10,.92);backdrop-filter:blur(8px)">
    <div data-stop="1" style="display:flex;align-items:center;gap:16px;max-width:1100px;width:100%">
      ${nav("prev", idx <= 0)}
      <div style="flex:1;min-width:0;text-align:center">
        ${media}
        <div style="margin-top:14px"><div style="font-weight:700;font-size:16px;color:#fff">${escHtml(it.title)}</div>${it.tournament ? `<div style="font-size:12.5px;color:#22D3EE;font-weight:700;margin-top:4px">${escHtml(it.tournament.name)}</div>` : ""}<div style="font-size:11.5px;color:#5D5E72;margin-top:6px">${idx + 1} / ${items.length}</div></div>
      </div>
      ${nav("next", idx >= items.length - 1)}
    </div>
    <button data-gclose="1" style="position:absolute;top:20px;right:24px;display:grid;place-items:center;width:38px;height:38px;border-radius:10px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);color:#F4F5FB;cursor:pointer">${ic(I.x, 18)}</button>
  </div>`;
}

function pBoutique(S: State) {
  const source = S.products ?? [];
  let list = S.cat === "Tous" ? source : source.filter((p) => p.cat === S.cat);
  if (S.boutiqueInStock) list = list.filter((p) => (p.stock ?? 0) > 0);
  const pImg = (p: { ph: string; img?: string | null }, h: number) => p.img
    ? `<div class="zoom" style="height:${h}px;background-image:url('${mediaUrl(p.img)}');background-size:cover;background-position:center"></div>`
    : `<div class="zoom" style="height:${h}px;background:repeating-linear-gradient(45deg,#191922,#191922 13px,#14141D 13px,#14141D 26px);display:grid;place-items:center;color:#5D5E72;font-family:monospace;font-size:11px;letter-spacing:1px">// ${p.ph}</div>`;
  const productCard = (p: typeof source[number]) => {
    const out = (p.stock ?? 0) <= 0;
    return `<div class="${out ? "" : "hcard"}" style="border:1px solid #282838;border-radius:12px;overflow:hidden;background:#14141D;${out ? "opacity:.6" : ""}">
      <div style="position:relative">${pImg(p, 180)}${out ? `<span style="position:absolute;top:10px;left:10px;font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#FB7185;background:rgba(11,11,17,.75);border:1px solid rgba(251,113,133,.4);border-radius:99px;padding:4px 9px">Rupture</span>` : ""}</div>
      <div style="padding:14px 15px 16px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><span style="font-size:11px;color:#7C82FF;font-weight:700">${escHtml(p.cat)}</span>${p.loyaltyEligible ? `<span title="Réduction possible avec les points fidélité" style="font-size:9.5px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:#04222a;background:#22D3EE;border-radius:99px;padding:3px 8px">Points</span>` : ""}</div>
        <div style="font-weight:650;font-size:15px;margin:5px 0 4px">${escHtml(p.name)}</div>
        <div style="font-size:11.5px;color:#5D5E72;margin-bottom:11px">${p.stock !== undefined ? (out ? `<span style="color:#FB7185;font-weight:700">épuisé</span>` : `<span style="color:#34D399;font-weight:700">${p.stock} en stock</span>`) : ""}</div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <span style="font-weight:800;color:${out ? "#8E8FA6" : "#22D3EE"};font-size:16px;font-family:'JetBrains Mono',monospace">${money(p.price)}</span>
          ${out
            ? `<span style="border:1px solid #282838;color:#5D5E72;border-radius:9px;padding:9px 12px;font-weight:700;font-size:12.5px">Épuisé</span>`
            : `<button data-add-name="${escAttr(p.name)}" data-add-price="${p.price}" data-add-id="${p.id}" style="display:inline-flex;align-items:center;gap:6px;background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:9px;padding:9px 12px;font-weight:700;font-size:12.5px;cursor:pointer">${ic(I.plus, 14)}Ajouter</button>`}
        </div>
      </div>
    </div>`;
  };
  const grid = list.length
    ? `<div class="rise d2" style="padding:0 40px 40px;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:18px">${list.map(productCard).join("")}</div>`
    : `<div class="rise d2" style="margin:0 40px 40px;border:1px solid #282838;border-radius:16px;background:#14141D;padding:48px 24px;text-align:center;color:#8E8FA6">${source.length === 0 ? "Aucun produit pour l'instant." : "Aucun produit ne correspond à ces filtres."}</div>`;

  const catRow = (v: string, label: string, n: number) => {
    const on = S.cat === v;
    return `<div data-cat="${v}" style="display:flex;align-items:center;justify-content:space-between;padding:9px 11px;border-radius:8px;cursor:pointer;transition:background .2s ease,color .2s ease;background:${on ? "rgba(251,191,36,.12)" : "transparent"};color:${on ? "#fff" : "#8E8FA6"};font-size:13px;font-weight:${on ? 700 : 600}">${label} <span style="font-family:'JetBrains Mono',monospace;font-size:11.5px;color:${on ? "#FBBF24" : "#5D5E72"}">${n}</span></div>`;
  };
  const availChip = (v: boolean, label: string) => {
    const on = S.boutiqueInStock === v;
    return `<span data-instock="${v ? 1 : 0}" class="chip" style="font-size:12px;font-weight:${on ? 700 : 600};color:${on ? "#FBBF24" : "#8E8FA6"};background:${on ? "rgba(251,191,36,.1)" : "transparent"};border:1px solid ${on ? "#FBBF24" : "#282838"};border-radius:99px;padding:6px 12px;cursor:pointer;transition:background .2s ease,color .2s ease,border-color .2s ease">${label}</span>`;
  };
  const rail = `<div class="rise d1 page-filter-rail" style="width:220px;flex:none;border-right:1px solid #1B1B27;padding:32px 20px">
    <div style="font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:#5D5E72;font-weight:800;margin-bottom:14px">Catégories</div>
    <div style="display:flex;flex-direction:column;gap:2px">${catRow("Tous", "Tout", source.length)}${CATS.filter((c) => c !== "Tous").map((c) => catRow(c, c, source.filter((p) => p.cat === c).length)).join("")}</div>
    <div style="margin-top:24px;padding-top:18px;border-top:1px solid #1B1B27">
      <div style="font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:#5D5E72;font-weight:800;margin-bottom:12px">Disponibilité</div>
      <div style="display:flex;gap:7px;flex-wrap:wrap">${availChip(true, "En stock")}${availChip(false, "Tout")}</div>
    </div>
    <div style="margin-top:24px;padding-top:18px;border-top:1px solid #1B1B27">
      <div style="font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:#5D5E72;font-weight:800;margin-bottom:12px">Paiement accepté</div>
      <div style="display:flex;flex-direction:column;gap:8px">${PAYMENTS.map((m) => `<span style="font-size:12.5px;color:#8E8FA6;font-weight:600">${m}</span>`).join("")}</div>
    </div>
  </div>`;

  const head = `<div class="rise" style="display:flex;align-items:flex-end;gap:20px;padding:32px 40px 22px;flex-wrap:wrap">
    <div><h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(38px,4.5vw,56px);letter-spacing:1.5px;margin:0;line-height:.92">Boutique</h1><p style="color:#8E8FA6;font-size:14px;margin:8px 0 0">Maillots, goodies, billets et cartes cadeaux — paiement mobile money &amp; carte</p></div>
    <span style="flex:1"></span>
    <button data-cart-open="1" style="display:inline-flex;align-items:center;gap:9px;background:#FBBF24;border:0;color:#0b0b11;border-radius:10px;padding:11px 17px;font-weight:750;font-size:13.5px;cursor:pointer">${ic(I.cart, 17)}Panier · <span style="font-family:'JetBrains Mono',monospace">${S.cartItems.length}</span></button>
  </div>`;

  return `<div style="display:flex;flex-wrap:wrap">${rail}<div style="flex:1;min-width:0">${head}${grid}</div></div>`;
}

const canManage = (S: State) => !!S.user && (S.user.role === "ORGANIZER" || S.user.role === "ADMIN");
const ROLE_LABEL: Record<string, string> = { PLAYER: "Joueur", ORGANIZER: "Organisateur", ADMIN: "Administrateur" };
const ROLE_COLOR: Record<string, string> = { PLAYER: "#22D3EE", ORGANIZER: "#7C82FF", ADMIN: "#FBBF24" };
const card = (inner: string, pad = "20px") => `<div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:${pad}">${inner}</div>`;

function pDashboard(S: State) {
  const wrap = (inner: string) => `<main class="rise" style="width:100%;padding:28px clamp(22px,3vw,64px) 60px">${inner}</main>`;
  if (!S.user) {
    return wrap(`<div style="border:1px solid #282838;border-radius:18px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:56px 24px;text-align:center">
      <div style="display:grid;place-items:center;width:64px;height:64px;border-radius:18px;background:#1B1B27;border:1px solid #33334A;color:#22D3EE;margin:0 auto 16px">${ic(I.user, 28)}</div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:30px;letter-spacing:1px;margin-bottom:8px">Espace membre</div>
      <p style="color:#8E8FA6;font-size:14px;max-width:420px;margin:0 auto 22px">Connecte-toi ou crée un compte pour accéder à ton tableau de bord.</p>
      <button data-auth-open="1" style="background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:13px 24px;font-weight:750;font-size:15px;cursor:pointer;box-shadow:0 0 30px rgba(34,211,238,.22)">Se connecter / S'inscrire</button></div>`);
  }
  const u = S.user;
  const me = S.me;
  const rc = ROLE_COLOR[u.role] || "#22D3EE";
  const sub: string[] = [];
  if (me?.city) sub.push(me.city);
  if (me?.favoriteGame) sub.push(me.favoriteGame);
  const header = `<div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;margin-bottom:24px">
    <div style="display:grid;place-items:center;width:78px;height:78px;border-radius:20px;background:linear-gradient(135deg,#22D3EE,#7C82FF);font-family:'Bebas Neue',sans-serif;font-size:36px;color:#04222a;box-shadow:0 0 30px rgba(34,211,238,.3);flex:none">${(u.displayName || "?").charAt(0).toUpperCase()}</div>
    <div style="min-width:0"><h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(28px,4vw,44px);letter-spacing:1px;margin:0;line-height:1">${u.displayName}</h1>
      <div style="color:#8E8FA6;font-size:13.5px;margin-top:5px">${u.email}${sub.length ? " · " + sub.join(" · ") : ""}</div>
      ${me?.bio ? `<div style="color:#8E8FA6;font-size:13px;margin-top:6px;max-width:560px">${(me.bio as string).replace(/</g, "&lt;")}</div>` : ""}
      <span style="display:inline-block;margin-top:10px;font-size:12px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:${rc};background:${rc}18;border:1px solid ${rc}66;border-radius:999px;padding:6px 12px">${ROLE_LABEL[u.role] || u.role}</span></div>
    <div style="flex:1"></div>
    <button data-profileedit="1" style="display:inline-flex;align-items:center;gap:7px;background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:11px 16px;font-weight:700;font-size:13.5px;cursor:pointer">${ic(I.edit, 15)}Modifier le profil</button>
    <button data-logout="1" style="display:inline-flex;align-items:center;gap:7px;background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:11px 16px;font-weight:700;font-size:13.5px;cursor:pointer">${ic(I.logout, 15)}Déconnexion</button>
  </div>`;
  if (!me) return wrap(header + card(`<div style="color:#8E8FA6;text-align:center;padding:22px">Chargement du profil…</div>`));
  const statTiles = memberStats(S);
  const editor = S.profileEdit ? profileEditor(S) : "";
  // ADMIN/ORGANIZER passent par la console (sidebar) — voir renderPage(). Cette page ne sert plus qu'aux PLAYER.
  const body = grid2(regsCard(S), resultsCard(S)) + grid2(ordersCard(S), profileSecurity(S));
  return wrap(header + editor + statTiles + body + loyaltyCard(S));
}

/** Solde + historique des points fidélité (gagnés par participation, dépensés en boutique ou sur des frais d'inscription). */
function loyaltyCard(S: State) {
  const balance = S.me?.loyaltyPoints ?? 0;
  const history: Detail[] = S.loyaltyHistory ?? [];
  const reasonLabel: Record<string, string> = {
    PARTICIPATION: "Participation à un tournoi", ORDER_REDEMPTION: "Dépensé en boutique",
    REGISTRATION_REDEMPTION: "Dépensé sur une inscription", ADMIN_ADJUST: "Ajustement", REFUND: "Remboursement",
  };
  const rows = history.length ? history.map((h) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-top:1px solid #22222F">
      <div><div style="font-size:13.5px;font-weight:600">${reasonLabel[h.reason] || h.reason}${h.note ? ` · ${escHtml(h.note)}` : ""}</div><div style="font-size:11.5px;color:#5D5E72">${new Date(h.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}</div></div>
      <span style="font-family:'JetBrains Mono',monospace;font-weight:800;font-size:14px;color:${h.amount > 0 ? "#34D399" : "#FB7185"};flex:none">${h.amount > 0 ? "+" : ""}${h.amount}</span>
    </div>`).join("") : `<div style="color:#5D5E72;font-size:13.5px;text-align:center;padding:20px 0">Aucun mouvement pour l'instant. Inscris-toi à un tournoi pour gagner ton premier point !</div>`;
  return card(`<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px">
    ${secTitle("Points fidélité")}
    <span style="font-family:'Bebas Neue',sans-serif;font-size:28px;color:#22D3EE">${balance} pt${balance > 1 ? "s" : ""}</span>
  </div>${scrollBox(rows, 320)}`);
}

const grid2 = (a: string, b: string) => `<div class="grid2b" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">${a}${b}</div>`;

const secTitle = (t: string) => `<h3 style="margin:0 0 14px;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6;font-weight:750">${t}</h3>`;

function memberStats(S: State) {
  const me = S.me!;
  const since = me.createdAt ? new Date(me.createdAt).toLocaleDateString("fr-FR", { month: "short", year: "numeric" }) : "—";
  const stat = (v: string | number, k: string, color = "#F4F5FB") => `<div style="border:1px solid #282838;border-radius:14px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:16px"><div style="font-family:'Bebas Neue',sans-serif;font-size:30px;line-height:1;color:${color}">${v}</div><div style="font-size:11px;letter-spacing:.8px;text-transform:uppercase;color:#8E8FA6;font-weight:700;margin-top:6px">${k}</div></div>`;
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
    ? results.map((r: Detail) => `<div style="display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid #22222F">
        <span style="display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:#1B1B27;border:1px solid #282838;color:${r.champion ? "#FBBF24" : "#7C82FF"};flex:none">${ic(r.champion ? I.crown : I.medal, 15)}</span>
        <div style="min-width:0;flex:1"><div style="font-weight:650;font-size:14px">${escHtml(r.tournamentName)}</div><div style="font-size:12px;color:#5D5E72">${r.wins} victoire${r.wins > 1 ? "s" : ""}${r.champion ? " · Champion" : ""} · ${escHtml(r.status)}</div></div>
        <span style="font-weight:800;color:#22D3EE;font-size:14px">${r.points} pts</span></div>`).join("")
    : `<div style="color:#5D5E72;font-size:13.5px;padding:16px 0;text-align:center">Pas encore de résultats. Participe à un tournoi pour voir tes stats ici !</div>`;
  return card(secTitle(`Mes résultats (${results.length})`) + rows);
}

function profileEditor(S: State) {
  const me = S.me!;
  const inp = "width:100%;background:#1B1B27;border:1px solid #282838;border-radius:11px;color:#F4F5FB;font-family:inherit;font-size:14px;padding:11px 13px;margin-top:6px";
  const esc = (v: string | null | undefined) => (v || "").replace(/"/g, "&quot;");
  return `<div style="border:1px solid rgba(34,211,238,.3);border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px;margin-bottom:16px">
    <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;margin-bottom:12px">Mon profil</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px">
      <label style="font-size:12px;color:#8E8FA6;font-weight:600">Nom affiché<input id="p-name" value="${esc(me.displayName)}" style="${inp}" /></label>
      <label style="font-size:12px;color:#8E8FA6;font-weight:600">Ville<input id="p-city" value="${esc(me.city)}" placeholder="Lomé" style="${inp}" /></label>
      <label style="font-size:12px;color:#8E8FA6;font-weight:600">Jeu favori<input id="p-game" value="${esc(me.favoriteGame)}" placeholder="EA FC 26" style="${inp}" /></label>
    </div>
    <label style="font-size:12px;color:#8E8FA6;font-weight:600;display:block;margin-top:14px">Bio<textarea id="p-bio" rows="2" placeholder="Quelques mots sur toi…" style="${inp};resize:vertical">${(me.bio || "").replace(/</g, "&lt;")}</textarea></label>
    ${S.profileMsg ? `<div style="color:#FB7185;font-size:12.5px;margin-top:10px">${S.profileMsg}</div>` : ""}
    <div style="display:flex;gap:10px;margin-top:14px"><button data-profilesave="1" style="background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:11px;padding:11px 18px;font-weight:750;font-size:14px;cursor:pointer">Enregistrer</button><button data-profilecancel="1" style="background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer">Annuler</button></div>
  </div>`;
}

function regsCard(S: State) {
  const regs = S.myRegs ?? [];
  const rows = regs.length
    ? regs.map((r: Detail) => `<div data-open="${r.tournament.id}" style="display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid #22222F;cursor:pointer">
        <span style="display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:#1B1B27;border:1px solid #282838;color:#22D3EE;flex:none">${ic(I.crown, 15)}</span>
        <div style="min-width:0;flex:1"><div style="font-weight:650;font-size:14px">${r.tournament.name}</div><div style="font-size:12px;color:#5D5E72">${r.tournament.game}${r.tournament.date ? " · " + r.tournament.date : ""}${r.tournament.place ? " · " + r.tournament.place : ""}</div></div>
        <span style="font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:${r.tournament.live ? "#22D3EE" : r.tournament.status === "Terminé" ? "#FBBF24" : "#8E8FA6"}">${r.tournament.status}</span></div>`).join("")
    : `<div style="color:#5D5E72;font-size:13.5px;padding:16px 0;text-align:center">Aucune inscription pour l'instant.<br><button data-go="tournois" style="margin-top:10px;background:#1B1B27;border:1px solid #33334A;color:#22D3EE;border-radius:10px;padding:9px 14px;font-weight:700;font-size:13px;cursor:pointer">Parcourir les tournois</button></div>`;
  return card(secTitle(`Mes inscriptions (${regs.length})`) + rows);
}

function ordersCard(S: State) {
  const orders = S.myOrders ?? [];
  const rows = orders.length
    ? orders.map((o: Detail) => {
        const items = Array.isArray(o.items) ? o.items.map((i: Detail) => i.name).join(", ") : "";
        return `<div style="display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid #22222F">
        <span style="display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:#1B1B27;border:1px solid #282838;color:#7C82FF;flex:none">${ic(I.cart, 15)}</span>
        <div style="min-width:0;flex:1"><div style="font-weight:650;font-size:14px">${o.reference}</div><div style="font-size:12px;color:#5D5E72;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${items || o.paymentMethod}</div></div>
        <div style="text-align:right;flex:none"><div style="font-weight:800;color:#22D3EE;font-size:13.5px">${money(o.totalXof)}</div><div style="font-size:11px;color:${o.status === "pending" ? "#FBBF24" : "#34D399"};font-weight:700;text-transform:uppercase">${o.status === "pending" ? "En attente" : o.status}</div></div></div>`;
      }).join("")
    : `<div style="color:#5D5E72;font-size:13.5px;padding:16px 0;text-align:center">Aucune commande.<br><button data-go="boutique" style="margin-top:10px;background:#1B1B27;border:1px solid #33334A;color:#7C82FF;border-radius:10px;padding:9px 14px;font-weight:700;font-size:13px;cursor:pointer">Visiter la boutique</button></div>`;
  return card(secTitle(`Mes commandes (${orders.length})`) + rows);
}

/** Panneau organisateur/admin : inscriptions du tournoi (payées + en attente de confirmation). */
function paymentsPanel(S: State, tournamentId: string) {
  const regs = S.regsPanel;
  if (regs === null) return "";
  const pending = regs.filter((r: Detail) => r.paymentStatus === "pending");
  const paid = regs.filter((r: Detail) => r.paymentStatus === "paid" && r.amountXof > 0);
  if (!pending.length && !paid.length) return "";
  const row = (r: Detail, isPending: boolean) => `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid #22222F;flex-wrap:wrap">
    <div style="min-width:0;flex:1"><div style="font-weight:650;font-size:13.5px">${escHtml(r.playerName)}</div><div style="font-size:11.5px;color:#5D5E72">${escHtml(r.userDisplayName)} · ${escHtml(r.userEmail)}</div></div>
    <span style="font-weight:700;color:#F4F5FB;font-size:13px">${money(r.amountXof)}</span>
    <span style="font-size:11px;color:#8E8FA6">${escHtml(r.paymentMethod || "")}</span>
    ${isPending
      ? `<button data-confirmpay="${tournamentId}|${r.id}" style="font-size:12px;font-weight:750;border-radius:9px;padding:7px 13px;cursor:pointer;background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.4);color:#34D399">Confirmer</button>`
      : `<span style="font-size:10.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#34D399;background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.35);border-radius:99px;padding:4px 10px">Payé</span>`}
    </div>`;
  return `<div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px;margin-top:18px;text-align:left">
    <h3 style="margin:0 0 6px;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6;font-weight:750">Paiements des inscriptions${pending.length ? ` · ${pending.length} en attente` : ""}</h3>
    ${pending.map((r: Detail) => row(r, true)).join("")}${paid.map((r: Detail) => row(r, false)).join("")}</div>`;
}

function profileSecurity(S: State) {
  const inp = "width:100%;background:#1B1B27;border:1px solid #282838;border-radius:11px;color:#F4F5FB;font-family:inherit;font-size:14px;padding:11px 13px;margin-top:6px";
  const ok = S.passMsg === "Mot de passe modifié.";
  return card(secTitle("Sécurité · mot de passe") + `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;align-items:end">
      <label style="font-size:12px;color:#8E8FA6;font-weight:600">Mot de passe actuel<input id="pw-cur" type="password" placeholder="••••••" style="${inp}" /></label>
      <label style="font-size:12px;color:#8E8FA6;font-weight:600">Nouveau mot de passe<input id="pw-new" type="password" placeholder="6 caractères min." style="${inp}" /></label>
      <button data-passsave="1" style="background:#22222F;border:1px solid #33334A;color:#22D3EE;border-radius:11px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer">Changer</button>
    </div>
    ${S.passMsg ? `<div style="color:${ok ? "#34D399" : "#FB7185"};font-size:12.5px;margin-top:10px">${S.passMsg}</div>` : ""}`);
}

const ADMIN_TABS: [string, string][] = [
  ["apercu", "Aperçu"], ["site", "Site"], ["users", "Utilisateurs"], ["joueurs", "Joueurs"], ["news", "Actualités"], ["galerie", "Galerie"], ["produits", "Produits"], ["fidelite", "Fidélité"], ["paiements", "Paiements"], ["commandes", "Commandes"],
];
const escAttr = (v: string | null | undefined) => (v || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const escHtml = (v: string | null | undefined) => (v || "").replace(/</g, "&lt;");
const btnSm = (attr: string, label: string, color = "#8E8FA6", border = "#282838") =>
  `<button ${attr} style="font-size:11.5px;font-weight:700;border-radius:8px;padding:6px 10px;cursor:pointer;background:transparent;border:1px solid ${border};color:${color}">${label}</button>`;
const adminInp = "width:100%;background:#1B1B27;border:1px solid #282838;border-radius:11px;color:#F4F5FB;font-family:inherit;font-size:14px;padding:11px 13px;margin-top:6px";

/** Barre de recherche (validation par Entrée) réutilisée dans les listes admin. */
function adminSearchBar(S: State, placeholder: string) {
  const q = S.adminSearch;
  return `<div style="margin-bottom:14px">
    <div style="position:relative;max-width:340px">
      <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#5D5E72;pointer-events:none">${ic(I.search, 15)}</span>
      <input id="adm-search" value="${escAttr(q)}" placeholder="${placeholder}" style="width:100%;background:#1B1B27;border:1px solid #282838;border-radius:10px;color:#F4F5FB;font-family:inherit;font-size:13px;padding:9px 12px 9px 34px" />
    </div>
    ${q ? `<div style="margin-top:8px"><span style="display:inline-flex;align-items:center;gap:7px;font-size:12px;color:#8E8FA6;background:#14141D;border:1px solid #282838;border-radius:999px;padding:6px 11px">Recherche : <b style="color:#F4F5FB">${escHtml(q)}</b><button data-admsearchclear="1" style="display:grid;place-items:center;width:18px;height:18px;background:transparent;border:0;color:#8E8FA6;cursor:pointer">${ic(I.x, 12)}</button></span></div>` : ""}
  </div>`;
}

/** Enveloppe défilante : évite qu'une longue liste ne pousse toute la page. */
const scrollBox = (inner: string, max = 480) => `<div style="max-height:${max}px;overflow-y:auto;padding-right:4px">${inner}</div>`;

/** Jeu d'onglets réduit pour ORGANIZER (pas d'accès aux réglages site/utilisateurs/joueurs/actus/galerie/produits — réservés à ADMIN). */
const ORG_TABS: [string, string][] = [["apercu", "Tableau de bord"], ["compte", "Mon compte"]];
/** Icônes de la sidebar console par clé d'onglet — réutilise l'objet I déjà défini (aucune nouvelle icône). */
const CONSOLE_TAB_ICON: Record<string, string> = {
  apercu: I.bolt, site: I.edit, users: I.user, joueurs: I.crown, news: I.flame, galerie: I.image,
  produits: I.cart, fidelite: I.medal, paiements: I.warn, commandes: I.cart, compte: I.user,
};

/** Tuiles KPI + table des tournois + « à traiter » (onglet "apercu") — données déjà chargées, aucune requête supplémentaire.
 * Pas de métrique inventée : uniquement ce que S.admin.overview / S.tourns / S.myTourns fournissent réellement. */
function consoleOverview(S: State) {
  const isAdmin = S.user?.role === "ADMIN";
  const tourns: TournCard[] = ((isAdmin ? S.tourns : S.myTourns) ?? []) as TournCard[];
  const kpiStat = (v: number | string, k: string, color = "#F4F5FB") => `<div style="background:#14141D;padding:16px 18px"><div style="font-family:'JetBrains Mono',monospace;font-size:28px;font-weight:600;color:${color}">${v}</div><div style="font-size:10.5px;letter-spacing:1.1px;text-transform:uppercase;color:#8E8FA6;font-weight:750;margin-top:6px">${k}</div></div>`;
  const ov = S.admin?.overview;
  const kpis = isAdmin
    ? (ov ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:1px;background:#1B1B27;border:1px solid #1B1B27;border-radius:12px;overflow:hidden;margin-bottom:20px">${kpiStat(ov.tournaments, "Tournois", "#22D3EE")}${kpiStat(ov.users, "Utilisateurs", "#7C82FF")}${kpiStat(ov.pendingPayments ?? 0, "Paiements en attente", (ov.pendingPayments ?? 0) > 0 ? "#FBBF24" : "#F4F5FB")}${kpiStat(ov.orders, "Commandes")}${kpiStat(ov.products, "Produits")}</div>` : "")
    : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:1px;background:#1B1B27;border:1px solid #1B1B27;border-radius:12px;overflow:hidden;margin-bottom:20px">${kpiStat(tourns.length, "Mes tournois", "#22D3EE")}${kpiStat((S.myRegs ?? []).length, "Mes inscriptions", "#7C82FF")}${kpiStat((S.myOrders ?? []).length, "Commandes")}${kpiStat(tourns.filter((t) => t.live).length, "En direct", "#FBBF24")}</div>`;

  const tableRows = tourns.length ? tourns.map((t) => `
    <tr data-open="${t.id}" style="border-top:1px solid #1B1B27;cursor:pointer">
      <td style="padding:12px 18px"><div style="font-weight:650">${escHtml(t.name)}</div><div style="font-size:11px;color:#5D5E72">${escHtml(t.date)}${t.place ? " · " + escHtml(t.place) : ""}</div></td>
      <td style="padding:12px;color:#8E8FA6">${escHtml(t.game)} · ${escHtml(t.format)}</td>
      <td style="padding:12px;text-align:right;font-family:'JetBrains Mono',monospace">${t.players}</td>
      <td style="padding:12px;text-align:right;font-family:'JetBrains Mono',monospace;color:#FBBF24">${t.cagnotte}</td>
      <td style="padding:12px 18px;text-align:right">${t.live
        ? `<span style="display:inline-flex;align-items:center;gap:6px;font-size:10.5px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:#04222a;background:#22D3EE;border-radius:99px;padding:4px 10px"><span style="width:5px;height:5px;border-radius:50%;background:#04222a;animation:blink 1.2s infinite"></span>Live</span>`
        : `<span style="font-size:10.5px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:#8E8FA6;border:1px solid #33334A;border-radius:99px;padding:4px 10px">${escHtml(t.status)}</span>`}</td>
    </tr>`).join("") : `<tr><td colspan="5" style="padding:26px;text-align:center;color:#5D5E72">${isAdmin ? "Aucun tournoi pour l'instant." : "Tu n'as pas encore créé de tournoi."}</td></tr>`;
  const table = `<div style="border:1px solid #282838;border-radius:12px;background:#14141D;overflow:hidden;margin-bottom:20px">
    <div style="padding:13px 18px;border-bottom:1px solid #1B1B27;font-size:11px;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6;font-weight:750">${isAdmin ? "Tournois" : "Mes tournois"} (${tourns.length})</div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13.5px;min-width:560px"><thead><tr style="color:#5D5E72;font-size:10px;text-transform:uppercase;letter-spacing:1.1px">
      <th style="text-align:left;padding:10px 18px;font-weight:750">Tournoi</th><th style="text-align:left;padding:10px 12px;font-weight:750">Jeu / Format</th><th style="text-align:right;padding:10px 12px;font-weight:750">Joueurs</th><th style="text-align:right;padding:10px 12px;font-weight:750">Cagnotte</th><th style="text-align:right;padding:10px 18px;font-weight:750">Statut</th>
    </tr></thead><tbody>${tableRows}</tbody></table></div></div>`;

  const pending = ov?.pendingPayments ?? 0;
  const todo = isAdmin && pending > 0 ? `<div style="border:1px solid #282838;border-radius:12px;background:#14141D;overflow:hidden">
    <div style="padding:13px 18px;border-bottom:1px solid #1B1B27;font-size:11px;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6;font-weight:750">À traiter</div>
    <div data-admintab="paiements" style="display:flex;align-items:center;gap:12px;padding:13px 18px;cursor:pointer">
      <span style="display:grid;place-items:center;width:30px;height:30px;border-radius:8px;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.35);color:#FBBF24;flex:none">${ic(I.warn, 15)}</span>
      <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:650">${pending} paiement${pending > 1 ? "s" : ""} à confirmer</div></div>
      <span style="border:1px solid rgba(251,191,36,.4);border-radius:7px;padding:6px 11px;font-size:11.5px;font-weight:700;color:#FBBF24">Voir</span>
    </div></div>` : "";

  return kpis + table + todo;
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
    <div style="font-size:11.5px;color:#8E8FA6;margin-top:5px">${escHtml(live.game)}${live.place ? " · " + escHtml(live.place) : ""}</div>
    <div style="margin-top:11px;border-radius:9px;background:#22D3EE;color:#04222a;padding:9px;text-align:center;font-size:12.5px;font-weight:750">Ouvrir la régie</div>
  </div>`;
}

/** Shell console (sidebar + zone de contenu) pour ADMIN/ORGANIZER sur « Mon espace » — remplace le header/nav public sur cette page. */
function consoleShell(S: State, tabs: [string, string][], title: string, body: string) {
  const u = S.user!;
  const rc = ROLE_COLOR[u.role] || "#22D3EE";
  const nav = tabs.map(([k, label]) => {
    const on = S.adminTab === k;
    return `<button data-admintab="${k}" style="display:flex;align-items:center;gap:11px;width:100%;text-align:left;padding:10px 16px;margin:0 8px;border-radius:9px;border:0;background:${on ? "rgba(34,211,238,.1)" : "transparent"};color:${on ? "#F4F5FB" : "#8E8FA6"};font-weight:${on ? 700 : 600};font-size:13.5px;cursor:pointer">${ic(CONSOLE_TAB_ICON[k] || I.bolt, 17)}${label}</button>`;
  }).join("");
  return `<div style="min-height:100vh;display:flex" class="console-shell">
    <div class="console-backdrop${S.consoleMenuOpen ? " console-backdrop-open" : ""}" data-consolemenu=""></div>
    <div class="console-sidebar${S.consoleMenuOpen ? " console-sidebar-open" : ""}" style="width:250px;flex:none;border-right:1px solid #1B1B27;background:#0E0E16;display:flex;flex-direction:column;padding:16px 0">
      <div data-go="accueil" style="display:flex;align-items:center;gap:10px;padding:0 16px 18px;border-bottom:1px solid #1B1B27;cursor:pointer">
        ${brandLogo(S, 34, 19)}
        <span style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:1.4px">${escHtml(S.site?.brand?.name1 ?? "VLOME")} <span style="color:#22D3EE">${escHtml(S.site?.brand?.name2 ?? "ESPORT")}</span></span>
      </div>
      ${consolePinnedLive(S)}
      <div style="padding:8px 12px 6px;font-size:10px;letter-spacing:1.4px;text-transform:uppercase;color:#3d3d55;font-weight:800">Console</div>
      ${nav}
      <div style="flex:1"></div>
      <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-top:1px solid #1B1B27;margin-top:12px">
        <span style="display:grid;place-items:center;width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,#22D3EE,#7C82FF);color:#04222a;font-weight:800;font-size:14px;flex:none">${(u.displayName || "?").charAt(0).toUpperCase()}</span>
        <div style="min-width:0;flex:1"><div style="font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(u.displayName)}</div><div style="font-size:10.5px;color:${rc};font-weight:700;letter-spacing:.4px;text-transform:uppercase">${ROLE_LABEL[u.role] || u.role}</div></div>
        <button data-logout="1" title="Déconnexion" style="display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:transparent;border:0;color:#8E8FA6;cursor:pointer;flex:none">${ic(I.logout, 15)}</button>
      </div>
    </div>
    <div style="flex:1;min-width:0;display:flex;flex-direction:column">
      <div class="console-mobile-top" style="align-items:center;gap:12px;padding:13px 16px;border-bottom:1px solid #1B1B27">
        <button data-consolemenu="1" title="Menu" style="display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;cursor:pointer;flex:none">${ic(I.menu, 17)}</button>
        <span style="font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:1px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${title}</span>
      </div>
      <div style="display:flex;align-items:center;gap:16px;padding:16px 28px;border-bottom:1px solid #1B1B27;flex-wrap:wrap">
        <h1 class="console-desktop-title" style="font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:1.2px;margin:0;line-height:1">${title}</h1>
        <span style="flex:1"></span>
        <div style="position:relative;min-width:220px">
          <span style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:#5D5E72;pointer-events:none">${ic(I.search, 15)}</span>
          <input id="hsearch" value="${escAttr(S.q)}" placeholder="Tournoi, jeu… (Entrée)" style="width:100%;background:#14141D;border:1px solid #282838;border-radius:9px;color:#F4F5FB;font-family:inherit;font-size:13px;padding:9px 12px 9px 34px" />
        </div>
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
  if (isAdmin) {
    const a = S.admin;
    body = !a ? `<div style="color:#8E8FA6;text-align:center;padding:40px 0">Chargement…</div>` :
      S.adminTab === "site" ? adminSite(S) :
      S.adminTab === "users" ? adminUsers(S) :
      S.adminTab === "joueurs" ? adminRoster(S) :
      S.adminTab === "news" ? adminNews(S) :
      S.adminTab === "galerie" ? adminGallery(S) :
      S.adminTab === "produits" ? adminProducts(S) :
      S.adminTab === "fidelite" ? adminLoyalty(S) :
      S.adminTab === "paiements" ? adminPayments(S) :
      S.adminTab === "commandes" ? adminOrders(a) :
      consoleOverview(S);
  } else {
    body = S.adminTab === "compte"
      ? grid2(regsCard(S), resultsCard(S)) + grid2(ordersCard(S), profileSecurity(S)) + loyaltyCard(S)
      : consoleOverview(S);
  }
  const editor = S.profileEdit ? profileEditor(S) : "";
  const shell = consoleShell(S, tabs, activeLabel, editor + body);
  return shell + (S.creating ? tournamentWizard(S) : "") + cartDrawer(S) + confirmModal(S);
}

/** Onglet Site : identité (logo/nom), héro, slider « À la une », partenaires. */
function adminSite(S: State) {
  const site = S.site;
  if (!site) return card(`<div style="color:#8E8FA6;text-align:center;padding:20px">Chargement des réglages…</div>`);
  const b = site.brand || {};
  const hz = site.hero || {};
  const stats: Detail[] = hz.stats?.length ? hz.stats : [{ v: "", k: "" }, { v: "", k: "" }, { v: "", k: "" }];
  const slides = S.slidesEdit ?? [];
  const partners = S.partnersEdit ?? [];
  const ads = S.adsEdit ?? [];
  const lbl = "font-size:12px;color:#8E8FA6;font-weight:600";
  const sec = (title: string, inner: string) => `<div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px;margin-bottom:16px">${secTitle(title)}${inner}</div>`;

  const identite = sec("Identité · logo & nom du site", `
    <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
      <div style="flex:1;min-width:220px"><div style="${lbl}">Logo (image carrée conseillée)</div>${filePicker("b-logo", "Choisir le logo", "image/*", b.logoUrl)}</div>
      <label style="${lbl}">Nom (partie 1)<input id="b-name1" value="${escAttr(b.name1 ?? "VLOME")}" style="${adminInp}" /></label>
      <label style="${lbl}">Nom (partie 2, en couleur)<input id="b-name2" value="${escAttr(b.name2 ?? "ESPORT")}" style="${adminInp}" /></label>
    </div>`);

  const heroSec = sec("Accueil · section principale (héro)", `
    <label style="${lbl};display:block">Sur-titre<input id="h-kicker" value="${escAttr(hz.kicker)}" style="${adminInp}" /></label>
    <label style="${lbl};display:block;margin-top:12px">Grand titre (une ligne par retour à la ligne)<textarea id="h-title" rows="2" style="${adminInp};resize:vertical">${escHtml(hz.title)}</textarea></label>
    <label style="${lbl};display:block;margin-top:12px">Texte de présentation<textarea id="h-sub" rows="3" style="${adminInp};resize:vertical">${escHtml(hz.subtitle)}</textarea></label>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-top:12px">
      ${[0, 1, 2].map((i) => `<div style="border:1px solid #22222F;border-radius:12px;padding:12px"><div style="${lbl};margin-bottom:4px">Statistique ${i + 1}</div><input id="h-s${i}v" value="${escAttr(stats[i]?.v)}" placeholder="2 400+" style="${adminInp}" /><input id="h-s${i}k" value="${escAttr(stats[i]?.k)}" placeholder="Joueurs" style="${adminInp}" /></div>`).join("")}
    </div>
    <div style="display:flex;align-items:center;gap:14px;margin-top:14px;flex-wrap:wrap">
      <div style="flex:1;min-width:240px"><div style="${lbl}">Fond du héro : image ou vidéo (mp4/webm, 20 Mo max) — halos animés par défaut</div>${filePicker("h-bg", "Choisir le fond", "image/*,video/mp4,video/webm", hz.bgUrl)}</div>
      ${hz.bgUrl ? `<button data-herobgclear="1" style="font-size:12px;font-weight:700;border-radius:9px;padding:8px 12px;cursor:pointer;background:transparent;border:1px solid #33334A;color:#8E8FA6">Retirer le fond</button>` : ""}
    </div>`);

  const slidesSec = sec("Accueil · « À la une » (slider)", `
    ${slides.map((sl, i) => `
    <div style="border:1px solid #22222F;border-radius:12px;padding:14px;margin-bottom:12px">
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
    ${slides.length ? "" : `<div style="color:#5D5E72;font-size:13px;padding:8px 0 14px">Aucune diapo pour l'instant.</div>`}
    <button data-sladd="1" style="display:inline-flex;align-items:center;gap:7px;background:#1B1B27;border:1px dashed #33334A;color:#22D3EE;border-radius:10px;padding:9px 15px;font-weight:700;font-size:13px;cursor:pointer">${ic(I.plus, 15)}Ajouter une diapo</button>`);

  const partnersSec = sec("Partenaires & sponsors <span style=\"color:#5D5E72;text-transform:none;letter-spacing:0;font-weight:500\">— bandeau permanent affiché sur toutes les pages, logo optionnel</span>", `
    ${partners.map((p) => `
    <div style="border:1px solid #22222F;border-radius:12px;padding:12px;margin-bottom:10px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <label style="${lbl};flex:1;min-width:180px">Nom du partenaire<input id="pt-${p.key}-name" value="${escAttr(p.name)}" placeholder="Nom du sponsor" style="${adminInp}" /></label>
      <div style="flex:1;min-width:220px"><div style="${lbl}">Logo (optionnel)</div>${filePicker(`pt-${p.key}-logo`, "Choisir le logo", "image/*", p.logoUrl)}</div>
      <button data-ptdel="${p.key}" style="align-self:flex-end;display:grid;place-items:center;width:38px;height:38px;border-radius:10px;background:transparent;border:1px solid rgba(251,113,133,.35);color:#FB7185;cursor:pointer;flex:none">${ic(I.trash, 15)}</button>
    </div>`).join("")}
    ${partners.length ? "" : `<div style="color:#5D5E72;font-size:13px;padding:8px 0 14px">Aucun partenaire pour l'instant.</div>`}
    <button data-ptadd="1" style="display:inline-flex;align-items:center;gap:7px;background:#1B1B27;border:1px dashed #33334A;color:#22D3EE;border-radius:10px;padding:9px 15px;font-weight:700;font-size:13px;cursor:pointer">${ic(I.plus, 15)}Ajouter un partenaire</button>`);

  const AD_PAGES: [string, string][] = [["accueil", "Accueil"], ["tournois", "Page Tournois"], ["toutes", "Toutes les pages"]];
  const adsSec = sec("Emplacements publicitaires <span style=\"color:#5D5E72;text-transform:none;letter-spacing:0;font-weight:500\">— plusieurs annonces sur une même page tournent en carrousel</span>", `
    ${ads.map((ad) => `
    <div style="border:1px solid #22222F;border-radius:12px;padding:14px;margin-bottom:10px">
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
    ${ads.length ? "" : `<div style="color:#5D5E72;font-size:13px;padding:8px 0 14px">Aucune publicité pour l'instant.</div>`}
    <button data-adnew="1" style="display:inline-flex;align-items:center;gap:7px;background:#1B1B27;border:1px dashed #33334A;color:#7C82FF;border-radius:10px;padding:9px 15px;font-weight:700;font-size:13px;cursor:pointer">${ic(I.plus, 15)}Ajouter une publicité</button>`);

  const ok = S.siteMsg === "Réglages enregistrés.";
  const saveBar = `<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
    <button data-sitesave="1" style="background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:13px 24px;font-weight:750;font-size:15px;cursor:pointer;box-shadow:0 0 30px rgba(34,211,238,.22)">Enregistrer les réglages</button>
    ${S.siteMsg ? `<span style="color:${ok ? "#34D399" : "#FB7185"};font-size:13px;font-weight:700">${S.siteMsg}</span>` : ""}
  </div>`;

  return identite + heroSec + slidesSec + partnersSec + adsSec + saveBar;
}

function adminOverview(a: NonNullable<State["admin"]>) {
  const ov = a.overview;
  const stat = (v: number, k: string, color = "#F4F5FB") => `<div style="border:1px solid #282838;border-radius:14px;background:#14141D;padding:16px"><div style="font-family:'Bebas Neue',sans-serif;font-size:32px;line-height:1;color:${color}">${v}</div><div style="font-size:11px;letter-spacing:.8px;text-transform:uppercase;color:#8E8FA6;font-weight:700;margin-top:6px">${k}</div></div>`;
  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:14px;margin-bottom:20px">
    ${stat(ov.users, "Utilisateurs", "#22D3EE")}${stat(ov.organizers, "Organisateurs", "#7C82FF")}${stat(ov.admins, "Admins", "#FBBF24")}${stat(ov.tournaments, "Tournois")}${stat(ov.news ?? 0, "Articles", "#34D399")}${stat(ov.gallery ?? 0, "Photos/vidéos", "#7C82FF")}${stat(ov.products, "Produits")}${stat(ov.pendingPayments ?? 0, "Paiements en attente", (ov.pendingPayments ?? 0) > 0 ? "#FBBF24" : "#F4F5FB")}${stat(ov.orders, "Commandes")}</div>`;
}

function adminUsers(S: State) {
  const a = S.admin!;
  const q = S.adminSearch.trim().toLowerCase();
  const users = q ? a.users.filter((u: Detail) => `${u.displayName} ${u.email}`.toLowerCase().includes(q)) : a.users;
  const roleBtn = (uid: string, role: string, cur: string) => { const on = cur === role; return `<button data-setrole="${uid}|${role}" style="font-size:11.5px;font-weight:700;border-radius:8px;padding:6px 10px;cursor:pointer;background:${on ? ROLE_COLOR[role] + "18" : "transparent"};border:1px solid ${on ? ROLE_COLOR[role] : "#282838"};color:${on ? ROLE_COLOR[role] : "#8E8FA6"}">${ROLE_LABEL[role]}</button>`; };
  const rows = users.length ? users.map((usr: Detail) => `<tr style="border-top:1px solid #22222F">
    <td style="padding:10px 8px"><div style="display:flex;align-items:center;gap:10px"><span style="display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:#22222F;border:1px solid #282838;font-size:12px;font-weight:800;color:#8E8FA6">${(usr.displayName || "?").charAt(0).toUpperCase()}</span><div><div style="font-weight:650">${escHtml(usr.displayName)}</div><div style="font-size:11.5px;color:#5D5E72">${escHtml(usr.email)}</div></div></div></td>
    <td style="padding:10px 8px;text-align:right"><div style="display:inline-flex;gap:6px">${roleBtn(usr.id, "PLAYER", usr.role)}${roleBtn(usr.id, "ORGANIZER", usr.role)}${roleBtn(usr.id, "ADMIN", usr.role)}</div></td></tr>`).join("")
    : `<tr><td colspan="2" style="color:#5D5E72;font-size:13.5px;padding:16px 0;text-align:center">Aucun utilisateur trouvé.</td></tr>`;
  return card(`${secTitle(`Utilisateurs · rôles (${a.users.length})`)}${adminSearchBar(S, "Nom ou email…")}
    ${scrollBox(`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px;min-width:480px"><tbody>${rows}</tbody></table></div>`)}`);
}

/** Onglet Joueurs : base de joueurs (roster) + clubs, gérée depuis l'admin — sert aussi à pré-remplir les participants à la création d'un tournoi. */
function adminRoster(S: State) {
  const tabBtn = (k: "joueurs" | "clubs", label: string) => `<button data-rostertab="${k}" style="font-size:12.5px;font-weight:700;border-radius:999px;padding:8px 15px;cursor:pointer;background:${S.rosterTab === k ? "rgba(34,211,238,.1)" : "#14141D"};border:1px solid ${S.rosterTab === k ? "#22D3EE" : "#282838"};color:${S.rosterTab === k ? "#22D3EE" : "#8E8FA6"}">${label}</button>`;
  const tabs = `<div style="display:flex;gap:8px;margin-bottom:16px">${tabBtn("joueurs", `${ic(I.user, 14)} Joueurs`)}${tabBtn("clubs", `${ic(I.image, 14)} Clubs`)}</div>`;
  return tabs + (S.rosterTab === "clubs" ? adminClubsView(S) : adminRosterPlayers(S));
}

function adminRosterPlayers(S: State) {
  const roster: Detail[] = S.roster ?? [];
  const clubs: Detail[] = S.clubs ?? [];
  const e = S.rosterEdit;
  const editor = e ? `<div style="border:1px solid rgba(34,211,238,.3);border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px;margin-bottom:16px">
    <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;margin-bottom:12px">${e.id ? "Modifier le joueur" : "Ajouter un joueur"}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px">
      <label style="font-size:12px;color:#8E8FA6;font-weight:600">Nom<input id="ro-name" value="${escAttr(e.name)}" placeholder="Nom du joueur" style="${adminInp}" /></label>
      <label style="font-size:12px;color:#8E8FA6;font-weight:600">Ville<input id="ro-city" value="${escAttr(e.city)}" placeholder="Lomé, Kara…" style="${adminInp}" /></label>
      <label style="font-size:12px;color:#8E8FA6;font-weight:600">Club<select id="ro-club" style="${adminInp}"><option value="">— Sans club —</option>${clubs.map((c: Detail) => `<option value="${c.id}" ${e.clubId === c.id ? "selected" : ""}>${escAttr(c.name)}</option>`).join("")}</select></label>
    </div>
    <div style="display:flex;gap:10px;margin-top:14px"><button data-rostersave="${e.id || "new"}" style="background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:11px;padding:11px 18px;font-weight:750;font-size:14px;cursor:pointer">${e.id ? "Enregistrer" : "Ajouter"}</button><button data-rostercancel="1" style="background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer">Annuler</button></div>
  </div>` : "";
  const q = S.adminSearch.trim().toLowerCase();
  const filtered = q ? roster.filter((p: Detail) => `${p.name} ${p.clubName || ""} ${p.city || ""}`.toLowerCase().includes(q)) : roster;
  const rows = filtered.length ? filtered.map((p: Detail) => `<div style="display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid #22222F;flex-wrap:wrap">
      <span style="display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:#22222F;border:1px solid #282838;font-size:13px;font-weight:800;color:#8E8FA6;flex:none">${(p.name || "?").charAt(0).toUpperCase()}</span>
      <div style="min-width:0;flex:1"><div style="font-weight:650;font-size:14px">${escHtml(p.name)}</div><div style="font-size:11.5px;color:#5D5E72">${[p.city, p.clubName].filter(Boolean).map(escHtml).join(" · ") || "—"}</div></div>
      <span style="font-size:11px;color:#22D3EE;font-weight:700">${ic(I.bolt, 11)} ${p.elo}</span>
      <div style="display:inline-flex;gap:6px">${btnSm(`data-rosteredit="${p.id}"`, "Modifier", "#22D3EE", "#22D3EE55")}${btnSm(`data-rosterdel="${p.id}"`, "Retirer", "#FB7185", "rgba(251,113,133,.35)")}</div></div>`).join("")
    : `<div style="color:#5D5E72;font-size:13.5px;padding:16px 0;text-align:center">${q ? "Aucun joueur trouvé." : "Base vide. Ajoute des joueurs ici, ou crée un tournoi — pense à les y ajouter aussi."}</div>`;
  const head = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px">${secTitle(`Base de joueurs (${roster.length})`)}<button data-rosteredit="new" style="display:inline-flex;align-items:center;gap:7px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:11px;padding:10px 16px;font-weight:750;font-size:13.5px;cursor:pointer">${ic(I.plus, 15)}Ajouter un joueur</button></div>`;
  return editor + `<div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px">${head}${adminSearchBar(S, "Nom, ville ou club…")}${scrollBox(rows)}<p style="color:#5D5E72;font-size:11.5px;margin-top:12px">Ces joueurs sont proposés à la création d'un tournoi (« Depuis la base de joueurs »).</p></div>`;
}

function adminClubsView(S: State) {
  const clubs: Detail[] = S.clubs ?? [];
  const e = S.clubEdit;
  const editor = e ? `<div style="border:1px solid rgba(124,130,255,.35);border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px;margin-bottom:16px">
    <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;margin-bottom:12px">${e.id ? "Modifier le club" : "Nouveau club"}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px">
      <label style="font-size:12px;color:#8E8FA6;font-weight:600">Nom<input id="cl-name" value="${escAttr(e.name)}" placeholder="Team Mawu" style="${adminInp}" /></label>
      <label style="font-size:12px;color:#8E8FA6;font-weight:600">Ville<input id="cl-city" value="${escAttr(e.city)}" placeholder="Lomé" style="${adminInp}" /></label>
    </div>
    <div style="margin-top:14px"><div style="font-size:12px;color:#8E8FA6;font-weight:600;margin-bottom:2px">Logo du club (optionnel)</div>${filePicker("cl-logo", "Choisir le logo", "image/*", e.logoUrl)}</div>
    <div style="display:flex;gap:10px;margin-top:14px"><button data-clubsave="${e.id || "new"}" style="background:linear-gradient(135deg,#7C82FF,#5a60e0);color:#fff;border:0;border-radius:11px;padding:11px 18px;font-weight:750;font-size:14px;cursor:pointer">${e.id ? "Enregistrer" : "Créer le club"}</button><button data-clubcancel="1" style="background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer">Annuler</button></div>
  </div>` : "";
  const q = S.adminSearch.trim().toLowerCase();
  const filtered = q ? clubs.filter((c: Detail) => `${c.name} ${c.city || ""}`.toLowerCase().includes(q)) : clubs;
  const clubAvatar = (c: Detail) => c.logoUrl
    ? `<span style="display:grid;place-items:center;width:36px;height:36px;border-radius:10px;overflow:hidden;flex:none;background:url('${mediaUrl(c.logoUrl)}') center/cover;border:1px solid #282838"></span>`
    : `<span style="display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:#22222F;border:1px solid #282838;color:#7C82FF;flex:none">${ic(I.image, 16)}</span>`;
  const rows = filtered.length ? filtered.map((c: Detail) => `<div style="display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid #22222F;flex-wrap:wrap">
      ${clubAvatar(c)}
      <div style="min-width:0;flex:1"><div style="font-weight:650;font-size:14px">${escHtml(c.name)}</div><div style="font-size:11.5px;color:#5D5E72">${escHtml(c.city) || "—"}</div></div>
      <span style="font-size:12px;color:#8E8FA6">${c.playerCount} joueur${c.playerCount > 1 ? "s" : ""}</span>
      <div style="display:inline-flex;gap:6px">${btnSm(`data-clubedit="${c.id}"`, "Modifier", "#7C82FF", "#7C82FF55")}${btnSm(`data-clubdel="${c.id}"`, "Supprimer", "#FB7185", "rgba(251,113,133,.35)")}</div></div>`).join("")
    : `<div style="color:#5D5E72;font-size:13.5px;padding:16px 0;text-align:center">${q ? "Aucun club trouvé." : "Aucun club. Crée le premier !"}</div>`;
  const head = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px">${secTitle(`Clubs (${clubs.length})`)}<button data-clubedit="new" style="display:inline-flex;align-items:center;gap:7px;background:linear-gradient(135deg,#7C82FF,#5a60e0);color:#fff;border:0;border-radius:11px;padding:10px 16px;font-weight:750;font-size:13.5px;cursor:pointer">${ic(I.plus, 15)}Nouveau club</button></div>`;
  return editor + `<div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px">${head}${adminSearchBar(S, "Nom ou ville…")}${scrollBox(rows)}</div>`;
}

function adminNews(S: State) {
  const a = S.admin!;
  const e = S.newsEdit;
  const editor = e ? `<div style="border:1px solid rgba(34,211,238,.3);border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px;margin-bottom:16px">
    <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;margin-bottom:12px">${e.id ? "Modifier l'article" : "Nouvel article"}</div>
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:14px" class="grid2b">
      <label style="font-size:12px;color:#8E8FA6;font-weight:600">Titre<input id="n-title" value="${escAttr(e.title)}" placeholder="Titre de l'article" style="${adminInp}" /></label>
      <label style="font-size:12px;color:#8E8FA6;font-weight:600">Catégorie<input id="n-cat" value="${escAttr(e.category)}" placeholder="Esport Togo, EA FC…" style="${adminInp}" /></label>
    </div>
    <label style="font-size:12px;color:#8E8FA6;font-weight:600;display:block;margin-top:14px">Contenu<textarea id="n-body" rows="4" placeholder="Texte de l'article…" style="${adminInp};resize:vertical">${escHtml(e.body)}</textarea></label>
    <div style="margin-top:14px"><div style="font-size:12px;color:#8E8FA6;font-weight:600">Image de l'article (jpg, png, webp — 3 Mo max)</div>${filePicker("n-img", "Choisir une image", "image/*", e.imageUrl)}</div>
    <div style="display:flex;gap:10px;margin-top:14px"><button data-newssave="${e.id || "new"}" style="background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:11px;padding:11px 18px;font-weight:750;font-size:14px;cursor:pointer">${e.id ? "Enregistrer" : "Publier l'article"}</button><button data-newscancel="1" style="background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer">Annuler</button></div>
  </div>` : "";
  const q = S.adminSearch.trim().toLowerCase();
  const news = q ? a.news.filter((n: Detail) => `${n.title} ${n.category}`.toLowerCase().includes(q)) : a.news;
  const rows = news.length ? news.map((n: Detail) => `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid #22222F;flex-wrap:wrap">
      ${n.imageUrl ? `<img src="${mediaUrl(n.imageUrl)}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:10px;border:1px solid #282838;flex:none" />` : `<span style="display:grid;place-items:center;width:44px;height:44px;border-radius:10px;background:#1B1B27;border:1px solid #282838;color:#5D5E72;flex:none">${ic(I.image, 17)}</span>`}
      <div style="min-width:0;flex:1"><div style="font-weight:650;font-size:14px">${escHtml(n.title)}</div><div style="font-size:12px;color:#5D5E72">${escHtml(n.category)} · ${new Date(n.createdAt).toLocaleDateString("fr-FR")}</div></div>
      <span style="font-size:10.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:${n.published ? "#34D399" : "#8E8FA6"};background:${n.published ? "rgba(52,211,153,.08)" : "#14141D"};border:1px solid ${n.published ? "rgba(52,211,153,.4)" : "#282838"};border-radius:99px;padding:4px 10px">${n.published ? "Publié" : "Brouillon"}</span>
      <div style="display:inline-flex;gap:6px">${btnSm(`data-newspub="${n.id}|${n.published ? 0 : 1}"`, n.published ? "Masquer" : "Publier", n.published ? "#8E8FA6" : "#34D399", n.published ? "#282838" : "rgba(52,211,153,.4)")}${btnSm(`data-newsedit="${n.id}"`, "Modifier", "#22D3EE", "#22D3EE55")}${btnSm(`data-newsdel="${n.id}"`, "Supprimer", "#FB7185", "rgba(251,113,133,.35)")}</div></div>`).join("")
    : `<div style="color:#5D5E72;font-size:13.5px;padding:16px 0;text-align:center">${q ? "Aucun article trouvé." : "Aucun article. Crée le premier !"}</div>`;
  const head = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px">${secTitle(`Actualités (${a.news.length})`)}<button data-newsnew="1" style="display:inline-flex;align-items:center;gap:7px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:11px;padding:10px 16px;font-weight:750;font-size:13.5px;cursor:pointer">${ic(I.plus, 15)}Nouvel article</button></div>`;
  return editor + `<div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px">${head}${adminSearchBar(S, "Titre ou catégorie…")}${scrollBox(rows)}</div>`;
}

function adminGallery(S: State) {
  const items = S.gallery ?? [];
  const tourns = S.tourns ?? [];
  const editing = S.galleryEdit;
  const editor = editing ? `<div style="border:1px solid rgba(124,130,255,.35);border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px;margin-bottom:16px">
    <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;margin-bottom:12px">Ajouter à la galerie</div>
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:14px" class="grid2b">
      <label style="font-size:12px;color:#8E8FA6;font-weight:600">Titre<input id="ga-title" placeholder="Finale Survival Cup — remise des prix" style="${adminInp}" /></label>
      <label style="font-size:12px;color:#8E8FA6;font-weight:600">Tournoi lié (optionnel)<select id="ga-tourn" style="${adminInp}"><option value="">—</option>${tourns.map((t) => `<option value="${t.id}">${escAttr(t.name)}</option>`).join("")}</select></label>
    </div>
    <div style="margin-top:14px"><div style="font-size:12px;color:#8E8FA6;font-weight:600">Photo ou vidéo (jpg, png, webp, mp4, webm — 20 Mo max)</div>${filePicker("ga-file", "Choisir le fichier", "image/*,video/mp4,video/webm")}</div>
    <div style="display:flex;gap:10px;margin-top:14px"><button data-gallerysave="1" style="background:linear-gradient(135deg,#7C82FF,#5a60e0);color:#fff;border:0;border-radius:11px;padding:11px 18px;font-weight:750;font-size:14px;cursor:pointer">Ajouter</button><button data-gallerycancel="1" style="background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer">Annuler</button></div>
  </div>` : "";
  const q = S.adminSearch.trim().toLowerCase();
  const filtered = q ? items.filter((it: Detail) => `${it.title} ${it.tournament?.name ?? ""}`.toLowerCase().includes(q)) : items;
  const grid = filtered.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px">${filtered.map((it: Detail) => `<div style="border:1px solid #282838;border-radius:14px;overflow:hidden;background:#0E0E16;position:relative">
      <div style="height:150px;position:relative;background:${it.mediaType === "video" ? "#14141D" : `url('${mediaUrl(it.mediaUrl)}')`};background-size:cover;background-position:center">
        ${it.mediaType === "video" ? `<span style="position:absolute;inset:0;display:grid;place-items:center;color:#7C82FF">${ic(I.tv, 30)}</span>` : ""}
        <button data-gallerydel="${it.id}" style="position:absolute;top:8px;right:8px;display:grid;place-items:center;width:28px;height:28px;border-radius:9px;background:rgba(11,11,17,.75);border:1px solid rgba(251,113,133,.4);color:#FB7185;cursor:pointer">${ic(I.trash, 13)}</button>
      </div>
      <div style="padding:11px 12px"><div style="font-size:13px;font-weight:650;line-height:1.35">${escHtml(it.title)}</div>${it.tournament ? `<div style="font-size:11px;color:#7C82FF;font-weight:700;margin-top:4px">${escHtml(it.tournament.name)}</div>` : ""}</div>
    </div>`).join("")}</div>` : `<div style="color:#5D5E72;font-size:13.5px;padding:24px 0;text-align:center">${q ? "Aucun média trouvé." : "Galerie vide. Ajoute la première photo ou vidéo !"}</div>`;
  const head = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:16px">${secTitle(`Galerie (${items.length})`)}<button data-gallerynew="1" style="display:inline-flex;align-items:center;gap:7px;background:linear-gradient(135deg,#7C82FF,#5a60e0);color:#fff;border:0;border-radius:11px;padding:10px 16px;font-weight:750;font-size:13.5px;cursor:pointer">${ic(I.plus, 15)}Ajouter un media</button></div>`;
  return editor + `<div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px">${head}${adminSearchBar(S, "Titre ou tournoi…")}${scrollBox(grid)}</div>`;
}

function adminProducts(S: State) {
  const a = S.admin!;
  const e = S.prodEdit;
  const editor = e ? `<div style="border:1px solid rgba(124,130,255,.35);border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px;margin-bottom:16px">
    <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;margin-bottom:12px">${e.id ? "Modifier le produit" : "Nouveau produit"}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px">
      <label style="font-size:12px;color:#8E8FA6;font-weight:600">Nom<input id="pr-name" value="${escAttr(e.name)}" placeholder="Maillot officiel" style="${adminInp}" /></label>
      <label style="font-size:12px;color:#8E8FA6;font-weight:600">Catégorie<input id="pr-cat" value="${escAttr(e.category)}" placeholder="Vêtements, Goodies…" style="${adminInp}" /></label>
      <label style="font-size:12px;color:#8E8FA6;font-weight:600">Prix (FCFA)<input id="pr-price" type="number" min="0" value="${e.priceXof ?? 0}" style="${adminInp}" /></label>
      <label style="font-size:12px;color:#8E8FA6;font-weight:600">Stock<input id="pr-stock" type="number" min="0" value="${e.stock ?? 0}" style="${adminInp}" /></label>
    </div>
    <label style="display:flex;align-items:center;gap:8px;margin-top:14px;cursor:pointer"><input id="pr-loyalty" type="checkbox" ${e.loyaltyEligible ? "checked" : ""} style="width:16px;height:16px;accent-color:#22D3EE" /><span style="font-size:13px;color:#F4F5FB">Éligible à la réduction en points fidélité</span></label>
    <div style="margin-top:14px"><div style="font-size:12px;color:#8E8FA6;font-weight:600">Image du produit (jpg, png, webp — 3 Mo max)</div>${filePicker("pr-img", "Choisir une image", "image/*", e.imageUrl)}</div>
    <div style="display:flex;gap:10px;margin-top:14px"><button data-prodsave="${e.id || "new"}" style="background:linear-gradient(135deg,#7C82FF,#5a60e0);color:#fff;border:0;border-radius:11px;padding:11px 18px;font-weight:750;font-size:14px;cursor:pointer">${e.id ? "Enregistrer" : "Ajouter le produit"}</button><button data-prodcancel="1" style="background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer">Annuler</button></div>
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
  const catChips = cats.length > 1 ? `<div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:12px">${["Tous", ...cats].map((c) => `<button data-prodcat="${escAttr(c)}" style="font-size:12px;font-weight:${S.prodCat === c ? 700 : 600};color:${S.prodCat === c ? "#7C82FF" : "#8E8FA6"};background:${S.prodCat === c ? "rgba(124,130,255,.1)" : "#14141D"};border:1px solid ${S.prodCat === c ? "#7C82FF" : "#282838"};border-radius:999px;padding:6px 13px;cursor:pointer">${escHtml(c)}</button>`).join("")}</div>` : "";
  const sortTh = (label: string, key: string, right = true) => {
    const active = S.prodSort === key;
    const arrow = active ? (S.prodSortDir === "asc" ? " ↑" : " ↓") : "";
    return `<th data-prodsort="${key}" style="text-align:${right ? "right" : "left"};color:${active ? "#7C82FF" : "#8E8FA6"};font-size:10.5px;text-transform:uppercase;letter-spacing:1px;padding:12px 8px;font-weight:750;cursor:pointer;user-select:none">${label}${arrow}</th>`;
  };
  const thead = `<tr>${sortTh("Produit", "name", false)}${sortTh("Prix", "price")}${sortTh("Stock", "stock")}<th style="text-align:right;color:#8E8FA6;font-size:10.5px;text-transform:uppercase;letter-spacing:1px;padding:12px 8px;font-weight:750">Actions</th></tr>`;
  const rows = products.length ? products.map((p: Detail) => `<tr style="border-top:1px solid #22222F">
      <td style="padding:10px 8px"><div style="display:flex;align-items:center;gap:10px">${p.imageUrl ? `<img src="${mediaUrl(p.imageUrl)}" alt="" style="width:38px;height:38px;object-fit:cover;border-radius:9px;border:1px solid #282838;flex:none" />` : `<span style="display:grid;place-items:center;width:38px;height:38px;border-radius:9px;background:#1B1B27;border:1px solid #282838;color:#5D5E72;flex:none">${ic(I.cart, 15)}</span>`}<div><div style="font-weight:650;display:flex;align-items:center;gap:7px">${escHtml(p.name)}${p.loyaltyEligible ? `<span style="font-size:9.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#04222a;background:#22D3EE;border-radius:99px;padding:2px 7px">Points</span>` : ""}</div><div style="font-size:11.5px;color:#5D5E72">${escHtml(p.category)}</div></div></div></td>
      <td style="padding:10px 8px;text-align:right;font-weight:800;color:#22D3EE;white-space:nowrap">${money(p.priceXof)}</td>
      <td style="padding:10px 8px;text-align:right;color:${p.stock > 0 ? "#8E8FA6" : "#FB7185"};font-weight:700;white-space:nowrap">${p.stock > 0 ? p.stock + " en stock" : "Rupture"}</td>
      <td style="padding:10px 8px;text-align:right"><div style="display:inline-flex;gap:6px">${btnSm(`data-prodedit="${p.id}"`, "Modifier", "#22D3EE", "#22D3EE55")}${btnSm(`data-proddel="${p.id}"`, "Supprimer", "#FB7185", "rgba(251,113,133,.35)")}</div></td></tr>`).join("")
    : `<tr><td colspan="4" style="color:#5D5E72;font-size:13.5px;padding:16px 0;text-align:center">${q ? "Aucun produit trouvé." : "Aucun produit."}</td></tr>`;
  const head = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px">${secTitle(`Produits (${products.length}/${a.products.length})`)}<button data-prodnew="1" style="display:inline-flex;align-items:center;gap:7px;background:linear-gradient(135deg,#7C82FF,#5a60e0);color:#fff;border:0;border-radius:11px;padding:10px 16px;font-weight:750;font-size:13.5px;cursor:pointer">${ic(I.plus, 15)}Nouveau produit</button></div>`;
  return editor + `<div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px">${head}${adminSearchBar(S, "Nom ou catégorie…")}${catChips}${scrollBox(`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px;min-width:480px"><thead>${thead}</thead><tbody>${rows}</tbody></table></div>`)}</div>`;
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
    <p style="color:#8E8FA6;font-size:13.5px;line-height:1.7;margin:0 0 18px">Chaque participation validée à un tournoi Vlome rapporte 1 point (désactivable par tournoi). Les membres peuvent ensuite dépenser leurs points sur les produits marqués « éligibles » en boutique, ou sur les frais d'inscription d'un futur tournoi.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">
      <label style="font-size:12px;color:#8E8FA6;font-weight:600">Valeur d'un point (FCFA)<input id="ly-value" type="number" min="1" value="${ly.pointValueXof}" style="${adminInp}" /></label>
      <label style="font-size:12px;color:#8E8FA6;font-weight:600">Plafond de réduction (% du montant)<input id="ly-percent" type="number" min="0" max="100" value="${ly.maxRedeemPercent}" style="${adminInp}" /></label>
    </div>
    <div style="margin-top:16px"><button data-loyaltysave="1" style="background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:12px 22px;font-weight:750;font-size:14px;cursor:pointer">Enregistrer</button></div>
    <p style="color:#5D5E72;font-size:12px;margin:14px 0 0">L'éligibilité produit se règle depuis l'onglet Produits, et le gain de point par tournoi depuis l'assistant de création (étape 1).</p>
  `);
}

function adminPayments(S: State) {
  const a = S.admin!;
  const q = S.adminSearch.trim().toLowerCase();
  const payments = q
    ? a.payments.filter((r: Detail) => `${r.playerName} ${r.tournament?.name ?? ""} ${r.user?.displayName ?? ""} ${r.user?.email ?? ""}`.toLowerCase().includes(q))
    : a.payments;
  const rows = payments.length ? payments.map((r: Detail) => {
    const isPending = r.paymentStatus === "pending";
    return `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid #22222F;flex-wrap:wrap">
      <div style="min-width:0;flex:1"><div style="font-weight:650;font-size:14px">${escHtml(r.playerName)} <span style="color:#5D5E72;font-weight:400;font-size:12px">· ${escHtml(r.tournament?.name)}</span></div><div style="font-size:12px;color:#5D5E72">${escHtml(r.user?.displayName)} · ${escHtml(r.user?.email)} · ${escHtml(r.paymentMethod)}</div></div>
      <span style="font-weight:800;color:#22D3EE;white-space:nowrap">${money(r.amountXof)}</span>
      ${isPending
        ? `<button data-confirmpay="${r.tournament?.id}|${r.id}" style="font-size:12px;font-weight:750;border-radius:9px;padding:8px 14px;cursor:pointer;background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.4);color:#34D399">Confirmer</button>`
        : `<span style="font-size:10.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#34D399;background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.35);border-radius:99px;padding:4px 10px">Payé</span>`}
      </div>`;
  }).join("") : `<div style="color:#5D5E72;font-size:13.5px;padding:16px 0;text-align:center">${q ? "Aucun paiement trouvé." : "Aucun paiement d'inscription pour l'instant."}</div>`;
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
  const stat = (v: string | number, k: string, color = "#F4F5FB") => `<div style="border:1px solid #282838;border-radius:14px;background:#14141D;padding:16px"><div style="font-family:'Bebas Neue',sans-serif;font-size:28px;line-height:1;color:${color}">${v}</div><div style="font-size:11px;letter-spacing:.8px;text-transform:uppercase;color:#8E8FA6;font-weight:700;margin-top:6px">${k}</div></div>`;
  const summary = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;margin-bottom:18px">
    ${stat(orders.length, "Commandes")}${stat(money(revenue), "Revenu confirmé", "#34D399")}${stat(pending, "En attente", pending > 0 ? "#FBBF24" : "#F4F5FB")}</div>`;
  const rows = orders.length ? orders.map((o: Detail) => {
    const [sl, sc] = ORDER_STATUS[o.status] || [o.status, "#8E8FA6"];
    const items = Array.isArray(o.items) ? o.items.map((i: Detail) => i.name).join(", ") : "";
    const stBtns = ["paid", "delivered", "cancelled"].filter((s) => s !== o.status)
      .map((s) => btnSm(`data-ordstatus="${o.id}|${s}"`, ORDER_STATUS[s][0], ORDER_STATUS[s][1], ORDER_STATUS[s][1] + "55")).join("");
    return `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid #22222F;flex-wrap:wrap">
      <div style="min-width:0;flex:1"><div style="font-weight:650;font-size:14px">${o.reference} <span style="color:#5D5E72;font-weight:400;font-size:12px">· ${o.user ? escHtml(o.user.displayName) + " (" + escHtml(o.user.email) + ")" : "invité"}</span></div>
      <div style="font-size:12px;color:#5D5E72;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:520px">${escHtml(items || o.paymentMethod || "Aucun article")} · ${new Date(o.createdAt).toLocaleDateString("fr-FR")}</div></div>
      <span style="font-weight:800;color:#22D3EE;white-space:nowrap">${money(o.totalXof)}</span>
      <span style="font-size:10.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:${sc};background:${sc}14;border:1px solid ${sc}55;border-radius:99px;padding:4px 10px">${sl}</span>
      <div style="display:inline-flex;gap:6px">${stBtns}</div></div>`;
  }).join("") : `<div style="color:#5D5E72;font-size:13.5px;padding:16px 0;text-align:center">Aucune commande.</div>`;
  return summary + card(secTitle(`Commandes (${orders.length})`) + scrollBox(rows));
}

/** Premier match jouable de la phase finale (tous formats confondus) — utilisé par le panneau d'arbitrage et le Mode Show. */
/** Regroupe tous les matchs de la phase finale, quel que soit le format (hors battle_royale, qui n'a pas de duels 1v1). */
function finalsMatchGroups(finals: Detail): Detail[][] {
  const pools: Detail[][] = [];
  if (!finals || finals.format === "battle_royale") return pools;
  if (finals.format === "roundrobin") pools.push(finals.matches);
  else if (finals.format === "double") {
    finals.wb.forEach((r: Detail) => pools.push(r.matches));
    finals.lb.forEach((r: Detail) => pools.push(r.matches));
    pools.push(finals.gf2 ? [finals.gf, finals.gf2] : [finals.gf]);
  } else finals.rounds.forEach((r: Detail) => pools.push(r.matches));
  return pools;
}
function findPlayableFinalsMatch(finals: Detail): Detail | null {
  for (const arr of finalsMatchGroups(finals)) for (const m of arr) if (m && m.playable) return m;
  return null;
}
function findFinalsMatchById(finals: Detail, matchId: string): Detail | null {
  for (const arr of finalsMatchGroups(finals)) for (const m of arr) if (m && m.matchId === matchId) return m;
  return null;
}

/** Régie Battle Royale : classement cumulé + saisie du classement complet de la prochaine partie (clic dans l'ordre = classement). */
function battleRoyalePanel(S: State, t: Detail, manage: boolean): string {
  const f = t.finals;
  const champ = f.champion
    ? `<div style="border:1px solid rgba(251,191,36,.4);border-radius:16px;background:linear-gradient(180deg,rgba(251,191,36,.08),#14141D);padding:24px;text-align:center;margin-bottom:18px"><div style="font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:#FBBF24;font-weight:800">${ic(I.crown, 16)} Champion du tournoi</div><div style="font-family:'Bebas Neue',sans-serif;font-size:44px;letter-spacing:1px;margin-top:6px">${escHtml(f.champion)}</div></div>`
    : "";
  const standings = `<table style="width:100%;border-collapse:collapse;font-size:13.5px"><thead><tr style="color:#5D5E72;font-size:11px;text-transform:uppercase;letter-spacing:.5px"><td style="padding:6px 8px">#</td><td style="padding:6px 8px">Joueur</td><td style="padding:6px 8px;text-align:right">Pts</td></tr></thead><tbody>${f.standings.map((r: Detail, i: number) => `<tr style="border-top:1px solid #22222F"><td style="padding:7px 8px;color:#5D5E72;font-family:'Bebas Neue',sans-serif;font-size:16px">${i + 1}</td><td style="padding:7px 8px;font-weight:600">${escHtml(r.name)}</td><td style="padding:7px 8px;text-align:right;font-weight:750;color:#22D3EE">${r.pts}</td></tr>`).join("")}</tbody></table>`;
  const gamesList = `<div style="display:flex;flex-direction:column;gap:8px">${f.games.map((g: Detail) => {
    const topline = g.played ? g.ranking.slice(0, 3).map((r: Detail) => `${r.rank}. ${escHtml(r.name)}`).join(" · ") : "En attente";
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid #282838;border-radius:10px;padding:10px 13px;background:${g.played ? "#14141D" : "rgba(34,211,238,.05)"}">
      <span style="font-size:13px;font-weight:650">${escHtml(g.label)}</span>
      <span style="font-size:12px;color:${g.played ? "#8E8FA6" : "#22D3EE"}">${topline}</span>
    </div>`;
  }).join("")}</div>`;
  const nextGame = f.games.find((g: Detail) => !g.played);
  const players: { id: string; name: string }[] = Array.isArray(t.players) ? t.players : [];
  const pickPanel = manage && nextGame ? (() => {
    const pick: string[] = S.brPick;
    const ranked = pick.map((id, i) => ({ id, name: players.find((p) => p.id === id)?.name || "?", rank: i + 1 }));
    const remaining = players.filter((p) => !pick.includes(p.id));
    const canValidate = pick.length === players.length && players.length > 0;
    return `<div class="glow" style="border:1px solid rgba(34,211,238,.4);border-radius:12px;background:rgba(34,211,238,.06);padding:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><span style="font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:#22D3EE;font-weight:800">Classement · ${escHtml(nextGame.label)}</span>${pick.length ? `<span data-brreset="1" style="font-size:11px;color:#8E8FA6;cursor:pointer">Réinitialiser</span>` : ""}</div>
      ${ranked.length ? `<div style="display:flex;flex-direction:column;gap:5px;margin-bottom:10px">${ranked.map((r) => `<div style="display:flex;align-items:center;gap:8px;font-size:13px;background:#14141D;border:1px solid #282838;border-radius:8px;padding:6px 10px"><span style="font-family:'Bebas Neue',sans-serif;color:#FBBF24;width:20px">${r.rank}</span><span style="flex:1">${escHtml(r.name)}</span><span data-brpick="${r.id}" style="color:#8E8FA6;cursor:pointer">${ic(I.x, 13)}</span></div>`).join("")}</div>` : ""}
      <p style="color:#5D5E72;font-size:11px;margin:0 0 8px">Touche les joueurs dans l'ordre d'arrivée (1er en premier).</p>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">${remaining.map((p) => `<span data-brpick="${p.id}" style="font-size:12px;font-weight:600;background:#1B1B27;border:1px solid #282838;color:#F4F5FB;border-radius:99px;padding:6px 12px;cursor:pointer">${escHtml(p.name)}</span>`).join("")}</div>
      <button data-brsubmit="${nextGame.id}" ${canValidate ? "" : "disabled"} style="width:100%;background:${canValidate ? "linear-gradient(135deg,#22D3EE,#12aec4)" : "#22222F"};color:${canValidate ? "#04222a" : "#5D5E72"};border:0;border-radius:10px;padding:11px;font-weight:750;font-size:13.5px;cursor:${canValidate ? "pointer" : "default"}">Valider le classement</button>
    </div>`;
  })() : "";
  const left = `${champ}<div style="font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:1px;margin-bottom:14px;display:flex;align-items:center;gap:10px"><span style="width:5px;height:22px;border-radius:3px;background:#22D3EE"></span>Battle Royale · ${f.games.filter((g: Detail) => g.played).length}/${f.games.length} parties</div>
    <div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:18px;margin-bottom:18px"><div style="font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:#5D5E72;font-weight:800;margin-bottom:12px">Classement cumulé</div>${standings}</div>
    <div style="font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:#5D5E72;font-weight:800;margin-bottom:10px">Parties</div>${gamesList}`;
  return manage
    ? `<div class="grid2c" style="margin-top:26px;display:grid;grid-template-columns:1fr 300px;gap:22px;align-items:start"><div class="rise d1">${left}</div><div class="rise d2">${pickPanel}</div></div>`
    : `<div class="rise" style="margin-top:26px">${left}</div>`;
}

/** Affiche imprimable (résultats) : classement général, qualifiés par poule, phase finale. Données réelles uniquement (mêmes champs que le cockpit). */
function buildPoster(t: Detail): string {
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
  const pools = (t.pools || []).filter((p: Detail) => p.top1).map((p: Detail) => `<div class="pa-pool"><b>${escHtml(p.name)}</b> — ${escHtml(p.top1)}${p.top2 ? ", " + escHtml(p.top2) : ""}</div>`).join("");
  let bracket = "";
  if (t.finals) {
    const line = (name: string | null, win: boolean) => `<div class="${win ? "w" : ""}">${name ? escHtml(name) : "—"}</div>`;
    const rounds = (arr: Detail[][]) => `<div class="pa-bracket">${arr.map((round) => `<div class="pa-round">${round.map((m: Detail) => `<div class="pa-seed">${line(m.aName, m.winnerId === m.aId)}${line(m.bName, m.winnerId === m.bId)}</div>`).join("")}</div>`).join("")}</div>`;
    const f = t.finals;
    if (f.format === "roundrobin" || f.format === "swiss") {
      const rowsHtml = f.format === "swiss"
        ? f.standings.map((r: Detail, i: number) => `<tr><td>${i + 1}</td><td>${escHtml(r.name)}</td><td>${r.wins}</td><td>${r.buchholz}</td></tr>`).join("")
        : f.standings.map((r: Detail, i: number) => `<tr><td>${i + 1}</td><td>${escHtml(r.name)}</td><td>${r.wins}</td><td>${r.gd > 0 ? "+" : ""}${r.gd}</td></tr>`).join("");
      bracket = `<table class="pa-table"><thead><tr><th>#</th><th>Joueur</th><th>V</th><th>${f.format === "swiss" ? "Buchholz" : "Diff."}</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
    } else if (f.format === "double") {
      bracket = `<div class="pa-h" style="font-size:13px">Vainqueurs</div>${rounds(f.wb.map((r: Detail) => r.matches))}<div class="pa-h" style="font-size:13px;margin-top:8px">Perdants</div>${rounds(f.lb.map((r: Detail) => r.matches))}`;
    } else if (f.format === "battle_royale") {
      bracket = `<table class="pa-table"><thead><tr><th>#</th><th>Joueur</th><th>Points</th></tr></thead><tbody>${f.standings.map((r: Detail, i: number) => `<tr><td>${i + 1}</td><td>${escHtml(r.name)}</td><td><b>${r.pts}</b></td></tr>`).join("")}</tbody></table>`;
    } else if (f.format === "single") {
      bracket = rounds(f.rounds.map((r: Detail) => r.matches));
    }
  }
  const now = new Date().toLocaleString("fr-FR");
  return `<div class="pa">
    <div class="pa-head"><div class="pa-brand">VLOME ESPORT</div><div class="pa-title">${escHtml(t.name)}</div>${meta ? `<div class="pa-meta">${meta}</div>` : ""}</div>
    ${champHtml}
    <div class="pa-cols">
      <div class="pa-col"><div class="pa-h">Classement général</div>${standings}</div>
      <div class="pa-col">${pools ? `<div class="pa-h">Qualifiés par poule</div>${pools}` : ""}${bracket ? `<div class="pa-h" style="margin-top:14px">Phase finale</div>${bracket}` : ""}</div>
    </div>
    <div class="pa-foot">Édité le ${now} · VLOME Esport</div>
  </div>`;
}

/** Panneau "Joueurs" (organisateur/admin) — renommer, club, ajustement manuel de points, disqualification en direct.
 * Partagé entre pTournoi (pied de page) et la régie (overlay). */
function playersRosterPanel(S: State, t: Detail, manage: boolean): string {
  const roster2: { id: string; name: string; club?: string; disqualified?: boolean }[] = Array.isArray(t.players) ? t.players : [];
  if (!manage || !roster2.length) return "";
  const editRow = (p: { id: string; name: string; club?: string }) => `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;background:#14141D;border:1px solid #22D3EE55;border-radius:10px;padding:8px;width:100%">
    <input id="pl-edit-name" value="${escAttr(p.name)}" placeholder="Nom" style="flex:1;min-width:110px;background:#1B1B27;border:1px solid #282838;border-radius:8px;color:#F4F5FB;font-family:inherit;font-size:12.5px;padding:6px 9px" />
    <input id="pl-edit-club" value="${escAttr(p.club || "")}" placeholder="Club" style="flex:1;min-width:90px;background:#1B1B27;border:1px solid #282838;border-radius:8px;color:#F4F5FB;font-family:inherit;font-size:12.5px;padding:6px 9px" />
    <input id="pl-edit-delta" type="number" step="0.5" placeholder="+/- pts" style="width:72px;background:#1B1B27;border:1px solid #282838;border-radius:8px;color:#F4F5FB;font-family:inherit;font-size:12.5px;padding:6px 7px" />
    <input id="pl-edit-reason" placeholder="Motif (si ajustement)" style="flex:1;min-width:110px;background:#1B1B27;border:1px solid #282838;border-radius:8px;color:#F4F5FB;font-family:inherit;font-size:12.5px;padding:6px 9px" />
    <button data-pledit-save="${t.id}|${p.id}" style="background:#22222F;border:1px solid #33334A;color:#22D3EE;border-radius:8px;padding:6px 11px;font-weight:700;font-size:12px;cursor:pointer">OK</button>
    <button data-pledit-cancel="1" style="background:transparent;border:0;color:#8E8FA6;cursor:pointer;font-size:12px">Annuler</button>
  </div>`;
  const q = S.rosterQ.trim().toLowerCase();
  const filtered = q ? roster2.filter((p) => p.name.toLowerCase().includes(q) || (p.club || "").toLowerCase().includes(q)) : roster2;
  const searchBar = roster2.length > 8 ? `<div style="position:relative;max-width:320px;margin:14px 0 4px">
      <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#5D5E72;pointer-events:none">${ic(I.search, 14)}</span>
      <input id="regie-roster-search" value="${escAttr(S.rosterQ)}" placeholder="Chercher un joueur…" style="width:100%;background:#1B1B27;border:1px solid #282838;border-radius:10px;color:#F4F5FB;font-family:inherit;font-size:13px;padding:9px 12px 9px 33px" />
    </div>${q ? `<div style="margin-top:8px"><span style="display:inline-flex;align-items:center;gap:7px;font-size:11.5px;color:#8E8FA6;background:#14141D;border:1px solid #282838;border-radius:999px;padding:5px 10px">Recherche : <b style="color:#F4F5FB">${escHtml(S.rosterQ)}</b><button data-rosterqclear="1" style="display:grid;place-items:center;width:16px;height:16px;background:transparent;border:0;color:#8E8FA6;cursor:pointer">${ic(I.x, 11)}</button></span></div>` : ""}` : "";
  return `<details open style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:16px 20px;margin-bottom:20px">
      <summary style="cursor:pointer;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6;font-weight:750">Joueurs (${roster2.length})</summary>
      ${searchBar}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">${filtered.length ? filtered.map((p) => S.editingPlayerId === p.id ? editRow(p) : `<span style="display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:${p.disqualified ? "#5D5E72" : "#F4F5FB"};background:#14141D;border:1px solid #282838;border-radius:999px;padding:7px 8px 7px 13px${p.disqualified ? ";text-decoration:line-through" : ""}"><span style="display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#22222F;font-size:10px;font-weight:800;color:#22D3EE">${p.name.charAt(0).toUpperCase()}</span>${escHtml(p.name)}${p.club ? `<span style="color:#5D5E72;font-weight:500">@${escHtml(p.club)}</span>` : ""}<button data-pledit-open="${p.id}" title="Renommer / club / points" style="display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:transparent;border:0;color:#8E8FA6;cursor:pointer">${ic(I.edit || I.plus, 11)}</button>${p.disqualified ? `<span style="font-size:9.5px;font-weight:800;letter-spacing:.5px;color:#FB7185">DQ</span>` : t.status === "live" ? `<button data-pldq="${t.id}|${p.id}" title="Disqualifier" style="display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:transparent;border:0;color:#FB7185;cursor:pointer">${ic(I.warn, 12)}</button>` : ""}</span>`).join("") : `<div style="color:#5D5E72;font-size:13px;padding:6px 2px">Aucun joueur ne correspond à « ${escHtml(S.rosterQ)} ».</div>`}</div>
    </details>`;
}

/** Poule Survival (match courant cliquable + classement) — partagé entre pTournoi et la régie. */
function poolCard(S: State, p: Detail, manage: boolean): string {
  let body: string;
  if (p.current) {
    const stageLabel: Record<string, string> = { survival: "Survival", losers: "Repêchage", poolFinal: "Finale de poule" };
    const stageTitle = `${stageLabel[p.current.stage] || p.current.stage}${p.current.streak > 1 ? " · série " + p.current.streak : ""}`;
    const subA = p.current.stage === "poolFinal" ? "Champ. vainqueurs" : "Survivant";
    const subB = p.current.stage === "poolFinal" ? "Champ. perdants" : "Challenger";
    if (manage) {
      const side = (id: string, name: string, cls: string, sub: string) => `<button data-report="${p.current.poolId}|${id}" style="flex:1;min-height:120px;border-radius:15px;border:1px solid ${cls === "surv" ? "rgba(34,211,238,.4)" : "rgba(244,63,126,.35)"};background:linear-gradient(180deg,${cls === "surv" ? "rgba(34,211,238,.08)" : "rgba(244,63,126,.05)"},#14141D);color:#F4F5FB;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:14px"><span style="font-size:10.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:${cls === "surv" ? "#22D3EE" : "#F43F7E"}">${sub}</span><span style="font-family:'Bebas Neue',sans-serif;font-size:30px;line-height:1;color:${cls === "surv" ? "#22D3EE" : "#F43F7E"}">${name}</span></button>`;
      const inp = "width:52px;height:44px;text-align:center;background:#1B1B27;border:1px solid #282838;border-radius:10px;color:#F4F5FB;font-family:'JetBrains Mono',monospace;font-size:19px;font-weight:700;line-height:44px;padding:0";
      body = `<div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8E8FA6;font-weight:700;margin-bottom:10px">${stageTitle} — saisis le score (FT) ou touche un vainqueur</div>
        <div style="display:flex;align-items:stretch;gap:12px"><div style="flex:1">${side(p.current.aId, p.current.aName, "surv", subA)}</div><div style="display:flex;align-items:center;color:#5D5E72;font-family:'Bebas Neue',sans-serif;font-size:22px">VS</div><div style="flex:1">${side(p.current.bId, p.current.bName, "chal", subB)}</div></div>
        <div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-top:14px"><input id="sc-a-${p.current.poolId}" type="number" min="0" value="0" class="scorenum" style="${inp}" /><span style="color:#5D5E72;font-weight:800;font-size:16px;flex:none">–</span><input id="sc-b-${p.current.poolId}" type="number" min="0" value="0" class="scorenum" style="${inp}" /><button data-reportscore="${p.current.poolId}" ${S.detailBusy ? "disabled" : ""} style="height:44px;background:#22222F;border:1px solid #33334A;color:#22D3EE;border-radius:10px;padding:0 16px;font-weight:750;font-size:13px;cursor:pointer;margin-left:4px">Valider le score</button></div>`;
    } else {
      const sideRO = (name: string, cls: string, sub: string) => `<div style="flex:1;min-height:120px;border-radius:15px;border:1px solid ${cls === "surv" ? "rgba(34,211,238,.4)" : "rgba(244,63,126,.35)"};background:linear-gradient(180deg,${cls === "surv" ? "rgba(34,211,238,.08)" : "rgba(244,63,126,.05)"},#14141D);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:14px"><span style="font-size:10.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:${cls === "surv" ? "#22D3EE" : "#F43F7E"}">${sub}</span><span style="font-family:'Bebas Neue',sans-serif;font-size:30px;line-height:1;color:${cls === "surv" ? "#22D3EE" : "#F43F7E"}">${name}</span></div>`;
      body = `<div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8E8FA6;font-weight:700;margin-bottom:10px">${stageTitle} — en direct</div>
        <div style="display:flex;align-items:stretch;gap:12px"><div style="flex:1">${sideRO(p.current.aName, "surv", subA)}</div><div style="display:flex;align-items:center;color:#5D5E72;font-family:'Bebas Neue',sans-serif;font-size:22px">VS</div><div style="flex:1">${sideRO(p.current.bName, "chal", subB)}</div></div>`;
    }
  } else if (p.done) {
    body = `<div style="text-align:center;padding:14px 0"><div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#34D399;font-weight:700;margin-bottom:12px">Poule terminée — qualifiés</div><div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><span style="font-size:13px;font-weight:700;color:#FBBF24;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.35);border-radius:99px;padding:8px 14px">1. ${p.top1}</span>${p.top2 ? `<span style="font-size:13px;font-weight:700;color:#22D3EE;background:rgba(34,211,238,.08);border:1px solid rgba(34,211,238,.35);border-radius:99px;padding:8px 14px">2. ${p.top2}</span>` : ""}</div></div>`;
  } else {
    body = `<div style="color:#5D5E72;text-align:center;padding:14px 0">En attente…</div>`;
  }
  const rank = `<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:14px">${p.ranking.map((r: Detail, i: number) => `<tr style="border-top:1px solid #22222F"><td style="padding:7px 4px;color:#5D5E72;font-family:'Bebas Neue',sans-serif;font-size:15px;width:22px">${i + 1}</td><td style="padding:7px 4px;font-weight:600">${r.name}</td><td style="padding:7px 4px;text-align:right;color:#8E8FA6">${r.wins}V</td><td style="padding:7px 4px;text-align:right;font-weight:750;color:#22D3EE">${r.pts}</td></tr>`).join("")}</table>`;
  return `<div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:18px"><div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;margin-bottom:12px">${p.name}</div>${body}${rank}</div>`;
}

/** Bracket(s) de la phase finale — rendu générique réutilisé pour les formats single/double/roundrobin/swiss, partagé entre pTournoi et la régie. */
function matchLine(name: string | null, id: string | null, win: boolean, playable: boolean, matchId: string, manage: boolean): string {
  if (!name) return `<div style="padding:9px 11px;color:#5D5E72;font-style:italic">à venir</div>`;
  if (playable && manage) return `<button data-reportf="${matchId}|${id}" style="display:block;width:100%;text-align:left;padding:9px 11px;background:transparent;border:0;color:#F4F5FB;cursor:pointer;font-family:inherit;font-size:14px">${escHtml(name)}</button>`;
  return `<div style="padding:9px 11px;color:${win ? "#22D3EE" : "#8E8FA6"};font-weight:${win ? 700 : 400}">${escHtml(name)}${win ? " ✓" : ""}</div>`;
}
function matchBox(m: Detail, manage: boolean): string {
  if (m.bye) return `<div style="border:1px solid #282838;border-radius:10px;overflow:hidden;background:#14141D">${matchLine(m.aName, m.aId, true, false, m.matchId, manage)}<div style="padding:9px 11px;color:#5D5E72;font-style:italic;border-top:1px solid #22222F">exempt</div></div>`;
  return `<div style="border:1px solid ${m.playable ? "rgba(34,211,238,.4)" : "#282838"};border-radius:10px;overflow:hidden;background:#14141D">${matchLine(m.aName, m.aId, m.winnerId === m.aId, m.playable, m.matchId, manage)}<div style="border-top:1px solid #22222F">${matchLine(m.bName, m.bId, m.winnerId === m.bId, m.playable, m.matchId, manage)}</div></div>`;
}
function roundCol(label: string, matches: Detail[], manage: boolean): string {
  return `<div style="display:flex;flex-direction:column;justify-content:space-around;gap:12px;min-width:180px">${label ? `<div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8E8FA6;font-weight:700">${escHtml(label)}</div>` : ""}${matches.map((m) => matchBox(m, manage)).join("")}</div>`;
}

/** Une ligne de match Round Robin en tableau compact — remplace la grille de mini-cartes, illisible dès qu'il y a beaucoup de joueurs (ex : 16 joueurs = 120 matchs). Clic sur un nom = victoire directe (1 manche), même sémantique que matchBox. */
function roundRobinMatchRow(m: Detail, manage: boolean): string {
  const nameCell = (name: string, id: string, isWin: boolean) => {
    if (manage && m.playable) return `<button data-reportf="${m.matchId}|${id}" style="background:transparent;border:0;color:#F4F5FB;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;padding:3px 6px;border-radius:6px;text-align:inherit">${escHtml(name)}</button>`;
    return `<span style="color:${isWin ? "#22D3EE" : m.winnerId ? "#5D5E72" : "#F4F5FB"};font-weight:${isWin ? 750 : 600}">${escHtml(name)}${isWin ? " ✓" : ""}</span>`;
  };
  const status = m.winnerId
    ? `<span style="font-size:10px;font-weight:800;letter-spacing:.3px;color:#34D399">JOUÉ</span>`
    : m.playable ? `<span style="font-size:10px;font-weight:800;letter-spacing:.3px;color:#22D3EE">À JOUER</span>` : `<span style="font-size:10px;color:#5D5E72">—</span>`;
  return `<div style="display:grid;grid-template-columns:1fr 26px 1fr 68px;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid #15151f">
    <div style="text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${nameCell(m.aName, m.aId, m.winnerId === m.aId)}</div>
    <div style="text-align:center;color:#5D5E72;font-size:10.5px">vs</div>
    <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${nameCell(m.bName, m.bId, m.winnerId === m.bId)}</div>
    <div style="text-align:right">${status}</div>
  </div>`;
}
/** Liste complète des matchs Round Robin, groupée à jouer / joués (repliés), scrollable — remplace la grille de mini-cartes plate de tous les matchs. */
function roundRobinMatchList(matches: Detail[], manage: boolean): string {
  const todo = matches.filter((m: Detail) => !m.winnerId);
  const done = matches.filter((m: Detail) => m.winnerId);
  const todoList = `<div style="border:1px solid #282838;border-radius:12px;overflow:hidden"><div style="max-height:440px;overflow-y:auto">${todo.length ? todo.map((m) => roundRobinMatchRow(m, manage)).join("") : `<div style="padding:16px;text-align:center;color:#5D5E72;font-size:13px">Tous les matchs ont été joués.</div>`}</div></div>`;
  const doneList = done.length ? `<details style="margin-top:16px">
      <summary style="cursor:pointer;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:#8E8FA6;font-weight:750;padding:2px 0">Matchs joués (${done.length})</summary>
      <div style="border:1px solid #282838;border-radius:12px;overflow:hidden;margin-top:10px"><div style="max-height:300px;overflow-y:auto">${done.map((m) => roundRobinMatchRow(m, manage)).join("")}</div></div>
    </details>` : "";
  return `<div style="font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:#8E8FA6;font-weight:750;margin-bottom:10px">Matchs à jouer (${todo.length})</div>${todoList}${doneList}`;
}

const FINALS_FORMATS: [string, string][] = [["single", "Élimination simple"], ["double", "Double élimination"], ["roundrobin", "Round Robin"]];
/** Sélecteur de format + bouton "Lancer la phase finale", une fois toutes les poules Survival terminées. Partagé entre pTournoi et la régie. */
function finalsStartPanel(S: State, t: Detail, manage: boolean): string {
  if (!manage || !t.allPoolsDone || t.finals) return "";
  return `<div style="text-align:center;margin:24px 0">
      <div style="display:inline-flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;justify-content:center">${FINALS_FORMATS.map(([v, l]) => `<button data-finalsfmt="${v}" style="font-size:12.5px;font-weight:700;border-radius:10px;padding:8px 14px;cursor:pointer;background:${S.finalsFormatPick === v ? "rgba(34,211,238,.1)" : "#1B1B27"};border:1px solid ${S.finalsFormatPick === v ? "#22D3EE" : "#282838"};color:${S.finalsFormatPick === v ? "#22D3EE" : "#8E8FA6"}">${l}</button>`).join("")}</div>
      <div><button data-finals-start="${t.id}" ${S.detailBusy ? "disabled" : ""} style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:14px 24px;font-weight:750;font-size:15px;cursor:pointer;box-shadow:0 0 30px rgba(34,211,238,.22)">${ic(I.crown)}Lancer la phase finale</button></div>
    </div>`;
}

/* ================= Régie (organisateur, tournoi en direct) — squelette rail · centre · contrôle (Tour 5/6) ================= */

type ActiveMatch = { kind: "pool" | "finals"; poolId?: string; matchId?: string; aId: string; aName: string; bId: string; bName: string };

/** Match mis en avant dans le panneau de contrôle : celui choisi via la file d'attente s'il est toujours jouable, sinon le premier jouable. */
function getActiveMatch(S: State, t: Detail): ActiveMatch | null {
  if (t.finals && t.finals.format !== "battle_royale") {
    const wanted = S.activeMatchId ? findFinalsMatchById(t.finals, S.activeMatchId) : null;
    const m = (wanted && wanted.playable) ? wanted : findPlayableFinalsMatch(t.finals);
    if (!m) return null;
    return { kind: "finals", matchId: m.matchId, aId: m.aId, aName: m.aName, bId: m.bId, bName: m.bName };
  }
  const pools: Detail[] = Array.isArray(t.pools) ? t.pools : [];
  const withCurrent = pools.filter((p: Detail) => p.current);
  if (!withCurrent.length) return null;
  const wanted = S.activeMatchId ? withCurrent.find((p: Detail) => p.id === S.activeMatchId) : null;
  const p = wanted || withCurrent[0];
  return { kind: "pool", poolId: p.id, aId: p.current.aId, aName: p.current.aName, bId: p.current.bId, bName: p.current.bName };
}

/** Les autres matchs jouables que celui affiché dans le contrôle — "Lancer" bascule S.activeMatchId. */
function matchQueuePanel(t: Detail, active: ActiveMatch): string {
  // Round Robin : tous les matchs sont jouables en parallèle (pas de progression par round), la liste complète du centre
  // (roundRobinMatchList, avec report en un clic) couvre déjà ce besoin — une file d'attente y ferait doublon à l'identique.
  if (t.finals?.format === "roundrobin") return "";
  const items: { id: string; label: string }[] = [];
  if (t.finals && t.finals.format !== "battle_royale") {
    for (const arr of finalsMatchGroups(t.finals)) for (const m of arr) {
      if (m && m.playable && m.matchId !== active.matchId) items.push({ id: m.matchId, label: `${escHtml(m.aName)} <span style="color:#5D5E72">vs</span> ${escHtml(m.bName)}` });
    }
  } else if (!t.finals) {
    (t.pools || []).forEach((p: Detail) => { if (p.current && p.id !== active.poolId) items.push({ id: p.id, label: `${escHtml(p.name)} · ${escHtml(p.current.aName)} <span style="color:#5D5E72">vs</span> ${escHtml(p.current.bName)}` }); });
  }
  if (!items.length) return "";
  return `<div style="border:1px solid #282838;border-radius:12px;background:#14141D;overflow:hidden;margin-top:16px">
    <div style="display:flex;align-items:center;gap:9px;padding:12px 15px;border-bottom:1px solid #22222F"><span style="font-size:10.5px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6">File d'attente</span><span style="flex:1"></span><span style="font-family:'JetBrains Mono',monospace;font-size:11.5px;color:#5D5E72">${items.length}</span></div>
    <div style="padding:6px 12px 12px;max-height:280px;overflow-y:auto">${items.map((it) => `<div style="display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid #1B1B27"><span style="font-size:12.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${it.label}</span><span data-activematch="${it.id}" style="font-size:11px;font-weight:750;color:#22D3EE;cursor:pointer;flex:none">Lancer</span></div>`).join("")}</div>
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
  const rows = flagged.length ? `<div style="display:flex;flex-direction:column;gap:2px;margin-top:10px">${flagged.map((f) => `<div style="display:flex;align-items:center;gap:8px;padding:6px 2px"><span style="width:6px;height:6px;border-radius:50%;background:${f.color};flex:none"></span><span style="font-size:12.5px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(f.label)}${f.sub ? ` <span style="color:#5D5E72;font-weight:500">${escHtml(f.sub)}</span>` : ""}</span><span style="font-size:10.5px;font-weight:750;color:${f.color};flex:none">${f.tag}</span></div>`).join("")}</div>` : "";
  const alert = pending.length ? `<div style="display:flex;align-items:center;gap:9px;margin-top:12px;border:1px solid rgba(251,191,36,.35);background:rgba(251,191,36,.06);border-radius:10px;padding:9px 11px">
      <span style="color:#FBBF24;flex:none">${ic(I.warn, 14)}</span>
      <span style="font-size:11.5px;color:#F4F5FB;flex:1">${pending.length} paiement${pending.length > 1 ? "s" : ""} en attente</span>
      <span data-regiepanel="paiements" style="font-size:11px;font-weight:750;color:#FBBF24;cursor:pointer;flex:none">Traiter</span>
    </div>` : "";
  return `<div style="border:1px solid #282838;border-radius:12px;background:#14141D;padding:13px 14px">
    <div style="display:flex;align-items:center;gap:9px"><span style="font-size:10.5px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6">Joueurs</span><span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#5D5E72">${roster.length}</span>${dqCount ? `<span style="font-size:10px;font-weight:750;color:#FB7185">${dqCount} disqualifié${dqCount > 1 ? "s" : ""}</span>` : ""}<span style="flex:1"></span><span data-regiepanel="joueurs" style="font-size:11px;font-weight:700;color:#22D3EE;cursor:pointer">Voir tout</span></div>
    ${rows || `<div style="font-size:11px;color:#5D5E72;margin-top:6px">Renommer, disqualifier, ajuster les points — sans quitter la régie.</div>`}
    ${alert}
  </div>`;
}

/** Annuler le dernier résultat — indépendant du match actif : reste disponible même quand aucun match n'est jouable (poule/tournoi tout juste terminé), sinon impossible à annuler depuis la régie. */
function regieUndoBlock(t: Detail): string {
  if (!t.canUndo) return "";
  return `<button data-undo="${t.id}" style="width:100%;text-align:center;border:1px solid #33334A;color:#F4F5FB;background:#14141D;border-radius:10px;padding:11px;font-size:12.5px;font-weight:700;cursor:pointer">Annuler le dernier résultat</button>`;
}

/** Panneau de contrôle du match actif : stepper de score, valider/annuler/forfait — remplace la saisie par input number. */
function matchScoreControl(S: State, t: Detail, active: ActiveMatch): string {
  const sa = S.matchScoreA, sb = S.matchScoreB;
  const canValidate = sa !== sb && !S.detailBusy;
  const side = (name: string, score: number, key: "a" | "b") => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;background:#101019;border:1px solid #282838;margin-top:8px">
      <span style="display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#22222F;font-size:11px;font-weight:800;color:#22D3EE;flex:none">${escHtml(name).charAt(0).toUpperCase()}</span>
      <b style="font-size:13.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(name)}</b>
      <button data-scorestep="${key}|-1" style="display:grid;place-items:center;width:26px;height:26px;border-radius:7px;border:1px solid #33334A;background:transparent;color:#8E8FA6;font-size:15px;font-weight:700;cursor:pointer;flex:none">–</button>
      <span style="font-family:'JetBrains Mono',monospace;font-size:20px;font-weight:600;min-width:22px;text-align:center">${score}</span>
      <button data-scorestep="${key}|1" style="display:grid;place-items:center;width:26px;height:26px;border-radius:7px;background:#22D3EE;color:#04222a;font-size:15px;font-weight:800;border:0;cursor:pointer;flex:none">+</button>
    </div>`;
  return `<div style="border:1px solid rgba(34,211,238,.4);border-radius:12px;background:rgba(34,211,238,.05);overflow:hidden">
    <div style="display:flex;align-items:center;gap:9px;padding:12px 15px;border-bottom:1px solid rgba(34,211,238,.22)">
      <span style="width:6px;height:6px;border-radius:50%;background:#22D3EE;animation:blink 1.2s infinite"></span>
      <span style="font-size:10.5px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:#22D3EE">Match en cours</span>
    </div>
    <div style="padding:14px">
      ${side(active.aName, sa, "a")}
      ${side(active.bName, sb, "b")}
      <button data-matchvalidate="1" ${canValidate ? "" : "disabled"} style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;background:${canValidate ? "#22D3EE" : "#22222F"};color:${canValidate ? "#04222a" : "#5D5E72"};border:0;border-radius:9px;padding:11px;font-weight:800;font-size:13px;margin-top:12px;cursor:${canValidate ? "pointer" : "default"}">Valider le vainqueur</button>
      <div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#5D5E72;font-weight:750;margin-top:12px">Déclarer forfait</div>
      <div style="display:flex;gap:8px;margin-top:6px">
        <button data-matchforfeit="a" style="flex:1;text-align:center;border:1px solid rgba(244,63,126,.4);color:#F43F7E;background:transparent;border-radius:8px;padding:7px 4px;font-size:11px;font-weight:700;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(active.aName)}</button>
        <button data-matchforfeit="b" style="flex:1;text-align:center;border:1px solid rgba(244,63,126,.4);color:#F43F7E;background:transparent;border-radius:8px;padding:7px 4px;font-size:11px;font-weight:700;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(active.bName)}</button>
      </div>
    </div>
  </div>${matchQueuePanel(t, active)}`;
}

/** Une case de l'arbre de bracket, positionnée en absolu. */
function matchTreeBox(m: Detail, x: number, y: number, w: number, active: boolean, manage: boolean): string {
  if (m.bye) {
    return `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;border:1px solid #1B1B27;border-radius:10px;overflow:hidden;background:#101019">
      <div style="padding:8px 10px;font-size:12.5px;font-weight:600">${escHtml(m.aName || m.bName || "—")}</div>
      <div style="padding:8px 10px;color:#5D5E72;font-style:italic;font-size:11.5px;border-top:1px solid #1B1B27">exempt</div>
    </div>`;
  }
  const row = (name: string | null, win: boolean) => name
    ? `<div style="padding:8px 10px;font-size:12.5px;font-weight:600;color:${win ? "#34D399" : "#F4F5FB"};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(name)}${win ? " ✓" : ""}</div>`
    : `<div style="padding:8px 10px;color:#5D5E72;font-style:italic;font-size:11.5px">à venir</div>`;
  const isPlayable = !!m.playable && manage;
  const border = active ? "1px solid #22D3EE" : m.winnerId ? "1px solid rgba(52,211,153,.3)" : isPlayable ? "1px solid rgba(34,211,238,.4)" : "1px dashed #2c2c3d";
  const statusBadge = active
    ? `<span style="font-size:9px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:#22D3EE">En direct</span>`
    : m.winnerId
      ? `<span style="font-size:9px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:#34D399">Joué</span>`
      : isPlayable
        ? `<span style="font-size:9px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:#22D3EE">À lancer</span>`
        : `<span style="font-size:9px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:#5D5E72">À jouer</span>`;
  const clickAttr = isPlayable && !active ? `data-activematch="${m.matchId}"` : "";
  return `<div ${clickAttr} style="position:absolute;left:${x}px;top:${y}px;width:${w}px;border:${border};border-radius:10px;overflow:hidden;background:${active ? "rgba(34,211,238,.07)" : "#101019"};${isPlayable && !active ? "cursor:pointer" : ""}">
    <div style="display:flex;align-items:center;padding:6px 10px;background:#0d0d14;border-bottom:1px solid #1B1B27">${statusBadge}</div>
    ${row(m.aName, m.winnerId === m.aId)}
    <div style="border-top:1px solid #1B1B27">${row(m.bName, m.winnerId === m.bId)}</div>
  </div>`;
}

/** Arbre de bracket avec connecteurs, disposition calculée génériquement (pas de pixels codés en dur) — élimination simple ou bracket vainqueurs d'un double élim. */
function bracketTree(rounds: { label: string; matches: Detail[] }[], activeMatchId: string | null, manage: boolean): string {
  if (!rounds.length) return "";
  const BOX_W = 172, COL_GAP = 40, BOX_H = 74, ROW_GAP = 18;
  const centers: number[][] = [];
  rounds.forEach((round, r) => {
    if (r === 0) centers.push(round.matches.map((_, i) => i * (BOX_H + ROW_GAP) + BOX_H / 2));
    else {
      const prev = centers[r - 1];
      centers.push(round.matches.map((_, i) => (prev[2 * i] + (prev[2 * i + 1] ?? prev[2 * i])) / 2));
    }
  });
  let connectors = "";
  for (let r = 1; r < rounds.length; r++) {
    const prev = centers[r - 1];
    rounds[r].matches.forEach((_, i) => {
      const yA = prev[2 * i], yB = prev[2 * i + 1];
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
  const boxes = rounds.map((round, r) => round.matches.map((m, i) => matchTreeBox(m, r * (BOX_W + COL_GAP), centers[r][i] - BOX_H / 2, BOX_W, m.matchId === activeMatchId, manage)).join("")).join("");
  const totalW = rounds.length * (BOX_W + COL_GAP) - COL_GAP;
  const totalH = Math.max(...centers[0].map((c) => c + BOX_H / 2 + 10), BOX_H);
  const header = `<div style="display:flex;gap:${COL_GAP}px;margin-bottom:14px">${rounds.map((r) => `<div style="width:${BOX_W}px"><div style="font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:#5D5E72;font-weight:800">${escHtml(r.label)}</div></div>`).join("")}</div>`;
  return `<div style="overflow-x:auto;padding-bottom:14px"><div style="width:${totalW}px">${header}<div style="position:relative;width:${totalW}px;height:${totalH}px">${connectors}${boxes}</div></div></div>`;
}

/** Une ligne de statut de round (phase finale) dans le rail de régie — terminée / en cours / à venir, à partir des données réelles des matchs. */
function regieRoundStatusRows(rounds: { label: string; matches: Detail[] }[]): string {
  return rounds.map((r) => {
    const doneCount = r.matches.filter((m: Detail) => m.winnerId || m.bye).length;
    const allDone = doneCount === r.matches.length;
    const anyPlayable = r.matches.some((m: Detail) => m.playable);
    const statusLabel = allDone ? "terminée" : anyPlayable ? `en cours · ${doneCount}/${r.matches.length}` : "à venir";
    const color = allDone ? "#34D399" : anyPlayable ? "#22D3EE" : "#5D5E72";
    return `<div style="display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:9px;${anyPlayable ? "background:rgba(34,211,238,.06)" : ""}">
      <span style="display:grid;place-items:center;width:19px;height:19px;border-radius:50%;${allDone ? "background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.4);color:#34D399" : "border:1px solid #33334A;color:#5D5E72"};font-size:9px;flex:none">${allDone ? ic(I.plus, 9) : ""}</span>
      <span style="font-size:12.5px;color:${anyPlayable ? "#F4F5FB" : "#8E8FA6"};font-weight:${anyPlayable ? 700 : 500};flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(r.label)}</span>
      <span style="font-size:11px;color:${color};flex:none;white-space:nowrap">${statusLabel}</span>
    </div>`;
  }).join("");
}
/** Une ligne de statut de poule Survival dans le rail — cliquable si elle a un match en cours (bascule le panneau de contrôle dessus). */
function regiePoolStatusRows(t: Detail, active: ActiveMatch | null): string {
  const pools: Detail[] = Array.isArray(t.pools) ? t.pools : [];
  return pools.map((p: Detail) => {
    const isActive = active?.kind === "pool" && active.poolId === p.id;
    const statusLabel = p.done ? "terminée" : p.current ? "en cours" : "à venir";
    const color = p.done ? "#34D399" : p.current ? "#22D3EE" : "#5D5E72";
    return `<div ${p.current ? `data-activematch="${p.id}"` : ""} style="display:flex;align-items:center;gap:9px;padding:9px 10px;border-radius:9px;cursor:${p.current ? "pointer" : "default"};${isActive ? "background:rgba(34,211,238,.08)" : ""}">
      <span style="display:grid;place-items:center;width:19px;height:19px;border-radius:50%;${p.done ? "background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.4);color:#34D399" : p.current ? "background:#22D3EE;color:#04222a" : "border:1px solid #33334A;color:#5D5E72"};font-size:10px;font-weight:700;flex:none">${p.done ? ic(I.plus, 9) : "•"}</span>
      <span style="font-size:12.5px;color:${p.current ? "#F4F5FB" : "#8E8FA6"};font-weight:${p.current ? 700 : 500};flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p.name)}</span>
      <span style="font-size:11px;color:${color};flex:none;white-space:nowrap">${statusLabel}</span>
    </div>`;
  }).join("");
}
/** Une ligne de statut de partie Battle Royale dans le rail. */
function regieGamesStatusRows(t: Detail): string {
  const games: Detail[] = t.finals?.games || [];
  return games.map((g: Detail, i: number) => `<div style="display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:9px">
    <span style="display:grid;place-items:center;width:19px;height:19px;border-radius:50%;${g.played ? "background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.4);color:#34D399" : "border:1px solid #33334A;color:#5D5E72"};font-size:9px;flex:none">${g.played ? ic(I.plus, 9) : i + 1}</span>
    <span style="font-size:12.5px;color:#8E8FA6;flex:1">${escHtml(g.label)}</span>
    <span style="font-size:11px;color:${g.played ? "#34D399" : "#5D5E72"}">${g.played ? "jouée" : "à jouer"}</span>
  </div>`).join("");
}

/** Rail de gauche de la régie : déroulé réel du tournoi (poules/rondes/parties selon le format) + accès Joueurs/Paiements/Réglages. */
function regieRail(S: State, t: Detail, manage: boolean, active: ActiveMatch | null): string {
  const hasPools = Array.isArray(t.pools) && t.pools.length > 0;
  let body: string;
  if (t.finals && t.finals.format === "battle_royale") {
    body = `<div style="font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:#5D5E72;font-weight:800;padding:0 8px 8px">Parties</div>${regieGamesStatusRows(t)}`;
  } else if (t.finals && !hasPools) {
    // Formats sans poules (single/double/roundrobin/swiss) : le bracket/les rondes sont toute la compétition.
    const rounds = t.finals.format === "double" ? t.finals.wb : t.finals.format === "roundrobin" ? null : t.finals.rounds;
    const heading = t.finals.format === "roundrobin" ? "Round Robin" : t.finals.format === "swiss" ? "Rondes suisses" : t.finals.format === "double" ? "Bracket · vainqueurs" : "Bracket";
    body = `<div style="font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:#5D5E72;font-weight:800;padding:0 8px 8px">${heading}</div>${rounds ? regieRoundStatusRows(rounds) : `<div style="padding:8px 10px;font-size:12px;color:#8E8FA6">${t.finals.matches.filter((m: Detail) => m.winnerId).length}/${t.finals.matches.length} matchs joués</div>`}`;
  } else {
    // Survival : poules, puis éventuellement phase finale une fois toutes terminées.
    body = `<div style="font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:#5D5E72;font-weight:800;padding:0 8px 8px">Phase 1 · poules</div>${regiePoolStatusRows(t, active)}`;
    if (t.finals) {
      const rounds = t.finals.format === "double" ? t.finals.wb : t.finals.format === "roundrobin" ? null : t.finals.rounds;
      body += `<div style="font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:#7C82FF;font-weight:800;padding:12px 8px 6px">Phase 2 · finale</div>${rounds ? regieRoundStatusRows(rounds) : `<div style="padding:8px 10px;font-size:12px;color:#8E8FA6">Round Robin en cours</div>`}`;
    } else if (t.allPoolsDone) {
      body += `<div style="font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:#7C82FF;font-weight:800;padding:12px 8px 6px">Phase 2 · finale</div><div style="padding:8px 10px;font-size:12px;color:#63C6DA">Poules terminées — à lancer</div>`;
    }
  }
  const nav = `<div style="margin-top:16px;border-top:1px solid #1B1B27;padding-top:12px;display:flex;flex-direction:column;gap:2px">
    <div data-regiepanel="joueurs" style="display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:9px;cursor:pointer"><span style="color:#8E8FA6">${ic(I.user, 15)}</span><span style="font-size:12.5px;color:#8E8FA6;flex:1">Joueurs</span><span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#5D5E72">${(t.players || []).length}</span></div>
    <div data-regiepanel="paiements" style="display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:9px;cursor:pointer"><span style="color:#8E8FA6">${ic(I.cart, 15)}</span><span style="font-size:12.5px;color:#8E8FA6;flex:1">Paiements</span></div>
    <div data-regiepanel="reglages" style="display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:9px;cursor:pointer"><span style="color:#8E8FA6">${ic(I.warn, 15)}</span><span style="font-size:12.5px;color:#8E8FA6;flex:1">Réglages &amp; barème</span></div>
  </div>`;
  return `<div class="regie-rail" style="width:236px;flex:none;border-right:1px solid #1B1B27;padding:20px 16px;display:flex;flex-direction:column;gap:6px;background:#0a0a10;overflow-y:auto">
    <div style="font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:#5D5E72;font-weight:800;padding:0 8px 8px">Déroulé du tournoi</div>
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
      <div style="font-size:10px;letter-spacing:1.1px;text-transform:uppercase;color:#5D5E72;font-weight:750">Cagnotte distribuée</div>
      <div style="display:flex;align-items:center;gap:9px;margin-top:5px"><span style="width:104px;height:5px;border-radius:99px;background:#22222F;overflow:hidden;display:inline-block"><span style="display:block;width:${pct}%;height:100%;background:#FBBF24"></span></span><span style="font-family:'JetBrains Mono',monospace;font-size:12.5px;color:#FBBF24">${dist}/${total}</span></div>
    </div>
    <span style="width:1px;height:32px;background:#22222F"></span>` : "";
  return `<div class="regie-banner" style="display:flex;align-items:center;gap:16px;padding:0 26px;height:70px;border-bottom:1px solid #1B1B27;background:linear-gradient(90deg,rgba(34,211,238,.07),transparent 46%)">
    <button data-back="1" style="display:grid;place-items:center;width:28px;height:28px;border-radius:8px;border:1px solid #282838;background:#14141D;color:#8E8FA6;flex:none;cursor:pointer">${icBack(14)}</button>
    <div style="min-width:0">
      <div style="display:flex;align-items:center;gap:10px">
        <h1 style="font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:1px;margin:0;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:360px">${escHtml(t.name)}</h1>
        <span style="display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:#04222a;background:#22D3EE;border-radius:99px;padding:4px 9px;flex:none"><span style="width:5px;height:5px;border-radius:50%;background:#04222a;animation:blink 1.2s infinite"></span>En direct</span>
      </div>
      <div style="font-size:12px;color:#8E8FA6;margin-top:3px">${[t.game, t.format].filter(Boolean).map((v: string) => escHtml(v)).join(" · ")}</div>
    </div>
    <span style="flex:1"></span>
    ${cagnotteBlock}
    <button data-show="${t.id}" style="display:inline-flex;align-items:center;gap:7px;border:1px solid #33334A;background:#14141D;color:#F4F5FB;border-radius:10px;padding:11px 15px;font-weight:700;font-size:13px;flex:none;cursor:pointer">${ic(I.tv, 15)}Mode Show</button>
    <button data-print="${t.id}" style="display:inline-flex;align-items:center;gap:7px;border:1px solid #33334A;background:#14141D;color:#F4F5FB;border-radius:10px;padding:11px 15px;font-weight:700;font-size:13px;flex:none;cursor:pointer">${ic(I.printer, 15)}Affiche</button>
    <button data-reset="${t.id}" style="display:inline-flex;align-items:center;gap:7px;border:1px solid rgba(251,191,36,.35);background:transparent;color:#FBBF24;border-radius:10px;padding:11px 15px;font-weight:700;font-size:13px;flex:none;cursor:pointer">${ic(I.warn, 15)}Réinitialiser</button>
  </div>`;
}

/** Centre de régie pour Battle Royale : classement cumulé en tableau + attribution de la prochaine place (Tour 5). */
function battleRoyaleRegieCenter(S: State, t: Detail): string {
  const f = t.finals;
  const nextGame = f.games.find((g: Detail) => !g.played);
  const players: { id: string; name: string }[] = Array.isArray(t.players) ? t.players : [];
  const pick: string[] = S.brPick;
  const pickedSet = new Set(pick);
  const nextRank = pick.length + 1;
  const canValidate = nextGame && pick.length === players.length && players.length > 0;
  const banner = nextGame ? `<div style="display:flex;align-items:center;gap:14px;margin:0 0 18px;border:1px solid rgba(34,211,238,.4);border-radius:12px;background:linear-gradient(90deg,rgba(34,211,238,.1),rgba(34,211,238,.02));padding:13px 16px">
      <span style="display:grid;place-items:center;width:32px;height:32px;border-radius:9px;background:#22D3EE;color:#04222a;flex:none;font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:600">${canValidate ? "✓" : nextRank}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13.5px;font-weight:750">${canValidate ? "Classement complet — valide pour enregistrer la partie" : `Touche un joueur pour lui donner la ${nextRank}ᵉ place`}</div>
        <div style="font-size:11.5px;color:#8E8FA6;margin-top:2px">${escHtml(nextGame.label)}</div>
      </div>
      <span style="font-family:'JetBrains Mono',monospace;font-size:12.5px;color:#22D3EE;background:rgba(34,211,238,.1);border:1px solid rgba(34,211,238,.35);border-radius:8px;padding:7px 11px">${pick.length}/${players.length}</span>
      ${pick.length ? `<span data-brreset="1" style="border:1px solid #33334A;background:#14141D;color:#F4F5FB;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer">Réinitialiser</span>` : ""}
      ${canValidate ? `<button data-brsubmit="${nextGame.id}" style="background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:8px;padding:9px 16px;font-weight:750;font-size:13px;cursor:pointer;flex:none">Valider le classement</button>` : ""}
    </div>` : "";
  const standings = f.standings as { id: string; name: string; pts: number }[];
  const rows = standings.map((r, i) => {
    const isNext = nextGame && !pickedSet.has(r.id);
    return `<div ${isNext ? `data-brpick="${r.id}"` : ""} style="display:grid;grid-template-columns:36px 1fr 90px;align-items:center;height:48px;padding:0 14px;border-bottom:1px solid #15151f;${isNext ? "cursor:pointer" : ""}${i === 0 ? ";background:rgba(251,191,36,.04)" : ""}">
      <span style="font-family:'JetBrains Mono',monospace;font-size:13px;color:${i === 0 ? "#FBBF24" : "#5D5E72"};font-weight:600">${i + 1}</span>
      <span style="display:flex;align-items:center;gap:10px;min-width:0"><span style="display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:#22222F;font-size:10.5px;font-weight:800;color:${i === 0 ? "#FBBF24" : "#22D3EE"};flex:none">${escHtml(r.name).charAt(0).toUpperCase()}</span><b style="font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(r.name)}</b>${isNext ? `<span style="font-size:11px;color:#63C6DA;flex:none">toucher pour classer</span>` : ""}</span>
      <span style="text-align:right;font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:600;color:${i === 0 ? "#FBBF24" : "#F4F5FB"}">${r.pts}</span>
    </div>`;
  }).join("");
  const table = `<div style="border:1px solid #1B1B27;border-radius:12px;overflow:hidden">
    <div style="display:grid;grid-template-columns:36px 1fr 90px;align-items:center;height:36px;padding:0 14px;background:#101019;border-bottom:1px solid #1B1B27;font-size:10px;letter-spacing:1.1px;text-transform:uppercase;color:#5D5E72;font-weight:800"><span>#</span><span>Joueur</span><span style="text-align:right">Total</span></div>
    ${rows}
  </div>`;
  const barème = `<div style="display:flex;align-items:center;gap:10px;margin-top:12px;font-size:11.5px;color:#5D5E72;flex-wrap:wrap">
    <span style="font-family:'JetBrains Mono',monospace">Barème</span> ${(f.pointsTable as number[]).map((p, i) => `${i + 1}${i === 0 ? "ᵉʳ" : "ᵉ"} ${p}`).join(" · ")}
  </div>`;
  const gamesRecap = `<div style="margin-top:16px;display:flex;flex-direction:column;gap:6px">${f.games.map((g: Detail, i: number) => `<div style="display:flex;align-items:center;gap:10px;font-size:11.5px;color:#5D5E72;padding:6px 2px;border-top:1px solid #15151f"><span style="font-family:'JetBrains Mono',monospace;width:20px">${i + 1}</span><span style="flex:1">${escHtml(g.label)}</span><span style="color:${g.played ? "#34D399" : "#5D5E72"}">${g.played ? `1ʳᵉ : ${escHtml(g.ranking[0].name)}` : "à jouer"}</span></div>`).join("")}</div>`;
  return `<div style="display:flex;align-items:flex-end;gap:14px;padding:22px 28px 0">
      <div><div style="display:inline-flex;align-items:center;gap:7px;font-size:10.5px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:#22D3EE;background:rgba(34,211,238,.1);border:1px solid rgba(34,211,238,.35);border-radius:99px;padding:4px 10px">${f.games.filter((g: Detail) => g.played).length}/${f.games.length} parties jouées</div>
      <h2 style="font-family:'Bebas Neue',sans-serif;font-size:34px;letter-spacing:1.2px;margin:9px 0 0;line-height:1">Classement cumulé</h2></div>
    </div>
    <div style="padding:18px 28px 30px">${banner}${table}${barème}${gamesRecap}</div>`;
}

/** Centre de la régie : arbre de bracket (single/double), table Round Robin/Swiss, ou poule Survival active. Battle Royale a son propre centre dédié. */
function regieCenter(S: State, t: Detail, manage: boolean, active: ActiveMatch | null): string {
  if (t.finals && t.finals.format === "battle_royale") return battleRoyaleRegieCenter(S, t);

  const champ = t.finals?.champion
    ? `<div style="border:1px solid rgba(251,191,36,.4);border-radius:16px;background:linear-gradient(180deg,rgba(251,191,36,.08),#14141D);padding:24px;text-align:center;margin:18px 28px 0"><div style="font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:#FBBF24;font-weight:800">${ic(I.crown, 16)} Champion du tournoi</div><div style="font-family:'Bebas Neue',sans-serif;font-size:44px;letter-spacing:1px;margin-top:6px">${escHtml(t.finals.champion)}</div></div>`
    : "";

  if (t.finals && (t.finals.format === "single" || t.finals.format === "double")) {
    const rounds = t.finals.format === "single" ? t.finals.rounds : t.finals.wb;
    const viewToggle = `<div style="display:flex;gap:7px">
      <span data-bracketview="tree" style="font-size:11.5px;font-weight:${S.bracketView === "tree" ? 750 : 700};color:${S.bracketView === "tree" ? "#04222a" : "#8E8FA6"};background:${S.bracketView === "tree" ? "#22D3EE" : "transparent"};border:1px solid ${S.bracketView === "tree" ? "#22D3EE" : "#282838"};border-radius:8px;padding:7px 12px;cursor:pointer">Arbre</span>
      <span data-bracketview="list" style="font-size:11.5px;font-weight:${S.bracketView === "list" ? 750 : 700};color:${S.bracketView === "list" ? "#04222a" : "#8E8FA6"};background:${S.bracketView === "list" ? "#22D3EE" : "transparent"};border:1px solid ${S.bracketView === "list" ? "#22D3EE" : "#282838"};border-radius:8px;padding:7px 12px;cursor:pointer">Liste des matchs</span>
    </div>`;
    const body = S.bracketView === "list"
      ? `<div style="display:flex;gap:24px;overflow-x:auto;padding-bottom:10px">${rounds.map((r: Detail) => roundCol(r.label, r.matches, manage)).join("")}</div>`
      : bracketTree(rounds, active?.matchId || null, manage);
    const extra = t.finals.format === "double"
      ? `<div style="margin-top:20px">
          <div style="font-size:11px;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6;font-weight:750;margin-bottom:10px">Bracket des perdants</div><div style="display:flex;gap:24px;overflow-x:auto;padding-bottom:14px">${t.finals.lb.map((r: Detail) => roundCol(r.label, r.matches, manage)).join("")}</div>
          <div style="font-size:11px;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6;font-weight:750;margin:14px 0 10px">Grande finale${t.finals.gf2 ? " (2e manche — bracket reset)" : ""}</div><div style="display:flex;gap:24px;overflow-x:auto;padding-bottom:10px">${roundCol("", t.finals.gf2 ? [t.finals.gf, t.finals.gf2] : [t.finals.gf], manage)}</div>
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
    const standings = `<table style="width:100%;border-collapse:collapse;font-size:13.5px;margin-bottom:20px"><thead><tr style="color:#5D5E72;font-size:11px;text-transform:uppercase;letter-spacing:.5px"><td style="padding:6px 8px">#</td><td style="padding:6px 8px">Joueur</td><td style="padding:6px 8px;text-align:right">V</td><td style="padding:6px 8px;text-align:right">${isSwiss ? "Buchholz" : "Diff."}</td><td style="padding:6px 8px;text-align:right">Pts</td></tr></thead><tbody>${t.finals.standings.map((r: Detail, i: number) => `<tr style="border-top:1px solid #22222F"><td style="padding:7px 8px;color:#5D5E72;font-family:'Bebas Neue',sans-serif;font-size:16px">${i + 1}</td><td style="padding:7px 8px;font-weight:600">${escHtml(r.name)}</td><td style="padding:7px 8px;text-align:right;color:#8E8FA6">${r.wins}</td><td style="padding:7px 8px;text-align:right;color:#8E8FA6">${isSwiss ? r.buchholz : (r.gd > 0 ? "+" : "") + r.gd}</td><td style="padding:7px 8px;text-align:right;font-weight:750;color:#22D3EE">${r.pts}</td></tr>`).join("")}</tbody></table>`;
    const label = isSwiss ? `Ronde ${t.finals.rounds.length}/${t.finals.roundCount}` : `${t.finals.matches.filter((m: Detail) => m.winnerId).length}/${t.finals.matches.length} matchs joués`;
    const body = isSwiss
      ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">${t.finals.rounds[t.finals.rounds.length - 1].matches.map((m: Detail) => matchBox(m, manage)).join("")}</div>`
      : roundRobinMatchList(t.finals.matches, manage);
    return `<div style="display:flex;align-items:flex-end;gap:14px;padding:22px 28px 0">
        <div><div style="display:inline-flex;align-items:center;gap:7px;font-size:10.5px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:#22D3EE;background:rgba(34,211,238,.1);border:1px solid rgba(34,211,238,.35);border-radius:99px;padding:4px 10px">${label}</div>
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:34px;letter-spacing:1.2px;margin:9px 0 0;line-height:1">${isSwiss ? "Classement Swiss" : "Round Robin"}</h2></div>
      </div>
      ${champ}
      <div style="padding:18px 28px 30px">${standings}${body}</div>`;
  }

  // Survival, poules en cours (pas encore de phase finale) : la poule active en avant, les autres restent dans le rail.
  const activePool = active?.kind === "pool" ? (t.pools || []).find((p: Detail) => p.id === active.poolId) : null;
  return `<div style="padding:22px 28px 30px">
    <div style="display:flex;align-items:flex-end;gap:14px;margin-bottom:18px">
      <div><div style="display:inline-flex;align-items:center;gap:7px;font-size:10.5px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:#22D3EE;background:rgba(34,211,238,.1);border:1px solid rgba(34,211,238,.35);border-radius:99px;padding:4px 10px">Phase 1 · poules</div>
      <h2 style="font-family:'Bebas Neue',sans-serif;font-size:34px;letter-spacing:1.2px;margin:9px 0 0;line-height:1">${activePool ? escHtml(activePool.name) : "Poules"}</h2></div>
    </div>
    ${activePool ? poolCard(S, activePool, manage) : `<div style="color:#8E8FA6;text-align:center;padding:30px 0">Toutes les poules sont terminées.</div>`}
    ${finalsStartPanel(S, t, manage)}
  </div>`;
}

const WIZ_SCORING_FIELDS_REF: [string, string][] = [["Victoire en poule Survival", "survWin"], ["Victoire en poule des perdants", "loserWin"], ["Victoire en finale de poule", "poolFinalWin"], ["Victoire en phase finale", "finalsWin"], ["Bonus champion du tournoi", "championBonus"]];
/** Barème modifiable en direct (le tournoi est déjà lancé — l'assistant de création ne s'applique plus). */
function regieScoringForm(t: Detail): string {
  const rows = WIZ_SCORING_FIELDS_REF.map(([label, key]) => `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #1B1B27">
    <span style="flex:1;font-size:13px">${label}</span>
    <input id="ls-${key}" type="number" min="0" step="0.25" value="${(t.scoring as Record<string, number>)[key]}" style="width:80px;text-align:center;background:#1B1B27;border:1px solid #282838;border-radius:8px;color:#F4F5FB;font-family:'JetBrains Mono',monospace;font-size:13px;padding:7px" />
  </div>`).join("");
  return `<div>${rows}</div><button data-livescoresave="${t.id}" style="width:100%;margin-top:14px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:10px;padding:11px;font-weight:750;font-size:13.5px;cursor:pointer">Enregistrer le barème</button>`;
}

/** Overlay Joueurs / Paiements / Réglages ouvert depuis le bas du rail de régie. */
function regieOverlay(S: State, t: Detail, manage: boolean): string {
  if (!S.regiePanel) return "";
  const titles: Record<string, string> = { joueurs: "Joueurs", paiements: "Paiements en attente", reglages: "Réglages & barème" };
  const body = S.regiePanel === "joueurs" ? (playersRosterPanel(S, t, manage) || `<div style="color:#8E8FA6;text-align:center;padding:20px">Aucun joueur.</div>`)
    : S.regiePanel === "paiements" ? (paymentsPanel(S, t.id) || `<div style="color:#8E8FA6;text-align:center;padding:20px">Aucun paiement en attente.</div>`)
    : regieScoringForm(t);
  return `<div data-regiepanel="" style="position:fixed;inset:0;z-index:270;display:flex;align-items:flex-start;justify-content:center;padding:min(6vh,60px) 18px;background:rgba(6,6,10,.75);backdrop-filter:blur(6px);overflow-y:auto">
    <div data-stop="1" style="width:100%;max-width:520px;border:1px solid #282838;border-radius:16px;background:#0E0E16;box-shadow:0 30px 80px rgba(0,0,0,.6);animation:fadeUp .18s ease both">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #1B1B27"><span style="font-family:'Bebas Neue',sans-serif;font-size:19px;letter-spacing:1px">${titles[S.regiePanel]}</span><button data-regiepanel="" style="display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:#1B1B27;border:1px solid #282838;color:#8E8FA6;cursor:pointer">${ic(I.x, 13)}</button></div>
      <div style="padding:18px 20px;max-height:70vh;overflow-y:auto">${body}</div>
    </div>
  </div>`;
}

/** Régie plein cadre (organisateur/admin, tournoi en direct) — rail · centre · contrôle, hors du rail public. Tour 5/6. */
function regiePage(S: State): string {
  const t = S.detail;
  if (!t) return `<div style="min-height:100vh;display:grid;place-items:center;color:#8E8FA6">Chargement…</div>`;
  const manage = canManage(S);
  const active = getActiveMatch(S, t);
  const control = active
    ? matchScoreControl(S, t, active)
    : `<div style="border:1px solid #282838;border-radius:12px;background:#14141D;padding:24px;text-align:center;color:#8E8FA6;font-size:13px">Aucun match en attente pour l'instant.</div>`;
  return `<div class="regie-page-outer" style="height:100vh;overflow:hidden;background:#08080d;display:flex;flex-direction:column">
    ${regieTopBanner(S, t)}
    <div class="regie-grid" style="display:grid;grid-template-columns:236px 1fr 330px;flex:1;min-height:0">
      ${regieRail(S, t, manage, active)}
      <div class="regie-center" style="min-width:0;overflow-y:auto">${regieCenter(S, t, manage, active)}</div>
      <div class="regie-control" style="border-left:1px solid #1B1B27;padding:22px 20px 30px;display:flex;flex-direction:column;gap:16px;background:#0a0a10;overflow-y:auto">${control}${regieUndoBlock(t)}${regieRosterMini(S, t)}</div>
    </div>
  </div>${regieOverlay(S, t, manage)}${confirmModal(S)}${cartDrawer(S)}`;
}

function pTournoi(S: State) {
  const t = S.detail;
  if (!t) return `<main style="max-width:1220px;margin:0 auto;padding:40px 22px;text-align:center;color:#8E8FA6">Chargement du tournoi…</main>`;
  const manage = canManage(S); // seuls organisateur/admin voient les contrôles de pilotage
  const statusMap: Record<string, [string, string]> = { setup: ["À lancer", "#8E8FA6"], live: ["En direct", "#22D3EE"], finished: ["Terminé", "#FBBF24"] };
  const [slabel, scolor] = statusMap[t.status] || ["", "#8E8FA6"];
  const dist = t.distributed || 0, total = t.cagnotte?.total || 0;
  const pct = total ? Math.min(100, (dist / total) * 100) : 0;

  // Couverture : l'affiche du tournoi (si fournie) constitue le fond de la section détail, comme sur les cartes.
  const coverBg = t.imageUrl
    ? `background-image:linear-gradient(180deg,rgba(11,11,17,.2) 35%,rgba(11,11,17,.94)),url('${mediaUrl(t.imageUrl)}');background-size:cover;background-position:center`
    : `background:linear-gradient(150deg,rgba(34,211,238,.10),rgba(124,130,255,.06) 55%,#0E0E16)`;
  const cover = `<div style="border-radius:20px;border:1px solid #282838;overflow:hidden;position:relative;margin-bottom:14px;${coverBg}">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 18px 0;flex-wrap:wrap;gap:10px">
      <button data-back="1" style="display:inline-flex;align-items:center;gap:7px;background:rgba(20,20,29,.72);backdrop-filter:blur(6px);border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:10px 14px;font-weight:700;font-size:13.5px;cursor:pointer">← Tournois</button>
      <span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:${scolor};background:rgba(20,20,29,.72);backdrop-filter:blur(6px);border:1px solid ${scolor}55;border-radius:99px;padding:6px 12px">${slabel}</span>
    </div>
    <div style="padding:${t.imageUrl ? "64px" : "26px"} 22px 22px">
      <h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(28px,4vw,44px);letter-spacing:1px;margin:0;line-height:1;${t.imageUrl ? "text-shadow:0 2px 14px rgba(0,0,0,.65)" : ""}">${t.name}</h1>
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px;color:${t.imageUrl ? "#D5D6E3" : "#8E8FA6"};font-size:13px;font-weight:600">
        <span>${[t.game, t.format, t.place, t.date].filter(Boolean).map((v: string) => escHtml(v)).join(" · ")}</span>
        ${t.entryFeeXof ? `<span style="display:inline-flex;align-items:center;gap:5px;color:#FBBF24;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.3);border-radius:99px;padding:3px 10px;font-size:12px">${ic(I.cart, 12)}${money(t.entryFeeXof)}</span>` : ""}
      </div>
    </div>
  </div>`;
  const head = `${cover}<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:20px">
    <button data-show="${t.id}" style="display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,rgba(34,211,238,.14),rgba(124,130,255,.14));border:1px solid #22D3EE66;color:#22D3EE;border-radius:11px;padding:9px 13px;font-weight:700;font-size:13px;cursor:pointer">${ic(I.tv, 15)}Mode Show</button>
    <button data-print="${t.id}" style="display:inline-flex;align-items:center;gap:6px;background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:9px 13px;font-weight:700;font-size:13px;cursor:pointer">${ic(I.printer, 15)}Affiche</button>
    ${manage ? `<button data-edit="1" style="display:inline-flex;align-items:center;gap:6px;background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:9px 13px;font-weight:700;font-size:13px;cursor:pointer">${ic(I.edit || I.plus, 15)}Modifier</button>
    ${t.status !== "setup" ? `${t.canUndo ? `<button data-undo="${t.id}" ${S.detailBusy ? "disabled" : ""} style="display:inline-flex;align-items:center;gap:6px;background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:9px 13px;font-weight:700;font-size:13px;cursor:pointer">${icBack(15)}Annuler</button>` : ""}
    <button data-reset="${t.id}" style="display:inline-flex;align-items:center;gap:6px;background:transparent;border:1px solid rgba(251,191,36,.35);color:#FBBF24;border-radius:11px;padding:9px 13px;font-weight:700;font-size:13px;cursor:pointer">${ic(I.warn, 15)}Réinitialiser</button>` : ""}
    <button data-del="${t.id}" style="display:inline-flex;align-items:center;gap:6px;background:transparent;border:1px solid rgba(251,113,133,.35);color:#FB7185;border-radius:11px;padding:9px 13px;font-weight:700;font-size:13px;cursor:pointer">${ic(I.trash, 15)}Supprimer</button>` : ""}
    <div style="flex:1"></div>
    ${t.mainFormat === "survival" ? `<div style="min-width:200px"><div style="display:flex;justify-content:space-between;font-size:12px;color:#8E8FA6;margin-bottom:6px"><span>Cagnotte distribuée</span><span style="font-weight:700;color:#F4F5FB">${dist} / ${total} pts</span></div><div style="height:9px;border-radius:99px;background:#22222F;border:1px solid #282838;overflow:hidden"><span style="display:block;height:100%;width:${pct}%;background:linear-gradient(90deg,#22D3EE,#7C82FF)"></span></div></div>` : ""}
  </div>`;

  const inpE = "width:100%;background:#1B1B27;border:1px solid #282838;border-radius:11px;color:#F4F5FB;font-family:inherit;font-size:14px;padding:11px 13px;margin-top:6px";
  const editCard = S.editing && manage ? `<div style="border:1px solid rgba(34,211,238,.3);border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px;margin-bottom:20px">
    <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;margin-bottom:12px">Modifier le tournoi</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px">
      <label style="font-size:12px;color:#8E8FA6;font-weight:600">Nom<input id="e-name" value="${(t.name || "").replace(/"/g, "&quot;")}" style="${inpE}" /></label>
      <label style="font-size:12px;color:#8E8FA6;font-weight:600">Jeu<input id="e-game" value="${(t.game || "").replace(/"/g, "&quot;")}" style="${inpE}" /></label>
      <label style="font-size:12px;color:#8E8FA6;font-weight:600">Lieu<input id="e-place" value="${(t.place || "").replace(/"/g, "&quot;")}" style="${inpE}" /></label>
      <label style="font-size:12px;color:#8E8FA6;font-weight:600">Date<input id="e-date" type="date" style="${inpE}" /></label>
      <label style="font-size:12px;color:#8E8FA6;font-weight:600">Frais d'inscription (FCFA)<input id="e-fee" type="number" min="0" step="100" value="${t.entryFeeXof || 0}" style="${inpE}" /></label>
      ${t.status === "setup" ? `<label style="font-size:12px;color:#8E8FA6;font-weight:600">Nombre de poules<input id="e-pools" type="number" min="1" value="${t.nbPools || 2}" style="${inpE}" /></label>
      <label style="font-size:12px;color:#8E8FA6;font-weight:600">Points / joueur (cagnotte)<input id="e-pts" type="number" min="1" value="${t.pointsPerPlayer || 5}" style="${inpE}" /></label>` : ""}
      <div><div style="font-size:12px;color:#8E8FA6;font-weight:600">Affiche (image)</div>${filePicker("e-img", "Remplacer l'affiche", "image/*", t.imageUrl)}</div>
    </div>
    ${t.status !== "setup" ? `<div style="font-size:12px;color:#5D5E72;margin-top:10px">Poules et points par joueur ne sont modifiables qu'avant le lancement.</div>` : ""}
    <div style="display:flex;gap:10px;margin-top:14px"><button data-editsave="${t.id}" style="background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:11px;padding:11px 18px;font-weight:750;font-size:14px;cursor:pointer">Enregistrer</button><button data-editcancel="1" style="background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer">Annuler</button></div>
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
      action = `<div style="display:flex;flex-direction:column;align-items:center;gap:12px"><span style="display:inline-flex;align-items:center;gap:8px;color:#FBBF24;font-weight:750;font-size:15px;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.4);border-radius:12px;padding:12px 22px">${ic(I.warn, 17)}Paiement en attente de confirmation (${money(myReg!.amountXof)})</span><button data-unreg="${t.id}" style="background:transparent;border:1px solid #33334A;color:#8E8FA6;border-radius:10px;padding:9px 16px;font-weight:700;font-size:12.5px;cursor:pointer">Annuler l'inscription</button></div>`;
    } else if (isReg) {
      action = `<div style="display:flex;flex-direction:column;align-items:center;gap:12px"><span style="display:inline-flex;align-items:center;gap:8px;color:#34D399;font-weight:750;font-size:15px;background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.4);border-radius:12px;padding:12px 22px">${ic(I.crown, 17)}Tu es inscrit à ce tournoi</span><button data-unreg="${t.id}" style="background:transparent;border:1px solid #33334A;color:#8E8FA6;border-radius:10px;padding:9px 16px;font-weight:700;font-size:12.5px;cursor:pointer">Se désinscrire</button></div>`;
    } else if (fee > 0) {
      const chips = PAYMENTS.map((m) => `<button data-paypick="${m}" style="font-size:12.5px;font-weight:700;border-radius:10px;padding:9px 14px;cursor:pointer;background:${S.payPick === m ? "rgba(34,211,238,.1)" : "#1B1B27"};border:1px solid ${S.payPick === m ? "#22D3EE" : "#282838"};color:${S.payPick === m ? "#22D3EE" : "#8E8FA6"}">${m}</button>`).join("");
      const ly = S.loyaltySettings || { pointValueXof: 100, maxRedeemPercent: 50 };
      const maxXof = Math.floor((fee * ly.maxRedeemPercent) / 100);
      const maxPoints = Math.max(0, Math.min(S.loyaltyBalance, Math.floor(maxXof / ly.pointValueXof)));
      const chosenPoints = Math.min(S.regPointsToRedeem, maxPoints);
      const discount = chosenPoints * ly.pointValueXof;
      const netFee = Math.max(0, fee - discount);
      const loyaltyBox = maxPoints > 0 ? `<div style="border:1px solid #282838;border-radius:12px;background:#14141D;padding:12px 14px;width:100%;max-width:320px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
          <span style="font-size:12px;color:#8E8FA6;font-weight:700;text-transform:uppercase;letter-spacing:.5px">Points fidélité</span>
          <span style="font-size:12px;color:#5D5E72">Solde : <b style="color:#F4F5FB">${S.loyaltyBalance}</b></span>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <button data-regpts="${Math.max(0, chosenPoints - 1)}" style="width:30px;height:30px;border-radius:8px;background:#1B1B27;border:1px solid #282838;color:#F4F5FB;cursor:pointer">−</button>
          <span style="flex:1;text-align:center;font-family:'JetBrains Mono',monospace;font-weight:700">${chosenPoints} pt${chosenPoints > 1 ? "s" : ""}</span>
          <button data-regpts="${Math.min(maxPoints, chosenPoints + 1)}" style="width:30px;height:30px;border-radius:8px;background:#1B1B27;border:1px solid #282838;color:#F4F5FB;cursor:pointer">+</button>
          <button data-regpts="${maxPoints}" style="font-size:11.5px;font-weight:700;color:#22D3EE;background:transparent;border:1px solid rgba(34,211,238,.35);border-radius:8px;padding:0 10px;height:30px;cursor:pointer">Max</button>
        </div>
        ${discount > 0 ? `<div style="margin-top:8px;font-size:12.5px;color:#34D399;font-weight:700">− ${money(discount)} appliqués</div>` : ""}
      </div>` : "";
      action = `<div style="display:flex;flex-direction:column;align-items:center;gap:14px">
        <div><div style="color:#8E8FA6;font-size:12.5px;font-weight:700;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Moyen de paiement</div><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">${chips}</div></div>
        ${loyaltyBox}
        <button data-reg="${t.id}" ${S.payPick || netFee === 0 ? "" : "disabled"} style="display:inline-flex;align-items:center;gap:8px;background:${S.payPick || netFee === 0 ? "linear-gradient(135deg,#22D3EE,#12aec4)" : "#22222F"};color:${S.payPick || netFee === 0 ? "#04222a" : "#5D5E72"};border:0;border-radius:12px;padding:14px 26px;font-weight:750;font-size:16px;cursor:${S.payPick || netFee === 0 ? "pointer" : "default"};box-shadow:${S.payPick || netFee === 0 ? "0 0 34px rgba(34,211,238,.24)" : "none"}">${ic(I.plus, 18)}S'inscrire · ${discount > 0 ? `<span style="text-decoration:line-through;opacity:.6;font-weight:600;font-size:13px">${money(fee)}</span> ` : ""}${money(netFee)}</button>
      </div>`;
    } else {
      action = `<button data-reg="${t.id}" style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:14px 26px;font-weight:750;font-size:16px;cursor:pointer;box-shadow:0 0 34px rgba(34,211,238,.24)">${ic(I.plus, 18)}S'inscrire au tournoi</button>`;
    }
    const sub = manage
      ? "Le lancement répartit les joueurs en poules et démarre le mode Survival. L'ordre de passage est verrouillé."
      : fee > 0 ? "Inscription payante : choisis un moyen de paiement, l'organisateur confirmera à réception."
      : "Les inscriptions sont ouvertes jusqu'au lancement par l'organisateur.";
    const feeBadge = fee > 0 ? `<div style="display:inline-flex;align-items:center;gap:7px;color:#FBBF24;font-weight:700;font-size:13px;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.35);border-radius:99px;padding:6px 14px;margin-bottom:18px;margin-right:10px">${ic(I.cart, 14)}Frais d'inscription : ${money(fee)}</div>` : "";
    const pointBadge = !manage && t.givesLoyaltyPoint !== false ? `<div style="display:inline-flex;align-items:center;gap:7px;color:#22D3EE;font-weight:700;font-size:13px;background:rgba(34,211,238,.08);border:1px solid rgba(34,211,238,.35);border-radius:99px;padding:6px 14px;margin-bottom:18px">${ic(I.medal, 14)}+1 point fidélité</div>` : "";
    const roster: { id: string; name: string; club?: string }[] = Array.isArray(t.players) ? t.players : [];
    const participants = roster.length || manage
      ? `<div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px;margin-top:18px">
          <h3 style="margin:0 0 14px;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6;font-weight:750">Participants (${roster.length})</h3>
          <div style="display:flex;gap:8px;flex-wrap:wrap">${roster.map((p) => `<span style="display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:#F4F5FB;background:#14141D;border:1px solid #282838;border-radius:999px;padding:7px 8px 7px 13px"><span style="display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#22222F;font-size:10px;font-weight:800;color:#22D3EE">${p.name.charAt(0).toUpperCase()}</span>${escHtml(p.name)}${manage ? `<button data-plrem="${t.id}|${p.id}" style="display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:transparent;border:0;color:#8E8FA6;cursor:pointer">${ic(I.x, 12)}</button>` : ""}</span>`).join("")}</div>
          ${roster.length ? "" : `<div style="color:#5D5E72;font-size:13px;margin-bottom:${manage ? "12px" : "0"}">Aucun participant pour l'instant.</div>`}
          ${manage ? `<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><input id="pl-add-name" placeholder="Nom du joueur (@club optionnel)" style="flex:1;min-width:200px;background:#1B1B27;border:1px solid #282838;border-radius:10px;color:#F4F5FB;font-family:inherit;font-size:13px;padding:9px 12px" /><button data-pladd="${t.id}" style="display:inline-flex;align-items:center;gap:6px;background:#1B1B27;border:1px dashed #33334A;color:#22D3EE;border-radius:10px;padding:9px 15px;font-weight:700;font-size:13px;cursor:pointer">${ic(I.plus, 14)}Ajouter</button></div>` : ""}
        </div>`
      : "";
    // Répartition des poules (facultative) : prévisualiser et réordonner l'ordre de
    // passage avant le lancement — sinon le lancement répartit et tire au sort tout seul.
    const poolsList: { id: string; name: string; order: { id: string; name: string }[] }[] = Array.isArray(t.pools) ? t.pools : [];
    const poolsPreview = manage
      ? poolsList.length
        ? `<div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px;margin-top:18px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;flex-wrap:wrap;gap:8px"><h3 style="margin:0;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6;font-weight:750">Répartition des poules</h3><button data-pools-distribute="${t.id}" style="font-size:12px;font-weight:700;color:#22D3EE;background:transparent;border:0;cursor:pointer">Re-répartir au hasard</button></div>
            <p style="color:#5D5E72;font-size:12.5px;margin:0 0 14px">L'ordre définit qui entre sur le terrain en premier dans chaque poule.</p>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px">${poolsList.map((p) => `<div style="border:1px solid #282838;border-radius:12px;padding:14px">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><b style="font-size:13.5px">${escHtml(p.name)}</b><button data-pool-shuffle="${t.id}|${p.id}" title="Rebrasser" style="background:transparent;border:0;color:#8E8FA6;cursor:pointer;display:grid;place-items:center">${ic(I.arrow, 14)}</button></div>
              <div style="display:flex;flex-direction:column;gap:5px">${p.order.map((pl, i) => `<div style="display:flex;align-items:center;gap:6px;font-size:13px;background:#14141D;border:1px solid #282838;border-radius:8px;padding:6px 8px"><span style="color:#5D5E72;width:16px">${i + 1}</span><span style="flex:1">${escHtml(pl.name)}</span><button data-pool-move="${t.id}|${p.id}|${i}|-1" ${i === 0 ? "disabled" : ""} style="background:transparent;border:0;color:${i === 0 ? "#33334A" : "#8E8FA6"};cursor:${i === 0 ? "default" : "pointer"};padding:2px">▲</button><button data-pool-move="${t.id}|${p.id}|${i}|1" ${i === p.order.length - 1 ? "disabled" : ""} style="background:transparent;border:0;color:${i === p.order.length - 1 ? "#33334A" : "#8E8FA6"};cursor:${i === p.order.length - 1 ? "default" : "pointer"};padding:2px">▼</button></div>`).join("")}</div>
            </div>`).join("")}</div>
          </div>`
        : roster.length >= 2
          ? `<div style="text-align:center;margin-top:18px"><button data-pools-distribute="${t.id}" style="display:inline-flex;align-items:center;gap:7px;background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:10px 18px;font-weight:700;font-size:13.5px;cursor:pointer">${ic(I.plus, 15)}Répartir en poules (aperçu avant lancement)</button></div>`
          : ""
      : "";
    const pendingPanel = manage ? paymentsPanel(S, t.id) : "";
    const statTile = (label: string, value: string, color = "#F4F5FB") => `<div style="background:#14141D;padding:14px 16px"><div style="font-size:10px;letter-spacing:1.1px;text-transform:uppercase;color:#8E8FA6;font-weight:750">${label}</div><div style="font-family:'JetBrains Mono',monospace;font-size:22px;color:${color};margin-top:4px">${value}</div></div>`;
    const statTiles = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1px;background:#1B1B27;border:1px solid #1B1B27;border-radius:11px;overflow:hidden;margin-bottom:30px">
      ${statTile("Cagnotte", String(t.cagnotte?.total ?? 0), "#FBBF24")}
      ${statTile("Inscrits", String(roster.length))}
      ${statTile("Frais", fee > 0 ? money(fee) : "Gratuit")}
      ${statTile("Format", escHtml(t.format) || "—")}
    </div>`;
    // Explication générique du format Survival (identique pour tous les tournois — VLOME ne stocke pas de description par tournoi).
    const formatInfo = `<div style="border:1px solid #282838;border-radius:11px;background:#14141D;padding:16px;margin-bottom:30px">
      <div style="display:flex;align-items:center;gap:9px;margin-bottom:8px"><span style="display:grid;place-items:center;width:26px;height:26px;border-radius:8px;background:rgba(34,211,238,.1);border:1px solid rgba(34,211,238,.3);color:#22D3EE">${ic(I.bolt, 14)}</span><b style="font-size:13.5px">Comment ça se joue</b></div>
      <div style="font-size:12.5px;color:#8E8FA6;line-height:1.7">Format Survival : dans chaque poule, le vainqueur reste sur le terrain et enchaîne les adversaires. Les perdants ont une seconde chance (repêchage), puis les meilleurs de chaque poule se rejoignent en phase finale.</div>
    </div>`;
    const actionRail = `<div style="border:1px solid rgba(34,211,238,.35);border-radius:12px;background:rgba(34,211,238,.05);padding:20px;text-align:center">
      <div style="font-size:10.5px;letter-spacing:1.4px;text-transform:uppercase;color:#22D3EE;font-weight:800;margin-bottom:10px">${manage ? "Prêt à démarrer" : "Inscription"}</div>
      ${feeBadge}${pointBadge}
      <p style="color:#8E8FA6;font-size:13.5px;margin:0 0 18px">${sub}</p>
      ${action}
    </div>`;
    const left = `<div class="rise d1 detail-left" style="flex:1;min-width:0;padding:24px 40px 44px;border-right:1px solid #1B1B27">${statTiles}${formatInfo}${participants}${pendingPanel}${poolsPreview}</div>`;
    const right = `<div class="rise d2 stack-sidebar" style="width:340px;flex:none;padding:24px 28px 44px">${actionRail}</div>`;
    return `<main class="rise" style="width:100%"><div style="padding:28px 44px 0">${head}${editCard}</div><div style="display:flex;align-items:flex-start;flex-wrap:wrap">${left}${right}</div>${wizModal}</main>`;
  }

  const poolsHtml = `<div class="rise" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px">${t.pools.map((p: Detail) => poolCard(S, p, manage)).join("")}</div>`;

  const finalsBtn = finalsStartPanel(S, t, manage);


  let finalsHtml = "";
  if (t.finals && t.finals.format === "battle_royale") {
    finalsHtml = battleRoyalePanel(S, t, manage);
  } else if (t.finals) {
    const champ = t.finals.champion
      ? `<div style="border:1px solid rgba(251,191,36,.4);border-radius:16px;background:linear-gradient(180deg,rgba(251,191,36,.08),#14141D);padding:24px;text-align:center;margin-bottom:18px"><div style="font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:#FBBF24;font-weight:800">${ic(I.crown, 16)} Champion du tournoi</div><div style="font-family:'Bebas Neue',sans-serif;font-size:44px;letter-spacing:1px;margin-top:6px">${escHtml(t.finals.champion)}</div></div>`
      : "";
    let body: string;
    let fmtLabel = "";
    if (t.finals.format === "swiss") {
      fmtLabel = ` · Swiss (ronde ${t.finals.rounds.length}/${t.finals.roundCount})`;
      const standings = `<table style="width:100%;border-collapse:collapse;font-size:13.5px;margin-bottom:20px"><thead><tr style="color:#5D5E72;font-size:11px;text-transform:uppercase;letter-spacing:.5px"><td style="padding:6px 8px">#</td><td style="padding:6px 8px">Joueur</td><td style="padding:6px 8px;text-align:right">V</td><td style="padding:6px 8px;text-align:right">Buchholz</td><td style="padding:6px 8px;text-align:right">Pts</td></tr></thead><tbody>${t.finals.standings.map((r: Detail, i: number) => `<tr style="border-top:1px solid #22222F"><td style="padding:7px 8px;color:#5D5E72;font-family:'Bebas Neue',sans-serif;font-size:16px">${i + 1}</td><td style="padding:7px 8px;font-weight:600">${escHtml(r.name)}</td><td style="padding:7px 8px;text-align:right;color:#8E8FA6">${r.wins}</td><td style="padding:7px 8px;text-align:right;color:#8E8FA6">${r.buchholz}</td><td style="padding:7px 8px;text-align:right;font-weight:750;color:#22D3EE">${r.pts}</td></tr>`).join("")}</tbody></table>`;
      body = standings + `<div style="display:flex;flex-direction:column;gap:18px">${t.finals.rounds.map((r: Detail) => roundCol(r.label, r.matches, manage)).join("")}</div>`;
    } else if (t.finals.format === "roundrobin") {
      fmtLabel = " · Round Robin";
      const standings = `<table style="width:100%;border-collapse:collapse;font-size:13.5px;margin-bottom:20px"><thead><tr style="color:#5D5E72;font-size:11px;text-transform:uppercase;letter-spacing:.5px"><td style="padding:6px 8px">#</td><td style="padding:6px 8px">Joueur</td><td style="padding:6px 8px;text-align:right">V</td><td style="padding:6px 8px;text-align:right">Diff.</td><td style="padding:6px 8px;text-align:right">Pts</td></tr></thead><tbody>${t.finals.standings.map((r: Detail, i: number) => `<tr style="border-top:1px solid #22222F"><td style="padding:7px 8px;color:#5D5E72;font-family:'Bebas Neue',sans-serif;font-size:16px">${i + 1}</td><td style="padding:7px 8px;font-weight:600">${escHtml(r.name)}</td><td style="padding:7px 8px;text-align:right;color:#8E8FA6">${r.wins}</td><td style="padding:7px 8px;text-align:right;color:#8E8FA6">${r.gd > 0 ? "+" : ""}${r.gd}</td><td style="padding:7px 8px;text-align:right;font-weight:750;color:#22D3EE">${r.pts}</td></tr>`).join("")}</tbody></table>`;
      body = standings + `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">${t.finals.matches.map((m: Detail) => matchBox(m, manage)).join("")}</div>`;
    } else if (t.finals.format === "double") {
      fmtLabel = " · Double élimination";
      const gf = t.finals.gf2 ? [t.finals.gf, t.finals.gf2] : [t.finals.gf];
      body = `<div style="font-size:11px;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6;font-weight:750;margin-bottom:10px">Bracket des vainqueurs</div><div style="display:flex;gap:24px;overflow-x:auto;padding-bottom:14px">${t.finals.wb.map((r: Detail) => roundCol(r.label, r.matches, manage)).join("")}</div>
        <div style="font-size:11px;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6;font-weight:750;margin:18px 0 10px">Bracket des perdants</div><div style="display:flex;gap:24px;overflow-x:auto;padding-bottom:14px">${t.finals.lb.map((r: Detail) => roundCol(r.label, r.matches, manage)).join("")}</div>
        <div style="font-size:11px;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6;font-weight:750;margin:18px 0 10px">Grande finale${t.finals.gf2 ? " (2e manche — bracket reset)" : ""}</div><div style="display:flex;gap:24px;overflow-x:auto;padding-bottom:10px">${roundCol("", gf, manage)}</div>`;
    } else {
      body = `<div style="display:flex;gap:24px;overflow-x:auto;padding-bottom:10px">${t.finals.rounds.map((r: Detail) => roundCol(r.label, r.matches, manage)).join("")}</div>`;
    }
    const bracketCol = `${champ}<div style="font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:1px;margin-bottom:14px;display:flex;align-items:center;gap:10px"><span style="width:5px;height:22px;border-radius:3px;background:#22D3EE"></span>Phase finale${fmtLabel}</div>${body}`;
    // Panneau organisateur : premier match jouable extrait du bracket pour l'arbitrer en un clic, + suivi de la cagnotte (données déjà calculées plus haut : dist/total/pct).
    const nextMatch = manage ? findPlayableFinalsMatch(t.finals) : null;
    const arbitragePanel = nextMatch ? `<div class="glow" style="border:1px solid rgba(34,211,238,.4);border-radius:12px;background:rgba(34,211,238,.06);padding:16px">
      <div style="font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:#22D3EE;font-weight:800;margin-bottom:12px">Match à arbitrer</div>
      <button data-reportf="${nextMatch.matchId}|${nextMatch.aId}" style="display:block;width:100%;border:1px solid rgba(34,211,238,.4);border-radius:10px;background:rgba(34,211,238,.08);padding:12px;text-align:center;margin-bottom:8px;color:#22D3EE;font-family:'Bebas Neue',sans-serif;font-size:22px;cursor:pointer">${escHtml(nextMatch.aName)}</button>
      <div style="text-align:center;color:#5D5E72;font-family:'Bebas Neue',sans-serif;font-size:16px;margin:4px 0">VS</div>
      <button data-reportf="${nextMatch.matchId}|${nextMatch.bId}" style="display:block;width:100%;border:1px solid rgba(244,63,126,.4);border-radius:10px;background:rgba(244,63,126,.06);padding:12px;text-align:center;color:#F43F7E;font-family:'Bebas Neue',sans-serif;font-size:22px;cursor:pointer">${escHtml(nextMatch.bName)}</button>
      <p style="color:#5D5E72;font-size:11px;margin:10px 0 0;text-align:center">Touche un nom pour déclarer le vainqueur.</p>
    </div>` : "";
    // La cagnotte (points distribués par victoire) ne concerne que le mode Survival.
    const cagnotteTracker = t.mainFormat === "survival" ? `<div style="border:1px solid #282838;border-radius:11px;background:#14141D;padding:14px">
      <div style="font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:#5D5E72;font-weight:800;margin-bottom:10px">Cagnotte</div>
      <div style="display:flex;justify-content:space-between;font-size:12.5px;color:#8E8FA6;margin-bottom:6px">Distribuée<b style="color:#F4F5FB;font-family:'JetBrains Mono',monospace">${dist}</b></div>
      <div style="display:flex;justify-content:space-between;font-size:12.5px;color:#8E8FA6;margin-bottom:10px">Reste à distribuer<b style="color:#FBBF24;font-family:'JetBrains Mono',monospace">${Math.max(0, total - dist)}</b></div>
      <div style="height:7px;border-radius:99px;background:#1B1B27;border:1px solid #282838;overflow:hidden"><span style="display:block;height:100%;width:${pct}%;background:linear-gradient(90deg,#22D3EE,#7C82FF)"></span></div>
    </div>` : "";
    const sideCol = `${arbitragePanel}${cagnotteTracker}`;
    finalsHtml = manage && sideCol
      ? `<div class="grid2c" style="margin-top:26px;display:grid;grid-template-columns:1fr 300px;gap:22px;align-items:start"><div class="rise d1">${bracketCol}</div><div class="rise d2" style="display:flex;flex-direction:column;gap:16px">${sideCol}</div></div>`
      : `<div class="rise" style="margin-top:26px">${bracketCol}</div>`;
  }

  const rosterPanel = playersRosterPanel(S, t, manage);

  return `<main class="rise" style="width:100%;padding:28px 44px 60px">${head}${editCard}${rosterPanel}${finalsHtml || poolsHtml + finalsBtn}</main>${wizModal}`;
}

/** Page d'authentification dédiée : présentation à gauche, formulaire à droite. */
function pAuth(S: State) {
  const isLogin = S.authTab === "login";
  const inp = "width:100%;background:#1B1B27;border:1px solid #282838;border-radius:11px;color:#F4F5FB;font-family:inherit;font-size:14px;padding:12px 13px;margin-top:6px";
  const lbl = "font-size:12px;color:#8E8FA6;font-weight:600;display:block";

  // Déjà connecté : pas de formulaire.
  if (S.user) {
    return `<main class="rise" style="width:100%;padding:28px clamp(22px,3vw,64px) 60px"><div style="max-width:520px;margin:40px auto;border:1px solid #282838;border-radius:20px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:44px 28px;text-align:center">
      <div style="display:grid;place-items:center;width:60px;height:60px;border-radius:18px;background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.4);color:#34D399;margin:0 auto 14px">${ic(I.user, 26)}</div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:28px;letter-spacing:1px;margin-bottom:6px">Tu es déjà connecté</div>
      <p style="color:#8E8FA6;font-size:14px;margin:0 0 20px">${escHtml(S.user.displayName)} · ${escHtml(S.user.email)}</p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button data-go="profil" style="background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:12px 20px;font-weight:750;font-size:14px;cursor:pointer">Mon espace</button>
        <button data-logout="1" style="background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:12px;padding:12px 20px;font-weight:700;font-size:14px;cursor:pointer">Déconnexion</button>
      </div></div></main>`;
  }

  const tab = (k: string, label: string) => `<button data-auth-tab="${k}" style="flex:1;padding:12px;border:0;border-radius:10px;cursor:pointer;font-family:inherit;font-weight:700;font-size:14px;background:${S.authTab === k ? "#22222F" : "transparent"};color:${S.authTab === k ? "#22D3EE" : "#8E8FA6"}">${label}</button>`;
  const roleBtns = ["PLAYER", "ORGANIZER"].map((r) => {
    const on = S.authRole === r;
    const t2 = r === "PLAYER" ? ["Joueur", "Je participe aux tournois"] : ["Organisateur", "Je crée et pilote des tournois"];
    return `<button data-authrole="${r}" style="flex:1;padding:12px;border-radius:12px;cursor:pointer;font-family:inherit;text-align:left;background:${on ? "rgba(34,211,238,.08)" : "#1B1B27"};border:1px solid ${on ? "#22D3EE" : "#282838"}">
      <div style="font-weight:750;font-size:13.5px;color:${on ? "#22D3EE" : "#F4F5FB"}">${t2[0]}</div>
      <div style="font-size:11.5px;color:#8E8FA6;margin-top:2px">${t2[1]}</div></button>`;
  }).join("");

  const loginForm = `
    <label style="${lbl};margin-top:14px">Email<input id="a-email" type="email" placeholder="toi@vlome.tg" style="${inp}" /></label>
    <label style="${lbl};margin-top:14px">Mot de passe<input id="a-pass" type="password" placeholder="••••••" style="${inp}" /></label>`;

  const registerForm = `
    <label style="${lbl};margin-top:14px">Nom affiché (pseudo)<input id="a-name" placeholder="Kossi K9" style="${inp}" /></label>
    <div style="margin-top:14px"><div style="${lbl};margin-bottom:6px">Je m'inscris en tant que</div><div style="display:flex;gap:10px">${roleBtns}</div></div>
    <label style="${lbl};margin-top:14px">Email<input id="a-email" type="email" placeholder="toi@vlome.tg" style="${inp}" /></label>
    <div class="grid2b" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px">
      <label style="${lbl}">Mot de passe (6 caractères min.)<input id="a-pass" type="password" placeholder="••••••" style="${inp}" /></label>
      <label style="${lbl}">Confirme le mot de passe<input id="a-pass2" type="password" placeholder="••••••" style="${inp}" /></label>
    </div>
    <div class="grid2b" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px">
      <label style="${lbl}">Ville <span style="color:#5D5E72">(optionnel)</span><input id="a-city" placeholder="Lomé" style="${inp}" /></label>
      <label style="${lbl}">Jeu favori <span style="color:#5D5E72">(optionnel)</span><input id="a-game" placeholder="EA FC 26, Tekken 8…" style="${inp}" /></label>
    </div>`;

  const perks = [
    [I.crown, "Inscris-toi aux tournois", "Survival, brackets, Battle Royale — suis tes matchs en direct."],
    [I.medal, "Classements & progression", "Points, ELO et historique de tes performances."],
    [I.cart, "Boutique officielle", "Maillots, billets et goodies — paiement mobile money."],
    [I.tv, "Mode Show", "Suis les matchs en plein écran, comme à la télé."],
  ].map(([icn, t2, s2]) => `<div style="display:flex;gap:14px;align-items:flex-start"><span style="display:grid;place-items:center;width:42px;height:42px;border-radius:12px;background:rgba(34,211,238,.07);border:1px solid rgba(34,211,238,.25);color:#22D3EE;flex:none">${ic(icn, 19)}</span><div><div style="font-weight:700;font-size:14.5px">${t2}</div><div style="color:#8E8FA6;font-size:13px;line-height:1.5;margin-top:3px">${s2}</div></div></div>`).join("");

  return `<main class="rise" style="width:100%;padding:28px clamp(22px,3vw,64px) 60px">
    <div class="grid2" style="display:grid;grid-template-columns:1fr 1.1fr;gap:28px;max-width:1180px;margin:0 auto;align-items:center;min-height:70vh">
      <div class="rise d1" style="padding:10px 6px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:22px">${brandLogo(S, 44, 24)}<span style="font-family:'Bebas Neue',sans-serif;font-size:30px;letter-spacing:1.6px">${escHtml(S.site?.brand?.name1 ?? "VLOME")} <span style="color:#22D3EE">${escHtml(S.site?.brand?.name2 ?? "ESPORT")}</span></span></div>
        <h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(32px,3.6vw,50px);letter-spacing:1.2px;line-height:.95;margin:0 0 12px">Rejoins la communauté<br>esport du Togo</h1>
        <p style="color:#8E8FA6;font-size:14.5px;line-height:1.6;max-width:460px;margin:0 0 26px">Un seul compte pour t'inscrire aux tournois, suivre tes résultats, commander à la boutique et vibrer avec la scène.</p>
        <div style="display:flex;flex-direction:column;gap:18px">${perks}</div>
      </div>
      <div class="rise d2" style="border:1px solid #33334A;border-radius:22px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:26px 26px 28px;box-shadow:0 24px 70px rgba(0,0,0,.45)">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:1px;margin-bottom:14px">${isLogin ? "Connexion" : "Créer mon compte"}</div>
        <div style="display:flex;gap:4px;background:#0E0E16;border:1px solid #282838;border-radius:12px;padding:4px;margin-bottom:4px">${tab("login", "Se connecter")}${tab("register", "Créer un compte")}</div>
        ${isLogin ? loginForm : registerForm}
        ${S.authError ? `<div style="display:flex;align-items:center;gap:8px;color:#FB7185;font-size:12.5px;margin-top:14px;background:rgba(251,113,133,.06);border:1px solid rgba(251,113,133,.3);border-radius:10px;padding:10px 12px">${ic(I.warn, 15)}${escHtml(S.authError)}</div>` : ""}
        <button data-auth-submit="1" ${S.authBusy ? "disabled" : ""} style="width:100%;margin-top:18px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:14px;font-weight:750;font-size:15px;cursor:${S.authBusy ? "default" : "pointer"};opacity:${S.authBusy ? ".6" : "1"};box-shadow:0 0 30px rgba(34,211,238,.2)">${S.authBusy ? "…" : isLogin ? "Se connecter" : "Créer mon compte"}</button>
        <p style="color:#5D5E72;font-size:12px;text-align:center;margin:14px 0 0">${isLogin ? `Pas encore de compte ? <button data-auth-tab="register" style="background:none;border:0;color:#22D3EE;font-weight:700;cursor:pointer;font-size:12px;font-family:inherit">Inscris-toi</button>` : `Déjà membre ? <button data-auth-tab="login" style="background:none;border:0;color:#22D3EE;font-weight:700;cursor:pointer;font-size:12px;font-family:inherit">Connecte-toi</button>`}</p>
      </div>
    </div></main>`;
}

/** Modale de confirmation (suppression, déconnexion…). */
function confirmModal(S: State) {
  const c = S.confirmBox;
  if (!c) return "";
  const danger = c.action !== "logout";
  const okColor = danger
    ? "background:linear-gradient(135deg,#FB7185,#e35065);color:#fff"
    : "background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a";
  return `<div data-confirm-cancel="1" style="position:fixed;inset:0;z-index:300;display:grid;place-items:center;padding:20px;background:rgba(6,6,10,.72);backdrop-filter:blur(6px)">
    <div data-stop="1" style="width:100%;max-width:400px;background:linear-gradient(180deg,#14141D,#0E0E16);border:1px solid #33334A;border-radius:20px;padding:26px;box-shadow:0 30px 80px rgba(0,0,0,.6);text-align:center;animation:fadeUp .18s ease both">
      <div style="display:grid;place-items:center;width:54px;height:54px;border-radius:16px;background:${danger ? "rgba(251,113,133,.1)" : "rgba(34,211,238,.08)"};border:1px solid ${danger ? "rgba(251,113,133,.4)" : "rgba(34,211,238,.35)"};color:${danger ? "#FB7185" : "#22D3EE"};margin:0 auto 14px">${ic(danger ? I.warn : I.logout, 24)}</div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:1px;margin-bottom:8px">${c.title}</div>
      <p style="color:#8E8FA6;font-size:14px;line-height:1.55;margin:0 0 20px">${c.message}</p>
      <div style="display:flex;gap:10px;justify-content:center">
        <button data-confirm-cancel="1" style="flex:1;background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:12px;padding:12px 18px;font-weight:700;font-size:14px;cursor:pointer">Annuler</button>
        <button data-confirm-ok="1" style="flex:1;border:0;border-radius:12px;padding:12px 18px;font-weight:750;font-size:14px;cursor:pointer;${okColor}">${c.okLabel}</button>
      </div>
    </div></div>`;
}

function cartDrawer(S: State) {
  if (!S.cartOpen) return "";
  if (S.lastOrder) {
    const o = S.lastOrder;
    return `<div data-cart-close="1" style="position:fixed;inset:0;z-index:200;background:rgba(6,6,10,.6);backdrop-filter:blur(4px)">
      <div data-stop="1" style="position:absolute;top:0;right:0;height:100%;width:min(420px,92vw);background:#0E0E16;border-left:1px solid #282838;padding:22px;display:flex;flex-direction:column">
        <div style="display:flex;align-items:center;justify-content:flex-end;margin-bottom:8px"><span data-cart-close="1" style="color:#8E8FA6;cursor:pointer">${ic(I.x, 20)}</span></div>
        <div class="rise" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:6px">
          <div style="display:grid;place-items:center;width:64px;height:64px;border-radius:18px;background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.4);color:#34D399;margin-bottom:10px">${ic(I.crown, 26)}</div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:1px">Commande enregistrée</div>
          <div style="color:#8E8FA6;font-size:13.5px;max-width:280px;margin-top:4px">Réf. <b style="color:#F4F5FB">${escHtml(o.reference)}</b> · ${money(o.totalXof)} · paiement ${escHtml(o.paymentMethod)}. Elle sera confirmée par l'équipe VLOME à réception du paiement.</div>
        </div>
        <div style="border-top:1px solid #282838;padding-top:16px;margin-top:8px;display:flex;flex-direction:column;gap:8px">
          <button data-cart-vieworders="1" style="width:100%;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:13px;font-weight:750;font-size:15px;cursor:pointer">Voir mes commandes</button>
          <button data-cart-close="1" style="width:100%;background:transparent;border:1px solid #282838;color:#8E8FA6;border-radius:12px;padding:11px;font-weight:600;font-size:13px;cursor:pointer">Continuer mes achats</button>
        </div>
      </div></div>`;
  }
  const total = S.cartItems.reduce((a, i) => a + i.price, 0);
  const rows = S.cartItems.length
    ? S.cartItems.map((i, idx) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 0;border-bottom:1px solid #22222F"><div><div style="font-weight:600;font-size:14px">${escHtml(i.name)}</div><div style="font-size:12.5px;color:#22D3EE;font-weight:700;font-family:'JetBrains Mono',monospace">${money(i.price)}</div></div><button data-cart-remove="${idx}" style="display:grid;place-items:center;width:32px;height:32px;background:transparent;border:1px solid #282838;border-radius:9px;color:#8E8FA6;cursor:pointer">${ic(I.trash, 15)}</button></div>`).join("")
    : `<div style="color:#5D5E72;font-size:14px;text-align:center;padding:40px 0">Ton panier est vide.<br>Ajoute des articles depuis la boutique.</div>`;
  const payChips = S.cartItems.length ? `<div style="margin-bottom:14px">
    <div style="color:#8E8FA6;font-size:12px;font-weight:700;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Moyen de paiement</div>
    <div style="display:flex;gap:7px;flex-wrap:wrap">${PAYMENTS.map((m) => `<button data-cartpaypick="${m}" style="font-size:12px;font-weight:700;border-radius:9px;padding:8px 12px;cursor:pointer;background:${S.cartPayPick === m ? "rgba(34,211,238,.1)" : "#1B1B27"};border:1px solid ${S.cartPayPick === m ? "#22D3EE" : "#282838"};color:${S.cartPayPick === m ? "#22D3EE" : "#8E8FA6"}">${m}</button>`).join("")}</div>
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
  const loyaltyBox = S.user && maxPoints > 0 ? `<div style="margin-bottom:14px;border:1px solid #282838;border-radius:12px;background:#14141D;padding:12px 14px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
      <span style="font-size:12px;color:#8E8FA6;font-weight:700;text-transform:uppercase;letter-spacing:.5px">Points fidélité</span>
      <span style="font-size:12px;color:#5D5E72">Solde : <b style="color:#F4F5FB">${S.loyaltyBalance}</b></span>
    </div>
    <div style="display:flex;align-items:center;gap:10px">
      <button data-cartpts="${Math.max(0, chosenPoints - 1)}" style="width:30px;height:30px;border-radius:8px;background:#1B1B27;border:1px solid #282838;color:#F4F5FB;cursor:pointer">−</button>
      <span style="flex:1;text-align:center;font-family:'JetBrains Mono',monospace;font-weight:700">${chosenPoints} pt${chosenPoints > 1 ? "s" : ""}</span>
      <button data-cartpts="${Math.min(maxPoints, chosenPoints + 1)}" style="width:30px;height:30px;border-radius:8px;background:#1B1B27;border:1px solid #282838;color:#F4F5FB;cursor:pointer">+</button>
      <button data-cartpts="${maxPoints}" style="font-size:11.5px;font-weight:700;color:#22D3EE;background:transparent;border:1px solid rgba(34,211,238,.35);border-radius:8px;padding:0 10px;height:30px;cursor:pointer">Max</button>
    </div>
    ${discount > 0 ? `<div style="margin-top:8px;font-size:12.5px;color:#34D399;font-weight:700">− ${money(discount)} appliqués</div>` : ""}
  </div>` : "";
  const canOrder = S.cartItems.length > 0 && !!S.cartPayPick && !S.cartBusy;
  return `<div data-cart-close="1" style="position:fixed;inset:0;z-index:200;background:rgba(6,6,10,.6);backdrop-filter:blur(4px)">
    <div data-stop="1" style="position:absolute;top:0;right:0;height:100%;width:min(420px,92vw);background:#0E0E16;border-left:1px solid #282838;padding:22px;display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><span style="font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:1px">Panier</span><span data-cart-close="1" style="color:#8E8FA6;cursor:pointer">${ic(I.x, 20)}</span></div>
      <div style="flex:1;overflow-y:auto">${rows}</div>
      <div style="border-top:1px solid #282838;padding-top:16px;margin-top:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><span style="color:#8E8FA6;font-size:14px">Total</span><span style="text-align:right">${discount > 0 ? `<div style="font-size:13px;color:#5D5E72;text-decoration:line-through">${money(total)}</div>` : ""}<span style="font-family:'Bebas Neue',sans-serif;font-size:26px;color:#22D3EE">${money(netTotal)}</span></span></div>
        ${loyaltyBox}
        ${payChips}
        <button ${canOrder ? "" : "disabled"} data-checkout="1" style="width:100%;background:${canOrder ? "linear-gradient(135deg,#22D3EE,#12aec4)" : "#22222F"};color:${canOrder ? "#04222a" : "#5D5E72"};border:0;border-radius:12px;padding:13px;font-weight:750;font-size:15px;cursor:${canOrder ? "pointer" : "default"};opacity:${S.cartItems.length ? "1" : ".5"}">${S.cartBusy ? "Envoi…" : "Commander"}</button>
        ${S.cartItems.length ? `<button data-cart-clear="1" style="width:100%;margin-top:8px;background:transparent;border:1px solid #282838;color:#8E8FA6;border-radius:12px;padding:11px;font-weight:600;font-size:13px;cursor:pointer">Vider le panier</button>` : ""}
      </div>
    </div></div>`;
}

/** Table de classement plein écran (Mode Show) — top 8, réutilisée pour poules Survival, Round Robin/Swiss et Battle Royale. */
function showStandingsTable(rows: { name: string; pts: number }[], ptsLabel: string): string {
  if (!rows.length) return `<div style="text-align:center;color:#5D5E72;font-size:2.2vh;margin-top:3vh">Classement pas encore disponible.</div>`;
  return `<div style="max-width:min(880px,74vw);margin:2.4vh auto 0"><table style="width:100%;border-collapse:collapse">
    <thead><tr style="color:#5D5E72;font-size:1.4vh;text-transform:uppercase;letter-spacing:2px"><td style="padding:.7vh 1vw">#</td><td style="padding:.7vh 1vw">Joueur</td><td style="padding:.7vh 1vw;text-align:right">${ptsLabel}</td></tr></thead>
    <tbody>${rows.map((r, i) => `<tr style="border-top:1px solid #22222F"><td style="padding:1vh 1vw;font-family:'Bebas Neue',sans-serif;font-size:3vh;color:${i === 0 ? "#FBBF24" : "#5D5E72"}">${i + 1}</td><td style="padding:1vh 1vw;font-weight:700;font-size:2.2vh">${escHtml(r.name)}</td><td style="padding:1vh 1vw;text-align:right;font-weight:800;color:#22D3EE;font-size:2.6vh">${r.pts}</td></tr>`).join("")}</tbody>
  </table></div>`;
}
/** Un à trois duels en gros plan (Mode Show) — phase finale single/double/round robin/swiss, ou file d'attente Survival. */
function showMatchesFocus(matches: { aName: string; bName: string }[]): string {
  if (!matches.length) return `<div style="text-align:center;color:#5D5E72;font-size:2.2vh;margin-top:3vh">En attente du prochain match…</div>`;
  const box = (m: { aName: string; bName: string }) => `<div style="display:flex;align-items:center;justify-content:center;gap:2vw;flex-wrap:wrap">
    <div style="text-align:center;flex:1;min-width:0"><div style="font-family:'Bebas Neue',sans-serif;font-size:${matches.length > 1 ? 5.5 : 8}vh;color:#22D3EE;line-height:1">${escHtml(m.aName)}</div></div>
    <div style="font-family:'Bebas Neue',sans-serif;font-size:${matches.length > 1 ? 2 : 3.4}vh;color:#5D5E72;flex:none">VS</div>
    <div style="text-align:center;flex:1;min-width:0"><div style="font-family:'Bebas Neue',sans-serif;font-size:${matches.length > 1 ? 5.5 : 8}vh;color:#F43F7E;line-height:1">${escHtml(m.bName)}</div></div>
  </div>`;
  return `<div style="display:flex;flex-direction:column;gap:${matches.length > 1 ? 2.6 : 0}vh;margin-top:3vh;max-width:82vw;margin-left:auto;margin-right:auto">${matches.map(box).join("")}</div>`;
}
/** Derniers résultats (Mode Show) — vainqueur mis en avant, une ligne par match. */
function showRecentResults(matches: Detail[]): string {
  return `<div style="max-width:min(760px,66vw);margin:2.6vh auto 0;display:flex;flex-direction:column;gap:1.6vh">${matches.map((m: Detail) => {
    const win = m.winnerId === m.aId ? m.aName : m.bName, lose = m.winnerId === m.aId ? m.bName : m.aName;
    return `<div style="display:flex;align-items:center;justify-content:center;gap:1.2vw;font-size:2.4vh;border-bottom:1px solid #1B1B27;padding-bottom:1.4vh">${ic(I.crown, 18)}<span style="color:#22D3EE;font-weight:800">${escHtml(win)}</span><span style="color:#5D5E72;font-size:1.9vh">a battu</span><span style="color:#5D5E72">${escHtml(lose)}</span></div>`;
  }).join("")}</div>`;
}
/** Battle Royale (Mode Show) — partie à venir, ou podium de la dernière partie jouée. */
function showBRSlide(f: Detail): string {
  const nextGame = f.games.find((g: Detail) => !g.played);
  const lastGame = [...f.games].reverse().find((g: Detail) => g.played);
  const status = nextGame
    ? `<div style="color:#22D3EE;font-weight:800;letter-spacing:2px;font-size:1.7vh;text-transform:uppercase">${escHtml(nextGame.label)} à venir</div>`
    : `<div style="color:#34D399;font-weight:800;letter-spacing:2px;font-size:1.7vh;text-transform:uppercase">Toutes les parties ont été jouées</div>`;
  const podium = lastGame ? `<div style="margin-top:3vh;display:flex;justify-content:center;align-items:flex-end;gap:3vw"><div style="text-align:center;color:#5D5E72;font-size:1.4vh">${escHtml(lastGame.label)}</div></div>
    <div style="margin-top:1vh;display:flex;justify-content:center;align-items:flex-end;gap:3vw">${lastGame.ranking.slice(0, 3).map((r: Detail, i: number) => `<div style="text-align:center"><div style="font-family:'Bebas Neue',sans-serif;font-size:${i === 0 ? 8 : 5.5}vh;color:${i === 0 ? "#FBBF24" : i === 1 ? "#D1D5DB" : "#B45309"};line-height:1">${escHtml(r.name)}</div><div style="color:#5D5E72;font-size:1.4vh;margin-top:.6vh">${i + 1}${i === 0 ? "ʳᵉ" : "ᵉ"} place</div></div>`).join("")}</div>` : "";
  return `<div style="text-align:center">${status}${podium}</div>`;
}

function pShow(S: State) {
  const t = S.detail;
  const close = `<button data-showclose="1" style="position:absolute;top:16px;right:18px;background:#1B1B27;border:1px solid #33334A;color:#8E8FA6;border-radius:10px;padding:8px 12px;font-weight:700;font-size:12px;cursor:pointer;z-index:5">Fermer</button>`;
  const brand = `<div style="display:flex;align-items:center;justify-content:center;gap:1.4vh;margin-bottom:2vh">${brandLogo(S, 38, 20)}<span style="font-family:'Bebas Neue',sans-serif;font-size:3vh;letter-spacing:2.5px;color:#8E8FA6">${escHtml(S.site?.brand?.name1 ?? "VLOME")} <span style="color:#22D3EE">${escHtml(S.site?.brand?.name2 ?? "ESPORT")}</span></span></div>`;
  if (!t) return `<div style="min-height:100vh;display:grid;place-items:center;color:#8E8FA6">${close}Chargement de l'affichage…</div>`;
  if (t.status === "finished" && t.champion) {
    return `<div style="min-height:100vh;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:4vh 3vw;position:relative">${close}${brand}
      <div style="text-align:center"><div style="display:inline-flex;align-items:center;gap:1vh;color:#FBBF24;font-size:2vh;letter-spacing:2px;text-transform:uppercase;font-weight:800">${ic(I.crown, 22)} Champion du tournoi</div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:14vh;line-height:.9;color:#22D3EE;letter-spacing:1px;margin-top:1vh">${t.champion}</div>
      <div style="color:#8E8FA6;font-size:2.4vh;margin-top:1vh">${t.name}</div></div></div>`;
  }

  // Construit les diapositives disponibles pour l'état actuel (format + phase) — tournent automatiquement.
  type Slide = { caption: string; body: string };
  const slides: Slide[] = [];
  let phaseLabel = "";
  if (!t.finals) {
    // Survival, poules en cours.
    phaseLabel = "Phase 1 · poules";
    const poolCard = (p: Detail) => {
      let match: string;
      if (p.current) {
        match = `<div style="display:flex;align-items:center;justify-content:center;gap:2.2vw;flex-wrap:wrap"><div style="text-align:center"><div style="color:#22D3EE;font-size:1.4vh;font-weight:800;text-transform:uppercase;letter-spacing:1px">Survivant${p.current.streak > 1 ? " · série " + p.current.streak : ""}</div><div style="font-family:'Bebas Neue',sans-serif;font-size:5.5vh;color:#22D3EE;line-height:1;margin-top:.4vh">${p.current.aName}</div></div><div style="font-family:'Bebas Neue',sans-serif;font-size:3.4vh;color:#5D5E72">VS</div><div style="text-align:center"><div style="color:#F43F7E;font-size:1.4vh;font-weight:800;text-transform:uppercase;letter-spacing:1px">Challenger</div><div style="font-family:'Bebas Neue',sans-serif;font-size:5.5vh;color:#F43F7E;line-height:1;margin-top:.4vh">${p.current.bName}</div></div></div>`;
      } else if (p.done) {
        match = `<div style="text-align:center;color:#34D399;font-weight:700;font-size:2vh;padding:1vh 0">Qualifiés : ${p.top1}${p.top2 ? ", " + p.top2 : ""}</div>`;
      } else match = `<div style="text-align:center;color:#5D5E72;padding:1vh 0">En attente du lancement…</div>`;
      const lead = p.ranking?.[0] ? `<div style="text-align:center;color:#8E8FA6;font-size:1.5vh;margin-top:1.4vh">Leader : <b style="color:#F4F5FB">${p.ranking[0].name}</b> · ${p.ranking[0].pts} pts</div>` : "";
      return `<div style="border:1px solid #282838;border-radius:18px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:2.6vh 2vw"><div style="font-family:'Bebas Neue',sans-serif;font-size:2.4vh;letter-spacing:1.5px;text-align:center;margin-bottom:1.6vh;color:#8E8FA6">${p.name}</div>${match}${lead}</div>`;
    };
    const grid = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(440px,92vw),1fr));gap:2vh;margin-top:2.4vh">${(t.pools || []).map(poolCard).join("")}</div>`;
    slides.push({ caption: "Poules en direct", body: grid });
    const overall: Detail[] = ([] as Detail[]).concat(...(t.pools || []).map((p: Detail) => p.ranking || [])).sort((a: Detail, b: Detail) => b.pts - a.pts || b.wins - a.wins);
    if (overall.some((r) => r.pts > 0)) slides.push({ caption: "Classement général", body: showStandingsTable(overall.slice(0, 8), "Pts") });
  } else if (t.finals.format === "battle_royale") {
    phaseLabel = "Battle Royale";
    slides.push({ caption: "Classement cumulé", body: showStandingsTable(t.finals.standings.slice(0, 8), "Pts") });
    slides.push({ caption: "Parties", body: showBRSlide(t.finals) });
  } else if (t.finals.format === "roundrobin" || t.finals.format === "swiss") {
    phaseLabel = t.finals.format === "swiss" ? `Swiss · ronde ${t.finals.rounds.length}/${t.finals.roundCount}` : "Round Robin";
    slides.push({ caption: "Classement", body: showStandingsTable(t.finals.standings.slice(0, 8), "Pts") });
    const playable = finalsMatchGroups(t.finals).flat().filter((m): m is Detail => !!m && m.playable);
    if (playable.length) slides.push({ caption: playable.length > 1 ? `${playable.length} matchs en direct` : "Match en direct", body: showMatchesFocus(playable.slice(0, 3)) });
    const played = finalsMatchGroups(t.finals).flat().filter((m): m is Detail => !!m && !!m.winnerId).slice(-4).reverse();
    if (played.length) slides.push({ caption: "Derniers résultats", body: showRecentResults(played) });
  } else {
    // single / double élimination.
    phaseLabel = t.finals.format === "double" ? "Double élimination" : "Élimination simple";
    const playable = finalsMatchGroups(t.finals).flat().filter((m): m is Detail => !!m && m.playable);
    slides.push({ caption: playable.length > 1 ? `${playable.length} matchs en direct` : "Phase finale", body: showMatchesFocus(playable.slice(0, 3)) });
    const played = finalsMatchGroups(t.finals).flat().filter((m): m is Detail => !!m && !!m.winnerId && !m.bye).slice(-4).reverse();
    if (played.length) slides.push({ caption: "Derniers résultats", body: showRecentResults(played) });
  }
  if (!slides.length) slides.push({ caption: "", body: `<div style="text-align:center;color:#5D5E72;font-size:2.2vh;margin-top:3vh">En attente…</div>` });
  const idx = ((S.showSlide % slides.length) + slides.length) % slides.length;
  const active = slides[idx];
  const dots = slides.length > 1 ? `<div style="display:flex;gap:.9vh;justify-content:center;margin-top:4vh">${slides.map((_, i) => `<span style="display:inline-block;width:${i === idx ? "2.6vh" : "1vh"};height:.6vh;border-radius:99px;background:${i === idx ? "#22D3EE" : "#33334A"};transition:width .3s"></span>`).join("")}</div>` : "";

  const title = `<div style="text-align:center;margin-bottom:1vh"><div style="font-family:'Bebas Neue',sans-serif;font-size:5.5vh;letter-spacing:2px;line-height:1">${escHtml(t.name)}</div>
    <div style="display:inline-flex;align-items:center;gap:.8vh;color:${t.status === "live" ? "#22D3EE" : "#8E8FA6"};font-weight:800;letter-spacing:2px;font-size:1.7vh;text-transform:uppercase;margin-top:1vh">${t.status === "live" ? `<span style="width:1vh;height:1vh;border-radius:50%;background:#22D3EE;animation:blink 1.2s infinite"></span>` : ""}${phaseLabel}</div></div>`;
  const caption = active.caption ? `<div style="text-align:center;color:#5D5E72;font-size:1.6vh;letter-spacing:1.5px;text-transform:uppercase;font-weight:750;margin-top:2.4vh">${escHtml(active.caption)}</div>` : "";
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
  const label = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px"><span style="width:5px;height:22px;border-radius:3px;background:#5D5E72;display:inline-block"></span><h3 style="margin:0;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6;font-weight:750">Contenu sponsorisé</h3></div>`;
  const inner = `<div class="slidein" style="display:flex;align-items:center;gap:26px;padding:20px 24px;flex-wrap:wrap">
    <div style="flex:none;width:180px;height:104px;border-radius:12px;overflow:hidden;background:#0B0B11;display:flex;align-items:center;justify-content:center">
      <img src="${mediaUrl(ad.imageUrl)}" alt="${escAttr(ad.label || "Publicité")}" style="max-width:100%;max-height:100%;object-fit:contain" />
    </div>
    <div style="flex:1;min-width:200px">
      <div style="font-weight:750;font-size:16px">${ad.label ? escHtml(ad.label) : "Un partenaire VLOME Esport"}</div>
      <div style="font-size:12.5px;color:#5D5E72;margin-top:4px">Cet emplacement soutient l'organisation des tournois VLOME.</div>
    </div>
    ${ad.linkUrl ? `<span style="flex:none;display:inline-flex;align-items:center;gap:7px;background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:11px 18px;font-weight:700;font-size:13.5px">Découvrir ${ic(I.arrow, 15)}</span>` : ""}
  </div>`;
  const card = `<div class="hcard" style="border:1px solid #282838;border-radius:16px;overflow:hidden;background:linear-gradient(90deg,#14141D,#0E0E16)">${inner}</div>`;
  const clickable = ad.linkUrl ? `<a href="${escAttr(ad.linkUrl)}" target="_blank" rel="noopener sponsored" style="display:block;text-decoration:none;color:inherit">${card}</a>` : card;
  const dots = items.length > 1
    ? `<div style="display:flex;gap:6px;justify-content:center;margin-top:12px">${items.map((_, i) => `<span data-adslide="${i}" style="display:inline-block;width:${i === idx ? 18 : 7}px;height:6px;border-radius:99px;background:${i === idx ? "#7C82FF" : "#33334A"};cursor:pointer;transition:width .2s"></span>`).join("")}</div>`
    : "";
  return `<section style="margin:0 0 44px">${label}${clickable}${dots}</section>`;
}

/** Bandeau permanent des partenaires — présent sur toutes les pages, sous l'en-tête. */
function partnersMarquee(S: State) {
  const partners = normPartners(S);
  if (!partners.length) return "";
  const items = partners.map((p) => `<span style="display:inline-flex;align-items:center;gap:8px;margin:0 22px;font-size:12px;font-weight:700;color:#5D5E72;letter-spacing:.4px">${p.logoUrl ? `<img src="${mediaUrl(p.logoUrl)}" alt="" style="width:16px;height:16px;object-fit:contain;border-radius:4px" />` : ic(I.crown, 12)}${escHtml(p.name)}</span>`).join("");
  return `<div class="marquee" style="border-bottom:1px solid #1B1B27;background:#0B0B11;padding:7px 0"><div class="marquee-track">${items}${items}</div></div>`;
}

/** Pages du module contenu : shell rail (barre live + rail d'icônes) au lieu du header public. */
const RAIL_PAGES: Record<string, (s: State) => string> = { accueil: pAccueil, tournois: pTournois, tournoi: pTournoi, classements: pClassements, galerie: pGalerie, boutique: pBoutique, profil: pDashboard, auth: pAuth };

function renderPage(S: State) {
  if (S.page === "show") return pShow(S);
  // Organisateur/admin sur « Mon espace » : shell console (sidebar) autonome, pas le rail du module contenu.
  if (S.page === "profil" && canManage(S)) return consolePage(S);
  // Régie organisateur/admin pendant qu'un tournoi est en direct : écran plein cadre autonome (rail·centre·contrôle), hors du rail public — même principe que la console.
  if (S.page === "tournoi" && canManage(S) && S.detail && S.detail.status === "live") return regiePage(S);
  if (RAIL_PAGES[S.page]) {
    const activeKey = S.page === "tournoi" ? "tournois" : S.page;
    return railShell(S, activeKey, RAIL_PAGES[S.page](S)) + cartDrawer(S) + confirmModal(S);
  }
  const body = S.page === "auth" ? pAuth(S) : pAccueil(S);
  const footer = `<footer style="border-top:1px solid #282838;padding:26px 22px;text-align:center;color:#5D5E72;font-size:12.5px">© ${new Date().getFullYear()} MIABE-ESPORT · Le hub de l'esport togolais &amp; ouest-africain</footer>`;
  return header(S) + partnersMarquee(S) + body + footer + cartDrawer(S) + confirmModal(S);
}

/* ================= Composant ================= */
export default function Page() {
  const [S, setS] = useState<State>({
    page: "accueil", slide: 0, fmt: "Tous", scope: "Togo", game: "Tous", cat: "Tous", tournStatus: "Tous",
    tourns: null, creating: false, busy: false, leaderboard: null,
    cartItems: [], cartOpen: false, products: null, cartPayPick: "", cartBusy: false, lastOrder: null,
    cartPointsToRedeem: 0, regPointsToRedeem: 0, loyaltySettings: null, loyaltyHistory: null, loyaltyBalance: 0,
    user: null, authTab: "login", authBusy: false, authError: "", authRole: "PLAYER",
    q: "",
    openId: null, detail: null, detailBusy: false, editing: false, admin: null,
    adminTab: "apercu", adminSearch: "", newsEdit: null, prodEdit: null, news: null, confirmBox: null,
    prodCat: "Tous", prodSort: "", prodSortDir: "asc",
    site: null, siteMsg: "",
    me: null, myRegs: null, myOrders: null, myTourns: null, myResults: null,
    regIds: [], profileMsg: "", passMsg: "", profileEdit: false,
    payPick: "", gallery: null, galleryEdit: null, galleryFilter: "", galleryOpen: null, galleryType: "", boutiqueInStock: false, regsPanel: null,
    partnersEdit: null, adsEdit: null, adSlide: 0, slidesEdit: null,
    editingPlayerId: null, finalsFormatPick: "single", brPick: [],
    activeMatchId: null, matchScoreA: 0, matchScoreB: 0, regiePanel: null, bracketView: "tree", rosterQ: "", showSlide: 0, consoleMenuOpen: false,
    wizStep: 1,
    wizData: { name: "", game: "", date: "", place: "", format: "SURVIVAL", pointsPerPlayer: 5, nbPools: 2, players: [], entryFeeXof: 0, givesLoyaltyPoint: true, survWin: 1, loserWin: 0.5, poolFinalWin: 1.5, finalsWin: 2, championBonus: 3, imageUrl: null },
    wizRosterSearch: "", wizEditId: null,
    roster: null, clubs: null, rosterEdit: null, clubEdit: null, rosterTab: "joueurs", classementView: "joueurs",
  });
  const html = useMemo(() => renderPage(S), [S]);

  // Les animations d'entrée (.rise) ne jouent qu'au changement de page :
  // tout autre re-rendu recrée le DOM et les rejouerait sinon.
  const prevPage = useRef<string | null>(null);
  const pageChanged = prevPage.current !== S.page;
  useEffect(() => { prevPage.current = S.page; });

  /* ---------- Pilotage d'un tournoi ---------- */
  async function openDetail(id: string, page = "tournoi") {
    setS((s) => ({ ...s, page, openId: id, detail: null, regsPanel: null, payPick: "", regPointsToRedeem: 0, activeMatchId: null, matchScoreA: 0, matchScoreB: 0, regiePanel: null, brPick: [], showSlide: 0 }));
    window.scrollTo({ top: 0 });
    try {
      const r = await fetch(`${API}/api/tournaments/${id}/state`);
      if (r.ok) { const d = await r.json(); setS((s) => ({ ...s, detail: d })); }
    } catch { /* API hors ligne */ }
    if (token() && (S.user?.role === "ORGANIZER" || S.user?.role === "ADMIN")) loadRegsPanel(id);
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
    try { const img = await uploadFile("e-img"); if (img) body.imageUrl = img; } catch { return; }
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

  async function submitAuth() {
    const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";
    const email = val("a-email").trim(), password = val("a-pass"), displayName = val("a-name").trim();
    const isLogin = S.authTab === "login";
    if (!email || !password) { setS((s) => ({ ...s, authError: "Email et mot de passe requis." })); return; }
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
          : { email, password, displayName, role: S.authRole, city: val("a-city").trim(), favoriteGame: val("a-game").trim() }),
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
      const r = await fetch(`${API}/api/gallery`);
      if (r.ok) { const rows = await r.json(); setS((s) => ({ ...s, gallery: rows })); }
    } catch { /* ignore */ }
  }
  async function saveGalleryItem() {
    const val = (x: string) => (document.getElementById(x) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";
    const title = val("ga-title").trim();
    if (!title) { alert("Le titre est requis."); return; }
    let mediaUrl: string | null = null;
    try { mediaUrl = await uploadFile("ga-file"); } catch { return; }
    if (!mediaUrl) { alert("Choisis une photo ou une vidéo."); return; }
    try {
      const r = await fetch(`${API}/api/gallery`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ title, mediaUrl, tournamentId: val("ga-tourn") || undefined }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({} as Detail)); alert(d.message || "Ajout impossible."); return; }
      setS((s) => ({ ...s, galleryEdit: null }));
      await loadGallery();
      if (S.admin) loadAdmin();
    } catch { /* ignore */ }
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
      const [rR, cR] = await Promise.all([
        fetch(`${API}/api/roster`, { headers: authHeaders() }),
        fetch(`${API}/api/clubs`, { headers: authHeaders() }),
      ]);
      const roster = rR.ok ? await rR.json() : [];
      const clubs = cR.ok ? await cR.json() : [];
      setS((s) => ({ ...s, roster, clubs }));
    } catch { /* ignore */ }
  }
  async function loadProducts() {
    try {
      const r = await fetch(`${API}/api/products`);
      if (!r.ok) return;
      const rows: { id: string; name: string; category: string; priceXof: number; imageUrl?: string | null; loyaltyEligible?: boolean }[] = await r.json();
      if (Array.isArray(rows) && rows.length) {
        setS((s) => ({ ...s, products: rows.map((p) => ({ id: p.id, cat: p.category, name: p.name, price: p.priceXof, ph: p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), img: p.imageUrl || null, loyaltyEligible: !!p.loyaltyEligible })) }));
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
  async function checkout() {
    if (!S.cartItems.length || !S.cartPayPick) return;
    if (!token()) { setS((s) => ({ ...s, cartOpen: false, page: "auth" })); window.scrollTo({ top: 0 }); return; }
    setS((s) => ({ ...s, cartBusy: true }));
    try {
      const r = await fetch(`${API}/api/orders`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          items: S.cartItems.map((i) => ({ name: i.name, priceXof: i.price, productId: i.id })),
          paymentMethod: S.cartPayPick, pointsToRedeem: S.cartPointsToRedeem || 0,
        }),
      });
      if (r.status === 401) { setS((s) => ({ ...s, page: "auth", user: null, cartBusy: false })); return; }
      if (r.ok) {
        const o = await r.json();
        setS((s) => ({ ...s, cartItems: [], cartPayPick: "", cartBusy: false, cartPointsToRedeem: 0, me: null, myOrders: null, loyaltyHistory: null, lastOrder: { reference: o.reference, totalXof: o.totalXof, paymentMethod: o.paymentMethod } }));
      } else setS((s) => ({ ...s, cartBusy: false }));
    } catch { setS((s) => ({ ...s, cartBusy: false })); }
  }

  async function loadAdmin() {
    try {
      const get = (p: string) => fetch(`${API}/api/admin/${p}`, { headers: authHeaders() });
      const [ovR, usR, nwR, prR, orR, payR] = await Promise.all([get("overview"), get("users"), get("news"), get("products"), get("orders"), get("payments")]);
      if (ovR.ok && usR.ok) {
        const [overview, users, news, products, orders, payments] = await Promise.all([
          ovR.json(), usR.json(),
          nwR.ok ? nwR.json() : [], prR.ok ? prR.json() : [], orR.ok ? orR.json() : [], payR.ok ? payR.json() : [],
        ]);
        setS((s) => ({ ...s, admin: { overview, users, news, products, orders, payments } }));
      }
    } catch { /* ignore */ }
  }
  /** Envoie le fichier choisi dans <input type=file> et renvoie son URL (/uploads/…). */
  async function uploadFile(inputId: string): Promise<string | null> {
    const el = document.getElementById(inputId) as HTMLInputElement | null;
    const f = el?.files?.[0];
    if (!f) return null;
    const fd = new FormData();
    fd.append("file", f);
    const r = await fetch(`${API}/api/uploads`, { method: "POST", headers: authHeaders(), body: fd });
    if (!r.ok) {
      const d = await r.json().catch(() => ({} as Detail));
      alert(d.message || "Échec de l'envoi de l'image.");
      throw new Error("upload");
    }
    return (await r.json()).url as string;
  }

  /** Enregistre les réglages du site (identité, héro, slider, partenaires). */
  /** Relit les champs texte des lignes partenaires/pubs depuis le DOM, sans perdre les logos déjà choisis. */
  function syncPartnersFromDom(list: NonNullable<State["partnersEdit"]>) {
    return list.map((p) => ({ ...p, name: (document.getElementById(`pt-${p.key}-name`) as HTMLInputElement | null)?.value ?? p.name }));
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
    try {
      const up = await uploadFile("b-logo"); if (up) logoUrl = up;
      const bg = await uploadFile("h-bg"); if (bg) heroBg = bg;
      for (const sl of slideRows) { const im = await uploadFile(`sl-${sl.key}-img`); if (im) sl.imageUrl = im; }
      for (const p of partnerRows) { const im = await uploadFile(`pt-${p.key}-logo`); if (im) p.logoUrl = im; }
      for (const a of adRows) { const im = await uploadFile(`ad-${a.key}-img`); if (im) a.imageUrl = im; }
    } catch { return; }
    const brand = { name1: val("b-name1").trim() || "VLOME", name2: val("b-name2").trim(), logoUrl };
    const hero = {
      kicker: val("h-kicker").trim(), title: val("h-title"), subtitle: val("h-sub").trim(),
      bgUrl: heroBg,
      stats: [0, 1, 2].map((i) => ({ v: val(`h-s${i}v`).trim(), k: val(`h-s${i}k`).trim() })).filter((st) => st.v || st.k),
    };
    const slides = slideRows
      .filter((sl) => sl.title.trim())
      .map((sl) => ({ tag: sl.tag.trim(), title: sl.title.trim(), sub: sl.sub.trim(), cta: sl.cta.trim(), imageUrl: sl.imageUrl }));
    const partners = partnerRows.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), logoUrl: p.logoUrl }));
    const ads = adRows.filter((a) => a.imageUrl).map((a) => ({ label: a.label.trim(), linkUrl: a.linkUrl.trim(), imageUrl: a.imageUrl, page: a.page || "accueil" }));
    try {
      const save = (key: string, value: unknown) => fetch(`${API}/api/admin/settings/${key}`, {
        method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ value }),
      });
      const rs = await Promise.all([save("brand", brand), save("hero", hero), save("slides", slides), save("partners", partners), save("ads", ads)]);
      if (rs.every((r) => r.ok)) {
        await loadSettings();
        setS((s) => ({ ...s, siteMsg: "Réglages enregistrés.", slide: 0, slidesEdit: null, partnersEdit: null, adsEdit: null }));
      } else setS((s) => ({ ...s, siteMsg: "Certains réglages n'ont pas pu être enregistrés." }));
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
    try { const img = await uploadFile("n-img"); if (img) body.imageUrl = img; } catch { return; }
    if (id === "new") adminAct("news", "POST", { ...body, published: true });
    else adminAct(`news/${id}`, "PATCH", body);
  }

  /** Enregistre un produit (avec envoi de l'image si un fichier est choisi). */
  async function saveProd(id: string) {
    const val = (x: string) => (document.getElementById(x) as HTMLInputElement | null)?.value ?? "";
    const body: Detail = {
      name: val("pr-name").trim(), category: val("pr-cat").trim() || "Goodies", priceXof: parseInt(val("pr-price")) || 0, stock: parseInt(val("pr-stock")) || 0,
      loyaltyEligible: (document.getElementById("pr-loyalty") as HTMLInputElement | null)?.checked ?? false,
    };
    if (!body.name) { alert("Le nom du produit est requis."); return; }
    try { const img = await uploadFile("pr-img"); if (img) body.imageUrl = img; } catch { return; }
    if (id === "new") adminAct("products", "POST", body);
    else adminAct(`products/${id}`, "PATCH", body);
  }

  /** Écriture admin générique puis rafraîchissement (panneau + site public). */
  /** Écriture roster/clubs (hors /api/admin) puis rafraîchissement de la base. */
  async function rosterAct(url: string, method: string, body?: unknown) {
    try {
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json", ...authHeaders() }, body: body ? JSON.stringify(body) : undefined });
      if (!r.ok) { const d = await r.json().catch(() => ({} as Detail)); alert(d.message || "Action impossible."); return; }
      setS((s) => ({ ...s, rosterEdit: null, clubEdit: null }));
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
    try { const logo = await uploadFile("cl-logo"); if (logo) body.logoUrl = logo; } catch { return; }
    if (id === "new") rosterAct(`${API}/api/clubs`, "POST", body);
    else rosterAct(`${API}/api/clubs/${id}`, "PATCH", body);
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
    try {
      const r = await fetch(`${API}/api/users/me`, {
        method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ displayName: val("p-name"), city: val("p-city"), favoriteGame: val("p-game"), bio: val("p-bio") }),
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
  async function toggleReg(id: string, register: boolean) {
    if (!token()) { setS((s) => ({ ...s, page: "auth" })); window.scrollTo({ top: 0 }); return; }
    const fee = S.detail?.entryFeeXof || 0;
    const ly = S.loyaltySettings || { pointValueXof: 100, maxRedeemPercent: 50 };
    const maxXof = Math.floor((fee * ly.maxRedeemPercent) / 100);
    const maxPoints = Math.max(0, Math.min(S.loyaltyBalance, Math.floor(maxXof / ly.pointValueXof)));
    const pointsToRedeem = Math.min(S.regPointsToRedeem, maxPoints);
    const netFee = Math.max(0, fee - pointsToRedeem * ly.pointValueXof);
    if (register && netFee > 0 && !S.payPick) { alert("Choisis un moyen de paiement avant de t'inscrire."); return; }
    try {
      const r = await fetch(`${API}/api/tournaments/${id}/register`, {
        method: register ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: register && fee > 0 ? JSON.stringify({ paymentMethod: S.payPick, pointsToRedeem }) : undefined,
      });
      if (r.status === 401) { setS((s) => ({ ...s, page: "auth", user: null })); return; }
      const data = await r.json();
      if (!r.ok) { alert(data.message || "Action impossible."); return; }
      await loadRegIds();
      await loadTournaments();
      setS((s) => ({ ...s, me: null, myRegs: null, myResults: null, payPick: "", regPointsToRedeem: 0 })); // le profil se rechargera
      loadLoyaltyMe();
      if (S.openId === id) {
        const st = await fetch(`${API}/api/tournaments/${id}/state`);
        if (st.ok) { const d = await st.json(); setS((s) => ({ ...s, detail: d })); }
      }
      if (register && data.pending) alert(`Inscription enregistrée · ${money(data.amountXof)} via ${S.payPick}.\nElle sera confirmée par l'organisateur dès réception du paiement.`);
    } catch { /* ignore */ }
  }

  /** Inscriptions du tournoi ouvert (cockpit organisateur) — payées et en attente. */
  async function loadRegsPanel(id: string) {
    try {
      const r = await fetch(`${API}/api/tournaments/${id}/registrations`, { headers: authHeaders() });
      if (r.ok) { const rows = await r.json(); setS((s) => ({ ...s, regsPanel: rows })); }
    } catch { /* ignore */ }
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
    if (S.page === "profil" && S.user?.role === "ADMIN" && !S.admin) loadAdmin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [S.page, S.user]);

  // Onglet Site : prépare les listes modifiables (partenaires, pubs) depuis les réglages chargés.
  useEffect(() => {
    if (S.adminTab !== "site" || !S.site) return;
    setS((s) => ({
      ...s,
      partnersEdit: s.partnersEdit ?? normPartners(s).map((p) => ({ key: newKey(), name: p.name, logoUrl: p.logoUrl })),
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

  // Mode Show : rafraîchit l'état en direct.
  useEffect(() => {
    if (S.page !== "show" || !S.openId) return;
    const id = setInterval(async () => {
      try { const r = await fetch(`${API}/api/tournaments/${S.openId}/state`); if (r.ok) { const d = await r.json(); setS((s) => ({ ...s, detail: d })); } } catch { /* ignore */ }
    }, 2500);
    return () => clearInterval(id);
  }, [S.page, S.openId]);

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
      const [tourns, products, news, site, gallery, leaderboard, loyaltySettings] = await Promise.all([get("tournaments"), get("products"), get("news"), get("settings"), get("gallery"), get("tournaments/leaderboard"), get("loyalty/settings")]);
      setS((s) => ({
        ...s,
        tourns: Array.isArray(tourns) && tourns.length ? tourns : s.tourns,
        products: Array.isArray(products) && products.length
          ? products.map((p: Detail) => ({ id: p.id, cat: p.category, name: p.name, price: p.priceXof, ph: p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), img: p.imageUrl || null, stock: p.stock, loyaltyEligible: !!p.loyaltyEligible }))
          : s.products,
        news: Array.isArray(news) && news.length ? news : s.news,
        site: site || s.site,
        gallery: Array.isArray(gallery) ? gallery : s.gallery,
        leaderboard: Array.isArray(leaderboard) ? leaderboard : s.leaderboard,
        loyaltySettings: loyaltySettings || s.loyaltySettings,
      }));
    })();
    try {
      const u = localStorage.getItem("vlome_user");
      if (u) { setS((s) => ({ ...s, user: JSON.parse(u) })); loadRegIds(); loadLoyaltyMe(); }
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
    applyHash(h);
  }, []);

  // Le bouton précédent/suivant du navigateur (ou l'édition manuelle du hash) rouvre la bonne page.
  useEffect(() => {
    const onHashChange = () => applyHash(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
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
    else if (S.page === "auth") hash = "#connexion";
    else if (SIMPLE_PAGES.includes(S.page)) hash = "#" + S.page;
    else return;
    if (window.location.hash !== hash) history.replaceState(null, "", hash);
  }, [S.page, S.openId]);

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

  /** Simples pages sans paramètre : le hash correspond directement à la clé de page. */
  function applyHash(h: string) {
    if (h.startsWith("#show=")) { openDetail(h.slice(6), "show"); return; }
    if (h.startsWith("#t=")) { openDetail(h.slice(3)); return; }
    if (h === "#creer") { setS((s) => ({ ...s, page: "tournois", creating: true })); return; }
    if (h === "#connexion") { setS((s) => ({ ...s, page: "auth", authTab: "login" })); return; }
    if (h === "#inscription") { setS((s) => ({ ...s, page: "auth", authTab: "register" })); return; }
    if (h === "#panier") { setS((s) => ({ ...s, cartOpen: true, cartItems: [{ name: "Maillot officiel VLOME", price: 15000 }, { name: "Casquette VLOME", price: 8000 }] })); return; }
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
      d.givesLoyaltyPoint = (document.getElementById("wz-loyalty") as HTMLInputElement | null)?.checked ?? true;
    } else if (S.wizStep === 2) {
      d.players = val("wz-players").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    } else if (S.wizStep === 3) {
      d.nbPools = Math.max(1, parseInt(val("wz-pools")) || 2);
    } else if (S.wizStep === 4) {
      const num = (id: string, def: number) => { const n = parseFloat(val(id)); return Number.isFinite(n) ? n : def; };
      d.survWin = num("wz-sc-surv", 1); d.loserWin = num("wz-sc-loser", 0.5); d.poolFinalWin = num("wz-sc-poolfinal", 1.5);
      d.finalsWin = num("wz-sc-finals", 2); d.championBonus = num("wz-sc-champion", 3);
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
      finalsWin: num("wz-sc-finals", 0), championBonus: num("wz-sc-champion", 0),
    };
    const d = S.wizData;
    const c = cagnottePreview(d.players.length, d.nbPools, d.pointsPerPlayer, scoring);
    const pct = Math.min(100, c.total ? (c.programmed / c.total) * 100 : 0);
    prog.textContent = String(c.programmed);
    prog.style.color = "#F4F5FB";
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
  function wizGoto(next: number) {
    if (next === 0) { setS((s) => ({ ...s, creating: false, wizEditId: null })); return; }
    const d = wizCapture();
    if (!S.wizEditId && next >= 3 && d.players.length < 2) { alert("Ajoute au moins 2 participants."); setS((s) => ({ ...s, wizData: d })); return; }
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
    if (!d.name.trim() || d.players.length < 2) return;
    const body: Detail = {
      name: d.name, game: d.game, format: d.format, place: d.place,
      date: d.date || undefined, pointsPerPlayer: d.pointsPerPlayer, players: d.players,
      nbPools: d.nbPools, entryFeeXof: d.entryFeeXof, givesLoyaltyPoint: d.givesLoyaltyPoint,
      survWin: d.survWin, loserWin: d.loserWin, poolFinalWin: d.poolFinalWin,
      finalsWin: d.finalsWin, championBonus: d.championBonus,
    };
    if (!token()) { setS((s) => ({ ...s, page: "auth" })); window.scrollTo({ top: 0 }); return; }
    setS((s) => ({ ...s, busy: true }));
    // Affiche du tournoi (optionnelle)
    try { const img = await uploadFile("wz-img"); if (img) body.imageUrl = img; }
    catch { setS((s) => ({ ...s, busy: false })); return; }
    try {
      const r = await fetch(`${API}/api/tournaments`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(body),
      });
      if (r.status === 401) { setS((s) => ({ ...s, busy: false, page: "auth", user: null })); return; }
      if (!r.ok) throw new Error();
      const created = await r.json();
      await loadTournaments();
      setS((s) => ({
        ...s, busy: false, creating: false, fmt: "Tous", wizStep: 1, wizRosterSearch: "",
        wizData: { name: "", game: "", date: "", place: "", format: "SURVIVAL", pointsPerPlayer: 5, nbPools: 2, players: [], entryFeeXof: 0, givesLoyaltyPoint: true, survWin: 1, loserWin: 0.5, poolFinalWin: 1.5, finalsWin: 2, championBonus: 3, imageUrl: null },
      }));
      if (created?.id) openDetail(created.id);
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
    };
    try { const img = await uploadFile("wz-img"); if (img) body.imageUrl = img; }
    catch { setS((s) => ({ ...s, busy: false })); return; }
    try {
      const r = await fetch(`${API}/api/tournaments/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(body),
      });
      if (r.status === 401) { setS((s) => ({ ...s, busy: false, page: "auth", user: null })); return; }
      if (!r.ok) throw new Error();
      const scoring: [string, number][] = [
        ["survWin", d.survWin], ["loserWin", d.loserWin], ["poolFinalWin", d.poolFinalWin],
        ["finalsWin", d.finalsWin], ["championBonus", d.championBonus],
      ];
      for (const [key, value] of scoring) {
        await fetch(`${API}/api/tournaments/${id}/scoring`, {
          method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ key, value }),
        });
      }
      await loadTournaments();
      setS((s) => ({ ...s, busy: false, creating: false, wizEditId: null, wizStep: 1 }));
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
      setS((s) => ({ ...s, confirmBox: { title: "Déconnexion", message: "Tu vas être déconnecté de ton compte VLOME.", okLabel: "Se déconnecter", action: "logout" } }));
      return;
    }
    const el = target.closest<HTMLElement>("[data-go],[data-slide],[data-fmt],[data-tournstatus],[data-scope],[data-game],[data-cat],[data-act],[data-add-name],[data-cart-open],[data-cart-close],[data-cart-vieworders],[data-cart-remove],[data-cart-clear],[data-cartpaypick],[data-cartpts],[data-regpts],[data-checkout],[data-auth-open],[data-auth-tab],[data-auth-submit],[data-stop],[data-open],[data-back],[data-launch],[data-report],[data-finals-start],[data-reportf],[data-brpick],[data-brreset],[data-brsubmit],[data-scorestep],[data-matchvalidate],[data-matchforfeit],[data-activematch],[data-regiepanel],[data-bracketview],[data-livescoresave],[data-reportscore],[data-del],[data-edit],[data-editcancel],[data-editsave],[data-authrole],[data-setrole],[data-show],[data-showclose],[data-print],[data-clearq],[data-profileedit],[data-profilecancel],[data-profilesave],[data-passsave],[data-reg],[data-unreg],[data-admintab],[data-newsnew],[data-newsedit],[data-newscancel],[data-newssave],[data-newspub],[data-newsdel],[data-prodnew],[data-prodedit],[data-prodcancel],[data-prodsave],[data-proddel],[data-ordstatus],[data-filepick],[data-confirm-ok],[data-confirm-cancel],[data-sitesave],[data-loyaltysave],[data-herobgclear],[data-paypick],[data-confirmpay],[data-gallerynew],[data-gallerysave],[data-gallerycancel],[data-gallerydel],[data-adnew],[data-adsave],[data-adcancel],[data-addel],[data-ptadd],[data-ptdel],[data-sladd],[data-sldel],[data-adslide],[data-gfilter],[data-gtype],[data-instock],[data-gopen],[data-gclose],[data-gprev],[data-gnext],[data-admsearchclear],[data-prodcat],[data-prodsort],[data-pladd],[data-plrem],[data-pldq],[data-finalsfmt],[data-undo],[data-reset],[data-pools-distribute],[data-pool-shuffle],[data-pool-move],[data-pledit-open],[data-pledit-save],[data-pledit-cancel],[data-wizgoto],[data-wiztoggleroster],[data-wizaddall],[data-wizformat],[data-rostertab],[data-rosteredit],[data-rosterdel],[data-rostersave],[data-rostercancel],[data-clubedit],[data-clubdel],[data-clubsave],[data-clubcancel],[data-classview],[data-rosterqclear],[data-consolemenu]");
    if (!el) return;
    const d = el.dataset;
    if (d.stop !== undefined) return; // clic à l'intérieur d'une modale : ne pas fermer
    if (d.open) { openDetail(d.open); }
    else if (d.back !== undefined) { setS((s) => ({ ...s, page: "tournois", detail: null, openId: null })); }
    else if (d.launch) { act(`${API}/api/tournaments/${d.launch}/launch`); }
    else if (d.finalsStart) { act(`${API}/api/tournaments/${d.finalsStart}/finals/start`, { format: S.finalsFormatPick }); }
    else if (d.finalsfmt) { setS((s) => ({ ...s, finalsFormatPick: d.finalsfmt! })); }
    else if (d.undo) { act(`${API}/api/tournaments/${d.undo}/undo`); }
    else if (d.reset) {
      setS((s) => ({ ...s, confirmBox: { title: "Réinitialiser le tournoi", message: "Tous les résultats, poules et la phase finale seront effacés — les joueurs et le barème sont conservés. Irréversible.", okLabel: "Réinitialiser", action: `treset|${d.reset}` } }));
    }
    else if (d.poolsDistribute) { act(`${API}/api/tournaments/${d.poolsDistribute}/pools/distribute`); }
    else if (d.poolShuffle) { const [tid, poolId] = d.poolShuffle.split("|"); act(`${API}/api/tournaments/${tid}/pools/${poolId}/shuffle`); }
    else if (d.poolMove) { const [tid, poolId, index, dir] = d.poolMove.split("|"); act(`${API}/api/tournaments/${tid}/pools/${poolId}/move`, { index: parseInt(index), dir: parseInt(dir) }); }
    else if (d.report) { const [poolId, winnerId] = d.report.split("|"); act(`${API}/api/tournaments/${S.openId}/report`, { poolId, winnerId }); }
    else if (d.reportf) { const [matchId, winnerId] = d.reportf.split("|"); act(`${API}/api/tournaments/${S.openId}/report`, { matchId, winnerId }); }
    else if (d.brpick) setS((s) => ({ ...s, brPick: s.brPick.includes(d.brpick!) ? s.brPick.filter((x) => x !== d.brpick) : [...s.brPick, d.brpick!] }));
    else if (d.brreset !== undefined) setS((s) => ({ ...s, brPick: [] }));
    else if (d.brsubmit) { act(`${API}/api/tournaments/${S.openId}/battle-royale-report`, { gameId: d.brsubmit, ranking: S.brPick }); setS((s) => ({ ...s, brPick: [] })); }
    else if (d.scorestep) {
      const [key, dir] = d.scorestep.split("|");
      setS((s) => {
        const field = key === "a" ? "matchScoreA" : "matchScoreB";
        return { ...s, [field]: Math.max(0, s[field] + (dir === "1" ? 1 : -1)) };
      });
    }
    else if (d.matchvalidate !== undefined) {
      const t = S.detail;
      const active = t ? getActiveMatch(S, t) : null;
      if (t && active) {
        const sa = S.matchScoreA, sb = S.matchScoreB;
        if (sa !== sb) {
          const winnerId = sa > sb ? active.aId : active.bId;
          const body = active.kind === "pool" ? { poolId: active.poolId, winnerId, scoreA: sa, scoreB: sb } : { matchId: active.matchId, winnerId, scoreA: sa, scoreB: sb };
          act(`${API}/api/tournaments/${t.id}/report`, body);
          setS((s) => ({ ...s, matchScoreA: 0, matchScoreB: 0, activeMatchId: null }));
        }
      }
    }
    else if (d.matchforfeit) {
      const t = S.detail;
      const active = t ? getActiveMatch(S, t) : null;
      if (t && active) {
        const winnerId = d.matchforfeit === "a" ? active.bId : active.aId;
        const body = active.kind === "pool" ? { poolId: active.poolId, winnerId, scoreA: 0, scoreB: 0 } : { matchId: active.matchId, winnerId, scoreA: 0, scoreB: 0 };
        act(`${API}/api/tournaments/${t.id}/report`, body);
        setS((s) => ({ ...s, matchScoreA: 0, matchScoreB: 0, activeMatchId: null }));
      }
    }
    else if (d.activematch) setS((s) => ({ ...s, activeMatchId: d.activematch!, matchScoreA: 0, matchScoreB: 0 }));
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
    else if (d.edit !== undefined) {
      // Tournoi pas encore lancé : on réutilise l'assistant de création, pré-rempli (poules/points/participants modifiables).
      // Une fois lancé : le petit formulaire inline reste plus adapté (poules/points verrouillés par le moteur).
      const t = S.detail;
      if (t && t.status === "setup") {
        const roster: { name: string; club?: string }[] = Array.isArray(t.players) ? t.players : [];
        setS((s) => ({
          ...s, creating: true, wizEditId: t.id, wizStep: 1, wizRosterSearch: "",
          wizData: {
            name: t.name || "", game: t.game || "", date: "", place: t.place || "", format: ENGINE_TO_DB_FORMAT[t.mainFormat] || "SURVIVAL",
            pointsPerPlayer: t.pointsPerPlayer || 5, nbPools: t.nbPools || 2,
            players: roster.map((p) => (p.club ? `${p.name} @${p.club}` : p.name)),
            entryFeeXof: t.entryFeeXof || 0, givesLoyaltyPoint: t.givesLoyaltyPoint ?? true,
            survWin: t.scoring?.survWin ?? 1, loserWin: t.scoring?.loserWin ?? 0.5, poolFinalWin: t.scoring?.poolFinalWin ?? 1.5,
            finalsWin: t.scoring?.finalsWin ?? 2, championBonus: t.scoring?.championBonus ?? 3,
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
      const body: Record<string, string | number> = { name: val("e-name"), game: val("e-game"), place: val("e-place"), date: val("e-date"), entryFeeXof: parseInt(val("e-fee")) || 0 };
      if (S.detail?.status === "setup") { body.nbPools = parseInt(val("e-pools")) || 1; body.pointsPerPlayer = parseInt(val("e-pts")) || 1; }
      editSave(d.editsave, body);
    }
    else if (d.pladd) {
      const nameEl = document.getElementById("pl-add-name") as HTMLInputElement | null;
      const name = (nameEl?.value || "").trim();
      if (name) { act(`${API}/api/tournaments/${d.pladd}/players`, { name }); if (nameEl) nameEl.value = ""; }
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
    else if (d.wizformat) setS((s) => ({ ...s, wizData: { ...s.wizData, format: d.wizformat! } }));
    else if (d.go) { setS((s) => ({ ...s, page: d.go! })); window.scrollTo({ top: 0 }); }
    else if (d.slide) setS((s) => ({ ...s, slide: parseInt(d.slide!) }));
    else if (d.adslide) setS((s) => ({ ...s, adSlide: parseInt(d.adslide!) }));
    else if (d.fmt) setS((s) => ({ ...s, fmt: d.fmt! }));
    else if (d.tournstatus) setS((s) => ({ ...s, tournStatus: d.tournstatus! }));
    else if (d.scope) setS((s) => ({ ...s, scope: d.scope! }));
    else if (d.game) setS((s) => ({ ...s, game: d.game! }));
    else if (d.cat) setS((s) => ({ ...s, cat: d.cat! }));
    else if (d.addName) setS((s) => ({ ...s, cartItems: [...s.cartItems, { name: d.addName!, price: parseInt(d.addPrice || "0"), id: d.addId }] }));
    else if (d.cartOpen !== undefined) { setS((s) => ({ ...s, cartOpen: true })); loadLoyaltyMe(); }
    else if (d.cartpts) setS((s) => ({ ...s, cartPointsToRedeem: parseInt(d.cartpts!) || 0 }));
    else if (d.regpts) setS((s) => ({ ...s, regPointsToRedeem: parseInt(d.regpts!) || 0 }));
    else if (d.cartClose !== undefined) setS((s) => ({ ...s, cartOpen: false, lastOrder: null, cartPayPick: "" }));
    else if (d.cartVieworders !== undefined) { setS((s) => ({ ...s, cartOpen: false, lastOrder: null, cartPayPick: "", page: "profil" })); window.scrollTo({ top: 0 }); }
    else if (d.cartRemove !== undefined) setS((s) => ({ ...s, cartItems: s.cartItems.filter((_, i) => i !== parseInt(d.cartRemove!)) }));
    else if (d.cartClear !== undefined) setS((s) => ({ ...s, cartItems: [] }));
    else if (d.cartpaypick) setS((s) => ({ ...s, cartPayPick: d.cartpaypick! }));
    else if (d.checkout !== undefined) { checkout(); }
    else if (d.authOpen !== undefined) { setS((s) => ({ ...s, page: "auth", authError: "" })); window.scrollTo({ top: 0 }); }
    else if (d.authTab) setS((s) => ({ ...s, authTab: d.authTab as "login" | "register", authError: "" }));
    else if (d.authrole) setS((s) => ({ ...s, authRole: d.authrole! }));
    else if (d.authSubmit !== undefined) submitAuth();
    else if (d.setrole) { const [uid, role] = d.setrole.split("|"); setRole(uid, role); }
    else if (d.admintab) { setS((s) => ({ ...s, adminTab: d.admintab!, newsEdit: null, prodEdit: null, siteMsg: "", adminSearch: "", prodCat: "Tous", prodSort: "", consoleMenuOpen: false })); if (d.admintab === "joueurs" && !S.roster) loadRoster(); }
    else if (d.consolemenu !== undefined) setS((s) => ({ ...s, consoleMenuOpen: d.consolemenu === "1" }));
    else if (d.admsearchclear !== undefined) setS((s) => ({ ...s, adminSearch: "" }));
    else if (d.sitesave !== undefined) saveSite();
    else if (d.loyaltysave !== undefined) saveLoyalty();
    else if (d.herobgclear !== undefined) clearHeroBg();
    else if (d.ptadd !== undefined) setS((s) => ({ ...s, partnersEdit: [...syncPartnersFromDom(s.partnersEdit ?? []), { key: newKey(), name: "", logoUrl: null }] }));
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
    else if (d.gallerynew !== undefined) setS((s) => ({ ...s, galleryEdit: { title: "", tournamentId: "" } }));
    else if (d.gallerycancel !== undefined) setS((s) => ({ ...s, galleryEdit: null }));
    else if (d.gallerysave !== undefined) saveGalleryItem();
    else if (d.gallerydel) {
      const it = S.gallery?.find((x: Detail) => x.id === d.gallerydel);
      setS((s) => ({ ...s, confirmBox: { title: "Supprimer ce média", message: `« ${it?.title || "Ce média"} » sera définitivement supprimé de la galerie.`, okLabel: "Supprimer", action: `gallerydel|${d.gallerydel}` } }));
    }
    else if (d.gfilter !== undefined) setS((s) => ({ ...s, galleryFilter: d.gfilter! }));
    else if (d.gtype !== undefined) setS((s) => ({ ...s, galleryType: d.gtype as State["galleryType"] }));
    else if (d.instock !== undefined) setS((s) => ({ ...s, boutiqueInStock: d.instock === "1" }));
    else if (d.classview) setS((s) => ({ ...s, classementView: d.classview as "joueurs" | "clubs" }));
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
    else if (d.prodnew !== undefined) setS((s) => ({ ...s, prodEdit: { name: "", category: "", priceXof: 0, stock: 0, loyaltyEligible: false } }));
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
        else if (kind === "ptdel") setS((s) => ({ ...s, partnersEdit: (s.partnersEdit ?? []).filter((p) => p.key !== arg) }));
        else if (kind === "addel") setS((s) => ({ ...s, adsEdit: (s.adsEdit ?? []).filter((a) => a.key !== arg) }));
        else if (kind === "sldel") setS((s) => ({ ...s, slidesEdit: (s.slidesEdit ?? []).filter((sl) => sl.key !== arg) }));
        else if (kind === "plrem") { const [tid, pid] = rest; act(`${API}/api/tournaments/${tid}/players/${pid}`, undefined, "DELETE"); }
        else if (kind === "pldq") { const [tid, pid] = rest; act(`${API}/api/tournaments/${tid}/players/${pid}/disqualify`, undefined, "POST"); }
        else if (kind === "treset") { act(`${API}/api/tournaments/${arg}/reset`, undefined, "POST"); }
        else if (kind === "rosterdel") rosterAct(`${API}/api/roster/${arg}`, "DELETE");
        else if (kind === "clubdel") rosterAct(`${API}/api/clubs/${arg}`, "DELETE");
      }
    }
    else if (d.profileedit !== undefined) setS((s) => ({ ...s, profileEdit: true, profileMsg: "", page: "profil" }));
    else if (d.profilecancel !== undefined) setS((s) => ({ ...s, profileEdit: false, profileMsg: "" }));
    else if (d.profilesave !== undefined) saveProfile();
    else if (d.passsave !== undefined) savePassword();
    else if (d.reg) toggleReg(d.reg, true);
    else if (d.unreg) toggleReg(d.unreg, false);
    else if (d.paypick) setS((s) => ({ ...s, payPick: d.paypick! }));
    else if (d.confirmpay) { const [tid, regId] = d.confirmpay.split("|"); confirmRegPayment(tid, regId); }
    else if (d.show) window.open(window.location.pathname + "#show=" + d.show, "_blank");
    else if (d.print) {
      if (!S.detail || S.detail.id !== d.print) return;
      let area = document.getElementById("print-area");
      if (!area) { area = document.createElement("div"); area.id = "print-area"; document.body.appendChild(area); }
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
      setS((s) => ({
        ...s, creating: true, wizStep: 1, wizRosterSearch: "", wizEditId: null,
        wizData: { name: "", game: "", date: "", place: "", format: "SURVIVAL", pointsPerPlayer: 5, nbPools: 2, players: [], entryFeeXof: 0, givesLoyaltyPoint: true, survWin: 1, loserWin: 0.5, poolFinalWin: 1.5, finalsWin: 2, championBonus: 3, imageUrl: null },
      }));
      loadRoster();
    }
    else if (d.act === "create-cancel") setS((s) => ({ ...s, creating: false, wizEditId: null }));
    else if (d.act === "wiz-submit") submitCreate();
    else if (d.act === "wiz-update") submitUpdate();
    else if (d.clearq !== undefined) setS((s) => ({ ...s, q: "" }));
  }

  // Affiche le nom du fichier choisi à côté du bouton d'envoi d'image.
  // (mise à jour DOM directe : pas de re-rendu, l'input garde son fichier)
  function onChange(e: React.ChangeEvent<HTMLDivElement>) {
    const t = e.target as HTMLInputElement;
    if (t.type === "file" && t.id) {
      const file = t.files?.[0];
      const span = document.getElementById(t.id + "-name");
      if (span) span.textContent = file?.name || "Aucun fichier";
      // Aperçu instantané (avant tout envoi/enregistrement) depuis le fichier local choisi.
      const pv = document.getElementById("pv-" + t.id);
      if (pv && file) {
        const url = URL.createObjectURL(file);
        if (file.type.startsWith("video/")) {
          pv.style.background = "#1B1B27";
          pv.innerHTML = `<video src="${url}" muted autoplay loop playsinline style="width:100%;height:100%;object-fit:cover"></video>`;
        } else {
          pv.style.background = `url('${url}') center/cover`;
          pv.innerHTML = "";
        }
      }
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const t = e.target as HTMLElement;
    if (e.key === "Enter" && t.id === "hsearch") {
      const q = (t as HTMLInputElement).value.trim();
      setS((s) => ({ ...s, q, page: "tournois", creating: false }));
      window.scrollTo({ top: 0 });
    }
    if (e.key === "Enter" && t.id === "adm-search") {
      setS((s) => ({ ...s, adminSearch: (t as HTMLInputElement).value.trim() }));
    }
    if (e.key === "Enter" && t.id === "wiz-roster-search") {
      setS((s) => ({ ...s, wizRosterSearch: (t as HTMLInputElement).value.trim() }));
    }
    if (e.key === "Enter" && t.id === "regie-roster-search") {
      setS((s) => ({ ...s, rosterQ: (t as HTMLInputElement).value.trim() }));
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(1200px 620px at 82% -12%,rgba(34,211,238,.10),transparent 62%),radial-gradient(1000px 520px at -6% 108%,rgba(244,63,126,.09),transparent 60%),#0B0B11",
        ...(pageChanged ? {} : ({ "--rise-anim": "none" } as React.CSSProperties)),
      }}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onChange={onChange}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
