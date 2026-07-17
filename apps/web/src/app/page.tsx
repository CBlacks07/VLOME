"use client";
import { useEffect, useMemo, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

function token(): string | null { return typeof window !== "undefined" ? localStorage.getItem("vlome_token") : null; }
function authHeaders(): Record<string, string> { const t = token(); return t ? { Authorization: "Bearer " + t } : {}; }

/* ================= Données ================= */
type TournCard = { id?: string; name: string; format: string; game: string; players: number; date: string; place: string; live: boolean; cagnotte: number; status: string };
/* eslint-disable @typescript-eslint/no-explicit-any */
type Detail = any; // DTO cockpit renvoyé par l'API (/tournaments/:id/state)
type CartItem = { name: string; price: number };
type AuthUser = { displayName: string; role: string; email: string };
type State = {
  page: string; slide: number; fmt: string; scope: string; game: string; cat: string;
  tourns: TournCard[] | null; creating: boolean; busy: boolean;
  cartItems: CartItem[]; cartOpen: boolean; products: { cat: string; name: string; price: number; ph: string }[] | null;
  user: AuthUser | null; authOpen: boolean; authTab: "login" | "register"; authBusy: boolean; authError: string; authRole: string;
  q: string;
  openId: string | null; detail: Detail | null; detailBusy: boolean; editing: boolean;
  admin: { overview: Detail; users: Detail[]; news: Detail[]; products: Detail[]; orders: Detail[] } | null;
  adminTab: string; newsEdit: Detail | null; prodEdit: Detail | null;
  news: Detail[] | null;
  me: Detail | null; myRegs: Detail[] | null; myOrders: Detail[] | null; myTourns: Detail[] | null;
  regIds: string[]; profileMsg: string; passMsg: string; profileEdit: boolean;
};

const FORMAT_OPTIONS: [string, string][] = [
  ["SURVIVAL", "Survival"], ["SINGLE_ELIM", "Bracket simple"], ["DOUBLE_ELIM", "Double élim"],
  ["SWISS", "Swiss"], ["ROUND_ROBIN", "Round Robin"], ["POOLS", "Poules"], ["BATTLE_ROYALE", "Battle Royale"],
];

const NAV = ["Accueil", "Tournois", "Classements", "Boutique", "Profil"];

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
};
const money = (n: number) => n.toLocaleString("fr-FR") + " F";

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
      <span style="display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:linear-gradient(140deg,#22D3EE,#7C82FF);color:#04222a;box-shadow:0 0 30px rgba(34,211,238,.35)">${ic(I.bolt, 20)}</span>
      <span style="font-family:'Bebas Neue',sans-serif;font-size:25px;letter-spacing:1.6px">VLOME <span style="color:#22D3EE">ESPORT</span></span></div>
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
  return `<div ${openAttr} style="border:1px solid #282838;border-radius:16px;overflow:hidden;cursor:pointer;background:linear-gradient(180deg,#14141D,#0E0E16)">
    <div style="height:${big ? 80 : 74}px;display:flex;align-items:flex-start;justify-content:space-between;padding:13px 14px;background:linear-gradient(135deg,rgba(34,211,238,.16),rgba(124,130,255,.11))">
      <span style="font-size:11px;font-weight:700;color:#04222a;background:rgba(255,255,255,.55);border-radius:99px;padding:3px 9px">${t.format}</span>${badge}</div>
    <div style="padding:${big ? "15px 16px 17px" : "14px 15px 16px"}">
      <h4 style="margin:0 0 6px;font-size:${big ? 18 : 17}px">${t.name}</h4>
      <div style="color:#8E8FA6;font-size:12.5px;line-height:1.7">${t.game} · ${t.players} joueurs<br>${t.date} · ${t.place}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:13px;padding-top:13px;border-top:1px solid #282838">${foot}
        <span style="font-size:12px;color:#FBBF24;font-weight:700">${big ? "Cagnotte " : ""}${t.cagnotte} pts</span></div></div></div>`;
}
function chips(list: string[], active: string, attr: string, color = "#22D3EE") {
  return list.map((l) => {
    const on = l === active;
    return `<button class="chip" data-${attr}="${l}" style="font-family:inherit;font-size:12.5px;font-weight:${on ? 700 : 600};color:${on ? color : "#8E8FA6"};background:${on ? "rgba(34,211,238,.08)" : "#14141D"};border:1px solid ${on ? color : "#282838"};border-radius:999px;padding:8px 15px;cursor:pointer">${l}</button>`;
  }).join("");
}

