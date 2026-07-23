"use client";
import { useEffect, useMemo, useRef, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

function token(): string | null { return typeof window !== "undefined" ? localStorage.getItem("vlome_token") : null; }
function authHeaders(): Record<string, string> { const t = token(); return t ? { Authorization: "Bearer " + t } : {}; }

/* ================= Données ================= */
type TournCard = { id?: string; name: string; format: string; game: string; players: number; date: string; place: string; live: boolean; cagnotte: number; status: string; imageUrl?: string | null };
/* eslint-disable @typescript-eslint/no-explicit-any */
type Detail = any; // DTO cockpit renvoyé par l'API (/tournaments/:id/state)
type CartItem = { name: string; price: number };
type AuthUser = { displayName: string; role: string; email: string };
type State = {
  page: string; slide: number; fmt: string; scope: string; game: string; cat: string;
  tourns: TournCard[] | null; creating: boolean; busy: boolean;
  cartItems: CartItem[]; cartOpen: boolean; products: { cat: string; name: string; price: number; ph: string; img?: string | null }[] | null;
  user: AuthUser | null; authTab: "login" | "register"; authBusy: boolean; authError: string; authRole: string;
  q: string;
  openId: string | null; detail: Detail | null; detailBusy: boolean; editing: boolean;
  admin: { overview: Detail; users: Detail[]; news: Detail[]; products: Detail[]; orders: Detail[]; payments: Detail[] } | null;
  adminTab: string; adminSearch: string; newsEdit: Detail | null; prodEdit: Detail | null;
  confirmBox: { title: string; message: string; okLabel: string; action: string } | null;
  site: Detail | null; siteMsg: string;
  news: Detail[] | null;
  me: Detail | null; myRegs: Detail[] | null; myOrders: Detail[] | null; myTourns: Detail[] | null; myResults: Detail[] | null;
  regIds: { id: string; status: string; amountXof: number }[]; profileMsg: string; passMsg: string; profileEdit: boolean;
  payPick: string; // moyen de paiement choisi sur la page d'un tournoi payant
  gallery: Detail[] | null; galleryEdit: Detail | null; galleryFilter: string; galleryOpen: string | null;
  partnersEdit: { key: string; name: string; logoUrl: string | null }[] | null;
  adsEdit: { key: string; label: string; linkUrl: string; imageUrl: string | null; page: string }[] | null;
  adSlide: number;
  regsPanel: Detail[] | null; // inscriptions du tournoi ouvert (cockpit organisateur)
};

const FORMAT_OPTIONS: [string, string][] = [
  ["SURVIVAL", "Survival"], ["SINGLE_ELIM", "Bracket simple"], ["DOUBLE_ELIM", "Double élim"],
  ["SWISS", "Swiss"], ["ROUND_ROBIN", "Round Robin"], ["POOLS", "Poules"], ["BATTLE_ROYALE", "Battle Royale"],
];

const NAV = ["Accueil", "Tournois", "Classements", "Galerie", "Boutique", "Profil"];
// Pages simples (sans paramètre) dont le hash d'URL correspond directement à la clé de page.
const SIMPLE_PAGES = ["accueil", "tournois", "classements", "galerie", "boutique", "profil"];

const SLIDES = [
  { tag: "Grand tournoi", title: "SURVIVAL CUP LOMÉ 2026", sub: "32 joueurs, mode Survival — le vainqueur reste sur le terrain. Cagnotte 160 points.", cta: "S'inscrire" },
  { tag: "Nouveau", title: "FREE FIRE TOGO SERIES", sub: "48 joueurs en Battle Royale sur 3 jours. Qualifications en ligne ouvertes.", cta: "Voir le tournoi" },
  { tag: "Communauté", title: "GAMING ARENA LOMÉ", sub: "LAN mensuelle : viens jouer, streamer et rencontrer la communauté esport togolaise.", cta: "Découvrir" },
];

const TOURN = [
  { name: "Survival Cup · Lomé", format: "Survival", game: "EA FC 26", players: 32, date: "12 juil.", place: "Lomé", live: true, cagnotte: 160, status: "" },
  { name: "Tekken Kings Cup", format: "Double élim", game: "Tekken 8", players: 24, date: "19 juil.", place: "Lomé", live: false, cagnotte: 120, status: "À venir" },
  { name: "Free Fire Togo Series", format: "Battle Royale", game: "Free Fire", players: 48, date: "26 juil.", place: "Kara", live: true, cagnotte: 240, status: "" },
  { name: "Valorant Lomé Open", format: "Round Robin", game: "Valorant", players: 16, date: "02 août", place: "Lomé", live: false, cagnotte: 80, status: "Inscriptions" },
  { name: "eFootball Coupe Kara", format: "Poules", game: "eFootball", players: 24, date: "28 juin", place: "Kara", live: false, cagnotte: 120, status: "Terminé" },
  { name: "Mortal Kombat Bash", format: "Bracket simple", game: "MK1", players: 12, date: "09 août", place: "Sokodé", live: false, cagnotte: 60, status: "À venir" },
];

const RANK = [
  { name: "Kossi « K9 » Adjeoda", club: "Team Mawu", game: "EA FC 26", city: "Lomé", wl: "128-37", wr: "78%", elo: 2145, pts: 342 },
  { name: "Prince Kodjo", club: "Lomé Kings", game: "Tekken 8", city: "Lomé", wl: "96-41", wr: "70%", elo: 2010, pts: 298 },
  { name: "Aminata Sow", club: "Kara eSports", game: "Free Fire", city: "Kara", wl: "88-30", wr: "75%", elo: 1980, pts: 271 },
  { name: "David Agbeko", club: "Sokodé Warriors", game: "Valorant", city: "Sokodé", wl: "75-44", wr: "63%", elo: 1875, pts: 240 },
  { name: "Fatou Mensah", club: "Team Mawu", game: "EA FC 26", city: "Lomé", wl: "70-38", wr: "65%", elo: 1840, pts: 224 },
  { name: "Yao Dossou", club: "Atakpamé GG", game: "Tekken 8", city: "Atakpamé", wl: "64-40", wr: "62%", elo: 1790, pts: 205 },
  { name: "Rachel Amevor", club: "Lomé Kings", game: "Free Fire", city: "Lomé", wl: "58-35", wr: "62%", elo: 1760, pts: 190 },
  { name: "Komla Tetteh", club: "Kara eSports", game: "Valorant", city: "Kara", wl: "52-39", wr: "57%", elo: 1710, pts: 172 },
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

const SHOP = [
  { cat: "Vêtements", name: "Maillot officiel VLOME", price: 15000, ph: "maillot-vlome" },
  { cat: "Vêtements", name: "Hoodie Team Mawu", price: 25000, ph: "hoodie-mawu" },
  { cat: "Goodies", name: "Casquette VLOME", price: 8000, ph: "casquette" },
  { cat: "Goodies", name: "Mug gamer édition Lomé", price: 5000, ph: "mug" },
  { cat: "Goodies", name: "Tapis de souris XL", price: 12000, ph: "tapis-souris" },
  { cat: "Billets", name: "Billet Survival Cup", price: 3000, ph: "billet-survival" },
  { cat: "Billets", name: "Pass LAN Gaming Arena", price: 6000, ph: "pass-lan" },
  { cat: "Cartes cadeaux", name: "Carte cadeau 10 000 F", price: 10000, ph: "carte-cadeau" },
];

const PAYMENTS = ["Flooz", "Mixx by Yas", "Visa", "Mastercard", "PayPal", "Espèces"];

const STATS = [
  { v: "165", k: "Matchs", color: "#F4F5FB" }, { v: "128", k: "Victoires", color: "#22D3EE" },
  { v: "37", k: "Défaites", color: "#F4F5FB" }, { v: "78%", k: "Taux de victoire", color: "#22D3EE" },
  { v: "9", k: "Meilleure série", color: "#22D3EE" }, { v: "4", k: "Titres", color: "#F4F5FB" },
  { v: "11", k: "Podiums", color: "#F4F5FB" }, { v: "342", k: "Points", color: "#FBBF24" },
];

const HISTORY = [
  { t: "Survival Cup Lomé", r: "Champion", d: "Juin 2026", p: "+40" },
  { t: "Tekken Kings Cup", r: "Finaliste", d: "Mai 2026", p: "+22" },
  { t: "eFootball Coupe Kara", r: "Top 4", d: "Avr. 2026", p: "+12" },
  { t: "Valorant Lomé Open", r: "3e place", d: "Mars 2026", p: "+15" },
];

const BADGES = ["Champion Survival 2026", "Série de 9 victoires", "Top 1 EA FC Togo", "Membre fondateur Team Mawu", "100 matchs joués"];
const UPCOMING = [
  { t: "Tekken Kings Cup", d: "19 juil. · Gaming Arena Lomé", ok: true, s: "Inscrit" },
  { t: "Free Fire Togo Series", d: "26 juil. · Kara", ok: false, s: "Paiement en attente" },
];

const FORMATS = ["Tous", "Survival", "Bracket simple", "Double élim", "Swiss", "Round Robin", "Poules", "Battle Royale"];
const SCOPES = ["Togo", "Afrique de l'Ouest", "International"];
const GAMES = ["Tous", "EA FC 26", "Tekken 8", "Free Fire", "Valorant"];
const CATS = ["Tous", "Vêtements", "Goodies", "Billets", "Cartes cadeaux"];

/* ================= Icônes SVG (aucun emoji) ================= */
function ic(p: string, s = 18) { return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`; }
const I = {
  bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>', search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
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
};
const money = (n: number) => n.toLocaleString("fr-FR") + " F";

/** Partenaires normalisés (compat : d'anciens réglages stockaient de simples chaînes). */
function normPartners(S: State): { name: string; logoUrl: string | null }[] {
  const raw: Detail[] = S.site?.partners?.length ? S.site.partners : PARTNERS;
  return raw.map((p: Detail) => (typeof p === "string" ? { name: p, logoUrl: null } : { name: p.name, logoUrl: p.logoUrl ?? null }));
}

/** Logo du site : image envoyée depuis l'admin, sinon l'éclair par défaut. */
function brandLogo(S: State, size = 34, iconSize = 20) {
  const url = S.site?.brand?.logoUrl;
  if (url) return `<img src="${API}${url}" alt="logo" style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.3)}px;object-fit:cover;box-shadow:0 0 30px rgba(34,211,238,.25)" />`;
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

/* ================= Composants ================= */
function tournCard(t: TournCard, big: boolean) {
  const badge = t.live ? '<span style="display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#04222a;background:#22D3EE;border-radius:99px;padding:4px 9px"><span style="width:6px;height:6px;border-radius:50%;background:#04222a;animation:blink 1.2s infinite"></span>Live</span>' : "";
  const foot = t.live ? '<span style="font-size:12px;color:#22D3EE;font-weight:700">En direct</span>' : `<span style="font-size:12px;color:#8E8FA6;font-weight:600">${t.status}</span>`;
  const openAttr = t.id ? `data-open="${t.id}"` : `data-go="tournois"`;
  // Bandeau : image du tournoi si fournie, sinon dégradé par défaut.
  const bannerBg = t.imageUrl
    ? `background-image:linear-gradient(180deg,rgba(11,11,17,.15),rgba(11,11,17,.55)),url('${API}${t.imageUrl}');background-size:cover;background-position:center`
    : "background:linear-gradient(135deg,rgba(34,211,238,.16),rgba(124,130,255,.11))";
  return `<div ${openAttr} class="hcard" style="border:1px solid #282838;border-radius:16px;overflow:hidden;cursor:pointer;background:linear-gradient(180deg,#14141D,#0E0E16)">
    <div class="zoom" style="height:${t.imageUrl ? (big ? 130 : 110) : big ? 80 : 74}px;display:flex;align-items:flex-start;justify-content:space-between;padding:13px 14px;${bannerBg}">
      <span style="font-size:11px;font-weight:700;color:#04222a;background:rgba(255,255,255,.55);border-radius:99px;padding:3px 9px">${t.format}</span>${badge}</div>
    <div style="padding:${big ? "15px 16px 17px" : "14px 15px 16px"}">
      <h4 style="margin:0 0 6px;font-size:${big ? 18 : 17}px">${t.name}</h4>
      <div style="color:#8E8FA6;font-size:12.5px;line-height:1.7">${t.game} · ${t.players} joueurs<br>${t.date} · ${t.place}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:13px;padding-top:13px;border-top:1px solid #282838">${foot}
        <span style="font-size:12px;color:#FBBF24;font-weight:700">${big ? "Cagnotte " : ""}${t.cagnotte} pts</span></div></div></div>`;
}
/** Sélecteur de fichier stylé : input masqué + bouton + nom du fichier choisi. */
function filePicker(id: string, label = "Choisir une image", accept = "image/*", existingUrl?: string | null) {
  const isVideo = !!existingUrl && /\.(mp4|webm)$/i.test(existingUrl);
  const preview = `<div id="pv-${id}" style="width:50px;height:50px;border-radius:11px;border:1px solid #282838;overflow:hidden;flex:none;display:flex;align-items:center;justify-content:center;color:#5D5E72;background:${existingUrl && !isVideo ? `url('${API}${existingUrl}') center/cover` : "#1B1B27"}">${isVideo ? ic(I.tv, 18) : !existingUrl ? ic(I.image, 18) : ""}</div>`;
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
  const tourns = S.tourns ?? TOURN;
  const dots = slides.map((_, i) => { const on = i === S.slide; return `<span data-slide="${i}" style="width:${on ? 26 : 10}px;height:6px;border-radius:99px;background:${on ? "#22D3EE" : "#33334A"};cursor:pointer"></span>`; }).join("");
  // Fond du héro : vidéo ou image (réglages admin), sinon halos lumineux animés.
  const heroBg = hero0?.bgUrl as string | undefined;
  const heroIsVideo = !!heroBg && /\.(mp4|webm)$/i.test(heroBg);
  const heroMedia = heroBg
    ? (heroIsVideo
      ? `<video class="heromedia" src="${API}${heroBg}" autoplay muted loop playsinline></video>`
      : `<div class="heromedia kb" style="background-image:url('${API}${heroBg}');background-size:cover;background-position:center"></div>`)
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
        ? `<div class="kb" style="position:absolute;inset:0;background-image:url('${API}${s.imageUrl}');background-size:cover;background-position:center"></div><div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(11,11,17,.5),rgba(11,11,17,.86) 78%);pointer-events:none"></div>`
        : `<div style="position:absolute;inset:0;background:linear-gradient(135deg,rgba(34,211,238,.14),transparent 55%);pointer-events:none"></div>`}
      <div style="display:flex;align-items:center;justify-content:space-between;position:relative;z-index:1"><span style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:#22D3EE;font-weight:800">À la une</span><span style="font-size:11px;color:#5D5E72;font-weight:600">${S.slide + 1} / ${slides.length}</span></div>
      <div class="slidein" style="flex:1;display:flex;flex-direction:column;justify-content:center;padding:26px 4px;position:relative;z-index:1;min-height:240px">
        <span style="align-self:flex-start;font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#04222a;background:#22D3EE;border-radius:99px;padding:5px 11px">${escHtml(s.tag)}</span>
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(30px,4vw,46px);letter-spacing:1px;line-height:.95;margin:14px 0 8px">${escHtml(s.title)}</h2>
        <p style="color:#8E8FA6;font-size:14px;line-height:1.55;margin:0">${escHtml(s.sub)}</p>
        <button data-go="tournois" style="align-self:flex-start;margin-top:20px;display:inline-flex;align-items:center;gap:7px;background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer">${escHtml(s.cta)} ${ic(I.arrow, 16)}</button></div>
      <div style="display:flex;gap:8px;position:relative;z-index:1">${dots}</div></div></section>`;

  // Bandeau défilant : tournois en direct (ou à venir en repli).
  const liveT = tourns.filter((t) => t.live);
  const tickerItems = (liveT.length ? liveT : tourns.slice(0, 4)).map((t) =>
    `<span style="display:inline-flex;align-items:center;gap:8px;margin:0 26px"><span style="display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:${t.live ? "#04222a" : "#8E8FA6"};background:${t.live ? "#22D3EE" : "#22222F"};border-radius:99px;padding:3px 9px">${t.live ? '<span style="width:5px;height:5px;border-radius:50%;background:#04222a;animation:blink 1.2s infinite"></span>En direct' : "À venir"}</span><span style="font-weight:700;font-size:13px;color:#F4F5FB">${t.name}</span><span style="font-size:12px;color:#5D5E72">${t.game}${t.place ? " · " + t.place : ""}</span></span>`
  ).join(`<span style="color:#33334A">·</span>`);
  const ticker = `<div class="marquee rise d1" style="border:1px solid #282838;border-radius:14px;background:linear-gradient(90deg,#14141D,#0E0E16);margin-bottom:30px;padding:11px 0">
    <div class="marquee-track">${tickerItems}${tickerItems}</div></div>`;

  const tournHead = `<div class="rise d1" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px"><h3 style="font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:1px;margin:0;display:flex;align-items:center;gap:10px"><span style="width:5px;height:22px;border-radius:3px;background:#22D3EE;display:inline-block"></span>Tournois en cours</h3><a data-go="tournois" style="font-size:13px;font-weight:700;cursor:pointer">Tout voir →</a></div>`;
  const tournGrid = `<div class="rise d2" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-bottom:40px">${tourns.slice(0, 3).map((t) => tournCard(t, false)).join("")}</div>`;

  const rankRows = RANK.slice(0, 5).map((r, i) => `<tr style="border-top:1px solid #282838"><td style="padding:9px 6px;font-family:'Bebas Neue',sans-serif;font-size:18px;color:#5D5E72;width:30px">${i + 1}</td><td style="padding:9px 6px"><div style="display:flex;align-items:center;gap:9px"><span style="display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:#22222F;border:1px solid #282838;font-size:11px;font-weight:800;color:#8E8FA6">${r.name.charAt(0)}</span><div><div style="font-weight:650">${r.name}</div><div style="font-size:11px;color:#5D5E72">${r.club}</div></div></div></td><td style="padding:9px 6px;color:#8E8FA6;font-size:12.5px">${r.game}</td><td style="padding:9px 6px;text-align:right;font-weight:750;color:#22D3EE;font-variant-numeric:tabular-nums">${r.pts}</td></tr>`).join("");
  const evRows = EVENTS.map((e) => `<div style="display:flex;gap:13px;align-items:center"><div style="flex:none;width:52px;text-align:center;border:1px solid #282838;border-radius:11px;padding:7px 4px;background:#14141D"><div style="font-family:'Bebas Neue',sans-serif;font-size:22px;line-height:1;color:#22D3EE">${e.d}</div><div style="font-size:9px;letter-spacing:1px;color:#8E8FA6;font-weight:700">${e.mo}</div></div><div style="min-width:0"><div style="font-weight:650;font-size:14px">${e.t}</div><div style="font-size:12px;color:#8E8FA6">${e.type} · ${e.place}</div></div></div>`).join("");
  const mid = `<section class="grid2b rise d3" style="display:grid;grid-template-columns:1.45fr 1fr;gap:18px;margin-bottom:40px"><div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px"><h3 style="margin:0;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6;font-weight:750">Classement · Top joueurs</h3><a data-go="classements" style="font-size:12px;font-weight:700;cursor:pointer">Complet →</a></div><table style="width:100%;border-collapse:collapse;font-size:14px">${rankRows}</table></div><div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px"><h3 style="margin:0 0 14px;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6;font-weight:750">Prochains événements</h3><div style="display:flex;flex-direction:column;gap:12px">${evRows}</div></div></section>`;

  const newsItems: { cat: string; ph: string; t: string; date: string; img?: string | null }[] = S.news
    ? S.news.slice(0, 3).map((n: Detail) => ({ cat: n.category, ph: n.slug, t: n.title, date: n.date, img: n.imageUrl }))
    : NEWS;
  const newsGrid = `<div class="rise d4" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px"><h3 style="font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:1px;margin:0;display:flex;align-items:center;gap:10px"><span style="width:5px;height:22px;border-radius:3px;background:#7C82FF;display:inline-block"></span>Actualités</h3></div><div class="rise d4" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;margin-bottom:44px">${newsItems.map((a) => `<div class="hcard" style="border:1px solid #282838;border-radius:16px;overflow:hidden;background:linear-gradient(180deg,#14141D,#0E0E16)">${a.img ? `<div class="zoom" style="height:132px;background-image:url('${API}${a.img}');background-size:cover;background-position:center"></div>` : `<div class="zoom" style="height:132px;background:repeating-linear-gradient(45deg,#191922,#191922 12px,#14141D 12px,#14141D 24px);display:grid;place-items:center;color:#5D5E72;font-family:monospace;font-size:11px;letter-spacing:1px">// ${a.ph}</div>`}<div style="padding:14px 15px 16px"><span style="font-size:11px;font-weight:700;color:#7C82FF;letter-spacing:.5px">${a.cat}</span><h4 style="margin:6px 0 0;font-size:15.5px;line-height:1.35">${a.t}</h4><div style="font-size:12px;color:#5D5E72;margin-top:8px">${a.date}</div></div></div>`).join("")}</div>`;

  const shopSec = `<section class="rise d5" style="border:1px solid #282838;border-radius:18px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:24px;margin-bottom:40px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:10px"><h3 style="font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:1px;margin:0">La boutique ${escHtml(S.site?.brand?.name1 ?? "VLOME")}</h3><a data-go="boutique" style="font-size:13px;font-weight:700;cursor:pointer">Voir la boutique →</a></div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px">${(S.products ?? SHOP).slice(0, 4).map((p: { name: string; price: number; ph: string; img?: string | null }) => `<div class="hcard" style="border:1px solid #282838;border-radius:14px;overflow:hidden;background:#14141D">${p.img ? `<div class="zoom" style="height:120px;background-image:url('${API}${p.img}');background-size:cover;background-position:center"></div>` : `<div class="zoom" style="height:120px;background:repeating-linear-gradient(45deg,#191922,#191922 12px,#14141D 12px,#14141D 24px);display:grid;place-items:center;color:#5D5E72;font-family:monospace;font-size:10px;letter-spacing:1px">// ${p.ph}</div>`}<div style="padding:12px 13px"><div style="font-weight:650;font-size:13.5px">${p.name}</div><div style="font-weight:800;color:#22D3EE;font-size:13px;margin-top:5px">${money(p.price)}</div></div></div>`).join("")}</div></section>`;

  const partnerList = normPartners(S);
  const partners = `<div class="rise d6" style="border:1px solid #282838;border-radius:16px;background:#0E0E16;padding:22px 24px"><div style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:#8E8FA6;font-weight:750;margin-bottom:14px">Partenaires &amp; sponsors</div><div style="display:flex;gap:12px;flex-wrap:wrap">${partnerList.map((p) => `<span style="display:inline-flex;align-items:center;gap:9px;height:44px;padding:0 18px;border:1px solid #282838;border-radius:11px;background:#14141D;color:#8E8FA6;font-weight:700;font-size:13px">${p.logoUrl ? `<img src="${API}${p.logoUrl}" alt="" style="width:22px;height:22px;object-fit:contain;border-radius:5px" />` : ""}${escHtml(p.name)}</span>`).join("")}</div></div>`;

  return `<main class="rise" style="width:100%;padding:28px clamp(22px,3vw,64px) 60px">${hero}${ticker}${tournHead}${tournGrid}${mid}${adCarousel(S, "accueil")}${newsGrid}${shopSec}${partners}</main>`;
}

