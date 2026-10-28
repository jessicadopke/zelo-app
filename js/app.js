// Zelo: núcleo do app. Navegação por abas, tema e cópia offline. O conteúdo das telas vem nas próximas partes.
// Depende de js/rotas.js (Rotas) e js/tema.js (Tema), carregados antes no index.html.
const APP_VERSION = "0.3.0";

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

(function () {
  if (typeof Rotas === "undefined" || typeof Tema === "undefined") return;
  const $ = (sel, raiz) => (raiz || document).querySelector(sel);
  const $$ = (sel, raiz) => Array.from((raiz || document).querySelectorAll(sel));
  const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

  // ---- navegação ----
  let atual = null;

  function mostrar(id) {
    const antes = atual;
    atual = id;
    const dir = antes ? Rotas.direcao(antes, id) : null;
    $$(".tela").forEach((t) => {
      t.hidden = t.dataset.tela !== id;
      t.classList.remove("entra-dir", "entra-esq");
    });
    const tela = $('.tela[data-tela="' + id + '"]');
    if (dir) {
      // Reinicia a animação mesmo se o toque vier durante a anterior.
      void tela.offsetWidth;
      tela.classList.add("entra-" + dir);
    }
    $$(".nav a").forEach((a) => {
      if (a.dataset.id === id) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    document.title = Rotas.titulo(id);
    const area = $("#conteudo");
    area.scrollTop = 0;
    area.focus({ preventScroll: true });
  }

  function ir(id) {
    if (id === atual) return;
    history.pushState({ aba: id }, "", "#" + id);
    mostrar(id);
  }

  $$(".nav a").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    ir(a.dataset.id);
  }));
  // Botão voltar do Android: mostra a aba anterior, sem empilhar de novo.
  window.addEventListener("popstate", () => mostrar(Rotas.abaDoHash(location.hash)));

  const inicial = Rotas.abaDoHash(location.hash);
  history.replaceState({ aba: inicial }, "", "#" + inicial);
  mostrar(inicial);
  // Na abertura o foco fica no começo da página, não na área da tela (evita contorno à toa).
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();

  // ---- início: saudação e mês (provisório até a tela de resumo) ----
  const agora = new Date();
  const h = agora.getHours();
  $("#saudacao").textContent = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  $("#inicio-apoio").textContent = "O resumo do mês de " + MESES[agora.getMonth()] + " chega em breve.";

  // ---- sem internet: aviso informativo, nunca erro ----
  function atualizarRede() {
    const sem = navigator.onLine === false;
    $("#faixa-semnet").hidden = !sem;
    $("#fila-texto").textContent = sem ? "Sem internet" : "Tudo enviado";
    $("#fila use").setAttribute("href", sem ? "#i-semnet" : "#i-ok");
  }
  window.addEventListener("online", atualizarRede);
  window.addEventListener("offline", atualizarRede);
  atualizarRede();

  // ---- tema (Ajustes > Aparência) ----
  const guardado = Tema.ler(localStorage);
  Tema.aplicar(document, guardado);
  $$('input[name="tema"]').forEach((r) => {
    r.checked = r.value === guardado;
    r.addEventListener("change", () => {
      if (!r.checked) return;
      Tema.aplicar(document, Tema.salvar(localStorage, r.value));
    });
  });
})();