/* ================= Pages ================= */
function pAccueil(S: State) {
  const s = SLIDES[S.slide];
  const tourns = S.tourns ?? TOURN;
  const dots = SLIDES.map((_, i) => { const on = i === S.slide; return `<span data-slide="${i}" style="width:${on ? 26 : 10}px;height:6px;border-radius:99px;background:${on ? "#22D3EE" : "#33334A"};cursor:pointer"></span>`; }).join("");
  const hero = `<section class="grid2" style="display:grid;grid-template-columns:1.35fr 1fr;gap:20px;align-items:stretch;margin-bottom:34px">
    <div style="display:flex;flex-direction:column;justify-content:center;padding:34px 32px;border-radius:20px;border:1px solid #282838;background:linear-gradient(150deg,rgba(34,211,238,.10),rgba(124,130,255,.06) 55%,#0E0E16);position:relative;overflow:hidden">
      <span style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#22D3EE;font-weight:800">VLOME Esport · Togo</span>
      <h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(40px,6vw,72px);letter-spacing:1.5px;line-height:.92;margin:12px 0 0">LE HUB DE L'ESPORT<br>TOGOLAIS &amp; OUEST-AFRICAIN</h1>
      <p style="color:#8E8FA6;font-size:15px;line-height:1.6;max-width:520px;margin:16px 0 24px">Compétitions, classements, communauté et boutique — une seule plateforme pour fédérer les gamers du Togo et professionnaliser l'esport de la région.</p>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <button data-go="tournois" style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:14px 22px;font-weight:750;font-size:15px;cursor:pointer;box-shadow:0 0 34px rgba(34,211,238,.24)">Voir les tournois ${ic(I.arrow)}</button>
        ${S.user ? `<button data-go="profil" style="background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:12px;padding:14px 22px;font-weight:700;font-size:15px;cursor:pointer">Mon espace</button>` : `<button data-auth-open="1" style="background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:12px;padding:14px 22px;font-weight:700;font-size:15px;cursor:pointer">Rejoindre la communauté</button>`}</div>
      <div style="display:flex;gap:30px;margin-top:30px;flex-wrap:wrap">
        <div><div style="font-family:'Bebas Neue',sans-serif;font-size:34px;color:#22D3EE;line-height:1">2 400+</div><div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8E8FA6;font-weight:700">Joueurs</div></div>
        <div><div style="font-family:'Bebas Neue',sans-serif;font-size:34px;line-height:1">18</div><div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8E8FA6;font-weight:700">Tournois / an</div></div>
        <div><div style="font-family:'Bebas Neue',sans-serif;font-size:34px;line-height:1">24</div><div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8E8FA6;font-weight:700">Clubs</div></div></div></div>
    <div style="border-radius:20px;border:1px solid #282838;background:linear-gradient(180deg,#14141D,#0E0E16);padding:22px;display:flex;flex-direction:column;position:relative;overflow:hidden">
      <div style="position:absolute;inset:0;background:linear-gradient(135deg,rgba(34,211,238,.14),transparent 55%);pointer-events:none"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;position:relative"><span style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:#22D3EE;font-weight:800">À la une</span><span style="font-size:11px;color:#5D5E72;font-weight:600">Slider</span></div>
      <div style="flex:1;display:flex;flex-direction:column;justify-content:center;padding:26px 4px;position:relative;min-height:240px">
        <span style="align-self:flex-start;font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#04222a;background:#22D3EE;border-radius:99px;padding:5px 11px">${s.tag}</span>
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(30px,4vw,46px);letter-spacing:1px;line-height:.95;margin:14px 0 8px">${s.title}</h2>
        <p style="color:#8E8FA6;font-size:14px;line-height:1.55;margin:0">${s.sub}</p>
        <button data-go="tournois" style="align-self:flex-start;margin-top:20px;display:inline-flex;align-items:center;gap:7px;background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer">${s.cta} ${ic(I.arrow, 16)}</button></div>
      <div style="display:flex;gap:8px;position:relative">${dots}</div></div></section>`;

  const tournHead = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px"><h3 style="font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:1px;margin:0;display:flex;align-items:center;gap:10px"><span style="width:5px;height:22px;border-radius:3px;background:#22D3EE;display:inline-block"></span>Tournois en cours</h3><a data-go="tournois" style="font-size:13px;font-weight:700;cursor:pointer">Tout voir →</a></div>`;
  const tournGrid = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-bottom:40px">${tourns.slice(0, 3).map((t) => tournCard(t, false)).join("")}</div>`;

  const rankRows = RANK.slice(0, 5).map((r, i) => `<tr style="border-top:1px solid #282838"><td style="padding:9px 6px;font-family:'Bebas Neue',sans-serif;font-size:18px;color:#5D5E72;width:30px">${i + 1}</td><td style="padding:9px 6px"><div style="display:flex;align-items:center;gap:9px"><span style="display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:#22222F;border:1px solid #282838;font-size:11px;font-weight:800;color:#8E8FA6">${r.name.charAt(0)}</span><div><div style="font-weight:650">${r.name}</div><div style="font-size:11px;color:#5D5E72">${r.club}</div></div></div></td><td style="padding:9px 6px;color:#8E8FA6;font-size:12.5px">${r.game}</td><td style="padding:9px 6px;text-align:right;font-weight:750;color:#22D3EE;font-variant-numeric:tabular-nums">${r.pts}</td></tr>`).join("");
  const evRows = EVENTS.map((e) => `<div style="display:flex;gap:13px;align-items:center"><div style="flex:none;width:52px;text-align:center;border:1px solid #282838;border-radius:11px;padding:7px 4px;background:#14141D"><div style="font-family:'Bebas Neue',sans-serif;font-size:22px;line-height:1;color:#22D3EE">${e.d}</div><div style="font-size:9px;letter-spacing:1px;color:#8E8FA6;font-weight:700">${e.mo}</div></div><div style="min-width:0"><div style="font-weight:650;font-size:14px">${e.t}</div><div style="font-size:12px;color:#8E8FA6">${e.type} · ${e.place}</div></div></div>`).join("");
  const mid = `<section class="grid2b" style="display:grid;grid-template-columns:1.45fr 1fr;gap:18px;margin-bottom:40px"><div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px"><h3 style="margin:0;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6;font-weight:750">Classement · Top joueurs</h3><a data-go="classements" style="font-size:12px;font-weight:700;cursor:pointer">Complet →</a></div><table style="width:100%;border-collapse:collapse;font-size:14px">${rankRows}</table></div><div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px"><h3 style="margin:0 0 14px;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6;font-weight:750">Prochains événements</h3><div style="display:flex;flex-direction:column;gap:12px">${evRows}</div></div></section>`;

  const newsItems = S.news
    ? S.news.slice(0, 3).map((n: Detail) => ({ cat: n.category, ph: n.slug, t: n.title, date: n.date }))
    : NEWS;
  const newsGrid = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px"><h3 style="font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:1px;margin:0;display:flex;align-items:center;gap:10px"><span style="width:5px;height:22px;border-radius:3px;background:#7C82FF;display:inline-block"></span>Actualités</h3></div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;margin-bottom:44px">${newsItems.map((a) => `<div style="border:1px solid #282838;border-radius:16px;overflow:hidden;background:linear-gradient(180deg,#14141D,#0E0E16)"><div style="height:132px;background:repeating-linear-gradient(45deg,#191922,#191922 12px,#14141D 12px,#14141D 24px);display:grid;place-items:center;color:#5D5E72;font-family:monospace;font-size:11px;letter-spacing:1px">// ${a.ph}</div><div style="padding:14px 15px 16px"><span style="font-size:11px;font-weight:700;color:#7C82FF;letter-spacing:.5px">${a.cat}</span><h4 style="margin:6px 0 0;font-size:15.5px;line-height:1.35">${a.t}</h4><div style="font-size:12px;color:#5D5E72;margin-top:8px">${a.date}</div></div></div>`).join("")}</div>`;

  const shopSec = `<section style="border:1px solid #282838;border-radius:18px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:24px;margin-bottom:40px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:10px"><h3 style="font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:1px;margin:0">La boutique VLOME</h3><a data-go="boutique" style="font-size:13px;font-weight:700;cursor:pointer">Voir la boutique →</a></div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px">${SHOP.slice(0, 4).map((p) => `<div style="border:1px solid #282838;border-radius:14px;overflow:hidden;background:#14141D"><div style="height:120px;background:repeating-linear-gradient(45deg,#191922,#191922 12px,#14141D 12px,#14141D 24px);display:grid;place-items:center;color:#5D5E72;font-family:monospace;font-size:10px;letter-spacing:1px">// ${p.ph}</div><div style="padding:12px 13px"><div style="font-weight:650;font-size:13.5px">${p.name}</div><div style="font-weight:800;color:#22D3EE;font-size:13px;margin-top:5px">${money(p.price)}</div></div></div>`).join("")}</div></section>`;

  const partners = `<div style="border:1px solid #282838;border-radius:16px;background:#0E0E16;padding:22px 24px"><div style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:#8E8FA6;font-weight:750;margin-bottom:14px">Partenaires &amp; sponsors</div><div style="display:flex;gap:12px;flex-wrap:wrap">${PARTNERS.map((p) => `<span style="display:inline-flex;align-items:center;height:44px;padding:0 18px;border:1px solid #282838;border-radius:11px;background:#14141D;color:#8E8FA6;font-weight:700;font-size:13px">${p}</span>`).join("")}</div></div>`;

  return `<main style="max-width:1220px;margin:0 auto;padding:28px 22px 60px;animation:fadeUp .4s ease both">${hero}${tournHead}${tournGrid}${mid}${newsGrid}${shopSec}${partners}</main>`;
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
  return `<main style="max-width:1220px;margin:0 auto;padding:28px 22px 60px;animation:fadeUp .4s ease both">${head}${form}${filt}${qPill}${grid}</main>`;
}

