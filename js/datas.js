// Zelo: datas AAAA-MM-DD e hora ISO (lógica pura, testada com node --test). No navegador vira o objeto global Datas.
// O relógio entra sempre por parâmetro (Date opcional), para poder testar.
var Datas = (function () {
  function pad(n, tam) {
    var s = String(n);
    while (s.length < (tam || 2)) s = "0" + s;
    return s;
  }
  function bissexto(a) {
    return (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;
  }
  function diasNoMes(a, m) {
    return [31, bissexto(a) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }

  // Só "AAAA-MM-DD" de verdade, ano de 2000 a 2099 (contrato 4).
  function valida(texto) {
    if (typeof texto !== "string") return false;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
    if (!m) return false;
    var a = Number(m[1]), mes = Number(m[2]), d = Number(m[3]);
    if (a < 2000 || a > 2099 || mes < 1 || mes > 12 || d < 1) return false;
    return d <= diasNoMes(a, mes);
  }

  // "AAAA-MM-DD" ou "D/M/AAAA" -> "AAAA-MM-DD"; o resto -> null.
  function deTexto(texto) {
    if (typeof texto !== "string") return null;
    var t = texto.replace(/^\s+|\s+$/g, "");
    if (valida(t)) return t;
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
    if (!m) return null;
    var iso = m[3] + "-" + pad(m[2]) + "-" + pad(m[1]);
    return valida(iso) ? iso : null;
  }

  function paraTela(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
    return m ? m[3] + "/" + m[2] + "/" + m[1] : "";
  }

  // Data local do celular (não UTC).
  function hoje(agora) {
    var d = agora || new Date();
    return pad(d.getFullYear(), 4) + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  // ISO 8601 UTC de 24 caracteres, para editado_em.
  function agoraIso(agora) {
    return (agora || new Date()).toISOString();
  }

  function mes(iso) {
    return String(iso).slice(0, 7);
  }
  function mesAnterior(ym) {
    var a = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) - 1;
    if (m < 1) { m = 12; a -= 1; }
    return pad(a, 4) + "-" + pad(m);
  }
  function mesSeguinte(ym) {
    var a = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) + 1;
    if (m > 12) { m = 1; a += 1; }
    return pad(a, 4) + "-" + pad(m);
  }
  function dosDoMes(ym) {
    var a = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
    return { de: ym + "-01", ate: ym + "-" + pad(diasNoMes(a, m)) };
  }

  return { valida: valida, deTexto: deTexto, paraTela: paraTela, hoje: hoje, agoraIso: agoraIso, mes: mes, mesAnterior: mesAnterior, mesSeguinte: mesSeguinte, dosDoMes: dosDoMes };
})();
if (typeof module !== "undefined") module.exports = Datas;
