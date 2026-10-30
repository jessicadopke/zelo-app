// Zelo: opções do formulário (categorias, pessoas e formas) copiadas da planilha para o celular (#18, parte B).
// Guarda só as três listas de textos em db.categorias (chave "lista"); nada disso fica escrito no código.
// Sem DOM e sem armazenamento próprio. Em erro da ponte, não mexe no que já estava guardado. No navegador vira o objeto global Opcoes.
var Opcoes = (function () {
  var LISTAS = ["categorias", "pessoas", "formas"];
  var UMA_HORA = 60 * 60 * 1000;
  var RE_CONTROLE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

  var emVoo = null;   // { db, promessa }: dois pedidos ao mesmo tempo viram um só
  var ultimaVez = 0;  // só em memória: ao reabrir o app, atualiza de novo

  // Lista de textos de 1 a 40 letras, sem quebra de linha. Devolve { lista, ignorados } ou null se não for lista.
  function limparLista(valor) {
    if (!Array.isArray(valor)) return null;
    var lista = [], ignorados = 0;
    valor.forEach(function (item) {
      var bom = typeof item === "string" && item.length >= 1 && item.length <= 40 && !RE_CONTROLE.test(item) && item.trim() !== "";
      if (bom) lista.push(item); else ignorados += 1;
    });
    return { lista: lista, ignorados: ignorados };
  }

  function formatoGuardado(v) {
    if (v === null || typeof v !== "object") return null;
    var saida = {};
    for (var i = 0; i < LISTAS.length; i++) {
      if (!Array.isArray(v[LISTAS[i]])) return null;
      saida[LISTAS[i]] = v[LISTAS[i]].filter(function (t) { return typeof t === "string"; });
    }
    return saida;
  }

  // O que está guardado no celular: { categorias, pessoas, formas }, ou null se nunca foi baixado.
  function ler(db) {
    return db.categorias.ler().then(formatoGuardado);
  }

  function igual(a, b) {
    if (!a || !b) return false;
    for (var i = 0; i < LISTAS.length; i++) {
      var x = a[LISTAS[i]], y = b[LISTAS[i]];
      if (x.length !== y.length) return false;
      for (var j = 0; j < x.length; j++) if (x[j] !== y[j]) return false;
    }
    return true;
  }

  function baixar(db, ponte) {
    return ponte.chamar("ler_categorias", {}).then(function (resp) {
      if (!resp || resp.ok !== true) {
        var codigo = resp && resp.erro && typeof resp.erro.codigo === "string" ? resp.erro.codigo : "resposta_estranha";
        return { parou: true, motivo: codigo };
      }
      var d = resp.dados;
      if (d === null || typeof d !== "object") return { parou: true, motivo: "resposta_estranha" };
      var novo = {}, ignorados = 0;
      for (var i = 0; i < LISTAS.length; i++) {
        var r = limparLista(d[LISTAS[i]]);
        if (!r) return { parou: true, motivo: "resposta_estranha" };
        novo[LISTAS[i]] = r.lista;
        ignorados += r.ignorados;
      }
      return ler(db).then(function (atual) {
        if (igual(atual, novo)) return { mudou: false, ignorados: ignorados };
        return db.categorias.gravar(novo).then(function () { return { mudou: true, ignorados: ignorados }; });
      });
    });
  }

  // Baixa as listas da planilha e guarda só se mudaram. Nunca lança.
  // Devolve { mudou, ignorados } ou { parou: true, motivo } (motivo = código do erro: sem_internet, codigo_invalido, sem_configuracao...).
  function atualizar(db, ponte, agora) {
    if (!ponte || typeof ponte.chamar !== "function") return Promise.resolve({ parou: true, motivo: "sem_configuracao" });
    if (emVoo && emVoo.db === db) return emVoo.promessa;
    var p = baixar(db, ponte).catch(function () { return { parou: true, motivo: "interno" }; }).then(function (res) {
      if (emVoo && emVoo.promessa === p) emVoo = null;
      if (!res.parou) ultimaVez = typeof agora === "number" ? agora : Date.now();
      return res;
    });
    emVoo = { db: db, promessa: p };
    return p;
  }

  // Para a tela Novo/Editar: só vai à ponte se já passou de 1 hora desde a última vez com sucesso (ou se nunca foi neste uso do app).
  function atualizarSeVelho(db, ponte, agora) {
    var t = typeof agora === "number" ? agora : Date.now();
    if (ultimaVez && t - ultimaVez < UMA_HORA) return Promise.resolve({ pulou: true });
    return atualizar(db, ponte, t);
  }

  // Só para os testes: volta ao estado de "app recém-aberto".
  function esquecer() { emVoo = null; ultimaVez = 0; }

  return { UMA_HORA: UMA_HORA, ler: ler, atualizar: atualizar, atualizarSeVelho: atualizarSeVelho, esquecer: esquecer };
})();
if (typeof module !== "undefined") module.exports = Opcoes;