function pClassements(S: State) {
  const podium = [
    { ini: "P", name: "Prince Kodjo", pts: 298, place: "2", h: "72px", avBg: "linear-gradient(135deg,#cbd5e1,#94a3b8)", plColor: "#cbd5e1" },
    { ini: "K", name: "Kossi « K9 »", pts: 342, place: "1", h: "96px", avBg: "linear-gradient(135deg,#FBBF24,#f59e0b)", plColor: "#FBBF24" },
    { ini: "A", name: "Aminata Sow", pts: 271, place: "3", h: "56px", avBg: "linear-gradient(135deg,#d6a37a,#b4784f)", plColor: "#d6a37a" },
  ].map((p) => `<div style="display:flex;flex-direction:column;align-items:center;gap:9px;width:112px"><div style="display:grid;place-items:center;width:52px;height:52px;border-radius:14px;font-family:'Bebas Neue',sans-serif;font-size:24px;color:#04222a;background:${p.avBg}">${p.ini}</div><div style="text-align:center"><div style="font-weight:700;font-size:13.5px">${p.name}</div><div style="font-size:11px;color:#8E8FA6">${p.pts} pts</div></div><div style="width:100%;border-radius:12px 12px 0 0;border:1px solid #282838;border-bottom:0;background:#1B1B27;display:flex;align-items:center;justify-content:center;padding-top:8px;height:${p.h}"><span style="font-family:'Bebas Neue',sans-serif;font-size:28px;color:${p.plColor}">${p.place}</span></div></div>`).join("");
  const th = (t: string, r?: boolean) => `<th style="text-align:${r ? "right" : "left"};color:#8E8FA6;font-size:10.5px;text-transform:uppercase;letter-spacing:1px;padding:12px 8px;font-weight:750">${t}</th>`;
  const rows = RANK.map((r, i) => `<tr style="border-top:1px solid #282838"><td style="padding:11px 8px;font-family:'Bebas Neue',sans-serif;font-size:19px;color:#5D5E72">${i + 1}</td><td style="padding:11px 8px"><div style="display:flex;align-items:center;gap:10px"><span style="display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#22222F;border:1px solid #282838;font-size:11px;font-weight:800;color:#8E8FA6">${r.name.charAt(0)}</span><div><div style="font-weight:650">${r.name}</div><div style="font-size:11px;color:#5D5E72">${r.club}</div></div></div></td><td style="padding:11px 8px;color:#8E8FA6;font-size:12.5px">${r.game}</td><td style="padding:11px 8px;color:#8E8FA6;font-size:12.5px">${r.city}</td><td style="padding:11px 8px;text-align:right;font-variant-numeric:tabular-nums">${r.wl}</td><td style="padding:11px 8px;text-align:right;color:#34D399;font-weight:700">${r.wr}</td><td style="padding:11px 8px;text-align:right;font-variant-numeric:tabular-nums;color:#7C82FF;font-weight:700">${r.elo}</td><td style="padding:11px 8px;text-align:right;font-weight:800;color:#22D3EE;font-variant-numeric:tabular-nums">${r.pts}</td></tr>`).join("");
  return `<main style="max-width:1220px;margin:0 auto;padding:28px 22px 60px;animation:fadeUp .4s ease both"><h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(36px,5vw,54px);letter-spacing:1.5px;margin:0;line-height:1">Classements</h1><p style="color:#8E8FA6;font-size:14px;margin:6px 0 20px">Par jeu, ville, club, région — Togo, Afrique de l'Ouest &amp; international</p><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${chips(SCOPES, S.scope, "scope", "#7C82FF")}</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:24px">${chips(GAMES, S.game, "game")}</div><div style="display:flex;align-items:flex-end;justify-content:center;gap:14px;margin:8px 0 30px;flex-wrap:wrap">${podium}</div><div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:8px 18px 14px;overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px;min-width:640px"><tr>${th("#")}${th("Joueur")}${th("Jeu")}${th("Ville")}${th("V / D", true)}${th("Winrate", true)}${th("ELO", true)}${th("Points", true)}</tr>${rows}</table></div></main>`;
}

function pBoutique(S: State) {
  const source = S.products ?? SHOP;
  const list = S.cat === "Tous" ? source : source.filter((p) => p.cat === S.cat);
  const grid = list.map((p) => `<div style="border:1px solid #282838;border-radius:16px;overflow:hidden;background:linear-gradient(180deg,#14141D,#0E0E16)"><div style="height:170px;background:repeating-linear-gradient(45deg,#191922,#191922 13px,#14141D 13px,#14141D 26px);display:grid;place-items:center;color:#5D5E72;font-family:monospace;font-size:11px;letter-spacing:1px">// ${p.ph}</div><div style="padding:14px 15px 16px"><span style="font-size:11px;color:#7C82FF;font-weight:700">${p.cat}</span><div style="font-weight:650;font-size:15px;margin:5px 0 10px">${p.name}</div><div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><span style="font-weight:800;color:#22D3EE;font-size:15px">${money(p.price)}</span><button data-add-name="${p.name}" data-add-price="${p.price}" style="display:inline-flex;align-items:center;gap:6px;background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:10px;padding:9px 13px;font-weight:700;font-size:12.5px;cursor:pointer">${ic(I.plus, 15)}Ajouter</button></div></div></div>`).join("");
  const pay = PAYMENTS.map((m) => `<span style="display:inline-flex;align-items:center;height:44px;padding:0 18px;border:1px solid #282838;border-radius:11px;background:#14141D;color:#F4F5FB;font-weight:700;font-size:13px">${m}</span>`).join("");
  return `<main style="max-width:1220px;margin:0 auto;padding:28px 22px 60px;animation:fadeUp .4s ease both"><div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px"><div><h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(36px,5vw,54px);letter-spacing:1.5px;margin:0;line-height:1">Boutique</h1><p style="color:#8E8FA6;font-size:14px;margin:6px 0 0">Maillots, goodies, billets &amp; cartes cadeaux — paiement mobile money &amp; carte</p></div><button data-cart-open="1" style="display:inline-flex;align-items:center;gap:9px;background:#1B1B27;border:1px solid #33334A;border-radius:12px;padding:11px 16px;font-weight:700;font-size:14px;color:#F4F5FB;cursor:pointer"><span style="color:#22D3EE">${ic(I.cart, 18)}</span>${S.cartItems.length} article(s)</button></div><div style="display:flex;gap:9px;flex-wrap:wrap;margin-bottom:24px">${chips(CATS, S.cat, "cat")}</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:18px;margin-bottom:34px">${grid}</div><div style="border:1px solid #282838;border-radius:16px;background:#0E0E16;padding:22px 24px"><div style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:#8E8FA6;font-weight:750;margin-bottom:14px">Moyens de paiement</div><div style="display:flex;gap:12px;flex-wrap:wrap">${pay}</div><p style="color:#5D5E72;font-size:12px;margin:14px 0 0">Mobile money togolais (Flooz, Mixx by Yas) &amp; cartes via agrégateur — paiement manuel possible sur place.</p></div></main>`;
}

const canManage = (S: State) => !!S.user && (S.user.role === "ORGANIZER" || S.user.role === "ADMIN");
const ROLE_LABEL: Record<string, string> = { PLAYER: "Joueur", ORGANIZER: "Organisateur", ADMIN: "Administrateur" };
const ROLE_COLOR: Record<string, string> = { PLAYER: "#22D3EE", ORGANIZER: "#7C82FF", ADMIN: "#FBBF24" };
const card = (inner: string, pad = "20px") => `<div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:${pad}">${inner}</div>`;

