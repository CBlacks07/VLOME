/*
 * Miabe Esport — intégration d'une association sur un site externe.
 *
 *   <div id="miabe-club"></div>
 *   <script src="https://www.miabe-esport.community/embed.js" data-club="mon-association" async></script>
 *
 * Options : data-theme="light|dark" (sinon selon le visiteur), data-target="id-du-conteneur" (défaut : miabe-club).
 * Le contenu s'affiche dans une iframe qui ajuste sa hauteur toute seule.
 */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var slug = script.getAttribute("data-club");
  if (!slug) return;
  var origin;
  try { origin = new URL(script.src).origin; } catch (e) { return; }
  var theme = script.getAttribute("data-theme");
  var frame = document.createElement("iframe");
  frame.src = origin + "/embed/club/" + encodeURIComponent(slug) + (theme ? "?theme=" + encodeURIComponent(theme) : "");
  frame.title = "Miabe Esport";
  frame.loading = "lazy";
  frame.style.cssText = "width:100%;min-height:480px;border:0;border-radius:12px;display:block";
  var target = document.getElementById(script.getAttribute("data-target") || "miabe-club");
  if (target) target.appendChild(frame);
  else script.parentNode.insertBefore(frame, script);
  window.addEventListener("message", function (e) {
    if (e.origin !== origin) return;
    var d = e.data;
    if (d && d.miabeEmbed === "height" && d.slug === slug && typeof d.height === "number") frame.style.height = Math.max(240, d.height) + "px";
  });
})();