function pTournois(S: State) {
  const source = S.tourns ?? TOURN;
  const manage = canManage(S);
  const q = S.q.trim().toLowerCase();
  let list = S.fmt === "Tous" ? source : source.filter((t) => t.format === S.fmt);
  if (q) list = list.filter((t) => `${t.name} ${t.game || ""}`.toLowerCase().includes(q));
  // Le bouton « Créer » n'est proposé qu'aux organisateurs / admins.
  const createBtn = manage
    ? `<button data-act="${S.creating ? "create-cancel" : "create-open"}" style="display:inline-flex;align-items:center;gap:8px;background:${S.creating ? "#1B1B27" : "linear-gradient(135deg,#22D3EE,#12aec4)"};color:${S.creating ? "#F4F5FB" : "#04222a"};border:${S.creating ? "1px solid #33334A" : "0"};border-radius:12px;padding:13px 20px;font-weight:750;font-size:14px;cursor:pointer;box-shadow:${S.creating ? "none" : "0 0 30px rgba(34,211,238,.22)"}">${S.creating ? ic(I.arrow) + "Fermer" : ic(I.plus) + "Créer un tournoi"}</button>`
    : "";
  const head = `<div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:22px"><div><h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(36px,5vw,54px);letter-spacing:1.5px;margin:0;line-height:1">Tournois</h1><p style="color:#8E8FA6;font-size:14px;margin:6px 0 0">Module Challonge · tous formats · scores &amp; arbitrage en temps réel</p></div>${createBtn}</div>`;
  const qPill = q
    ? `<div style="margin-bottom:16px"><span style="display:inline-flex;align-items:center;gap:8px;font-size:13px;color:#8E8FA6;background:#14141D;border:1px solid #282838;border-radius:999px;padding:7px 12px">Recherche : <b style="color:#F4F5FB">${S.q}</b> · ${list.length} résultat(s)<button data-clearq="1" style="display:grid;place-items:center;width:20px;height:20px;background:transparent;border:0;color:#8E8FA6;cursor:pointer">${ic(I.x, 14)}</button></span></div>`
    : "";

  const inputStyle = "width:100%;background:#1B1B27;border:1px solid #282838;border-radius:11px;color:#F4F5FB;font-family:inherit;font-size:14px;padding:11px 13px";
  const labelStyle = "font-size:12px;color:#8E8FA6;font-weight:600;display:block;margin-bottom:6px";
  const field = (label: string, inner: string) => `<div><label style="${labelStyle}">${label}</label>${inner}</div>`;
  const form = S.creating && manage ? `<section style="border:1px solid rgba(34,211,238,.3);border-radius:18px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:22px;margin-bottom:24px">
    <h3 style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:1px;margin:0 0 16px">Nouveau tournoi</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:14px">
      ${field("Nom du tournoi", `<input id="c-name" placeholder="Survival Cup Lomé" style="${inputStyle}" />`)}
      ${field("Jeu", `<input id="c-game" placeholder="EA FC 26, Tekken 8…" style="${inputStyle}" />`)}
      ${field("Format", `<select id="c-format" style="${inputStyle}">${FORMAT_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>`)}
      ${field("Lieu", `<input id="c-place" placeholder="Lomé" style="${inputStyle}" />`)}
      ${field("Date", `<input id="c-date" type="date" style="${inputStyle}" />`)}
      ${field("Points / joueur", `<input id="c-pts" type="number" min="1" value="5" style="${inputStyle}" />`)}
      ${field("Frais d'inscription (FCFA, 0 = gratuit)", `<input id="c-fee" type="number" min="0" step="100" value="0" style="${inputStyle}" />`)}
      ${field("Affiche du tournoi (image, 3 Mo max)", filePicker("c-img", "Choisir l'affiche"))}
    </div>
    ${field("Participants (un nom par ligne)", `<textarea id="c-players" rows="4" placeholder="Marie @Lomé&#10;Paul @Kara&#10;Léa…" style="${inputStyle};resize:vertical"></textarea>`)}
    <div style="display:flex;gap:10px;margin-top:16px">
      <button data-act="create-submit" ${S.busy ? "disabled" : ""} style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:12px 20px;font-weight:750;font-size:14px;cursor:${S.busy ? "default" : "pointer"};opacity:${S.busy ? ".6" : "1"}">${ic(I.plus)}${S.busy ? "Création…" : "Créer le tournoi"}</button>
      <button data-act="create-cancel" style="background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:12px;padding:12px 20px;font-weight:700;font-size:14px;cursor:pointer">Annuler</button>
    </div>
  </section>` : "";

  const filt = `<div style="display:flex;gap:9px;flex-wrap:wrap;margin-bottom:22px">${chips(FORMATS, S.fmt, "fmt")}</div>`;
  const empty = `<div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:48px 24px;text-align:center;color:#8E8FA6">Aucun tournoi ne correspond${q ? ` à « ${S.q} »` : ""}.</div>`;
  const grid = list.length
    ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px">${list.map((t) => tournCard(t, true)).join("")}</div>`
    : empty;
  return `<main class="rise" style="width:100%;padding:28px clamp(22px,3vw,64px) 60px">${head}${adCarousel(S, "tournois")}${form}${filt}${qPill}${grid}</main>`;
}

function pClassements(S: State) {
  const podium = [
    { ini: "P", name: "Prince Kodjo", pts: 298, place: "2", h: "72px", avBg: "linear-gradient(135deg,#cbd5e1,#94a3b8)", plColor: "#cbd5e1" },
    { ini: "K", name: "Kossi « K9 »", pts: 342, place: "1", h: "96px", avBg: "linear-gradient(135deg,#FBBF24,#f59e0b)", plColor: "#FBBF24" },
    { ini: "A", name: "Aminata Sow", pts: 271, place: "3", h: "56px", avBg: "linear-gradient(135deg,#d6a37a,#b4784f)", plColor: "#d6a37a" },
  ].map((p) => `<div style="display:flex;flex-direction:column;align-items:center;gap:9px;width:112px"><div style="display:grid;place-items:center;width:52px;height:52px;border-radius:14px;font-family:'Bebas Neue',sans-serif;font-size:24px;color:#04222a;background:${p.avBg}">${p.ini}</div><div style="text-align:center"><div style="font-weight:700;font-size:13.5px">${p.name}</div><div style="font-size:11px;color:#8E8FA6">${p.pts} pts</div></div><div style="width:100%;border-radius:12px 12px 0 0;border:1px solid #282838;border-bottom:0;background:#1B1B27;display:flex;align-items:center;justify-content:center;padding-top:8px;height:${p.h}"><span style="font-family:'Bebas Neue',sans-serif;font-size:28px;color:${p.plColor}">${p.place}</span></div></div>`).join("");
  const th = (t: string, r?: boolean) => `<th style="text-align:${r ? "right" : "left"};color:#8E8FA6;font-size:10.5px;text-transform:uppercase;letter-spacing:1px;padding:12px 8px;font-weight:750">${t}</th>`;
  const rows = RANK.map((r, i) => `<tr style="border-top:1px solid #282838"><td style="padding:11px 8px;font-family:'Bebas Neue',sans-serif;font-size:19px;color:#5D5E72">${i + 1}</td><td style="padding:11px 8px"><div style="display:flex;align-items:center;gap:10px"><span style="display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#22222F;border:1px solid #282838;font-size:11px;font-weight:800;color:#8E8FA6">${r.name.charAt(0)}</span><div><div style="font-weight:650">${r.name}</div><div style="font-size:11px;color:#5D5E72">${r.club}</div></div></div></td><td style="padding:11px 8px;color:#8E8FA6;font-size:12.5px">${r.game}</td><td style="padding:11px 8px;color:#8E8FA6;font-size:12.5px">${r.city}</td><td style="padding:11px 8px;text-align:right;font-variant-numeric:tabular-nums">${r.wl}</td><td style="padding:11px 8px;text-align:right;color:#34D399;font-weight:700">${r.wr}</td><td style="padding:11px 8px;text-align:right;font-variant-numeric:tabular-nums;color:#7C82FF;font-weight:700">${r.elo}</td><td style="padding:11px 8px;text-align:right;font-weight:800;color:#22D3EE;font-variant-numeric:tabular-nums">${r.pts}</td></tr>`).join("");
  return `<main class="rise" style="width:100%;padding:28px clamp(22px,3vw,64px) 60px"><h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(36px,5vw,54px);letter-spacing:1.5px;margin:0;line-height:1">Classements</h1><p style="color:#8E8FA6;font-size:14px;margin:6px 0 20px">Par jeu, ville, club, région — Togo, Afrique de l'Ouest &amp; international</p><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${chips(SCOPES, S.scope, "scope", "#7C82FF")}</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:24px">${chips(GAMES, S.game, "game")}</div><div style="display:flex;align-items:flex-end;justify-content:center;gap:14px;margin:8px 0 30px;flex-wrap:wrap">${podium}</div><div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:8px 18px 14px;overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px;min-width:640px"><tr>${th("#")}${th("Joueur")}${th("Jeu")}${th("Ville")}${th("V / D", true)}${th("Winrate", true)}${th("ELO", true)}${th("Points", true)}</tr>${rows}</table></div></main>`;
}

function pGalerie(S: State) {
  const all: Detail[] = S.gallery ?? [];
  const tournFilters = Array.from(
    new Map(all.filter((it) => it.tournament).map((it: Detail) => [it.tournament.id, it.tournament.name])).entries()
  );
  const items = S.galleryFilter ? all.filter((it) => it.tournament?.id === S.galleryFilter) : all;
  const count = all.length;
  const head = `<div style="margin-bottom:6px"><h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(36px,5vw,54px);letter-spacing:1.5px;margin:0;line-height:1">Galerie</h1><p style="color:#8E8FA6;font-size:14px;margin:6px 0 0">${count ? `${count} photo${count > 1 ? "s" : ""} et vidéo${count > 1 ? "s" : ""} des tournois, LAN et remises de prix VLOME` : "Photos et vidéos des tournois, LAN et remises de prix VLOME"}</p></div>`;
  if (!count) {
    return `<main class="rise" style="width:100%;padding:28px clamp(22px,3vw,64px) 60px">${head}
      <div style="border:1px solid #282838;border-radius:18px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:64px 24px;text-align:center;color:#8E8FA6;margin-top:20px">
        <div style="display:grid;place-items:center;width:64px;height:64px;border-radius:18px;background:#1B1B27;border:1px solid #33334A;color:#7C82FF;margin:0 auto 16px">${ic(I.image, 28)}</div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:1px;color:#F4F5FB;margin-bottom:6px">Galerie vide pour l'instant</div>
        Reviens après le prochain événement pour revivre les meilleurs moments !</div></main>`;
  }
  const filterChips = tournFilters.length
    ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:20px 0 22px">
        <button data-gfilter="" style="font-family:inherit;font-size:12.5px;font-weight:${!S.galleryFilter ? 700 : 600};color:${!S.galleryFilter ? "#22D3EE" : "#8E8FA6"};background:${!S.galleryFilter ? "rgba(34,211,238,.08)" : "#14141D"};border:1px solid ${!S.galleryFilter ? "#22D3EE" : "#282838"};border-radius:999px;padding:8px 15px;cursor:pointer">Tous</button>
        ${tournFilters.map(([id, name]) => `<button data-gfilter="${id}" style="font-family:inherit;font-size:12.5px;font-weight:${S.galleryFilter === id ? 700 : 600};color:${S.galleryFilter === id ? "#22D3EE" : "#8E8FA6"};background:${S.galleryFilter === id ? "rgba(34,211,238,.08)" : "#14141D"};border:1px solid ${S.galleryFilter === id ? "#22D3EE" : "#282838"};border-radius:999px;padding:8px 15px;cursor:pointer">${escHtml(name as string)}</button>`).join("")}
      </div>`
    : `<div style="margin-top:20px"></div>`;
  const card = (it: Detail, i: number) => {
    const media = it.mediaType === "video"
      ? `<video class="zoom" src="${API}${it.mediaUrl}" muted loop playsinline onmouseover="this.play()" onmouseout="this.pause()" style="width:100%;height:100%;object-fit:cover"></video>`
      : `<div class="zoom" style="width:100%;height:100%;background-image:url('${API}${it.mediaUrl}');background-size:cover;background-position:center"></div>`;
    return `<div data-gopen="${it.id}" class="hcard rise d${Math.min(i % 5 + 1, 5)}" style="cursor:pointer;border:1px solid #282838;border-radius:16px;overflow:hidden;background:#14141D;position:relative">
      <div style="height:250px;overflow:hidden">${media}</div>
      <div style="position:absolute;inset:0;background:linear-gradient(180deg,transparent 55%,rgba(11,11,17,.92));pointer-events:none"></div>
      ${it.mediaType === "video" ? `<span style="position:absolute;top:11px;right:11px;display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:rgba(11,11,17,.7);border:1px solid rgba(255,255,255,.2);color:#fff">${ic(I.tv, 14)}</span>` : ""}
      <div style="position:absolute;left:14px;right:14px;bottom:13px"><div style="font-weight:700;font-size:14.5px;color:#fff;line-height:1.3">${escHtml(it.title)}</div>${it.tournament ? `<div style="font-size:11.5px;color:#22D3EE;font-weight:700;margin-top:3px">${escHtml(it.tournament.name)}</div>` : ""}</div></div>`;
  };
  return `<main class="rise" style="width:100%;padding:28px clamp(22px,3vw,64px) 60px">${head}${filterChips}
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:18px">${items.map(card).join("")}</div>${galleryLightbox(S, items)}</main>`;
}

/** Visionneuse plein écran (photo/vidéo, navigation précédent/suivant). */
function galleryLightbox(S: State, items: Detail[]) {
  if (!S.galleryOpen) return "";
  const idx = items.findIndex((it) => it.id === S.galleryOpen);
  const it = items[idx];
  if (!it) return "";
  const media = it.mediaType === "video"
    ? `<video src="${API}${it.mediaUrl}" controls autoplay style="max-width:100%;max-height:78vh;border-radius:12px"></video>`
    : `<img src="${API}${it.mediaUrl}" alt="${escAttr(it.title)}" style="max-width:100%;max-height:78vh;border-radius:12px;object-fit:contain" />`;
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
  const source = S.products ?? SHOP;
  const list = S.cat === "Tous" ? source : source.filter((p) => p.cat === S.cat);
  const pImg = (p: { ph: string; img?: string | null }, h: number) => p.img
    ? `<div class="zoom" style="height:${h}px;background-image:url('${API}${p.img}');background-size:cover;background-position:center"></div>`
    : `<div class="zoom" style="height:${h}px;background:repeating-linear-gradient(45deg,#191922,#191922 13px,#14141D 13px,#14141D 26px);display:grid;place-items:center;color:#5D5E72;font-family:monospace;font-size:11px;letter-spacing:1px">// ${p.ph}</div>`;
  const grid = list.map((p, i) => `<div class="hcard rise d${Math.min(i % 5 + 1, 5)}" style="border:1px solid #282838;border-radius:16px;overflow:hidden;background:linear-gradient(180deg,#14141D,#0E0E16)">${pImg(p, 170)}<div style="padding:14px 15px 16px"><span style="font-size:11px;color:#7C82FF;font-weight:700">${p.cat}</span><div style="font-weight:650;font-size:15px;margin:5px 0 10px">${p.name}</div><div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><span style="font-weight:800;color:#22D3EE;font-size:15px">${money(p.price)}</span><button data-add-name="${p.name}" data-add-price="${p.price}" style="display:inline-flex;align-items:center;gap:6px;background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:10px;padding:9px 13px;font-weight:700;font-size:12.5px;cursor:pointer">${ic(I.plus, 15)}Ajouter</button></div></div></div>`).join("");
  const pay = PAYMENTS.map((m) => `<span style="display:inline-flex;align-items:center;height:44px;padding:0 18px;border:1px solid #282838;border-radius:11px;background:#14141D;color:#F4F5FB;font-weight:700;font-size:13px">${m}</span>`).join("");
  return `<main class="rise" style="width:100%;padding:28px clamp(22px,3vw,64px) 60px"><div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px"><div><h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(36px,5vw,54px);letter-spacing:1.5px;margin:0;line-height:1">Boutique</h1><p style="color:#8E8FA6;font-size:14px;margin:6px 0 0">Maillots, goodies, billets &amp; cartes cadeaux — paiement mobile money &amp; carte</p></div><button data-cart-open="1" style="display:inline-flex;align-items:center;gap:9px;background:#1B1B27;border:1px solid #33334A;border-radius:12px;padding:11px 16px;font-weight:700;font-size:14px;color:#F4F5FB;cursor:pointer"><span style="color:#22D3EE">${ic(I.cart, 18)}</span>${S.cartItems.length} article(s)</button></div><div style="display:flex;gap:9px;flex-wrap:wrap;margin-bottom:24px">${chips(CATS, S.cat, "cat")}</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:18px;margin-bottom:34px">${grid}</div><div style="border:1px solid #282838;border-radius:16px;background:#0E0E16;padding:22px 24px"><div style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:#8E8FA6;font-weight:750;margin-bottom:14px">Moyens de paiement</div><div style="display:flex;gap:12px;flex-wrap:wrap">${pay}</div><p style="color:#5D5E72;font-size:12px;margin:14px 0 0">Mobile money togolais (Flooz, Mixx by Yas) &amp; cartes via agrégateur — paiement manuel possible sur place.</p></div></main>`;
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
  let body: string;
  if (u.role === "ADMIN") body = adminPanel(S) + grid2(profileSecurity(S), ordersCard(S));
  else if (u.role === "ORGANIZER") body = myTournsCard(S) + grid2(regsCard(S), resultsCard(S)) + grid2(ordersCard(S), profileSecurity(S));
  else body = grid2(regsCard(S), resultsCard(S)) + grid2(ordersCard(S), profileSecurity(S));
  return wrap(header + editor + statTiles + body);
}

const grid2 = (a: string, b: string) => `<div class="grid2b" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">${a}${b}</div>`;

const secTitle = (t: string) => `<h3 style="margin:0 0 14px;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6;font-weight:750">${t}</h3>`;

function memberStats(S: State) {
  const me = S.me!;
  const since = me.createdAt ? new Date(me.createdAt).toLocaleDateString("fr-FR", { month: "short", year: "numeric" }) : "—";
  const stat = (v: string | number, k: string, color = "#F4F5FB") => `<div style="border:1px solid #282838;border-radius:14px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:16px"><div style="font-family:'Bebas Neue',sans-serif;font-size:30px;line-height:1;color:${color}">${v}</div><div style="font-size:11px;letter-spacing:.8px;text-transform:uppercase;color:#8E8FA6;font-weight:700;margin-top:6px">${k}</div></div>`;
  const tiles = [
    stat(me.stats?.registrations ?? 0, "Inscriptions", "#22D3EE"),
    stat(me.stats?.totalPoints ?? 0, "Points cumulés", "#7C82FF"),
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

function myTournsCard(S: State) {
  const ts = S.myTourns ?? [];
  const rows = ts.length
    ? ts.map((t: Detail) => `<div data-open="${t.id}" style="display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid #22222F;cursor:pointer">
        <span style="display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:#1B1B27;border:1px solid #282838;color:#FBBF24;flex:none">${ic(I.bolt, 15)}</span>
        <div style="min-width:0;flex:1"><div style="font-weight:650;font-size:14px">${t.name}</div><div style="font-size:12px;color:#5D5E72">${t.game}${t.players ? " · " + t.players + " joueurs" : ""}${t.place ? " · " + t.place : ""}</div></div>
        <span style="font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:${t.live ? "#22D3EE" : t.status === "Terminé" ? "#FBBF24" : "#8E8FA6"}">${t.live ? "En direct" : t.status}</span>
        <span style="color:#5D5E72">${ic(I.arrow, 15)}</span></div>`).join("")
    : `<div style="color:#5D5E72;font-size:13.5px;padding:16px 0;text-align:center">Tu n'as pas encore créé de tournoi.</div>`;
  const createBtn = `<button data-createnav="1" style="display:inline-flex;align-items:center;gap:7px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:11px;padding:10px 16px;font-weight:750;font-size:13.5px;cursor:pointer">${ic(I.plus, 15)}Créer un tournoi</button>`;
  return `<div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px;margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px">${secTitle(`Mes tournois (${ts.length})`)}${createBtn}</div>${rows}</div>`;
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
  ["apercu", "Aperçu"], ["site", "Site"], ["users", "Utilisateurs"], ["news", "Actualités"], ["galerie", "Galerie"], ["produits", "Produits"], ["paiements", "Paiements"], ["commandes", "Commandes"],
];
const escAttr = (v: string | null | undefined) => (v || "").replace(/"/g, "&quot;");
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

function adminPanel(S: State) {
  const a = S.admin;
  if (!a) return card(`<div style="color:#8E8FA6;text-align:center;padding:20px">Chargement du panneau admin…</div>`);
  const tabs = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px">${ADMIN_TABS.map(([k, l]) => {
    const on = S.adminTab === k;
    return `<button data-admintab="${k}" style="font-size:13px;font-weight:700;border-radius:999px;padding:9px 16px;cursor:pointer;background:${on ? "rgba(34,211,238,.1)" : "#14141D"};border:1px solid ${on ? "#22D3EE" : "#282838"};color:${on ? "#22D3EE" : "#8E8FA6"}">${l}</button>`;
  }).join("")}</div>`;
  const body =
    S.adminTab === "site" ? adminSite(S) :
    S.adminTab === "users" ? adminUsers(S) :
    S.adminTab === "news" ? adminNews(S) :
    S.adminTab === "galerie" ? adminGallery(S) :
    S.adminTab === "produits" ? adminProducts(S) :
    S.adminTab === "paiements" ? adminPayments(S) :
    S.adminTab === "commandes" ? adminOrders(a) :
    adminOverview(a);
  return tabs + body;
}

/** Onglet Site : identité (logo/nom), héro, slider « À la une », partenaires. */
function adminSite(S: State) {
  const site = S.site;
  if (!site) return card(`<div style="color:#8E8FA6;text-align:center;padding:20px">Chargement des réglages…</div>`);
  const b = site.brand || {};
  const hz = site.hero || {};
  const stats: Detail[] = hz.stats?.length ? hz.stats : [{ v: "", k: "" }, { v: "", k: "" }, { v: "", k: "" }];
  const slides: Detail[] = site.slides?.length ? site.slides : [{}, {}, {}];
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

  const slidesSec = sec("Accueil · « À la une » (slider, 3 diapos)", [0, 1, 2].map((i) => `
    <div style="border:1px solid #22222F;border-radius:12px;padding:14px;margin-bottom:${i < 2 ? "12px" : "0"}">
      <div style="${lbl};margin-bottom:8px;color:#22D3EE">Diapo ${i + 1}</div>
      <div style="display:grid;grid-template-columns:1fr 2fr;gap:12px" class="grid2b">
        <label style="${lbl}">Badge<input id="sl${i}-tag" value="${escAttr(slides[i]?.tag)}" placeholder="Grand tournoi" style="${adminInp}" /></label>
        <label style="${lbl}">Titre<input id="sl${i}-title" value="${escAttr(slides[i]?.title)}" placeholder="SURVIVAL CUP LOMÉ 2026" style="${adminInp}" /></label>
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-top:10px" class="grid2b">
        <label style="${lbl}">Texte<input id="sl${i}-sub" value="${escAttr(slides[i]?.sub)}" placeholder="Description courte…" style="${adminInp}" /></label>
        <label style="${lbl}">Bouton<input id="sl${i}-cta" value="${escAttr(slides[i]?.cta)}" placeholder="S'inscrire" style="${adminInp}" /></label>
      </div>
      <div style="margin-top:10px"><div style="${lbl}">Image de la diapo (fond du carrousel)</div>${filePicker(`sl${i}-img`, "Choisir une image", "image/*", slides[i]?.imageUrl)}</div>
    </div>`).join(""));

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
      ${n.imageUrl ? `<img src="${API}${n.imageUrl}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:10px;border:1px solid #282838;flex:none" />` : `<span style="display:grid;place-items:center;width:44px;height:44px;border-radius:10px;background:#1B1B27;border:1px solid #282838;color:#5D5E72;flex:none">${ic(I.image, 17)}</span>`}
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
      <div style="height:150px;position:relative;background:${it.mediaType === "video" ? "#14141D" : `url('${API}${it.mediaUrl}')`};background-size:cover;background-position:center">
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
    <div style="margin-top:14px"><div style="font-size:12px;color:#8E8FA6;font-weight:600">Image du produit (jpg, png, webp — 3 Mo max)</div>${filePicker("pr-img", "Choisir une image", "image/*", e.imageUrl)}</div>
    <div style="display:flex;gap:10px;margin-top:14px"><button data-prodsave="${e.id || "new"}" style="background:linear-gradient(135deg,#7C82FF,#5a60e0);color:#fff;border:0;border-radius:11px;padding:11px 18px;font-weight:750;font-size:14px;cursor:pointer">${e.id ? "Enregistrer" : "Ajouter le produit"}</button><button data-prodcancel="1" style="background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer">Annuler</button></div>
  </div>` : "";
  const q = S.adminSearch.trim().toLowerCase();
  const products = q ? a.products.filter((p: Detail) => `${p.name} ${p.category}`.toLowerCase().includes(q)) : a.products;
  const rows = products.length ? products.map((p: Detail) => `<tr style="border-top:1px solid #22222F">
      <td style="padding:10px 8px"><div style="display:flex;align-items:center;gap:10px">${p.imageUrl ? `<img src="${API}${p.imageUrl}" alt="" style="width:38px;height:38px;object-fit:cover;border-radius:9px;border:1px solid #282838;flex:none" />` : `<span style="display:grid;place-items:center;width:38px;height:38px;border-radius:9px;background:#1B1B27;border:1px solid #282838;color:#5D5E72;flex:none">${ic(I.cart, 15)}</span>`}<div><div style="font-weight:650">${escHtml(p.name)}</div><div style="font-size:11.5px;color:#5D5E72">${escHtml(p.category)}</div></div></div></td>
      <td style="padding:10px 8px;text-align:right;font-weight:800;color:#22D3EE;white-space:nowrap">${money(p.priceXof)}</td>
      <td style="padding:10px 8px;text-align:right;color:${p.stock > 0 ? "#8E8FA6" : "#FB7185"};font-weight:700;white-space:nowrap">${p.stock > 0 ? p.stock + " en stock" : "Rupture"}</td>
      <td style="padding:10px 8px;text-align:right"><div style="display:inline-flex;gap:6px">${btnSm(`data-prodedit="${p.id}"`, "Modifier", "#22D3EE", "#22D3EE55")}${btnSm(`data-proddel="${p.id}"`, "Supprimer", "#FB7185", "rgba(251,113,133,.35)")}</div></td></tr>`).join("")
    : `<tr><td style="color:#5D5E72;font-size:13.5px;padding:16px 0;text-align:center">${q ? "Aucun produit trouvé." : "Aucun produit."}</td></tr>`;
  const head = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px">${secTitle(`Produits (${a.products.length})`)}<button data-prodnew="1" style="display:inline-flex;align-items:center;gap:7px;background:linear-gradient(135deg,#7C82FF,#5a60e0);color:#fff;border:0;border-radius:11px;padding:10px 16px;font-weight:750;font-size:13.5px;cursor:pointer">${ic(I.plus, 15)}Nouveau produit</button></div>`;
  return editor + `<div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px">${head}${adminSearchBar(S, "Nom ou catégorie…")}${scrollBox(`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px;min-width:480px"><tbody>${rows}</tbody></table></div>`)}</div>`;
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

function pTournoi(S: State) {
  const t = S.detail;
  if (!t) return `<main style="max-width:1220px;margin:0 auto;padding:40px 22px;text-align:center;color:#8E8FA6">Chargement du tournoi…</main>`;
  const manage = canManage(S); // seuls organisateur/admin voient les contrôles de pilotage
  const statusMap: Record<string, [string, string]> = { setup: ["À lancer", "#8E8FA6"], live: ["En direct", "#22D3EE"], finished: ["Terminé", "#FBBF24"] };
  const [slabel, scolor] = statusMap[t.status] || ["", "#8E8FA6"];
  const dist = t.distributed || 0, total = t.cagnotte?.total || 0;
  const pct = total ? Math.min(100, (dist / total) * 100) : 0;

  const head = `<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:20px">
    <button data-back="1" style="display:inline-flex;align-items:center;gap:7px;background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:10px 14px;font-weight:700;font-size:13.5px;cursor:pointer">← Tournois</button>
    <div style="min-width:0"><h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(28px,4vw,44px);letter-spacing:1px;margin:0;line-height:1">${t.name}</h1><div style="color:#8E8FA6;font-size:13px;margin-top:4px">${t.game || ""}</div></div>
    <span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:${scolor};background:rgba(34,211,238,.06);border:1px solid ${scolor}55;border-radius:99px;padding:6px 12px">${slabel}</span>
    <div style="flex:1"></div>
    <button data-show="${t.id}" style="display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,rgba(34,211,238,.14),rgba(124,130,255,.14));border:1px solid #22D3EE66;color:#22D3EE;border-radius:11px;padding:9px 13px;font-weight:700;font-size:13px;cursor:pointer">${ic(I.tv, 15)}Mode Show</button>
    ${manage ? `<button data-edit="1" style="display:inline-flex;align-items:center;gap:6px;background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:9px 13px;font-weight:700;font-size:13px;cursor:pointer">${ic(I.edit || I.plus, 15)}Modifier</button>
    <button data-del="${t.id}" style="display:inline-flex;align-items:center;gap:6px;background:transparent;border:1px solid rgba(251,113,133,.35);color:#FB7185;border-radius:11px;padding:9px 13px;font-weight:700;font-size:13px;cursor:pointer">${ic(I.trash, 15)}Supprimer</button>` : ""}
    <div style="min-width:200px"><div style="display:flex;justify-content:space-between;font-size:12px;color:#8E8FA6;margin-bottom:6px"><span>Cagnotte distribuée</span><span style="font-weight:700;color:#F4F5FB">${dist} / ${total} pts</span></div><div style="height:9px;border-radius:99px;background:#22222F;border:1px solid #282838;overflow:hidden"><span style="display:block;height:100%;width:${pct}%;background:linear-gradient(90deg,#22D3EE,#7C82FF)"></span></div></div>
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
      <div><div style="font-size:12px;color:#8E8FA6;font-weight:600">Affiche (image)</div>${filePicker("e-img", "Remplacer l'affiche", "image/*", t.imageUrl)}</div>
    </div>
    <div style="display:flex;gap:10px;margin-top:14px"><button data-editsave="${t.id}" style="background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:11px;padding:11px 18px;font-weight:750;font-size:14px;cursor:pointer">Enregistrer</button><button data-editcancel="1" style="background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer">Annuler</button></div>
  </div>` : "";

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
      action = `<div style="display:flex;flex-direction:column;align-items:center;gap:14px">
        <div><div style="color:#8E8FA6;font-size:12.5px;font-weight:700;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Moyen de paiement</div><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">${chips}</div></div>
        <button data-reg="${t.id}" ${S.payPick ? "" : "disabled"} style="display:inline-flex;align-items:center;gap:8px;background:${S.payPick ? "linear-gradient(135deg,#22D3EE,#12aec4)" : "#22222F"};color:${S.payPick ? "#04222a" : "#5D5E72"};border:0;border-radius:12px;padding:14px 26px;font-weight:750;font-size:16px;cursor:${S.payPick ? "pointer" : "default"};box-shadow:${S.payPick ? "0 0 34px rgba(34,211,238,.24)" : "none"}">${ic(I.plus, 18)}S'inscrire · ${money(fee)}</button>
      </div>`;
    } else {
      action = `<button data-reg="${t.id}" style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:14px 26px;font-weight:750;font-size:16px;cursor:pointer;box-shadow:0 0 34px rgba(34,211,238,.24)">${ic(I.plus, 18)}S'inscrire au tournoi</button>`;
    }
    const sub = manage
      ? "Le lancement répartit les joueurs en poules et démarre le mode Survival. L'ordre de passage est verrouillé."
      : fee > 0 ? "Inscription payante : choisis un moyen de paiement, l'organisateur confirmera à réception."
      : "Les inscriptions sont ouvertes jusqu'au lancement par l'organisateur.";
    const feeBadge = fee > 0 ? `<div style="display:inline-flex;align-items:center;gap:7px;color:#FBBF24;font-weight:700;font-size:13px;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.35);border-radius:99px;padding:6px 14px;margin-bottom:18px">${ic(I.cart, 14)}Frais d'inscription : ${money(fee)}</div>` : "";
    const names: string[] = Array.isArray(t.players) ? t.players : [];
    const participants = names.length
      ? `<div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px;margin-top:18px">
          <h3 style="margin:0 0 14px;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6;font-weight:750">Participants (${names.length})</h3>
          <div style="display:flex;gap:8px;flex-wrap:wrap">${names.map((n) => `<span style="display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:#F4F5FB;background:#14141D;border:1px solid #282838;border-radius:999px;padding:7px 13px"><span style="display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#22222F;font-size:10px;font-weight:800;color:#22D3EE">${n.charAt(0).toUpperCase()}</span>${n}</span>`).join("")}</div></div>`
      : "";
    const pendingPanel = manage ? paymentsPanel(S, t.id) : "";
    return `<main style="width:100%;padding:28px clamp(22px,3vw,64px) 60px">${head}${editCard}
      <div style="border:1px solid #282838;border-radius:18px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:48px 24px;text-align:center">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:28px;letter-spacing:1px;margin-bottom:6px">${manage ? "Prêt à démarrer" : "Inscriptions ouvertes"}</div>
        ${feeBadge}
        <p style="color:#8E8FA6;font-size:14px;max-width:460px;margin:0 auto 22px">${sub}</p>
        ${action}
      </div>${pendingPanel}${participants}</main>`;
  }

  // Poule (match courant cliquable + classement)
  const poolCard = (p: Detail) => {
    let body: string;
    if (p.current) {
      const stageLabel: Record<string, string> = { survival: "Survival", losers: "Repêchage", poolFinal: "Finale de poule" };
      const stageTitle = `${stageLabel[p.current.stage] || p.current.stage}${p.current.streak > 1 ? " · série " + p.current.streak : ""}`;
      const subA = p.current.stage === "poolFinal" ? "Champ. vainqueurs" : "Survivant";
      const subB = p.current.stage === "poolFinal" ? "Champ. perdants" : "Challenger";
      if (manage) {
        const side = (id: string, name: string, cls: string, sub: string) => `<button data-report="${p.current.poolId}|${id}" style="flex:1;min-height:120px;border-radius:15px;border:1px solid ${cls === "surv" ? "rgba(34,211,238,.4)" : "rgba(244,63,126,.35)"};background:linear-gradient(180deg,${cls === "surv" ? "rgba(34,211,238,.08)" : "rgba(244,63,126,.05)"},#14141D);color:#F4F5FB;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:14px"><span style="font-size:10.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:${cls === "surv" ? "#22D3EE" : "#F43F7E"}">${sub}</span><span style="font-family:'Bebas Neue',sans-serif;font-size:30px;line-height:1;color:${cls === "surv" ? "#22D3EE" : "#F43F7E"}">${name}</span></button>`;
        const inp = "width:56px;text-align:center;background:#1B1B27;border:1px solid #282838;border-radius:9px;color:#F4F5FB;padding:8px;font-family:inherit;font-size:15px";
        body = `<div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8E8FA6;font-weight:700;margin-bottom:10px">${stageTitle} — saisis le score (FT) ou touche un vainqueur</div>
          <div style="display:flex;align-items:stretch;gap:12px"><div style="flex:1">${side(p.current.aId, p.current.aName, "surv", subA)}</div><div style="display:flex;align-items:center;color:#5D5E72;font-family:'Bebas Neue',sans-serif;font-size:22px">VS</div><div style="flex:1">${side(p.current.bId, p.current.bName, "chal", subB)}</div></div>
          <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:12px"><input id="sc-a-${p.current.poolId}" type="number" min="0" value="0" style="${inp}" /><span style="color:#5D5E72;font-weight:700">–</span><input id="sc-b-${p.current.poolId}" type="number" min="0" value="0" style="${inp}" /><button data-reportscore="${p.current.poolId}" ${S.detailBusy ? "disabled" : ""} style="background:#22222F;border:1px solid #33334A;color:#22D3EE;border-radius:9px;padding:9px 15px;font-weight:700;font-size:13px;cursor:pointer">Valider le score</button></div>`;
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
  };

  const poolsHtml = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px">${t.pools.map(poolCard).join("")}</div>`;

  // Bouton phase finale
  const finalsBtn = manage && t.allPoolsDone && !t.finals
    ? `<div style="text-align:center;margin:24px 0"><button data-finals-start="${t.id}" ${S.detailBusy ? "disabled" : ""} style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:14px 24px;font-weight:750;font-size:15px;cursor:pointer;box-shadow:0 0 30px rgba(34,211,238,.22)">${ic(I.crown)}Lancer la phase finale</button></div>`
    : "";

  // Bracket finale
  let finalsHtml = "";
  if (t.finals) {
    const champ = t.finals.champion
      ? `<div style="border:1px solid rgba(251,191,36,.4);border-radius:16px;background:linear-gradient(180deg,rgba(251,191,36,.08),#14141D);padding:24px;text-align:center;margin-bottom:18px"><div style="font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:#FBBF24;font-weight:800">${ic(I.crown, 16)} Champion du tournoi</div><div style="font-family:'Bebas Neue',sans-serif;font-size:44px;letter-spacing:1px;margin-top:6px">${t.finals.champion}</div></div>`
      : "";
    const rounds = t.finals.rounds.map((round: Detail) => {
      const matches = round.matches.map((m: Detail) => {
        const line = (name: string | null, id: string | null, win: boolean, playable: boolean) => {
          if (!name) return `<div style="padding:9px 11px;color:#5D5E72;font-style:italic">à venir</div>`;
          if (playable && manage) return `<button data-reportf="${m.matchId}|${id}" style="display:block;width:100%;text-align:left;padding:9px 11px;background:transparent;border:0;color:#F4F5FB;cursor:pointer;font-family:inherit;font-size:14px">${name}</button>`;
          return `<div style="padding:9px 11px;color:${win ? "#22D3EE" : "#8E8FA6"};font-weight:${win ? 700 : 400}">${name}${win ? " ✓" : ""}</div>`;
        };
        if (m.bye) return `<div style="border:1px solid #282838;border-radius:10px;overflow:hidden;background:#14141D">${line(m.aName, m.aId, true, false)}<div style="padding:9px 11px;color:#5D5E72;font-style:italic;border-top:1px solid #22222F">exempt</div></div>`;
        return `<div style="border:1px solid ${m.playable ? "rgba(34,211,238,.4)" : "#282838"};border-radius:10px;overflow:hidden;background:#14141D">${line(m.aName, m.aId, m.winnerId === m.aId, m.playable)}<div style="border-top:1px solid #22222F">${line(m.bName, m.bId, m.winnerId === m.bId, m.playable)}</div></div>`;
      }).join("");
      return `<div style="display:flex;flex-direction:column;justify-content:space-around;gap:12px;min-width:180px"><div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8E8FA6;font-weight:700">${round.label}</div>${matches}</div>`;
    }).join("");
    finalsHtml = `<div style="margin-top:26px">${champ}<div style="font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:1px;margin-bottom:14px;display:flex;align-items:center;gap:10px"><span style="width:5px;height:22px;border-radius:3px;background:#22D3EE"></span>Phase finale</div><div style="display:flex;gap:24px;overflow-x:auto;padding-bottom:10px">${rounds}</div></div>`;
  }

  return `<main class="rise" style="width:100%;padding:28px clamp(22px,3vw,64px) 60px">${head}${editCard}${finalsHtml || poolsHtml + finalsBtn}</main>`;
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
  const total = S.cartItems.reduce((a, i) => a + i.price, 0);
  const rows = S.cartItems.length
    ? S.cartItems.map((i, idx) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 0;border-bottom:1px solid #22222F"><div><div style="font-weight:600;font-size:14px">${i.name}</div><div style="font-size:12.5px;color:#22D3EE;font-weight:700">${money(i.price)}</div></div><button data-cart-remove="${idx}" style="display:grid;place-items:center;width:32px;height:32px;background:transparent;border:1px solid #282838;border-radius:9px;color:#8E8FA6;cursor:pointer">${ic(I.trash, 15)}</button></div>`).join("")
    : `<div style="color:#5D5E72;font-size:14px;text-align:center;padding:40px 0">Ton panier est vide.<br>Ajoute des articles depuis la boutique.</div>`;
  return `<div data-cart-close="1" style="position:fixed;inset:0;z-index:200;background:rgba(6,6,10,.6);backdrop-filter:blur(4px)">
    <div data-stop="1" style="position:absolute;top:0;right:0;height:100%;width:min(420px,92vw);background:#0E0E16;border-left:1px solid #282838;padding:22px;display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><span style="font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:1px">Panier</span><span data-cart-close="1" style="color:#8E8FA6;cursor:pointer">${ic(I.x, 20)}</span></div>
      <div style="flex:1;overflow-y:auto">${rows}</div>
      <div style="border-top:1px solid #282838;padding-top:16px;margin-top:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><span style="color:#8E8FA6;font-size:14px">Total</span><span style="font-family:'Bebas Neue',sans-serif;font-size:26px;color:#22D3EE">${money(total)}</span></div>
        <button ${S.cartItems.length ? "" : "disabled"} data-checkout="1" style="width:100%;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:13px;font-weight:750;font-size:15px;cursor:${S.cartItems.length ? "pointer" : "default"};opacity:${S.cartItems.length ? "1" : ".5"}">Commander</button>
        ${S.cartItems.length ? `<button data-cart-clear="1" style="width:100%;margin-top:8px;background:transparent;border:1px solid #282838;color:#8E8FA6;border-radius:12px;padding:11px;font-weight:600;font-size:13px;cursor:pointer">Vider le panier</button>` : ""}
      </div>
    </div></div>`;
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
  const title = `<div style="text-align:center;margin-bottom:1vh"><div style="font-family:'Bebas Neue',sans-serif;font-size:5.5vh;letter-spacing:2px;line-height:1">${t.name}</div><div style="display:inline-flex;align-items:center;gap:.8vh;color:${t.status === "live" ? "#22D3EE" : "#8E8FA6"};font-weight:800;letter-spacing:2px;font-size:1.7vh;text-transform:uppercase;margin-top:1vh">${t.status === "live" ? `<span style="width:1vh;height:1vh;border-radius:50%;background:#22D3EE;animation:blink 1.2s infinite"></span>En direct` : t.status === "setup" ? "À lancer" : ""}</div></div>`;
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
  const grid = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(440px,92vw),1fr));gap:2vh;margin-top:2.4vh">${t.pools.map(poolCard).join("")}</div>`;
  return `<div style="min-height:100vh;padding:4vh 3vw;position:relative">${close}${brand}${title}${grid}</div>`;
}

/**
 * Emplacement publicitaire : carrousel compact et animé (pas une bannière étirée
 * sur toute la largeur). Affiche les pubs ciblant cette page (ou « toutes les
 * pages ») ; s'il y en a plusieurs, elles tournent automatiquement avec des
 * puces de navigation. L'image reste toujours visible en entier (object-fit:contain).
 */
function adCarousel(S: State, pageKey: string) {
  const all: Detail[] = S.site?.ads ?? [];
  const items = all.filter((a) => a.imageUrl && (a.page === pageKey || a.page === "toutes"));
  if (!items.length) return "";
  const idx = items.length > 1 ? ((S.adSlide % items.length) + items.length) % items.length : 0;
  const ad = items[idx];
  const card = `<div class="hcard slidein" style="border:1px solid #282838;border-radius:16px;overflow:hidden;background:linear-gradient(180deg,#14141D,#0E0E16)">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:11px 15px 0">
      <span style="font-size:9.5px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#5D5E72">Publicité</span>
      ${ad.label ? `<span style="font-size:11.5px;font-weight:700;color:#8E8FA6">${escHtml(ad.label)}</span>` : ""}
    </div>
    <div style="height:130px;display:flex;align-items:center;justify-content:center;padding:12px 22px">
      <img src="${API}${ad.imageUrl}" alt="${escAttr(ad.label || "Publicité")}" style="max-width:100%;max-height:100%;object-fit:contain" />
    </div></div>`;
  const clickable = ad.linkUrl ? `<a href="${escAttr(ad.linkUrl)}" target="_blank" rel="noopener sponsored" style="display:block">${card}</a>` : card;
  const dots = items.length > 1
    ? `<div style="display:flex;gap:6px;justify-content:center;margin-top:10px">${items.map((_, i) => `<span data-adslide="${i}" style="display:inline-block;width:${i === idx ? 18 : 7}px;height:6px;border-radius:99px;background:${i === idx ? "#7C82FF" : "#33334A"};cursor:pointer;transition:width .2s"></span>`).join("")}</div>`
    : "";
  return `<div style="max-width:520px;margin:0 auto 30px">${clickable}${dots}</div>`;
}

/** Bandeau permanent des partenaires — présent sur toutes les pages, sous l'en-tête. */
function partnersMarquee(S: State) {
  const partners = normPartners(S);
  if (!partners.length) return "";
  const items = partners.map((p) => `<span style="display:inline-flex;align-items:center;gap:8px;margin:0 22px;font-size:12px;font-weight:700;color:#5D5E72;letter-spacing:.4px">${p.logoUrl ? `<img src="${API}${p.logoUrl}" alt="" style="width:16px;height:16px;object-fit:contain;border-radius:4px" />` : ic(I.crown, 12)}${escHtml(p.name)}</span>`).join("");
  return `<div class="marquee" style="border-bottom:1px solid #1B1B27;background:#0B0B11;padding:7px 0"><div class="marquee-track">${items}${items}</div></div>`;
}

function renderPage(S: State) {
  if (S.page === "show") return pShow(S);
  const pages: Record<string, (s: State) => string> = { accueil: pAccueil, tournois: pTournois, classements: pClassements, galerie: pGalerie, boutique: pBoutique, profil: pDashboard, tournoi: pTournoi, auth: pAuth };
  const body = (pages[S.page] || pAccueil)(S);
  const footer = `<footer style="border-top:1px solid #282838;padding:26px 22px;text-align:center;color:#5D5E72;font-size:12.5px">VLOME Esport Platform · Le hub de l'esport togolais &amp; ouest-africain · Module Tournois propulsé par Survival Challonge</footer>`;
  return header(S) + partnersMarquee(S) + body + footer + cartDrawer(S) + confirmModal(S);
}

/* ================= Composant ================= */
export default function Page() {
  const [S, setS] = useState<State>({
    page: "accueil", slide: 0, fmt: "Tous", scope: "Togo", game: "Tous", cat: "Tous",
    tourns: null, creating: false, busy: false,
    cartItems: [], cartOpen: false, products: null,
    user: null, authTab: "login", authBusy: false, authError: "", authRole: "PLAYER",
    q: "",
    openId: null, detail: null, detailBusy: false, editing: false, admin: null,
    adminTab: "apercu", adminSearch: "", newsEdit: null, prodEdit: null, news: null, confirmBox: null,
    site: null, siteMsg: "",
    me: null, myRegs: null, myOrders: null, myTourns: null, myResults: null,
    regIds: [], profileMsg: "", passMsg: "", profileEdit: false,
    payPick: "", gallery: null, galleryEdit: null, galleryFilter: "", galleryOpen: null, regsPanel: null,
    partnersEdit: null, adsEdit: null, adSlide: 0,
  });
  const html = useMemo(() => renderPage(S), [S]);

  // Les animations d'entrée (.rise) ne jouent qu'au changement de page :
  // tout autre re-rendu recrée le DOM et les rejouerait sinon.
  const prevPage = useRef<string | null>(null);
  const pageChanged = prevPage.current !== S.page;
  useEffect(() => { prevPage.current = S.page; });

  /* ---------- Pilotage d'un tournoi ---------- */
  async function openDetail(id: string, page = "tournoi") {
    setS((s) => ({ ...s, page, openId: id, detail: null, regsPanel: null, payPick: "" }));
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
      else setS((s) => ({ ...s, detailBusy: false }));
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

  async function loadProducts() {
    try {
      const r = await fetch(`${API}/api/products`);
      if (!r.ok) return;
      const rows: { name: string; category: string; priceXof: number; imageUrl?: string | null }[] = await r.json();
      if (Array.isArray(rows) && rows.length) {
        setS((s) => ({ ...s, products: rows.map((p) => ({ cat: p.category, name: p.name, price: p.priceXof, ph: p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), img: p.imageUrl || null })) }));
      }
    } catch { /* repli statique */ }
  }
  async function checkout() {
    if (!S.cartItems.length) return;
    if (!token()) { setS((s) => ({ ...s, cartOpen: false, page: "auth" })); window.scrollTo({ top: 0 }); return; }
    try {
      const r = await fetch(`${API}/api/orders`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ items: S.cartItems.map((i) => ({ name: i.name, priceXof: i.price })), paymentMethod: "Flooz" }) });
      if (r.status === 401) { setS((s) => ({ ...s, page: "auth", user: null })); return; }
      if (r.ok) { const o = await r.json(); alert("Commande " + o.reference + " enregistrée · " + o.totalXof + " F · paiement " + o.paymentMethod + " (agrégateur à venir)."); setS((s) => ({ ...s, cartItems: [], cartOpen: false, me: null, myOrders: null })); }
    } catch { /* ignore */ }
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
  const newKey = () => Math.random().toString(36).slice(2, 9);

  async function saveSite() {
    const val = (x: string) => (document.getElementById(x) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? "";
    let logoUrl = S.site?.brand?.logoUrl ?? null;
    let heroBg = S.site?.hero?.bgUrl ?? null;
    const slideImgs: (string | null)[] = [0, 1, 2].map((i) => S.site?.slides?.[i]?.imageUrl ?? null);
    const partnerRows = syncPartnersFromDom(S.partnersEdit ?? []);
    const adRows = syncAdsFromDom(S.adsEdit ?? []);
    try {
      const up = await uploadFile("b-logo"); if (up) logoUrl = up;
      const bg = await uploadFile("h-bg"); if (bg) heroBg = bg;
      for (const i of [0, 1, 2]) { const im = await uploadFile(`sl${i}-img`); if (im) slideImgs[i] = im; }
      for (const p of partnerRows) { const im = await uploadFile(`pt-${p.key}-logo`); if (im) p.logoUrl = im; }
      for (const a of adRows) { const im = await uploadFile(`ad-${a.key}-img`); if (im) a.imageUrl = im; }
    } catch { return; }
    const brand = { name1: val("b-name1").trim() || "VLOME", name2: val("b-name2").trim(), logoUrl };
    const hero = {
      kicker: val("h-kicker").trim(), title: val("h-title"), subtitle: val("h-sub").trim(),
      bgUrl: heroBg,
      stats: [0, 1, 2].map((i) => ({ v: val(`h-s${i}v`).trim(), k: val(`h-s${i}k`).trim() })).filter((st) => st.v || st.k),
    };
    const slides = [0, 1, 2]
      .map((i) => ({ tag: val(`sl${i}-tag`).trim(), title: val(`sl${i}-title`).trim(), sub: val(`sl${i}-sub`).trim(), cta: val(`sl${i}-cta`).trim(), imageUrl: slideImgs[i] }))
      .filter((sl) => sl.title);
    const partners = partnerRows.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), logoUrl: p.logoUrl }));
    const ads = adRows.filter((a) => a.imageUrl).map((a) => ({ label: a.label.trim(), linkUrl: a.linkUrl.trim(), imageUrl: a.imageUrl, page: a.page || "accueil" }));
    try {
      const save = (key: string, value: unknown) => fetch(`${API}/api/admin/settings/${key}`, {
        method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ value }),
      });
      const rs = await Promise.all([save("brand", brand), save("hero", hero), save("slides", slides), save("partners", partners), save("ads", ads)]);
      if (rs.every((r) => r.ok)) {
        await loadSettings();
        setS((s) => ({ ...s, siteMsg: "Réglages enregistrés.", slide: 0, partnersEdit: null, adsEdit: null }));
      } else setS((s) => ({ ...s, siteMsg: "Certains réglages n'ont pas pu être enregistrés." }));
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
    const body: Detail = { name: val("pr-name").trim(), category: val("pr-cat").trim() || "Goodies", priceXof: parseInt(val("pr-price")) || 0, stock: parseInt(val("pr-stock")) || 0 };
    if (!body.name) { alert("Le nom du produit est requis."); return; }
    try { const img = await uploadFile("pr-img"); if (img) body.imageUrl = img; } catch { return; }
    if (id === "new") adminAct("products", "POST", body);
    else adminAct(`products/${id}`, "PATCH", body);
  }

  /** Écriture admin générique puis rafraîchissement (panneau + site public). */
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
    if (register && fee > 0 && !S.payPick) { alert("Choisis un moyen de paiement avant de t'inscrire."); return; }
    try {
      const r = await fetch(`${API}/api/tournaments/${id}/register`, {
        method: register ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: register && fee > 0 ? JSON.stringify({ paymentMethod: S.payPick }) : undefined,
      });
      if (r.status === 401) { setS((s) => ({ ...s, page: "auth", user: null })); return; }
      const data = await r.json();
      if (!r.ok) { alert(data.message || "Action impossible."); return; }
      await loadRegIds();
      await loadTournaments();
      setS((s) => ({ ...s, me: null, myRegs: null, myResults: null, payPick: "" })); // le profil se rechargera
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

  // Montage : charge les tournois, restaure la session, gère #creer.
  useEffect(() => {
    // Chargement initial groupé : une seule mise à jour d'état (pas de rejeu d'animations).
    (async () => {
      const get = async (p: string) => { try { const r = await fetch(`${API}/api/${p}`); return r.ok ? await r.json() : null; } catch { return null; } };
      const [tourns, products, news, site, gallery] = await Promise.all([get("tournaments"), get("products"), get("news"), get("settings"), get("gallery")]);
      setS((s) => ({
        ...s,
        tourns: Array.isArray(tourns) && tourns.length ? tourns : s.tourns,
        products: Array.isArray(products) && products.length
          ? products.map((p: Detail) => ({ cat: p.category, name: p.name, price: p.priceXof, ph: p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), img: p.imageUrl || null }))
          : s.products,
        news: Array.isArray(news) && news.length ? news : s.news,
        site: site || s.site,
        gallery: Array.isArray(gallery) ? gallery : s.gallery,
      }));
    })();
    try {
      const u = localStorage.getItem("vlome_user");
      if (u) { setS((s) => ({ ...s, user: JSON.parse(u) })); loadRegIds(); }
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

  async function submitCreate() {
    const val = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? "";
    const name = val("c-name").trim();
    if (!name) { (document.getElementById("c-name") as HTMLInputElement)?.focus(); return; }
    const players = val("c-players").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const body: Detail = {
      name, game: val("c-game").trim(), format: val("c-format"), place: val("c-place").trim(),
      date: val("c-date") || undefined, pointsPerPlayer: parseInt(val("c-pts")) || 5, players,
      entryFeeXof: parseInt(val("c-fee")) || 0,
    };
    if (!token()) { setS((s) => ({ ...s, page: "auth" })); window.scrollTo({ top: 0 }); return; }
    setS((s) => ({ ...s, busy: true }));
    // Affiche du tournoi (optionnelle)
    try { const img = await uploadFile("c-img"); if (img) body.imageUrl = img; }
    catch { setS((s) => ({ ...s, busy: false })); return; }
    try {
      const r = await fetch(`${API}/api/tournaments`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(body),
      });
      if (r.status === 401) { setS((s) => ({ ...s, busy: false, page: "auth", user: null })); return; }
      if (!r.ok) throw new Error();
      await loadTournaments();
      setS((s) => ({ ...s, busy: false, creating: false, fmt: "Tous" }));
    } catch {
      setS((s) => ({ ...s, busy: false }));
      alert("Création impossible — l'API est-elle démarrée ? (pnpm dev:api)");
    }
  }

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    // déconnexion : sous-élément du bouton utilisateur, à traiter avant data-menu-user
    if (target.closest("[data-logout]")) {
      setS((s) => ({ ...s, confirmBox: { title: "Déconnexion", message: "Tu vas être déconnecté de ton compte VLOME.", okLabel: "Se déconnecter", action: "logout" } }));
      return;
    }
    const el = target.closest<HTMLElement>("[data-go],[data-slide],[data-fmt],[data-scope],[data-game],[data-cat],[data-act],[data-add-name],[data-cart-open],[data-cart-close],[data-cart-remove],[data-cart-clear],[data-checkout],[data-auth-open],[data-auth-tab],[data-auth-submit],[data-stop],[data-open],[data-back],[data-launch],[data-report],[data-finals-start],[data-reportf],[data-reportscore],[data-del],[data-edit],[data-editcancel],[data-editsave],[data-authrole],[data-setrole],[data-createnav],[data-show],[data-showclose],[data-clearq],[data-profileedit],[data-profilecancel],[data-profilesave],[data-passsave],[data-reg],[data-unreg],[data-admintab],[data-newsnew],[data-newsedit],[data-newscancel],[data-newssave],[data-newspub],[data-newsdel],[data-prodnew],[data-prodedit],[data-prodcancel],[data-prodsave],[data-proddel],[data-ordstatus],[data-filepick],[data-confirm-ok],[data-confirm-cancel],[data-sitesave],[data-herobgclear],[data-paypick],[data-confirmpay],[data-gallerynew],[data-gallerysave],[data-gallerycancel],[data-gallerydel],[data-adnew],[data-adsave],[data-adcancel],[data-addel],[data-ptadd],[data-ptdel],[data-adslide],[data-gfilter],[data-gopen],[data-gclose],[data-gprev],[data-gnext],[data-admsearchclear]");
    if (!el) return;
    const d = el.dataset;
    if (d.stop !== undefined) return; // clic à l'intérieur d'une modale : ne pas fermer
    if (d.open) { openDetail(d.open); }
    else if (d.back !== undefined) { setS((s) => ({ ...s, page: "tournois", detail: null, openId: null })); }
    else if (d.launch) { act(`${API}/api/tournaments/${d.launch}/launch`); }
    else if (d.finalsStart) { act(`${API}/api/tournaments/${d.finalsStart}/finals/start`); }
    else if (d.report) { const [poolId, winnerId] = d.report.split("|"); act(`${API}/api/tournaments/${S.openId}/report`, { poolId, winnerId }); }
    else if (d.reportf) { const [matchId, winnerId] = d.reportf.split("|"); act(`${API}/api/tournaments/${S.openId}/report`, { matchId, winnerId }); }
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
    else if (d.edit !== undefined) { setS((s) => ({ ...s, editing: true })); }
    else if (d.editcancel !== undefined) { setS((s) => ({ ...s, editing: false })); }
    else if (d.editsave) {
      const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";
      editSave(d.editsave, { name: val("e-name"), game: val("e-game"), place: val("e-place"), date: val("e-date"), entryFeeXof: parseInt(val("e-fee")) || 0 });
    }
    else if (d.go) { setS((s) => ({ ...s, page: d.go! })); window.scrollTo({ top: 0 }); }
    else if (d.slide) setS((s) => ({ ...s, slide: parseInt(d.slide!) }));
    else if (d.adslide) setS((s) => ({ ...s, adSlide: parseInt(d.adslide!) }));
    else if (d.fmt) setS((s) => ({ ...s, fmt: d.fmt! }));
    else if (d.scope) setS((s) => ({ ...s, scope: d.scope! }));
    else if (d.game) setS((s) => ({ ...s, game: d.game! }));
    else if (d.cat) setS((s) => ({ ...s, cat: d.cat! }));
    else if (d.addName) setS((s) => ({ ...s, cartItems: [...s.cartItems, { name: d.addName!, price: parseInt(d.addPrice || "0") }] }));
    else if (d.cartOpen !== undefined) setS((s) => ({ ...s, cartOpen: true }));
    else if (d.cartClose !== undefined) setS((s) => ({ ...s, cartOpen: false }));
    else if (d.cartRemove !== undefined) setS((s) => ({ ...s, cartItems: s.cartItems.filter((_, i) => i !== parseInt(d.cartRemove!)) }));
    else if (d.cartClear !== undefined) setS((s) => ({ ...s, cartItems: [] }));
    else if (d.checkout !== undefined) { checkout(); }
    else if (d.authOpen !== undefined) { setS((s) => ({ ...s, page: "auth", authError: "" })); window.scrollTo({ top: 0 }); }
    else if (d.authTab) setS((s) => ({ ...s, authTab: d.authTab as "login" | "register", authError: "" }));
    else if (d.authrole) setS((s) => ({ ...s, authRole: d.authrole! }));
    else if (d.authSubmit !== undefined) submitAuth();
    else if (d.setrole) { const [uid, role] = d.setrole.split("|"); setRole(uid, role); }
    else if (d.admintab) setS((s) => ({ ...s, adminTab: d.admintab!, newsEdit: null, prodEdit: null, siteMsg: "", adminSearch: "" }));
    else if (d.admsearchclear !== undefined) setS((s) => ({ ...s, adminSearch: "" }));
    else if (d.sitesave !== undefined) saveSite();
    else if (d.herobgclear !== undefined) clearHeroBg();
    else if (d.ptadd !== undefined) setS((s) => ({ ...s, partnersEdit: [...syncPartnersFromDom(s.partnersEdit ?? []), { key: newKey(), name: "", logoUrl: null }] }));
    else if (d.ptdel) setS((s) => ({ ...s, partnersEdit: syncPartnersFromDom(s.partnersEdit ?? []).filter((p) => p.key !== d.ptdel) }));
    else if (d.adnew !== undefined) setS((s) => ({ ...s, adsEdit: [...syncAdsFromDom(s.adsEdit ?? []), { key: newKey(), label: "", linkUrl: "", imageUrl: null, page: "accueil" }] }));
    else if (d.addel) setS((s) => ({ ...s, adsEdit: syncAdsFromDom(s.adsEdit ?? []).filter((a) => a.key !== d.addel) }));
    else if (d.newsnew !== undefined) setS((s) => ({ ...s, newsEdit: { title: "", category: "", body: "" } }));
    else if (d.newsedit) { const n = S.admin?.news.find((x: Detail) => x.id === d.newsedit); if (n) setS((s) => ({ ...s, newsEdit: n })); }
    else if (d.newscancel !== undefined) setS((s) => ({ ...s, newsEdit: null }));
    else if (d.newssave) saveNews(d.newssave);
    else if (d.newspub) { const [nid, pub] = d.newspub.split("|"); adminAct(`news/${nid}`, "PATCH", { published: pub === "1" }); }
    else if (d.newsdel) {
      const n = S.admin?.news.find((x: Detail) => x.id === d.newsdel);
      setS((s) => ({ ...s, confirmBox: { title: "Supprimer l'article", message: `« ${n?.title || "Cet article"} » sera définitivement supprimé du site.`, okLabel: "Supprimer", action: `newsdel|${d.newsdel}` } }));
    }
    else if (d.gallerynew !== undefined) setS((s) => ({ ...s, galleryEdit: { title: "", tournamentId: "" } }));
    else if (d.gallerycancel !== undefined) setS((s) => ({ ...s, galleryEdit: null }));
    else if (d.gallerysave !== undefined) saveGalleryItem();
    else if (d.gallerydel) {
      const it = S.gallery?.find((x: Detail) => x.id === d.gallerydel);
      setS((s) => ({ ...s, confirmBox: { title: "Supprimer ce média", message: `« ${it?.title || "Ce média"} » sera définitivement supprimé de la galerie.`, okLabel: "Supprimer", action: `gallerydel|${d.gallerydel}` } }));
    }
    else if (d.gfilter !== undefined) setS((s) => ({ ...s, galleryFilter: d.gfilter! }));
    else if (d.gopen) setS((s) => ({ ...s, galleryOpen: d.gopen! }));
    else if (d.gclose !== undefined) setS((s) => ({ ...s, galleryOpen: null }));
    else if (d.gprev !== undefined || d.gnext !== undefined) {
      const items = S.galleryFilter ? (S.gallery ?? []).filter((it: Detail) => it.tournament?.id === S.galleryFilter) : (S.gallery ?? []);
      const idx = items.findIndex((it: Detail) => it.id === S.galleryOpen);
      const next = d.gprev !== undefined ? idx - 1 : idx + 1;
      if (items[next]) setS((s) => ({ ...s, galleryOpen: items[next].id }));
    }
    else if (d.prodnew !== undefined) setS((s) => ({ ...s, prodEdit: { name: "", category: "", priceXof: 0, stock: 0 } }));
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
        const [act, arg] = c.action.split("|");
        if (act === "logout") logout();
        else if (act === "delT") deleteT(arg);
        else if (act === "newsdel") adminAct(`news/${arg}`, "DELETE");
        else if (act === "proddel") adminAct(`products/${arg}`, "DELETE");
        else if (act === "gallerydel") deleteGalleryItem(arg);
      }
    }
    else if (d.createnav !== undefined) { setS((s) => ({ ...s, page: "tournois", creating: true })); window.scrollTo({ top: 0 }); }
    else if (d.profileedit !== undefined) setS((s) => ({ ...s, profileEdit: true, profileMsg: "", page: "profil" }));
    else if (d.profilecancel !== undefined) setS((s) => ({ ...s, profileEdit: false, profileMsg: "" }));
    else if (d.profilesave !== undefined) saveProfile();
    else if (d.passsave !== undefined) savePassword();
    else if (d.reg) toggleReg(d.reg, true);
    else if (d.unreg) toggleReg(d.unreg, false);
    else if (d.paypick) setS((s) => ({ ...s, payPick: d.paypick! }));
    else if (d.confirmpay) { const [tid, regId] = d.confirmpay.split("|"); confirmRegPayment(tid, regId); }
    else if (d.show) window.open(window.location.pathname + "#show=" + d.show, "_blank");
    else if (d.showclose !== undefined) { history.replaceState(null, "", window.location.pathname); setS((s) => ({ ...s, page: "accueil", openId: null, detail: null })); }
    else if (d.act === "create-open") setS((s) => ({ ...s, creating: true }));
    else if (d.act === "create-cancel") setS((s) => ({ ...s, creating: false }));
    else if (d.act === "create-submit") submitCreate();
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