function pDashboard(S: State) {
  const wrap = (inner: string) => `<main style="max-width:1220px;margin:0 auto;padding:28px 22px 60px;animation:fadeUp .4s ease both">${inner}</main>`;
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
  else if (u.role === "ORGANIZER") body = myTournsCard(S) + grid2(regsCard(S), ordersCard(S)) + profileSecurity(S);
  else body = grid2(regsCard(S), ordersCard(S)) + profileSecurity(S);
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
    stat(me.stats?.orders ?? 0, "Commandes", "#7C82FF"),
    ...(me.role !== "PLAYER" ? [stat(me.stats?.tournaments ?? 0, "Tournois créés", "#FBBF24")] : []),
    stat(since, "Membre depuis"),
  ];
  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;margin-bottom:16px">${tiles.join("")}</div>`;
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
  ["apercu", "Aperçu"], ["users", "Utilisateurs"], ["news", "Actualités"], ["produits", "Produits"], ["commandes", "Commandes"],
];
const escAttr = (v: string | null | undefined) => (v || "").replace(/"/g, "&quot;");
const escHtml = (v: string | null | undefined) => (v || "").replace(/</g, "&lt;");
const btnSm = (attr: string, label: string, color = "#8E8FA6", border = "#282838") =>
  `<button ${attr} style="font-size:11.5px;font-weight:700;border-radius:8px;padding:6px 10px;cursor:pointer;background:transparent;border:1px solid ${border};color:${color}">${label}</button>`;
const adminInp = "width:100%;background:#1B1B27;border:1px solid #282838;border-radius:11px;color:#F4F5FB;font-family:inherit;font-size:14px;padding:11px 13px;margin-top:6px";

function adminPanel(S: State) {
  const a = S.admin;
  if (!a) return card(`<div style="color:#8E8FA6;text-align:center;padding:20px">Chargement du panneau admin…</div>`);
  const tabs = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px">${ADMIN_TABS.map(([k, l]) => {
    const on = S.adminTab === k;
    return `<button data-admintab="${k}" style="font-size:13px;font-weight:700;border-radius:999px;padding:9px 16px;cursor:pointer;background:${on ? "rgba(34,211,238,.1)" : "#14141D"};border:1px solid ${on ? "#22D3EE" : "#282838"};color:${on ? "#22D3EE" : "#8E8FA6"}">${l}</button>`;
  }).join("")}</div>`;
  const body =
    S.adminTab === "users" ? adminUsers(a) :
    S.adminTab === "news" ? adminNews(S) :
    S.adminTab === "produits" ? adminProducts(S) :
    S.adminTab === "commandes" ? adminOrders(a) :
    adminOverview(a);
  return tabs + body;
}

function adminOverview(a: NonNullable<State["admin"]>) {
  const ov = a.overview;
  const stat = (v: number, k: string, color = "#F4F5FB") => `<div style="border:1px solid #282838;border-radius:14px;background:#14141D;padding:16px"><div style="font-family:'Bebas Neue',sans-serif;font-size:32px;line-height:1;color:${color}">${v}</div><div style="font-size:11px;letter-spacing:.8px;text-transform:uppercase;color:#8E8FA6;font-weight:700;margin-top:6px">${k}</div></div>`;
  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:14px;margin-bottom:20px">
    ${stat(ov.users, "Utilisateurs", "#22D3EE")}${stat(ov.organizers, "Organisateurs", "#7C82FF")}${stat(ov.admins, "Admins", "#FBBF24")}${stat(ov.tournaments, "Tournois")}${stat(ov.news ?? 0, "Articles", "#34D399")}${stat(ov.products, "Produits")}${stat(ov.orders, "Commandes")}</div>`;
}

function adminUsers(a: NonNullable<State["admin"]>) {
  const roleBtn = (uid: string, role: string, cur: string) => { const on = cur === role; return `<button data-setrole="${uid}|${role}" style="font-size:11.5px;font-weight:700;border-radius:8px;padding:6px 10px;cursor:pointer;background:${on ? ROLE_COLOR[role] + "18" : "transparent"};border:1px solid ${on ? ROLE_COLOR[role] : "#282838"};color:${on ? ROLE_COLOR[role] : "#8E8FA6"}">${ROLE_LABEL[role]}</button>`; };
  const rows = a.users.map((usr: Detail) => `<tr style="border-top:1px solid #22222F">
    <td style="padding:10px 8px"><div style="display:flex;align-items:center;gap:10px"><span style="display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:#22222F;border:1px solid #282838;font-size:12px;font-weight:800;color:#8E8FA6">${(usr.displayName || "?").charAt(0).toUpperCase()}</span><div><div style="font-weight:650">${usr.displayName}</div><div style="font-size:11.5px;color:#5D5E72">${usr.email}</div></div></div></td>
    <td style="padding:10px 8px;text-align:right"><div style="display:inline-flex;gap:6px">${roleBtn(usr.id, "PLAYER", usr.role)}${roleBtn(usr.id, "ORGANIZER", usr.role)}${roleBtn(usr.id, "ADMIN", usr.role)}</div></td></tr>`).join("");
  return card(`${secTitle("Utilisateurs · rôles")}
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px;min-width:520px"><tbody>${rows}</tbody></table></div>`);
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
    <div style="display:flex;gap:10px;margin-top:14px"><button data-newssave="${e.id || "new"}" style="background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:11px;padding:11px 18px;font-weight:750;font-size:14px;cursor:pointer">${e.id ? "Enregistrer" : "Publier l'article"}</button><button data-newscancel="1" style="background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer">Annuler</button></div>
  </div>` : "";
  const rows = a.news.length ? a.news.map((n: Detail) => `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid #22222F;flex-wrap:wrap">
      <div style="min-width:0;flex:1"><div style="font-weight:650;font-size:14px">${escHtml(n.title)}</div><div style="font-size:12px;color:#5D5E72">${escHtml(n.category)} · ${new Date(n.createdAt).toLocaleDateString("fr-FR")}</div></div>
      <span style="font-size:10.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:${n.published ? "#34D399" : "#8E8FA6"};background:${n.published ? "rgba(52,211,153,.08)" : "#14141D"};border:1px solid ${n.published ? "rgba(52,211,153,.4)" : "#282838"};border-radius:99px;padding:4px 10px">${n.published ? "Publié" : "Brouillon"}</span>
      <div style="display:inline-flex;gap:6px">${btnSm(`data-newspub="${n.id}|${n.published ? 0 : 1}"`, n.published ? "Masquer" : "Publier", n.published ? "#8E8FA6" : "#34D399", n.published ? "#282838" : "rgba(52,211,153,.4)")}${btnSm(`data-newsedit="${n.id}"`, "Modifier", "#22D3EE", "#22D3EE55")}${btnSm(`data-newsdel="${n.id}"`, "Supprimer", "#FB7185", "rgba(251,113,133,.35)")}</div></div>`).join("")
    : `<div style="color:#5D5E72;font-size:13.5px;padding:16px 0;text-align:center">Aucun article. Crée le premier !</div>`;
  const head = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px">${secTitle(`Actualités (${a.news.length})`)}<button data-newsnew="1" style="display:inline-flex;align-items:center;gap:7px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:11px;padding:10px 16px;font-weight:750;font-size:13.5px;cursor:pointer">${ic(I.plus, 15)}Nouvel article</button></div>`;
  return editor + `<div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px">${head}${rows}</div>`;
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
    <div style="display:flex;gap:10px;margin-top:14px"><button data-prodsave="${e.id || "new"}" style="background:linear-gradient(135deg,#7C82FF,#5a60e0);color:#fff;border:0;border-radius:11px;padding:11px 18px;font-weight:750;font-size:14px;cursor:pointer">${e.id ? "Enregistrer" : "Ajouter le produit"}</button><button data-prodcancel="1" style="background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer">Annuler</button></div>
  </div>` : "";
  const rows = a.products.length ? a.products.map((p: Detail) => `<tr style="border-top:1px solid #22222F">
      <td style="padding:10px 8px"><div style="font-weight:650">${escHtml(p.name)}</div><div style="font-size:11.5px;color:#5D5E72">${escHtml(p.category)}</div></td>
      <td style="padding:10px 8px;text-align:right;font-weight:800;color:#22D3EE;white-space:nowrap">${money(p.priceXof)}</td>
      <td style="padding:10px 8px;text-align:right;color:${p.stock > 0 ? "#8E8FA6" : "#FB7185"};font-weight:700;white-space:nowrap">${p.stock > 0 ? p.stock + " en stock" : "Rupture"}</td>
      <td style="padding:10px 8px;text-align:right"><div style="display:inline-flex;gap:6px">${btnSm(`data-prodedit="${p.id}"`, "Modifier", "#22D3EE", "#22D3EE55")}${btnSm(`data-proddel="${p.id}"`, "Supprimer", "#FB7185", "rgba(251,113,133,.35)")}</div></td></tr>`).join("")
    : `<tr><td style="color:#5D5E72;font-size:13.5px;padding:16px 0;text-align:center">Aucun produit.</td></tr>`;
  const head = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px">${secTitle(`Produits (${a.products.length})`)}<button data-prodnew="1" style="display:inline-flex;align-items:center;gap:7px;background:linear-gradient(135deg,#7C82FF,#5a60e0);color:#fff;border:0;border-radius:11px;padding:10px 16px;font-weight:750;font-size:13.5px;cursor:pointer">${ic(I.plus, 15)}Nouveau produit</button></div>`;
  return editor + `<div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px">${head}<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px;min-width:560px"><tbody>${rows}</tbody></table></div></div>`;
}

