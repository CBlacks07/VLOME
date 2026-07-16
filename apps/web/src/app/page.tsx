"use client";
import { useEffect, useMemo, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

/* ================= Données ================= */
type TournCard = { id?: string; name: string; format: string; game: string; players: number; date: string; place: string; live: boolean; cagnotte: number; status: string };
/* eslint-disable @typescript-eslint/no-explicit-any */
type Detail = any; // DTO cockpit renvoyé par l'API (/tournaments/:id/state)
type CartItem = { name: string; price: number };
type AuthUser = { displayName: string; role: string; email: string };
type State = {
  page: string; slide: number; fmt: string; scope: string; game: string; cat: string;
  tourns: TournCard[] | null; creating: boolean; busy: boolean;
  cartItems: CartItem[]; cartOpen: boolean;
  user: AuthUser | null; authOpen: boolean; authTab: "login" | "register"; authBusy: boolean; authError: string;
  openId: string | null; detail: Detail | null; detailBusy: boolean;
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
};
const money = (n: number) => n.toLocaleString("fr-FR") + " F";

/* ================= En-tête ================= */
function header(S: State) {
  const nav = NAV.map((n) => {
    const key = n.toLowerCase(); const on = S.page === key;
    return `<button class="hbtn" data-go="${key}" style="position:relative;background:transparent;border:0;padding:10px 14px;cursor:pointer">
      <span style="color:${on ? "#22D3EE" : "#8E8FA6"};font-weight:${on ? 700 : 600};font-size:13.5px;letter-spacing:.3px">${n}</span>
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
      <input placeholder="Joueur, tournoi, jeu…" style="width:100%;background:#1B1B27;border:1px solid #282838;border-radius:11px;color:#F4F5FB;font-family:inherit;font-size:13px;padding:9px 12px 9px 36px" /></div>
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
        <button data-go="profil" style="background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:12px;padding:14px 22px;font-weight:700;font-size:15px;cursor:pointer">Rejoindre la communauté</button></div>
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
        <button style="align-self:flex-start;margin-top:20px;display:inline-flex;align-items:center;gap:7px;background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer">${s.cta} ${ic(I.arrow, 16)}</button></div>
      <div style="display:flex;gap:8px;position:relative">${dots}</div></div></section>`;

  const tournHead = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px"><h3 style="font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:1px;margin:0;display:flex;align-items:center;gap:10px"><span style="width:5px;height:22px;border-radius:3px;background:#22D3EE;display:inline-block"></span>Tournois en cours</h3><a data-go="tournois" style="font-size:13px;font-weight:700;cursor:pointer">Tout voir →</a></div>`;
  const tournGrid = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-bottom:40px">${tourns.slice(0, 3).map((t) => tournCard(t, false)).join("")}</div>`;

  const rankRows = RANK.slice(0, 5).map((r, i) => `<tr style="border-top:1px solid #282838"><td style="padding:9px 6px;font-family:'Bebas Neue',sans-serif;font-size:18px;color:#5D5E72;width:30px">${i + 1}</td><td style="padding:9px 6px"><div style="display:flex;align-items:center;gap:9px"><span style="display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:#22222F;border:1px solid #282838;font-size:11px;font-weight:800;color:#8E8FA6">${r.name.charAt(0)}</span><div><div style="font-weight:650">${r.name}</div><div style="font-size:11px;color:#5D5E72">${r.club}</div></div></div></td><td style="padding:9px 6px;color:#8E8FA6;font-size:12.5px">${r.game}</td><td style="padding:9px 6px;text-align:right;font-weight:750;color:#22D3EE;font-variant-numeric:tabular-nums">${r.pts}</td></tr>`).join("");
  const evRows = EVENTS.map((e) => `<div style="display:flex;gap:13px;align-items:center"><div style="flex:none;width:52px;text-align:center;border:1px solid #282838;border-radius:11px;padding:7px 4px;background:#14141D"><div style="font-family:'Bebas Neue',sans-serif;font-size:22px;line-height:1;color:#22D3EE">${e.d}</div><div style="font-size:9px;letter-spacing:1px;color:#8E8FA6;font-weight:700">${e.mo}</div></div><div style="min-width:0"><div style="font-weight:650;font-size:14px">${e.t}</div><div style="font-size:12px;color:#8E8FA6">${e.type} · ${e.place}</div></div></div>`).join("");
  const mid = `<section class="grid2b" style="display:grid;grid-template-columns:1.45fr 1fr;gap:18px;margin-bottom:40px"><div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px"><h3 style="margin:0;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6;font-weight:750">Classement · Top joueurs</h3><a data-go="classements" style="font-size:12px;font-weight:700;cursor:pointer">Complet →</a></div><table style="width:100%;border-collapse:collapse;font-size:14px">${rankRows}</table></div><div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px"><h3 style="margin:0 0 14px;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6;font-weight:750">Prochains événements</h3><div style="display:flex;flex-direction:column;gap:12px">${evRows}</div></div></section>`;

  const newsGrid = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px"><h3 style="font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:1px;margin:0;display:flex;align-items:center;gap:10px"><span style="width:5px;height:22px;border-radius:3px;background:#7C82FF;display:inline-block"></span>Actualités</h3></div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;margin-bottom:44px">${NEWS.map((a) => `<div style="border:1px solid #282838;border-radius:16px;overflow:hidden;background:linear-gradient(180deg,#14141D,#0E0E16);cursor:pointer"><div style="height:132px;background:repeating-linear-gradient(45deg,#191922,#191922 12px,#14141D 12px,#14141D 24px);display:grid;place-items:center;color:#5D5E72;font-family:monospace;font-size:11px;letter-spacing:1px">// ${a.ph}</div><div style="padding:14px 15px 16px"><span style="font-size:11px;font-weight:700;color:#7C82FF;letter-spacing:.5px">${a.cat}</span><h4 style="margin:6px 0 0;font-size:15.5px;line-height:1.35">${a.t}</h4><div style="font-size:12px;color:#5D5E72;margin-top:8px">${a.date}</div></div></div>`).join("")}</div>`;

  const shopSec = `<section style="border:1px solid #282838;border-radius:18px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:24px;margin-bottom:40px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:10px"><h3 style="font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:1px;margin:0">La boutique VLOME</h3><a data-go="boutique" style="font-size:13px;font-weight:700;cursor:pointer">Voir la boutique →</a></div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px">${SHOP.slice(0, 4).map((p) => `<div style="border:1px solid #282838;border-radius:14px;overflow:hidden;background:#14141D"><div style="height:120px;background:repeating-linear-gradient(45deg,#191922,#191922 12px,#14141D 12px,#14141D 24px);display:grid;place-items:center;color:#5D5E72;font-family:monospace;font-size:10px;letter-spacing:1px">// ${p.ph}</div><div style="padding:12px 13px"><div style="font-weight:650;font-size:13.5px">${p.name}</div><div style="font-weight:800;color:#22D3EE;font-size:13px;margin-top:5px">${money(p.price)}</div></div></div>`).join("")}</div></section>`;

  const partners = `<div style="border:1px solid #282838;border-radius:16px;background:#0E0E16;padding:22px 24px"><div style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:#8E8FA6;font-weight:750;margin-bottom:14px">Partenaires &amp; sponsors</div><div style="display:flex;gap:12px;flex-wrap:wrap">${PARTNERS.map((p) => `<span style="display:inline-flex;align-items:center;height:44px;padding:0 18px;border:1px solid #282838;border-radius:11px;background:#14141D;color:#8E8FA6;font-weight:700;font-size:13px">${p}</span>`).join("")}</div></div>`;

  return `<main style="max-width:1220px;margin:0 auto;padding:28px 22px 60px;animation:fadeUp .4s ease both">${hero}${tournHead}${tournGrid}${mid}${newsGrid}${shopSec}${partners}</main>`;
}

function pTournois(S: State) {
  const source = S.tourns ?? TOURN;
  const list = S.fmt === "Tous" ? source : source.filter((t) => t.format === S.fmt);
  const head = `<div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:22px"><div><h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(36px,5vw,54px);letter-spacing:1.5px;margin:0;line-height:1">Tournois</h1><p style="color:#8E8FA6;font-size:14px;margin:6px 0 0">Module Challonge · tous formats · scores &amp; arbitrage en temps réel</p></div><button data-act="${S.creating ? "create-cancel" : "create-open"}" style="display:inline-flex;align-items:center;gap:8px;background:${S.creating ? "#1B1B27" : "linear-gradient(135deg,#22D3EE,#12aec4)"};color:${S.creating ? "#F4F5FB" : "#04222a"};border:${S.creating ? "1px solid #33334A" : "0"};border-radius:12px;padding:13px 20px;font-weight:750;font-size:14px;cursor:pointer;box-shadow:${S.creating ? "none" : "0 0 30px rgba(34,211,238,.22)"}">${S.creating ? ic(I.arrow) + "Fermer" : ic(I.plus) + "Créer un tournoi"}</button></div>`;

  const inputStyle = "width:100%;background:#1B1B27;border:1px solid #282838;border-radius:11px;color:#F4F5FB;font-family:inherit;font-size:14px;padding:11px 13px";
  const labelStyle = "font-size:12px;color:#8E8FA6;font-weight:600;display:block;margin-bottom:6px";
  const field = (label: string, inner: string) => `<div><label style="${labelStyle}">${label}</label>${inner}</div>`;
  const form = S.creating ? `<section style="border:1px solid rgba(34,211,238,.3);border-radius:18px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:22px;margin-bottom:24px">
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
  const queue = ["Ayi", "Nadia", "Sena", "Koffi"].map((q) => `<span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#8E8FA6;background:#14141D;border:1px solid #282838;border-radius:999px;padding:5px 11px">${q}</span>`).join("");
  const pool = [["1", "K9", "11"], ["2", "Prince", "8"], ["3", "Nadia", "5"], ["4", "Sena", "2"]].map((p) => `<tr style="border-top:1px solid #282838"><td style="padding:8px 4px;font-family:'Bebas Neue',sans-serif;font-size:16px;color:#5D5E72;width:24px">${p[0]}</td><td style="padding:8px 4px;font-weight:650">${p[1]}</td><td style="padding:8px 4px;text-align:right;font-weight:750;color:#22D3EE">${p[2]}</td></tr>`).join("");
  const survival = `<section style="border:1px solid rgba(34,211,238,.3);border-radius:18px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:22px;margin-bottom:26px;box-shadow:0 0 40px rgba(34,211,238,.08)">
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px"><span style="display:inline-flex;align-items:center;gap:7px;font-size:10.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#04222a;background:#22D3EE;border-radius:99px;padding:5px 11px"><span style="width:6px;height:6px;border-radius:50%;background:#04222a;animation:blink 1.2s infinite"></span>Live</span><div><div style="font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:1px;line-height:1">Survival Cup · Lomé</div><div style="font-size:12.5px;color:#8E8FA6">Poule A · Mode Survival — le vainqueur reste sur le terrain</div></div><div style="flex:1"></div><button style="background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:10px 15px;font-weight:700;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:7px">${ic(I.tv, 16)}Mode Show</button></div>
    <div class="grid2c" style="display:grid;grid-template-columns:1.5fr 1fr;gap:18px;align-items:start">
      <div><div style="display:flex;align-items:stretch;gap:14px">
        <div style="flex:1;min-height:150px;border-radius:15px;border:1px solid rgba(34,211,238,.4);background:linear-gradient(180deg,rgba(34,211,238,.08),#14141D);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;position:relative"><span style="position:absolute;top:11px;font-size:10.5px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#22D3EE">Survivant</span><div style="font-family:'Bebas Neue',sans-serif;font-size:38px;color:#22D3EE;line-height:1;margin-top:8px">K9</div><span style="display:inline-flex;align-items:center;gap:5px;margin-top:8px;font-size:11px;font-weight:800;color:#22D3EE;background:rgba(34,211,238,.12);border:1px solid rgba(34,211,238,.4);border-radius:99px;padding:4px 10px">${ic(I.flame, 13)}Série ×4</span></div>
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;color:#5D5E72"><span style="font-family:'Bebas Neue',sans-serif;font-size:26px;color:#8E8FA6">VS</span></div>
        <div style="flex:1;min-height:150px;border-radius:15px;border:1px solid rgba(244,63,126,.35);background:linear-gradient(180deg,rgba(244,63,126,.05),#14141D);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;position:relative"><span style="position:absolute;top:11px;font-size:10.5px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#F43F7E">Challenger</span><div style="font-family:'Bebas Neue',sans-serif;font-size:38px;color:#F43F7E;line-height:1;margin-top:8px">PRINCE</div><span style="font-size:11px;color:#8E8FA6;margin-top:8px">Team Lomé Kings</span></div></div>
        <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:16px"><span style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8E8FA6;font-weight:750">File d'attente</span>${queue}</div></div>
      <div style="border:1px solid #282838;border-radius:14px;background:#14141D;padding:16px"><div style="font-size:11px;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6;font-weight:750;margin-bottom:10px">Classement de poule</div><table style="width:100%;border-collapse:collapse;font-size:13.5px">${pool}</table>
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid #282838"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:8px"><span style="color:#8E8FA6">Cagnotte</span><span style="font-weight:750">96 / 160 pts</span></div><div style="height:11px;border-radius:99px;background:#22222F;border:1px solid #282838;overflow:hidden"><span style="display:block;height:100%;width:60%;border-radius:99px;background:linear-gradient(90deg,#34D399,#10b981)"></span></div><div style="display:flex;justify-content:space-between;font-size:11.5px;margin-top:7px"><span style="color:#34D399;font-weight:700">64 pts disponibles</span><span style="color:#5D5E72">Écart 0</span></div></div></div></div></section>`;
  const grid = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px">${list.map((t) => tournCard(t, true)).join("")}</div>`;
  return `<main style="max-width:1220px;margin:0 auto;padding:28px 22px 60px;animation:fadeUp .4s ease both">${head}${form}${filt}${S.fmt === "Tous" || S.fmt === "Survival" ? survival : ""}${grid}</main>`;
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
  const list = S.cat === "Tous" ? SHOP : SHOP.filter((p) => p.cat === S.cat);
  const grid = list.map((p) => `<div style="border:1px solid #282838;border-radius:16px;overflow:hidden;background:linear-gradient(180deg,#14141D,#0E0E16)"><div style="height:170px;background:repeating-linear-gradient(45deg,#191922,#191922 13px,#14141D 13px,#14141D 26px);display:grid;place-items:center;color:#5D5E72;font-family:monospace;font-size:11px;letter-spacing:1px">// ${p.ph}</div><div style="padding:14px 15px 16px"><span style="font-size:11px;color:#7C82FF;font-weight:700">${p.cat}</span><div style="font-weight:650;font-size:15px;margin:5px 0 10px">${p.name}</div><div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><span style="font-weight:800;color:#22D3EE;font-size:15px">${money(p.price)}</span><button data-add-name="${p.name}" data-add-price="${p.price}" style="display:inline-flex;align-items:center;gap:6px;background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:10px;padding:9px 13px;font-weight:700;font-size:12.5px;cursor:pointer">${ic(I.plus, 15)}Ajouter</button></div></div></div>`).join("");
  const pay = PAYMENTS.map((m) => `<span style="display:inline-flex;align-items:center;height:44px;padding:0 18px;border:1px solid #282838;border-radius:11px;background:#14141D;color:#F4F5FB;font-weight:700;font-size:13px">${m}</span>`).join("");
  return `<main style="max-width:1220px;margin:0 auto;padding:28px 22px 60px;animation:fadeUp .4s ease both"><div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px"><div><h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(36px,5vw,54px);letter-spacing:1.5px;margin:0;line-height:1">Boutique</h1><p style="color:#8E8FA6;font-size:14px;margin:6px 0 0">Maillots, goodies, billets &amp; cartes cadeaux — paiement mobile money &amp; carte</p></div><button data-cart-open="1" style="display:inline-flex;align-items:center;gap:9px;background:#1B1B27;border:1px solid #33334A;border-radius:12px;padding:11px 16px;font-weight:700;font-size:14px;color:#F4F5FB;cursor:pointer"><span style="color:#22D3EE">${ic(I.cart, 18)}</span>${S.cartItems.length} article(s)</button></div><div style="display:flex;gap:9px;flex-wrap:wrap;margin-bottom:24px">${chips(CATS, S.cat, "cat")}</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:18px;margin-bottom:34px">${grid}</div><div style="border:1px solid #282838;border-radius:16px;background:#0E0E16;padding:22px 24px"><div style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:#8E8FA6;font-weight:750;margin-bottom:14px">Moyens de paiement</div><div style="display:flex;gap:12px;flex-wrap:wrap">${pay}</div><p style="color:#5D5E72;font-size:12px;margin:14px 0 0">Mobile money togolais (Flooz, Mixx by Yas) &amp; cartes via agrégateur — paiement manuel possible sur place.</p></div></main>`;
}

function pProfil() {
  const stats = STATS.map((s) => `<div style="border:1px solid #282838;border-radius:15px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:16px"><div style="font-family:'Bebas Neue',sans-serif;font-size:34px;line-height:1;color:${s.color}">${s.v}</div><div style="font-size:11px;letter-spacing:.8px;text-transform:uppercase;color:#8E8FA6;font-weight:700;margin-top:6px">${s.k}</div></div>`).join("");
  const hist = HISTORY.map((h) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid #22222F"><div style="min-width:0"><div style="font-weight:650;font-size:14px">${h.t}</div><div style="font-size:12px;color:#8E8FA6">${h.r} · ${h.d}</div></div><span style="font-weight:750;color:#34D399;white-space:nowrap;font-size:13px">${h.p} pts</span></div>`).join("");
  const badges = BADGES.map((b) => `<div style="display:flex;align-items:center;gap:11px;background:#14141D;border:1px solid #282838;border-radius:12px;padding:11px 13px"><span style="display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:rgba(251,191,36,.1);color:#FBBF24;flex:none">${ic(I.medal, 18)}</span><span style="font-weight:650;font-size:13.5px">${b}</span></div>`).join("");
  const upc = UPCOMING.map((u) => { const st = u.ok ? "color:#34D399;background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.4)" : "color:#FBBF24;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.4)"; return `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;background:#14141D;border:1px solid #282838;border-radius:12px;padding:13px 15px;flex-wrap:wrap"><div><div style="font-weight:650;font-size:14.5px">${u.t}</div><div style="font-size:12px;color:#8E8FA6">${u.d}</div></div><span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;border-radius:999px;padding:6px 12px;${st}">${u.s}</span></div>`; }).join("");
  return `<main style="max-width:1220px;margin:0 auto;padding:28px 22px 60px;animation:fadeUp .4s ease both"><div style="display:flex;align-items:center;gap:22px;flex-wrap:wrap;margin-bottom:26px"><div style="display:grid;place-items:center;width:84px;height:84px;border-radius:20px;background:linear-gradient(135deg,#22D3EE,#7C82FF);font-family:'Bebas Neue',sans-serif;font-size:40px;color:#04222a;box-shadow:0 0 30px rgba(34,211,238,.3);flex:none">K9</div><div style="min-width:0"><h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(30px,4.5vw,46px);letter-spacing:1px;margin:0;line-height:1">KOSSI « K9 » ADJEODA</h1><div style="color:#8E8FA6;font-size:14px;margin-top:6px">Team Mawu · Lomé, Togo · EA FC 26</div><div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:12px"><span style="font-size:12px;font-weight:700;color:#7C82FF;background:rgba(124,130,255,.1);border:1px solid rgba(124,130,255,.4);border-radius:999px;padding:6px 12px">ELO 2145</span><span style="font-size:12px;font-weight:700;color:#22D3EE;background:rgba(34,211,238,.08);border:1px solid rgba(34,211,238,.4);border-radius:999px;padding:6px 12px">Survival Rating S+</span><span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:#FBBF24;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.4);border-radius:999px;padding:6px 12px">${ic(I.crown, 14)}4 titres</span></div></div><div style="flex:1"></div><button style="background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:11px 18px;font-weight:700;font-size:13.5px;cursor:pointer">Modifier le profil</button></div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;margin-bottom:28px">${stats}</div><section class="grid2" style="display:grid;grid-template-columns:1.3fr 1fr;gap:18px;margin-bottom:26px"><div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px"><h3 style="margin:0 0 16px;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6;font-weight:750">Historique récent</h3><div style="display:flex;flex-direction:column;gap:2px">${hist}</div></div><div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px"><h3 style="margin:0 0 16px;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6;font-weight:750">Badges &amp; récompenses</h3><div style="display:flex;flex-direction:column;gap:10px">${badges}</div></div></section><div style="border:1px solid #282838;border-radius:16px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:20px"><h3 style="margin:0 0 16px;font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:#8E8FA6;font-weight:750">Inscriptions à venir</h3><div style="display:flex;flex-direction:column;gap:10px">${upc}</div></div></main>`;
}

function pTournoi(S: State) {
  const t = S.detail;
  if (!t) return `<main style="max-width:1220px;margin:0 auto;padding:40px 22px;text-align:center;color:#8E8FA6">Chargement du tournoi…</main>`;
  const statusMap: Record<string, [string, string]> = { setup: ["À lancer", "#8E8FA6"], live: ["En direct", "#22D3EE"], finished: ["Terminé", "#FBBF24"] };
  const [slabel, scolor] = statusMap[t.status] || ["", "#8E8FA6"];
  const dist = t.distributed || 0, total = t.cagnotte?.total || 0;
  const pct = total ? Math.min(100, (dist / total) * 100) : 0;

  const head = `<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:20px">
    <button data-back="1" style="display:inline-flex;align-items:center;gap:7px;background:#1B1B27;border:1px solid #33334A;color:#F4F5FB;border-radius:11px;padding:10px 14px;font-weight:700;font-size:13.5px;cursor:pointer">← Tournois</button>
    <div style="min-width:0"><h1 style="font-family:'Bebas Neue',sans-serif;font-size:clamp(28px,4vw,44px);letter-spacing:1px;margin:0;line-height:1">${t.name}</h1><div style="color:#8E8FA6;font-size:13px;margin-top:4px">${t.game || ""}</div></div>
    <span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:${scolor};background:rgba(34,211,238,.06);border:1px solid ${scolor}55;border-radius:99px;padding:6px 12px">${slabel}</span>
    <div style="flex:1"></div>
    <div style="min-width:220px"><div style="display:flex;justify-content:space-between;font-size:12px;color:#8E8FA6;margin-bottom:6px"><span>Cagnotte distribuée</span><span style="font-weight:700;color:#F4F5FB">${dist} / ${total} pts</span></div><div style="height:9px;border-radius:99px;background:#22222F;border:1px solid #282838;overflow:hidden"><span style="display:block;height:100%;width:${pct}%;background:linear-gradient(90deg,#22D3EE,#7C82FF)"></span></div></div>
  </div>`;

  // À lancer
  if (t.status === "setup") {
    return `<main style="max-width:1220px;margin:0 auto;padding:28px 22px 60px">${head}
      <div style="border:1px solid #282838;border-radius:18px;background:linear-gradient(180deg,#14141D,#0E0E16);padding:48px 24px;text-align:center">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:28px;letter-spacing:1px;margin-bottom:6px">Prêt à démarrer</div>
        <p style="color:#8E8FA6;font-size:14px;max-width:460px;margin:0 auto 22px">Le lancement répartit les joueurs en poules et démarre le mode Survival. L'ordre de passage est verrouillé.</p>
        <button data-launch="${t.id}" ${S.detailBusy ? "disabled" : ""} style="display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#22D3EE,#12aec4);color:#04222a;border:0;border-radius:12px;padding:14px 26px;font-weight:750;font-size:16px;cursor:${S.detailBusy ? "default" : "pointer"};opacity:${S.detailBusy ? ".6" : "1"};box-shadow:0 0 34px rgba(34,211,238,.24)">${ic(I.bolt)}${S.detailBusy ? "Lancement…" : "Lancer le tournoi"}</button>
      </div></main>`;
  }

  // Poule (match courant cliquable + classement)
  const poolCard = (p: Detail) => {
    let body: string;
    if (p.current) {
      const side = (id: string, name: string, cls: string, sub: string) => `<button data-report="${p.current.poolId}|${id}" style="flex:1;min-height:120px;border-radius:15px;border:1px solid ${cls === "surv" ? "rgba(34,211,238,.4)" : "rgba(244,63,126,.35)"};background:linear-gradient(180deg,${cls === "surv" ? "rgba(34,211,238,.08)" : "rgba(244,63,126,.05)"},#14141D);color:#F4F5FB;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:14px"><span style="font-size:10.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:${cls === "surv" ? "#22D3EE" : "#F43F7E"}">${sub}</span><span style="font-family:'Bebas Neue',sans-serif;font-size:30px;line-height:1;color:${cls === "surv" ? "#22D3EE" : "#F43F7E"}">${name}</span></button>`;
      const stageLabel: Record<string, string> = { survival: "Survival", losers: "Repêchage", poolFinal: "Finale de poule" };
      body = `<div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8E8FA6;font-weight:700;margin-bottom:10px">${stageLabel[p.current.stage] || p.current.stage}${p.current.streak > 1 ? " · série " + p.current.streak : ""} — touche le vainqueur</div>
        <div style="display:flex;align-items:stretch;gap:12px"><div style="flex:1">${side(p.current.aId, p.current.aName, "surv", p.current.stage === "poolFinal" ? "Champ. vainqueurs" : "Survivant")}</div><div style="display:flex;align-items:center;color:#5D5E72;font-family:'Bebas Neue',sans-serif;font-size:22px">VS</div><div style="flex:1">${side(p.current.bId, p.current.bName, "chal", p.current.stage === "poolFinal" ? "Champ. perdants" : "Challenger")}</div></div>`;
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
  const finalsBtn = t.allPoolsDone && !t.finals
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
          if (playable) return `<button data-reportf="${m.matchId}|${id}" style="display:block;width:100%;text-align:left;padding:9px 11px;background:transparent;border:0;color:#F4F5FB;cursor:pointer;font-family:inherit;font-size:14px">${name}</button>`;
          return `<div style="padding:9px 11px;color:${win ? "#22D3EE" : "#8E8FA6"};font-weight:${win ? 700 : 400}">${name}${win ? " ✓" : ""}</div>`;
        };
        if (m.bye) return `<div style="border:1px solid #282838;border-radius:10px;overflow:hidden;background:#14141D">${line(m.aName, m.aId, true, false)}<div style="padding:9px 11px;color:#5D5E72;font-style:italic;border-top:1px solid #22222F">exempt</div></div>`;
        return `<div style="border:1px solid ${m.playable ? "rgba(34,211,238,.4)" : "#282838"};border-radius:10px;overflow:hidden;background:#14141D">${line(m.aName, m.aId, m.winnerId === m.aId, m.playable)}<div style="border-top:1px solid #22222F">${line(m.bName, m.bId, m.winnerId === m.bId, m.playable)}</div></div>`;
      }).join("");
      return `<div style="display:flex;flex-direction:column;justify-content:space-around;gap:12px;min-width:180px"><div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8E8FA6;font-weight:700">${round.label}</div>${matches}</div>`;
    }).join("");
    finalsHtml = `<div style="margin-top:26px">${champ}<div style="font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:1px;margin-bottom:14px;display:flex;align-items:center;gap:10px"><span style="width:5px;height:22px;border-radius:3px;background:#22D3EE"></span>Phase finale</div><div style="display:flex;gap:24px;overflow-x:auto;padding-bottom:10px">${rounds}</div></div>`;
  }

  return `<main style="max-width:1220px;margin:0 auto;padding:28px 22px 60px;animation:fadeUp .4s ease both">${head}${finalsHtml || poolsHtml + finalsBtn}</main>`;
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
      ${isLogin ? "" : `<label style="font-size:12px;color:#8E8FA6;font-weight:600">Nom affiché<input id="a-name" placeholder="Kossi K9" style="${inputStyle}" /></label>`}
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

function renderPage(S: State) {
  const pages: Record<string, (s: State) => string> = { accueil: pAccueil, tournois: pTournois, classements: pClassements, boutique: pBoutique, profil: () => pProfil(), tournoi: pTournoi };
  const body = (pages[S.page] || pAccueil)(S);
  const footer = `<footer style="border-top:1px solid #282838;padding:26px 22px;text-align:center;color:#5D5E72;font-size:12.5px">VLOME Esport Platform · Le hub de l'esport togolais &amp; ouest-africain · Module Tournois propulsé par Survival Challonge</footer>`;
  return header(S) + body + footer + authModal(S) + cartDrawer(S);
}

/* ================= Composant ================= */
export default function Page() {
  const [S, setS] = useState<State>({
    page: "accueil", slide: 0, fmt: "Tous", scope: "Togo", game: "Tous", cat: "Tous",
    tourns: null, creating: false, busy: false,
    cartItems: [], cartOpen: false,
    user: null, authOpen: false, authTab: "login", authBusy: false, authError: "",
    openId: null, detail: null, detailBusy: false,
  });
  const html = useMemo(() => renderPage(S), [S]);

  /* ---------- Pilotage d'un tournoi ---------- */
  async function openDetail(id: string) {
    setS((s) => ({ ...s, page: "tournoi", openId: id, detail: null }));
    window.scrollTo({ top: 0 });
    try {
      const r = await fetch(`${API}/api/tournaments/${id}/state`);
      if (r.ok) { const d = await r.json(); setS((s) => ({ ...s, detail: d })); }
    } catch { /* API hors ligne */ }
  }
  async function act(url: string, body?: unknown) {
    setS((s) => ({ ...s, detailBusy: true }));
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      if (r.ok) { const d = await r.json(); setS((s) => ({ ...s, detail: d, detailBusy: false })); loadTournaments(); }
      else setS((s) => ({ ...s, detailBusy: false }));
    } catch { setS((s) => ({ ...s, detailBusy: false })); }
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
        body: JSON.stringify(isLogin ? { email, password } : { email, password, displayName }),
      });
      const data = await r.json();
      if (!r.ok) { setS((s) => ({ ...s, authBusy: false, authError: data.message || "Échec de la connexion." })); return; }
      localStorage.setItem("vlome_token", data.token);
      localStorage.setItem("vlome_user", JSON.stringify(data.user));
      setS((s) => ({ ...s, authBusy: false, authOpen: false, user: data.user }));
    } catch {
      setS((s) => ({ ...s, authBusy: false, authError: "API injoignable — démarre pnpm dev:api." }));
    }
  }
  function logout() {
    localStorage.removeItem("vlome_token"); localStorage.removeItem("vlome_user");
    setS((s) => ({ ...s, user: null }));
  }

  async function loadTournaments() {
    try {
      const r = await fetch(`${API}/api/tournaments`);
      if (!r.ok) return;
      const data: TournCard[] = await r.json();
      if (Array.isArray(data) && data.length) setS((s) => ({ ...s, tourns: data }));
    } catch { /* API hors ligne : repli statique */ }
  }

  // Montage : charge les tournois, restaure la session, gère #creer.
  useEffect(() => {
    loadTournaments();
    try {
      const u = localStorage.getItem("vlome_user");
      if (u) setS((s) => ({ ...s, user: JSON.parse(u) }));
    } catch { /* ignore */ }
    const h = typeof window !== "undefined" ? window.location.hash : "";
    if (h.startsWith("#t=")) openDetail(h.slice(3));
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
    setS((s) => ({ ...s, busy: true }));
    try {
      const r = await fetch(`${API}/api/tournaments`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
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
    const el = target.closest<HTMLElement>("[data-go],[data-slide],[data-fmt],[data-scope],[data-game],[data-cat],[data-act],[data-add-name],[data-cart-open],[data-cart-close],[data-cart-remove],[data-cart-clear],[data-checkout],[data-auth-open],[data-auth-close],[data-auth-tab],[data-auth-submit],[data-stop],[data-open],[data-back],[data-launch],[data-report],[data-finals-start],[data-reportf]");
    if (!el) return;
    const d = el.dataset;
    if (d.stop !== undefined) return; // clic à l'intérieur d'une modale : ne pas fermer
    if (d.open) { openDetail(d.open); }
    else if (d.back !== undefined) { setS((s) => ({ ...s, page: "tournois", detail: null, openId: null })); }
    else if (d.launch) { act(`${API}/api/tournaments/${d.launch}/launch`); }
    else if (d.finalsStart) { act(`${API}/api/tournaments/${d.finalsStart}/finals/start`); }
    else if (d.report) { const [poolId, winnerId] = d.report.split("|"); act(`${API}/api/tournaments/${S.openId}/report`, { poolId, winnerId }); }
    else if (d.reportf) { const [matchId, winnerId] = d.reportf.split("|"); act(`${API}/api/tournaments/${S.openId}/report`, { matchId, winnerId }); }
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
    else if (d.checkout !== undefined) { alert("Paiement à venir : Flooz, Mixx by Yas, carte (agrégateur)."); }
    else if (d.authOpen !== undefined) setS((s) => ({ ...s, authOpen: true, authError: "" }));
    else if (d.authClose !== undefined) setS((s) => ({ ...s, authOpen: false }));
    else if (d.authTab) setS((s) => ({ ...s, authTab: d.authTab as "login" | "register", authError: "" }));
    else if (d.authSubmit !== undefined) submitAuth();
    else if (d.act === "create-open") setS((s) => ({ ...s, creating: true }));
    else if (d.act === "create-cancel") setS((s) => ({ ...s, creating: false }));
    else if (d.act === "create-submit") submitCreate();
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(1200px 620px at 82% -12%,rgba(34,211,238,.10),transparent 62%),radial-gradient(1000px 520px at -6% 108%,rgba(244,63,126,.09),transparent 60%),#0B0B11",
      }}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