const ORDER_STATUS: Record<string, [string, string]> = {
  pending: ["En attente", "#FBBF24"], paid: ["Payée", "#34D399"], delivered: ["Livrée", "#22D3EE"], cancelled: ["Annulée", "#FB7185"],
};

function adminOrders(a: NonNullable<State["admin"]>) {
  const rows = a.orders.length ? a.orders.map((o: Detail) => {
    const [sl, sc] = ORDER_STATUS[o.status] || [o.status, "#8E8FA6"];
    const items = Array.isArray(o.items) ? o.items.map((i: Detail) => i.name).join(", ") : "";
    const stBtns = ["paid", "delivered", "cancelled"].filter((s) => s !== o.status)
      .map((s) => btnSm(`data-ordstatus="${o.id}|${s}"`, ORDER_STATUS[s][0], ORDER_STATUS[s][1], ORDER_STATUS[s][1] + "55")).join("");
    return `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid #22222F;flex-wrap:wrap">
      <div style="min-width:0;flex:1"><div style="font-weight:650;font-size:14px">${o.reference} <span style="color:#5D5E72;font-weight:400;font-size:12px">· ${o.user ? escHtml(o.user.displayName) + " (" + escHtml(o.user.email) + ")" : "invité"}</span></div>
      <div style="font-size:12px;color:#5D5E72;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:520px">${escHtml(items) || o.paymentMethod} · ${new Date(o.createdAt).toLocaleDateString("fr-FR")}</div></div>
      <span style="font-weight:800;color:#22D3EE;white-space:nowrap">${money(o.totalXof)}</span>
      <span style="font-size:10.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:${sc};background:${sc}14;border:1px solid ${sc}55;border-radius:99px;padding:4px 10px">${sl}</span>
      <div style="display:inline-flex;gap:6px">${stBtns}</div></div>`;
  }).join("") : `<div style="color:#5D5E72;font-size:13.5px;padding:16px 0;text-align:center">Aucune commande.</div>`;
  return card(secTitle(`Commandes (${a.orders.length})`) + rows);
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
    </div>
    <div style="display:flex;gap:10px;margin-top:14px"><button data-editsave="${t.id}" style="background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:11px;padding:11px 18px;font-weight:750;font-size:14px;cursor:pointer">Enregistrer</button><button data-editcancel="1" style="background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer">Annuler</button></div>
  </div>` : "";

  // À lancer : inscriptions ouvertes
  if (t.status === "setup") {
    const isReg = S.openId ? S.regIds.includes(S.openId) : false;
    let action: string;
    if (manage) {
      action = `<button data-launch="${t.id}" ${S.detailBusy ? "disabled" : ""} style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:14px 26px;font-weight:750;font-size:16px;cursor:${S.detailBusy ? "default" : "pointer"};opacity:${S.detailBusy ? ".6" : "1"};box-shadow:0 0 34px rgba(34,211,238,.24)">${ic(I.bolt)}${S.detailBusy ? "Lancement…" : "Lancer le tournoi"}</button>`;
    } else if (!S.user) {
      action = `<button data-auth-open="1" style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:14px 26px;font-weight:750;font-size:16px;cursor:pointer;box-shadow:0 0 34px rgba(34,211,238,.24)">${ic(I.user, 18)}Se connecter pour s'inscrire</button>`;
    } else if (isReg) {
      action = `<div style="display:flex;flex-direction:column;align-items:center;gap:12px"><span style="display:inline-flex;align-items:center;gap:8px;color:#34D399;font-weight:750;font-size:15px;background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.4);border-radius:12px;padding:12px 22px">${ic(I.crown, 17)}Tu es inscrit à ce tournoi</span><button data-unreg="${t.id}" style="background:transparent;border:1px solid #33334A;color:#8E8FA6;border-radius:10px;padding:9px 16px;font-weight:700;font-size:12.5px;cursor:pointer">Se désinscrire</button></div>`;
    } else {
      action = `<button data-reg="${t.id}" style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:14px 26px;font-weight:750;font-size:16px;cursor:pointer;box-shadow:0 0 34px rgba(34,211,238,.24)">${ic(I.plus, 18)}S'inscrire au tournoi</button>`;
    }
    const sub = manage
      ? "Le lancement répartit les joueurs en poules et démarre le mode Survival. L'ordre de passage est verrouillé."
      : "Les inscriptions sont ouvertes jusqu'au lancement par l'organisateur.";
    const names: string[] = Array.isArray(t.players) ? t.players : [];
    const participants = names.length
      ? `<div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px;margin-top:18px">
          <h3 style="margin:0 0 14px;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6;font-weight:750">Participants (${names.length})</h3>
          <div style="display:flex;gap:8px;flex-wrap:wrap">${names.map((n) => `<span style="display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:#F4F5FB;background:#14141D;border:1px solid #282838;border-radius:999px;padding:7px 13px"><span style="display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#22222F;font-size:10px;font-weight:800;color:#22D3EE">${n.charAt(0).toUpperCase()}</span>${n}</span>`).join("")}</div></div>`
      : "";
    return `<main style="max-width:1220px;margin:0 auto;padding:28px 22px 60px">${head}${editCard}
      <div style="border:1px solid #282838;border-radius:18px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:48px 24px;text-align:center">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:28px;letter-spacing:1px;margin-bottom:6px">${manage ? "Prêt à démarrer" : "Inscriptions ouvertes"}</div>
        <p style="color:#8E8FA6;font-size:14px;max-width:460px;margin:0 auto 22px">${sub}</p>
        ${action}
      </div>${participants}</main>`;
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

  return `<main style="max-width:1220px;margin:0 auto;padding:28px 22px 60px;animation:fadeUp .4s ease both">${head}${editCard}${finalsHtml || poolsHtml + finalsBtn}</main>`;
}

function authModal(S: State) {
  if (!S.authOpen) return "";
  const isLogin = S.authTab === "login";
  const inputStyle = "width:100%;background:#1B1B27;border:1px solid #282838;border-radius:11px;color:#F4F5FB;font-family:inherit;font-size:14px;padding:12px 13px;margin-top:6px";
  const tab = (k: string, label: string) => `<button data-auth-tab="${k}" style="flex:1;padding:11px;border:0;border-radius:10px;cursor:pointer;font-family:inherit;font-weight:700;font-size:14px;background:${S.authTab === k ? "#22222F" : "transparent"};color:${S.authTab === k ? "#22D3EE" : "#8E8FA6"}">${label}</button>`;
  return `<div data-auth-close="1" style="position:fixed;inset:0;z-index:200;display:grid;place-items:center;padding:20px;background:rgba(6,6,10,.72);backdrop-filter:blur(6px)">
    <div data-stop="1" style="width:100%;max-width:420px;background:linear-gradient(180deg,#14141D,#0E0E16);border:1px solid #33334A;border-radius:20px;padding:24px;box-shadow:0 30px 80px rgba(0,0,0,.6)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px"><span style="font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:1px">${isLogin ? "Connexion" : "Inscription"}</span><span data-auth-close="1" style="color:#8E8FA6;cursor:pointer">${ic(I.x, 20)}</span></div>
      <div style="display:flex;gap:4px;background:#0E0E16;border:1px solid #282838;border-radius:12px;padding:4px;margin-bottom:16px">${tab("login", "Se connecter")}${tab("register", "Créer un compte")}</div>
      ${isLogin ? "" : `<label style="font-size:12px;color:#8E8FA6;font-weight:600">Nom affiché<input id="a-name" placeholder="Kossi K9" style="${inputStyle}" /></label>
      <div style="margin-top:14px"><div style="font-size:12px;color:#8E8FA6;font-weight:600;margin-bottom:6px">Je m'inscris en tant que</div><div style="display:flex;gap:8px">
        ${["PLAYER", "ORGANIZER"].map((r) => { const on = S.authRole === r; const lbl = r === "PLAYER" ? "Joueur" : "Organisateur"; return `<button data-authrole="${r}" style="flex:1;padding:11px;border-radius:10px;cursor:pointer;font-family:inherit;font-weight:700;font-size:13.5px;background:${on ? "rgba(34,211,238,.1)" : "#1B1B27"};border:1px solid ${on ? "#22D3EE" : "#282838"};color:${on ? "#22D3EE" : "#8E8FA6"}">${lbl}</button>`; }).join("")}
      </div></div>`}
      <label style="font-size:12px;color:#8E8FA6;font-weight:600;display:block;margin-top:12px">Email<input id="a-email" type="email" placeholder="toi@vlome.tg" style="${inputStyle}" /></label>
      <label style="font-size:12px;color:#8E8FA6;font-weight:600;display:block;margin-top:12px">Mot de passe<input id="a-pass" type="password" placeholder="••••••" style="${inputStyle}" /></label>
      ${S.authError ? `<div style="color:#FB7185;font-size:12.5px;margin-top:12px">${S.authError}</div>` : ""}
      <button data-auth-submit="1" ${S.authBusy ? "disabled" : ""} style="width:100%;margin-top:18px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:13px;font-weight:750;font-size:15px;cursor:${S.authBusy ? "default" : "pointer"};opacity:${S.authBusy ? ".6" : "1"}">${S.authBusy ? "…" : isLogin ? "Se connecter" : "Créer mon compte"}</button>
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
  const brand = `<div style="display:flex;align-items:center;justify-content:center;gap:1.4vh;margin-bottom:2vh"><span style="display:grid;place-items:center;width:4.2vh;height:4.2vh;border-radius:1vh;background:linear-gradient(140deg,#22D3EE,#7C82FF);color:#04222a">${ic(I.bolt, 20)}</span><span style="font-family:'Bebas Neue',sans-serif;font-size:3vh;letter-spacing:2.5px;color:#8E8FA6">VLOME <span style="color:#22D3EE">ESPORT</span></span></div>`;
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

function renderPage(S: State) {
  if (S.page === "show") return pShow(S);
  const pages: Record<string, (s: State) => string> = { accueil: pAccueil, tournois: pTournois, classements: pClassements, boutique: pBoutique, profil: pDashboard, tournoi: pTournoi };
  const body = (pages[S.page] || pAccueil)(S);
  const footer = `<footer style="border-top:1px solid #282838;padding:26px 22px;text-align:center;color:#5D5E72;font-size:12.5px">VLOME Esport Platform · Le hub de l'esport togolais &amp; ouest-africain · Module Tournois propulsé par Survival Challonge</footer>`;
  return header(S) + body + footer + authModal(S) + cartDrawer(S);
}

/* ================= Composant ================= */
export default function Page() {
  const [S, setS] = useState<State>({
    page: "accueil", slide: 0, fmt: "Tous", scope: "Togo", game: "Tous", cat: "Tous",
    tourns: null, creating: false, busy: false,
    cartItems: [], cartOpen: false, products: null,
    user: null, authOpen: false, authTab: "login", authBusy: false, authError: "", authRole: "PLAYER",
    q: "",
    openId: null, detail: null, detailBusy: false, editing: false, admin: null,
    adminTab: "apercu", newsEdit: null, prodEdit: null, news: null,
    me: null, myRegs: null, myOrders: null, myTourns: null,
    regIds: [], profileMsg: "", passMsg: "", profileEdit: false,
  });
  const html = useMemo(() => renderPage(S), [S]);

  /* ---------- Pilotage d'un tournoi ---------- */
  async function openDetail(id: string, page = "tournoi") {
    setS((s) => ({ ...s, page, openId: id, detail: null }));
    window.scrollTo({ top: 0 });
    try {
      const r = await fetch(`${API}/api/tournaments/${id}/state`);
      if (r.ok) { const d = await r.json(); setS((s) => ({ ...s, detail: d })); }
    } catch { /* API hors ligne */ }
  }
  async function act(url: string, body?: unknown, method = "POST") {
    if (!token()) { setS((s) => ({ ...s, authOpen: true })); return; }
    setS((s) => ({ ...s, detailBusy: true }));
    try {
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json", ...authHeaders() }, body: body ? JSON.stringify(body) : undefined });
      if (r.status === 401) { setS((s) => ({ ...s, detailBusy: false, authOpen: true, user: null })); return; }
      if (r.status === 403) { setS((s) => ({ ...s, detailBusy: false })); alert("Action réservée à l'organisateur du tournoi."); return; }
      if (r.ok) { const d = await r.json(); setS((s) => ({ ...s, detail: d, detailBusy: false })); loadTournaments(); }
      else setS((s) => ({ ...s, detailBusy: false }));
    } catch { setS((s) => ({ ...s, detailBusy: false })); }
  }
  async function editSave(id: string, body: Record<string, string>) {
    if (!token()) { setS((s) => ({ ...s, authOpen: true })); return; }
    try {
      const r = await fetch(`${API}/api/tournaments/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(body) });
      if (r.status === 403) { alert("Seul l'organisateur peut modifier ce tournoi."); return; }
      if (r.ok) { await loadTournaments(); await openDetail(id); setS((s) => ({ ...s, editing: false })); }
    } catch { /* ignore */ }
  }
  async function deleteT(id: string) {
    if (!token()) { setS((s) => ({ ...s, authOpen: true })); return; }
    if (!confirm("Supprimer définitivement ce tournoi ?")) return;
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
    setS((s) => ({ ...s, authBusy: true, authError: "" }));
    try {
      const r = await fetch(`${API}/api/auth/${isLogin ? "login" : "register"}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isLogin ? { email, password } : { email, password, displayName, role: S.authRole }),
      });
      const data = await r.json();
      if (!r.ok) { setS((s) => ({ ...s, authBusy: false, authError: data.message || "Échec de la connexion." })); return; }
      localStorage.setItem("vlome_token", data.token);
      localStorage.setItem("vlome_user", JSON.stringify(data.user));
      setS((s) => ({ ...s, authBusy: false, authOpen: false, user: data.user, me: null, myRegs: null, myOrders: null, myTourns: null, admin: null }));
      loadRegIds();
    } catch {
      setS((s) => ({ ...s, authBusy: false, authError: "API injoignable — démarre pnpm dev:api." }));
    }
  }
  function logout() {
    localStorage.removeItem("vlome_token"); localStorage.removeItem("vlome_user");
    setS((s) => ({ ...s, user: null, me: null, myRegs: null, myOrders: null, myTourns: null, admin: null, regIds: [], page: s.page === "profil" ? "accueil" : s.page }));
  }

  async function loadTournaments() {
    try {
      const r = await fetch(`${API}/api/tournaments`);
      if (!r.ok) return;
      const data: TournCard[] = await r.json();
      if (Array.isArray(data) && data.length) setS((s) => ({ ...s, tourns: data }));
    } catch { /* API hors ligne : repli statique */ }
  }

  async function loadNews() {
    try {
      const r = await fetch(`${API}/api/news`);
      if (!r.ok) return;
      const rows: Detail[] = await r.json();
      if (Array.isArray(rows) && rows.length) setS((s) => ({ ...s, news: rows }));
    } catch { /* repli statique */ }
  }

  async function loadProducts() {
    try {
      const r = await fetch(`${API}/api/products`);
      if (!r.ok) return;
      const rows: { name: string; category: string; priceXof: number }[] = await r.json();
      if (Array.isArray(rows) && rows.length) {
        setS((s) => ({ ...s, products: rows.map((p) => ({ cat: p.category, name: p.name, price: p.priceXof, ph: p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") })) }));
      }
    } catch { /* repli statique */ }
  }
  async function checkout() {
    if (!S.cartItems.length) return;
    if (!token()) { setS((s) => ({ ...s, cartOpen: false, authOpen: true })); return; }
    try {
      const r = await fetch(`${API}/api/orders`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ items: S.cartItems.map((i) => ({ name: i.name, priceXof: i.price })), paymentMethod: "Flooz" }) });
      if (r.status === 401) { setS((s) => ({ ...s, authOpen: true, user: null })); return; }
      if (r.ok) { const o = await r.json(); alert("Commande " + o.reference + " enregistrée · " + o.totalXof + " F · paiement " + o.paymentMethod + " (agrégateur à venir)."); setS((s) => ({ ...s, cartItems: [], cartOpen: false, me: null, myOrders: null })); }
    } catch { /* ignore */ }
  }

  async function loadAdmin() {
    try {
      const get = (p: string) => fetch(`${API}/api/admin/${p}`, { headers: authHeaders() });
      const [ovR, usR, nwR, prR, orR] = await Promise.all([get("overview"), get("users"), get("news"), get("products"), get("orders")]);
      if (ovR.ok && usR.ok) {
        const [overview, users, news, products, orders] = await Promise.all([
          ovR.json(), usR.json(),
          nwR.ok ? nwR.json() : [], prR.ok ? prR.json() : [], orR.ok ? orR.json() : [],
        ]);
        setS((s) => ({ ...s, admin: { overview, users, news, products, orders } }));
      }
    } catch { /* ignore */ }
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
      const [meR, regR, ordR] = await Promise.all([
        fetch(`${API}/api/users/me`, { headers: authHeaders() }),
        fetch(`${API}/api/users/me/registrations`, { headers: authHeaders() }),
        fetch(`${API}/api/users/me/orders`, { headers: authHeaders() }),
      ]);
      if (!meR.ok) return;
      const me = await meR.json();
      const myRegs = regR.ok ? await regR.json() : [];
      const myOrders = ordR.ok ? await ordR.json() : [];
      let myTourns: Detail[] | null = null;
      if (me.role === "ORGANIZER" || me.role === "ADMIN") {
        const tR = await fetch(`${API}/api/tournaments/mine`, { headers: authHeaders() });
        if (tR.ok) myTourns = await tR.json();
      }
      setS((s) => ({ ...s, me, myRegs, myOrders, myTourns }));
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
    if (!token()) { setS((s) => ({ ...s, authOpen: true })); return; }
    try {
      const r = await fetch(`${API}/api/tournaments/${id}/register`, { method: register ? "POST" : "DELETE", headers: authHeaders() });
      if (r.status === 401) { setS((s) => ({ ...s, authOpen: true, user: null })); return; }
      const data = await r.json();
      if (!r.ok) { alert(data.message || "Action impossible."); return; }
      await loadRegIds();
      await loadTournaments();
      setS((s) => ({ ...s, me: null, myRegs: null })); // le profil se rechargera
      if (S.openId === id) {
        const st = await fetch(`${API}/api/tournaments/${id}/state`);
        if (st.ok) { const d = await st.json(); setS((s) => ({ ...s, detail: d })); }
      }
    } catch { /* ignore */ }
  }

  // Charge le tableau de bord quand on ouvre l'espace membre.
  useEffect(() => {
    if (S.page === "profil" && S.user && !S.me) loadMe();
    if (S.page === "profil" && S.user?.role === "ADMIN" && !S.admin) loadAdmin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [S.page, S.user]);

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
    loadTournaments();
    loadProducts();
    loadNews();
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
    if (h.startsWith("#show=")) openDetail(h.slice(6), "show");
    else if (h.startsWith("#t=")) openDetail(h.slice(3));
    else if (h === "#creer") setS((s) => ({ ...s, page: "tournois", creating: true }));
    else if (h === "#connexion") setS((s) => ({ ...s, authOpen: true }));
    else if (h === "#panier") setS((s) => ({ ...s, cartOpen: true, cartItems: [{ name: "Maillot officiel VLOME", price: 15000 }, { name: "Casquette VLOME", price: 8000 }] }));
  }, []);

  async function submitCreate() {
    const val = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? "";
    const name = val("c-name").trim();
    if (!name) { (document.getElementById("c-name") as HTMLInputElement)?.focus(); return; }
    const players = val("c-players").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const body = {
      name, game: val("c-game").trim(), format: val("c-format"), place: val("c-place").trim(),
      date: val("c-date") || undefined, pointsPerPlayer: parseInt(val("c-pts")) || 5, players,
    };
    if (!token()) { setS((s) => ({ ...s, authOpen: true })); return; }
    setS((s) => ({ ...s, busy: true }));
    try {
      const r = await fetch(`${API}/api/tournaments`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(body),
      });
      if (r.status === 401) { setS((s) => ({ ...s, busy: false, authOpen: true, user: null })); return; }
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
    if (target.closest("[data-logout]")) { logout(); return; }
    const el = target.closest<HTMLElement>("[data-go],[data-slide],[data-fmt],[data-scope],[data-game],[data-cat],[data-act],[data-add-name],[data-cart-open],[data-cart-close],[data-cart-remove],[data-cart-clear],[data-checkout],[data-auth-open],[data-auth-close],[data-auth-tab],[data-auth-submit],[data-stop],[data-open],[data-back],[data-launch],[data-report],[data-finals-start],[data-reportf],[data-reportscore],[data-del],[data-edit],[data-editcancel],[data-editsave],[data-authrole],[data-setrole],[data-createnav],[data-show],[data-showclose],[data-clearq],[data-profileedit],[data-profilecancel],[data-profilesave],[data-passsave],[data-reg],[data-unreg],[data-admintab],[data-newsnew],[data-newsedit],[data-newscancel],[data-newssave],[data-newspub],[data-newsdel],[data-prodnew],[data-prodedit],[data-prodcancel],[data-prodsave],[data-proddel],[data-ordstatus]");
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
    else if (d.del) { deleteT(d.del); }
    else if (d.edit !== undefined) { setS((s) => ({ ...s, editing: true })); }
    else if (d.editcancel !== undefined) { setS((s) => ({ ...s, editing: false })); }
    else if (d.editsave) {
      const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";
      editSave(d.editsave, { name: val("e-name"), game: val("e-game"), place: val("e-place"), date: val("e-date") });
    }
    else if (d.go) { setS((s) => ({ ...s, page: d.go! })); window.scrollTo({ top: 0 }); }
    else if (d.slide) setS((s) => ({ ...s, slide: parseInt(d.slide!) }));
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
    else if (d.authOpen !== undefined) setS((s) => ({ ...s, authOpen: true, authError: "" }));
    else if (d.authClose !== undefined) setS((s) => ({ ...s, authOpen: false }));
    else if (d.authTab) setS((s) => ({ ...s, authTab: d.authTab as "login" | "register", authError: "" }));
    else if (d.authrole) setS((s) => ({ ...s, authRole: d.authrole! }));
    else if (d.authSubmit !== undefined) submitAuth();
    else if (d.setrole) { const [uid, role] = d.setrole.split("|"); setRole(uid, role); }
    else if (d.admintab) setS((s) => ({ ...s, adminTab: d.admintab!, newsEdit: null, prodEdit: null }));
    else if (d.newsnew !== undefined) setS((s) => ({ ...s, newsEdit: { title: "", category: "", body: "" } }));
    else if (d.newsedit) { const n = S.admin?.news.find((x: Detail) => x.id === d.newsedit); if (n) setS((s) => ({ ...s, newsEdit: n })); }
    else if (d.newscancel !== undefined) setS((s) => ({ ...s, newsEdit: null }));
    else if (d.newssave) {
      const val = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? "";
      const body = { title: val("n-title").trim(), category: val("n-cat").trim() || "Actualité", body: val("n-body").trim() };
      if (!body.title) { alert("Le titre est requis."); return; }
      if (d.newssave === "new") adminAct("news", "POST", { ...body, published: true });
      else adminAct(`news/${d.newssave}`, "PATCH", body);
    }
    else if (d.newspub) { const [nid, pub] = d.newspub.split("|"); adminAct(`news/${nid}`, "PATCH", { published: pub === "1" }); }
    else if (d.newsdel) { if (confirm("Supprimer définitivement cet article ?")) adminAct(`news/${d.newsdel}`, "DELETE"); }
    else if (d.prodnew !== undefined) setS((s) => ({ ...s, prodEdit: { name: "", category: "", priceXof: 0, stock: 0 } }));
    else if (d.prodedit) { const p = S.admin?.products.find((x: Detail) => x.id === d.prodedit); if (p) setS((s) => ({ ...s, prodEdit: p })); }
    else if (d.prodcancel !== undefined) setS((s) => ({ ...s, prodEdit: null }));
    else if (d.prodsave) {
      const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";
      const body = { name: val("pr-name").trim(), category: val("pr-cat").trim() || "Goodies", priceXof: parseInt(val("pr-price")) || 0, stock: parseInt(val("pr-stock")) || 0 };
      if (!body.name) { alert("Le nom du produit est requis."); return; }
      if (d.prodsave === "new") adminAct("products", "POST", body);
      else adminAct(`products/${d.prodsave}`, "PATCH", body);
    }
    else if (d.proddel) { if (confirm("Supprimer définitivement ce produit ?")) adminAct(`products/${d.proddel}`, "DELETE"); }
    else if (d.ordstatus) { const [oid, st] = d.ordstatus.split("|"); adminAct(`orders/${oid}/status`, "PATCH", { status: st }); }
    else if (d.createnav !== undefined) { setS((s) => ({ ...s, page: "tournois", creating: true })); window.scrollTo({ top: 0 }); }
    else if (d.profileedit !== undefined) setS((s) => ({ ...s, profileEdit: true, profileMsg: "", page: "profil" }));
    else if (d.profilecancel !== undefined) setS((s) => ({ ...s, profileEdit: false, profileMsg: "" }));
    else if (d.profilesave !== undefined) saveProfile();
    else if (d.passsave !== undefined) savePassword();
    else if (d.reg) toggleReg(d.reg, true);
    else if (d.unreg) toggleReg(d.unreg, false);
    else if (d.show) window.open(window.location.pathname + "#show=" + d.show, "_blank");
    else if (d.showclose !== undefined) { history.replaceState(null, "", window.location.pathname); setS((s) => ({ ...s, page: "accueil", openId: null, detail: null })); }
    else if (d.act === "create-open") setS((s) => ({ ...s, creating: true }));
    else if (d.act === "create-cancel") setS((s) => ({ ...s, creating: false }));
    else if (d.act === "create-submit") submitCreate();
    else if (d.clearq !== undefined) setS((s) => ({ ...s, q: "" }));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const t = e.target as HTMLElement;
    if (e.key === "Enter" && t.id === "hsearch") {
      const q = (t as HTMLInputElement).value.trim();
      setS((s) => ({ ...s, q, page: "tournois", creating: false }));
      window.scrollTo({ top: 0 });
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(1200px 620px at 82% -12%,rgba(34,211,238,.10),transparent 62%),radial-gradient(1000px 520px at -6% 108%,rgba(244,63,126,.09),transparent 60%),#0B0B11",
      }}
      onClick={onClick}
      onKeyDown={onKeyDown}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
